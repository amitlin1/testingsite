import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import type { Actor } from "@/lib/auth/identity";
import { PACKAGE_ROLES, TEMPLATE_CONFLICT, allComponentsOf, fillVariables } from "./schema";
import type { PackageRole, PhotoComponent, PopupTemplateConfig, PopupTemplateJson, TemplateBase, TemplateSummaryJson } from "./schema";
import { savePhotoGroup } from "@/app/lib/station-fields/photo-groups";
import { shapeOr400 } from "@/app/lib/station-fields/validate";
import { lintPopupTemplate, parsePopupTemplateConfig, parseTemplateBase } from "./validate";
import type { TemplateIssue } from "./validate";

/**
 * The popup templates in the database (docs/popup-templates/PLAN.md §3, step 1.2):
 *
 *   station_popup_templates          the current template of a station type
 *   station_popup_template_versions  every saved config, by (type, version)
 *   photo_types                      one group per photo component (test_station_type_id + component_id)
 *
 * A save is one transaction: the template row, its version row, and the photo groups of its photo
 * components. A component that names an existing group's code links that group (the seed's way of
 * keeping today's reference images); a new code creates the group. A photo component that left the
 * template leaves its group linked but inactive, so its images and photos keep their name.
 *
 * Errors are HttpErrors ({ error, code, ...extra }) — the API answers them as they are.
 */

type Db = PrismaClient | TransactionClient;

type TemplateRow = {
  test_station_type_id: number;
  base: string;
  config: unknown;
  version: number;
  updated_at: Date;
  updated_by: string | null;
};

function toJson(row: TemplateRow): PopupTemplateJson {
  return {
    station_type_id: row.test_station_type_id,
    base: parseTemplateBase(row.base),
    version: row.version,
    // Parsed on the way out too: a row a script wrote by hand never reaches a popup unchecked.
    config: parsePopupTemplateConfig(row.config),
    updated_at: row.updated_at.toISOString(),
    updated_by: row.updated_by,
  };
}

/** The template of a station type, or null when it has none. */
export async function getTemplate(typeId: number, db: Db = prisma): Promise<PopupTemplateJson | null> {
  const row = await db.station_popup_templates.findUnique({ where: { test_station_type_id: typeId } });
  return row ? toJson(row) : null;
}

/** Which station types have a template, and its base and version — the testing page and the
 *  settings list read this, never the configs. */
export async function listTemplateSummaries(db: Db = prisma): Promise<TemplateSummaryJson[]> {
  const rows = await db.station_popup_templates.findMany({
    select: { test_station_type_id: true, base: true, version: true, config: true, updated_at: true, updated_by: true },
    orderBy: { test_station_type_id: "asc" },
  });
  return rows.map((r) => {
    // A package template's role (PLAN.md §5): the editor's list and the routes page's warning read it.
    const role = (r.config as { role?: unknown } | null)?.role;
    return {
      station_type_id: r.test_station_type_id,
      base: parseTemplateBase(r.base),
      version: r.version,
      role: (PACKAGE_ROLES as readonly unknown[]).includes(role) ? (role as PackageRole) : null,
      updated_at: r.updated_at.toISOString(),
      updated_by: r.updated_by,
    };
  });
}

/** The body of a PUT { base, config, expected_version } (a JSON object, readJsonObject), checked —
 *  expected_version is the version the editor started from, null when it believed there was no
 *  template. Shape errors → 400. */
export function parseSaveInput(b: Record<string, unknown>): { base: TemplateBase; config: PopupTemplateConfig; expectedVersion: number | null } {
  const ev = b.expected_version;
  if (ev !== null && !(Number.isSafeInteger(ev) && (ev as number) >= 1)) throw new HttpError(400, "expected_version חסר או לא תקין", { code: "INVALID_BODY" });
  return shapeOr400(() => ({ base: parseTemplateBase(b.base), config: parsePopupTemplateConfig(b.config), expectedVersion: ev as number | null }));
}

/**
 * Saves a station type's template as a new version.
 *   404 STATION_TYPE_NOT_FOUND
 *   409 BASE_MISMATCH          the item base on a package-level type (or the reverse)
 *   409 BASE_CHANGED           a template's base never changes; delete it and start again
 *   409 TEMPLATE_CONFLICT      someone saved since the editor loaded { current }
 *   422 TEMPLATE_INVALID       content issues { issues }
 *   409 PHOTO_CODE_TAKEN       a photo component names a group another component owns { photo_code }
 */
export async function saveTemplate(
  typeId: number,
  input: { base: TemplateBase; config: PopupTemplateConfig; expectedVersion: number | null },
  actor: Actor,
): Promise<PopupTemplateJson> {
  return prisma.$transaction(async (tx) => {
    const type = await tx.test_stations_type.findUnique({
      where: { test_station_type_id: typeId },
      select: { test_type_desc: true, package_level: true },
    });
    if (!type) throw new HttpError(404, "סוג העמדה לא נמצא", { code: "STATION_TYPE_NOT_FOUND" });
    const wantsPackage = input.base === "package";
    if (type.package_level !== wantsPackage) {
      throw new HttpError(409, type.package_level ? "לעמדה ברמת מארז מתאים רק בסיס למארז" : "לעמדה של פריט מתאים רק בסיס לפריט", { code: "BASE_MISMATCH" });
    }
    // The content, by the rules of its base — once the base itself fits the station type.
    const issues: TemplateIssue[] = lintPopupTemplate(input.config, input.base);
    if (issues.length > 0) throw new HttpError(422, "בתבנית יש בעיות לתיקון", { code: "TEMPLATE_INVALID", extra: { issues } });

    // Row-locked, so two saves of one type queue rather than both read the same version.
    const current = await tx.$queryRaw<TemplateRow[]>`
      SELECT test_station_type_id, base, config, version, updated_at, updated_by
      FROM station_popup_templates WHERE test_station_type_id = ${typeId} FOR UPDATE`;
    const cur = current[0] ?? null;
    if ((cur?.version ?? null) !== input.expectedVersion) {
      throw new HttpError(409, "התבנית נשמרה בינתיים על ידי מישהו אחר", { code: TEMPLATE_CONFLICT, extra: { current: cur ? toJson(cur) : null } });
    }
    if (cur && cur.base !== input.base) throw new HttpError(409, "אי אפשר לשנות את הבסיס של תבנית קיימת", { code: "BASE_CHANGED" });

    const last = await tx.station_popup_template_versions.aggregate({ where: { test_station_type_id: typeId }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const config = input.config as unknown as object;

    await syncPhotoGroups(tx, typeId, type.test_type_desc.trim(), input.config);

    await tx.station_popup_template_versions.create({
      data: { test_station_type_id: typeId, version, base: input.base, config, created_by: actor.username },
    });
    const row = await tx.station_popup_templates.upsert({
      where: { test_station_type_id: typeId },
      create: { test_station_type_id: typeId, base: input.base, config, version, updated_by: actor.username },
      update: { config, version, updated_at: new Date(), updated_by: actor.username },
    });
    return toJson(row);
  });
}

/** The photo groups of a template's photo components: linked or created, named "{type} · {title}",
 *  active; the type's groups no component holds any more go inactive (still linked). */
async function syncPhotoGroups(tx: TransactionClient, typeId: number, typeName: string, cfg: PopupTemplateConfig): Promise<void> {
  const photos = allComponentsOf(cfg).filter((c): c is PhotoComponent => c.kind === "photo");
  for (const c of photos) {
    await savePhotoGroup(tx, c.photo_code, {
      test_station_type_id: typeId, component_id: c.id,
      photo_type_desc: `${typeName} · ${fillVariables(c.title, { station: typeName })}`.slice(0, 255),
      is_active: true,
    }, (existing) =>
      // Another type's group is taken. Within this type it moves to the component that names it
      // now — the lint already refuses two components of one template on one code.
      existing.component_id != null && existing.test_station_type_id !== typeId
        ? new HttpError(409, "קבוצת התמונות של רכיב הצילום שייכת לסוג עמדה אחר", { code: "PHOTO_CODE_TAKEN", extra: { photo_code: c.photo_code, component_id: c.id } })
        : null);
  }
  await tx.photo_types.updateMany({
    where: { test_station_type_id: typeId, component_id: { notIn: photos.map((c) => c.id) } },
    data: { is_active: false },
  });
}

/**
 * Deletes a station type's template: the type opens the popup the code gives it again. Its photo
 * groups are released (no owner, active), as they were before a template owned them; the versions
 * stay. 404 TEMPLATE_NOT_FOUND when there is none.
 */
export async function deleteTemplate(typeId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const gone = await tx.station_popup_templates.deleteMany({ where: { test_station_type_id: typeId } });
    if (gone.count === 0) throw new HttpError(404, "לסוג העמדה אין תבנית", { code: "TEMPLATE_NOT_FOUND" });
    await tx.photo_types.updateMany({
      where: { test_station_type_id: typeId },
      data: { test_station_type_id: null, component_id: null, is_active: true },
    });
  });
}
