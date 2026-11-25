import { isResearchStatus } from "@/lib/item-status";
import { GATE_FINISH_ON_REQUIRED } from "./evaluate";
import { fieldPhotoCode, stepConfigOf, stepUidAt, targetKey } from "./schema";
import type { Field, KitItemFields, KitItemGroup, RouteFieldsConfig, StationFieldsResponse, StepConfig } from "./schema";
import { ShapeError, parseRouteFieldsConfig } from "./validate";

/**
 * Which fields a popup shows for a row at its current step (route-fields spec §3.3, steps 2–5),
 * on data the API route already loaded. Anything doubtful answers { mode: "legacy" }: today's
 * popup, unchanged — the safe fallback everywhere.
 */

export type ResolveRoute = {
  test_route_id: number;
  route_steps: readonly number[] | null;
  /** Parallel to route_steps; a different length means "no uids yet" → legacy. */
  step_uids: readonly string[] | null;
};

export type ResolveKitItem = { item_id: string; package_seq: number; item_type_id: number; item_type_desc: string };

export interface ResolveInput {
  /** The row's route: item_routes ⋈ testing_routes on (item_type_id, route_number). */
  route: ResolveRoute;
  /** item_routes.fields_version of this row — for a kit row, the kit route's version, which also
   *  governs the items inside it at package-level steps. NULL = intake predates station fields. */
  fields_version: number | null;
  /** item_routes.current_route_step (1-based). */
  current_route_step: number;
  /** item_routes.current_status — research (isResearchStatus) is always legacy. */
  current_status: number | null;
  /** The station opening the popup is a research station (test_stations.is_research). */
  stationIsResearch: boolean;
  /** test_stations_type.package_level of route_steps[current_route_step - 1]. */
  stepIsPackageLevel: boolean;
  /** loadPackageContext(...).isPackage — the row is a kit (the box). */
  rowIsPackage: boolean;
  /** route_field_versions(test_route_id, fields_version).config exactly as stored, or null when
   *  there is no such version. It is parsed here; a config that does not parse is legacy. */
  config: unknown;
  /** Kit rows: every item inside the kit (items.package_id = the kit). Ignored for item rows. */
  kitItems: readonly ResolveKitItem[];
}

/** Today's popup, unchanged — the answer for anything doubtful. */
export const LEGACY_FIELDS: StationFieldsResponse = { mode: "legacy" };


const hasInput = (fields: readonly Field[]): boolean => fields.some((f) => f.type !== "section");

function groupFields(step: StepConfig, key: string): Field[] {
  return step.groups.find((g) => targetKey(g.target) === key)?.fields ?? [];
}

/** A kit item's groups at a package-level step: "each_item" first, then its own item type.
 *  A group without a single input field (none, or section headers only) is left out. */
export function kitItemGroups(step: StepConfig, itemTypeId: number): KitItemGroup[] {
  const out: KitItemGroup[] = [];
  const each = groupFields(step, targetKey("each_item"));
  if (hasInput(each)) out.push({ target: "each_item", fields: each });
  const ofType = groupFields(step, targetKey({ item_type_id: itemTypeId }));
  if (hasInput(ofType)) out.push({ target: { item_type_id: itemTypeId }, fields: ofType });
  return out;
}

/** The step with every photo field tagging its shots with its own group (fieldPhotoCode) — in
 *  every frozen version alike, whatever group an older config stored. The popup uploads with it,
 *  and the submit check compares against it. */
function withFieldPhotoGroups(step: StepConfig, routeId: number): StepConfig {
  return {
    ...step,
    groups: step.groups.map((g) => ({
      ...g,
      fields: g.fields.map((f) => (f.type === "photo" ? { ...f, photo_type: fieldPhotoCode(routeId, step.uid, f.id) } : f)),
    })),
  };
}

function parseConfig(raw: unknown): RouteFieldsConfig | null {
  if (raw == null) return null;
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (e instanceof ShapeError) return null;
    throw e;
  }
}

export function resolveStationFields(input: ResolveInput): StationFieldsResponse {
  const legacy = LEGACY_FIELDS;
  // Research popups (PopUpTestDialog in research mode) never show fields before phase 3, and
  // current_route_step still points at the step the item was sent from.
  if (isResearchStatus(input.current_status) || input.stationIsResearch) return legacy;
  const v = input.fields_version;
  if (v == null || !Number.isSafeInteger(v) || v < 1) return legacy;
  const uid = stepUidAt(input.route, input.current_route_step);
  if (uid == null) return legacy;
  // A box only meets fields at package-level steps, an item only at per-item steps (an item inside
  // a kit at a package-level step is shown on the kit's card — the popup opens on the box).
  if (input.rowIsPackage !== input.stepIsPackageLevel) return legacy;
  const config = parseConfig(input.config);
  const stored = config ? stepConfigOf(config, uid) : undefined;
  if (!stored) return legacy;

  const route_id = input.route.test_route_id;
  const step = withFieldPhotoGroups(stored, route_id);
  if (!input.rowIsPackage) {
    const fields = groupFields(step, targetKey("item"));
    if (!hasInput(fields)) return legacy;
    return { mode: "item", schema: { route_id, v, step_uid: uid, target: "item" }, fields, gate: GATE_FINISH_ON_REQUIRED };
  }

  const box = groupFields(step, targetKey("box"));
  const items: KitItemFields[] = [...input.kitItems]
    .sort((a, b) => a.package_seq - b.package_seq || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0))
    .map((it) => ({
      item_id: it.item_id,
      package_seq: it.package_seq,
      item_type_id: it.item_type_id,
      item_type_desc: it.item_type_desc,
      groups: kitItemGroups(step, it.item_type_id),
    }));
  if (!hasInput(box) && items.every((it) => it.groups.length === 0)) return legacy;
  return {
    mode: "package",
    schema: { route_id, v, step_uid: uid },
    box: hasInput(box) ? box : [],
    items,
    gate: GATE_FINISH_ON_REQUIRED,
  };
}
