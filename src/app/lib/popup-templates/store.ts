import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import type { TransactionClient } from "@/app/lib/prisma";
import { PACKAGE_ROLES, allComponentsOf, fillVariables } from "./schema";
import type { PackageRole, PhotoComponent, PopupTemplateConfig, PopupTemplateJson, TemplateBase } from "./schema";
import { TemplateShapeError, lintPopupTemplate, parsePopupTemplateConfig, parseTemplateBase } from "./validate";
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
 * Errors are TemplateStoreError { status, code, ...body } — the API answers them as they are.
 */

export type Actor = { username: string; name: string | null };

export class TemplateStoreError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "TemplateStoreError";
    this.status = status;
    this.code = code;
    this.body = { error: message, code, ...extra };
  }
}

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
export async function listTemplateSummaries(db: Db = prisma): Promise<{
  station_type_id: number; base: TemplateBase; version: number; role: PackageRole | null; updated_at: string; updated_by: string | null;
}[]> {
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

export type SaveTemplateInput = {
  base: unknown;
  config: unknown;
  /** The version the editor started from; null = it believed there was no template. */
  expected_version: unknown;
};

/** The body of a PUT, checked: base, config (shape), expected_version. Shape errors → 400. */
export function parseSaveInput(body: unknown): { base: TemplateBase; config: PopupTemplateConfig; expectedVersion: number | null } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new TemplateStoreError(400, "INVALID_BODY", "גוף הבקשה אינו אובייקט");
  const b = body as SaveTemplateInput;
  const ev = b.expected_version;
  if (ev !== null && !(Number.isSafeInteger(ev) && (ev as number) >= 1)) throw new TemplateStoreError(400, "INVALID_BODY", "expected_version חסר או לא תקין");
  try {
    return { base: parseTemplateBase(b.base), config: parsePopupTemplateConfig(b.config), expectedVersion: ev as number | null };
  } catch (e) {
    if (e instanceof TemplateShapeError) throw new TemplateStoreError(400, e.code, e.message, { path: e.path });
    throw e;
  }
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
    if (!type) throw new TemplateStoreError(404, "STATION_TYPE_NOT_FOUND", "סוג העמדה לא נמצא");
    const wantsPackage = input.base === "package";
    if (type.package_level !== wantsPackage) {
      throw new TemplateStoreError(409, "BASE_MISMATCH", type.package_level ? "לעמדה ברמת מארז מתאים רק בסיס למארז" : "לעמדה של פריט מתאים רק בסיס לפריט");
    }
    // The content, by the rules of its base — once the base itself fits the station type.
    const issues: TemplateIssue[] = lintPopupTemplate(input.config, input.base);
    if (issues.length > 0) throw new TemplateStoreError(422, "TEMPLATE_INVALID", "בתבנית יש בעיות לתיקון", { issues });

    // Row-locked, so two saves of one type queue rather than both read the same version.
    const current = await tx.$queryRaw<TemplateRow[]>`
      SELECT test_station_type_id, base, config, version, updated_at, updated_by
      FROM station_popup_templates WHERE test_station_type_id = ${typeId} FOR UPDATE`;
    const cur = current[0] ?? null;
    if ((cur?.version ?? null) !== input.expectedVersion) {
      throw new TemplateStoreError(409, "TEMPLATE_CONFLICT", "התבנית נשמרה בינתיים על ידי מישהו אחר", { current: cur ? toJson(cur) : null });
    }
    if (cur && cur.base !== input.base) throw new TemplateStoreError(409, "BASE_CHANGED", "אי אפשר לשנות את הבסיס של תבנית קיימת");

    const last = await tx.station_popup_template_versions.aggregate({ where: { test_station_type_id: typeId }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const config = input.config as unknown as object;

    await syncPhotoGroups(tx, typeId, type.test_type_desc.trim(), input.config);

    await tx.station_popup_template_versions.create({
      data: { test_station_type_id: typeId, version, base: input.base, config, created_by: actor.username || null },
    });
    const row = await tx.station_popup_templates.upsert({
      where: { test_station_type_id: typeId },
      create: { test_station_type_id: typeId, base: input.base, config, version, updated_by: actor.username || null },
      update: { config, version, updated_at: new Date(), updated_by: actor.username || null },
    });
    return toJson(row);
  });
}

/** The photo groups of a template's photo components: linked or created, named "{type} · {title}",
 *  active; the type's groups no component holds any more go inactive (still linked). */
async function syncPhotoGroups(tx: TransactionClient, typeId: number, typeName: string, cfg: PopupTemplateConfig): Promise<void> {
  const photos = allComponentsOf(cfg).filter((c): c is PhotoComponent => c.kind === "photo");
  const descOf = (c: PhotoComponent) => `${typeName} · ${fillVariables(c.title, { station: typeName })}`.slice(0, 255);
  let nextSort = ((await tx.photo_types.aggregate({ _max: { sort_order: true } }))._max.sort_order ?? 0) + 1;

  for (const c of photos) {
    const existing = await tx.photo_types.findUnique({ where: { code: c.photo_code } });
    if (existing) {
      // Another type's group is taken. Within this type it moves to the component that names it
      // now — the lint already refuses two components of one template on one code.
      const ownedElsewhere = existing.component_id != null && existing.test_station_type_id !== typeId;
      if (ownedElsewhere) throw new TemplateStoreError(409, "PHOTO_CODE_TAKEN", "קבוצת התמונות של רכיב הצילום שייכת לסוג עמדה אחר", { photo_code: c.photo_code, component_id: c.id });
      await tx.photo_types.update({
        where: { photo_type_id: existing.photo_type_id },
        data: { test_station_type_id: typeId, component_id: c.id, photo_type_desc: descOf(c), is_active: true },
      });
    } else {
      await tx.photo_types.create({
        data: { code: c.photo_code, photo_type_desc: descOf(c), sort_order: nextSort++, is_active: true, test_station_type_id: typeId, component_id: c.id },
      });
    }
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
    if (gone.count === 0) throw new TemplateStoreError(404, "TEMPLATE_NOT_FOUND", "לסוג העמדה אין תבנית");
    await tx.photo_types.updateMany({
      where: { test_station_type_id: typeId },
      data: { test_station_type_id: null, component_id: null, is_active: true },
    });
  });
}
