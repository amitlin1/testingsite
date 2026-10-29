import type { TransactionClient } from "@/app/lib/prisma";
import { fieldPhotoCode } from "./schema";
import type { FieldId, RouteFieldsConfig, StepUid } from "./schema";

/**
 * The photo groups of a route's photo fields (docs/popup-templates/PLAN.md §5א). A photo field owns
 * its group: one photo_types row per route, step and field, code fieldPhotoCode(...), named
 * "{station type} · {field label}". Publishing creates the rows of the published config and renames
 * them after the field; a field that leaves the route keeps its row, so the photos it took keep
 * their name. The rows are not offered for reference images (GET /api/settings/photo-types lists
 * them only with ?all=1) — a photo field shows none.
 *
 * prisma/migrations/20261029120000_field_photo_groups creates the same rows for the versions
 * published before; its SQL builds the name the same way.
 */

export type FieldPhotoGroup = {
  code: string;
  step_uid: StepUid;
  field_id: FieldId;
  label: string;
  /** The step's station type as the config recorded it (StepConfig.station_type_id / station_label). */
  station_type_id: number;
  station_label: string;
};

/** Every photo field of a config, in step and group order. */
export function fieldPhotoGroupsOf(cfg: RouteFieldsConfig, routeId: number): FieldPhotoGroup[] {
  const out: FieldPhotoGroup[] = [];
  for (const [uid, step] of Object.entries(cfg.steps)) {
    for (const g of step.groups) {
      for (const f of g.fields) {
        if (f.type !== "photo") continue;
        out.push({
          code: fieldPhotoCode(routeId, uid, f.id),
          step_uid: uid,
          field_id: f.id,
          label: f.label,
          station_type_id: step.station_type_id,
          station_label: step.station_label,
        });
      }
    }
  }
  return out;
}

/** "{station type} · {field label}", at most photo_types.photo_type_desc's 255; an unnamed field
 *  reads "צילום" (the field type's name). */
export function fieldPhotoGroupDesc(stationName: string, fieldLabel: string): string {
  return `${stationName.trim()} · ${fieldLabel.trim() || "צילום"}`.slice(0, 255);
}

/** Creates or renames the groups of a route's photo fields, inside the publish transaction. */
export async function syncFieldPhotoGroups(tx: TransactionClient, routeId: number, cfg: RouteFieldsConfig): Promise<void> {
  const groups = fieldPhotoGroupsOf(cfg, routeId);
  if (groups.length === 0) return;
  const typeIds = [...new Set(groups.map((g) => g.station_type_id))];
  const types = await tx.test_stations_type.findMany({
    where: { test_station_type_id: { in: typeIds } },
    select: { test_station_type_id: true, test_type_desc: true },
  });
  const typeName = new Map(types.map((t) => [t.test_station_type_id, t.test_type_desc.trim()]));
  let nextSort = ((await tx.photo_types.aggregate({ _max: { sort_order: true } }))._max.sort_order ?? 0) + 1;

  for (const g of groups) {
    const photo_type_desc = fieldPhotoGroupDesc(typeName.get(g.station_type_id) || g.station_label, g.label);
    const owner = { test_route_id: routeId, step_uid: g.step_uid, field_id: g.field_id };
    const existing = await tx.photo_types.findUnique({ where: { code: g.code }, select: { photo_type_id: true } });
    if (existing) {
      await tx.photo_types.update({ where: { photo_type_id: existing.photo_type_id }, data: { ...owner, photo_type_desc, is_active: true } });
    } else {
      await tx.photo_types.create({ data: { code: g.code, ...owner, photo_type_desc, sort_order: nextSort++, is_active: true } });
    }
  }
}
