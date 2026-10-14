import { targetKey } from "@/app/lib/station-fields/schema";
import type { Change } from "@/app/lib/station-fields/diff";
import type {
  ApplyMode, FieldsContextJson, PublishImpactJson, PublishImpactRouteJson, PublishResultJson,
} from "@/app/lib/station-fields/admin-types";
import { contextRoutes, entryHasDraft } from "./draftModel";
import type { DraftModel } from "./draftModel";
import type { FieldsMapModel } from "./mapModel";
import {
  fieldAddedText, fieldRemovedText, filledWarnText, genericChangeText, groupCountText, groupTitleText,
  layoutGroupTitleText, optionAddedText, requiredOnText, setFilledText, sharedOutsideText, sharedRoutePart,
} from "./publishLabels";

/**
 * The publish dialog's model (artboard 10, route-fields spec §5.11, §3.4.2, §3.4.3, §10.2-4) —
 * pure: the requests' bodies, the answers checked, the version the dialog names, and "מה השתנה"
 * grouped from the preview's changes. PublishDialog.tsx draws it.
 *
 * Groups: one per (route, station) — a station being the step a change sits on — titled
 * "{station} · {item}" ("חשמל · מחשב"), the station alone on the kit's own route ("סגירת מארז"),
 * under the route's label ("מסלול 1 של מחשב" / "מסלול המארז"). A step's layout rows are a group of
 * their own, "פריסת החלון · {station}", after every field group (artboard 10). Groups follow the
 * fields map: column by column, row by row inside a column; a step the map does not show comes
 * after, by route and position.
 *
 * Lines, in the order of the changes (artboard 10 table, spec §5.11):
 *   field_added                      "נוסף '{label}'"                          badge add
 *   field_added with from_set        "{n} תאים מולאו מהערכה '{set}'" — ONE line per set and group,
 *                                    n = the cells (targets) of the group it filled  badge add
 *   field_changed + option_added     "'{field}': נוספה אפשרות '{opt}'"          badge edit
 *   field_changed + required: true   "'{field}' סומן כחובה"                     badge edit
 *   field_removed                    "נמחק '{label}'" + "מולא ב-{n} בדיקות, …"  badge del
 *   anything else (undrawn)     "'{label}'" — once per field and cell      badge edit
 *   step_removed (undrawn)      "'{station}'"                              badge del
 * A group's count is its lines ("שינוי אחד" / "{n} שינויים", artboard 10 `count`).
 */

export type PublishBadge = "add" | "edit" | "del";

export type PublishLine = {
  badge: PublishBadge;
  text: string;
  /** "· {warn}" in warning ink after the text, or null. */
  warn: string | null;
};

export type PublishGroup = {
  /** "{route_id}:{step_uid}" (":layout" for a layout group) — stable while the dialog is open. */
  key: string;
  title: string;
  /** The route's label from the preview: "מסלול 1 של מחשב" / "מסלול המארז". */
  sub: string;
  /** Other kits run this route (shared_outside) — the "משותף" Tag. */
  shared: boolean;
  /** "שינוי אחד" / "{n} שינויים" — counts the lines. */
  count: string;
  lines: PublishLine[];
};

// ---- requests ------------------------------------------------------------------------------------------
export const PUBLISH_PREVIEW_URL = "/api/settings/testing-routes/fields/publish-preview";
export const PUBLISH_URL = "/api/settings/testing-routes/fields/publish";
/** GET → the field sets (session 2d): their names for "מולאו מהערכה '{set}'". */
export const FIELD_SETS_URL = "/api/settings/field-sets";

/** The route the screen is open on: the kit's own route, or the single item route. */
export function ownRouteId(context: FieldsContextJson): number | null {
  return (context.kit ?? context.item)?.route.test_route_id ?? null;
}

/** The kit on screen (publish-preview's context_kit_id), or null on a single item route. */
export function contextKitId(context: FieldsContextJson): number | null {
  return context.kind === "package" ? context.subject.item_type_id : null;
}

/** POST …/fields/publish-preview: the routes with a draft, and the kit on screen — its route is
 *  "מסלול המארז" and it is not "outside" for the warning note. */
export function previewRequestBody(routeIds: readonly number[], kitId: number | null): { route_ids: number[]; context_kit_id?: number } {
  return kitId == null ? { route_ids: [...routeIds] } : { route_ids: [...routeIds], context_kit_id: kitId };
}

/** POST …/fields/publish: the same routes, at exactly the draft_revs the preview showed. */
export function publishRequestBody(
  routeIds: readonly number[], impact: Pick<PublishImpactJson, "base_revs">, applyMode: ApplyMode, note: string,
): { route_ids: number[]; base_revs: Record<number, number>; apply_mode: ApplyMode; note: string } {
  const baseRevs: Record<number, number> = {};
  for (const id of routeIds) baseRevs[id] = impact.base_revs[id];
  return { route_ids: [...routeIds], base_revs: baseRevs, apply_mode: applyMode, note };
}

// ---- answers --------------------------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;

/** The `code` of an error answer ({ error, code, … }), or null. */
export function errorCode(body: unknown): string | null {
  return isObj(body) && typeof body.code === "string" ? body.code : null;
}

const isTarget = (v: unknown): boolean =>
  v === "item" || v === "box" || v === "each_item" || (isObj(v) && isId(v.item_type_id));

function isChange(v: unknown): v is Change {
  return isObj(v) && typeof v.step_uid === "string" && typeof v.kind === "string" && typeof v.label === "string"
    && isTarget(v.target) && (v.field_id === undefined || typeof v.field_id === "string")
    && (v.detail === undefined || isObj(v.detail)) && (v.filled_count === undefined || isCount(v.filled_count));
}

function isImpactRoute(v: unknown): v is PublishImpactRouteJson {
  return isObj(v) && isId(v.route_id) && typeof v.label === "string" && isId(v.item_type_id)
    && typeof v.item_type_desc === "string" && isId(v.route_number) && isCount(v.from_version)
    && isCount(v.to_version) && Array.isArray(v.changes) && v.changes.every(isChange);
}

/** A 200 of publish-preview, checked before the dialog builds on it; null when it is not one. */
export function parsePublishImpact(raw: unknown): PublishImpactJson | null {
  if (!isObj(raw) || !Array.isArray(raw.routes) || !raw.routes.every(isImpactRoute)) return null;
  const t = raw.totals;
  if (!isObj(t) || !isCount(t.changes) || !isCount(t.stations) || !isCount(t.routes)) return null;
  if (!Array.isArray(raw.shared_outside) || !raw.shared_outside.every((s) => isObj(s) && isId(s.route_id)
    && typeof s.item_type_desc === "string" && isId(s.route_number) && Array.isArray(s.kits)
    && s.kits.every((k) => isObj(k) && isId(k.package_type_id) && typeof k.desc === "string"))) return null;
  if (!isCount(raw.items_on_routes) || !isCount(raw.not_reached) || !Array.isArray(raw.by_version) || !Array.isArray(raw.issues)) return null;
  const revs = raw.base_revs;
  if (!isObj(revs) || !Object.values(revs).every(isCount)) return null;
  return raw as unknown as PublishImpactJson;
}

/** A 200 of publish; null when it is not one. */
export function parsePublishResult(raw: unknown): PublishResultJson | null {
  if (!isObj(raw) || typeof raw.publish_batch !== "string" || !isObj(raw.versions) || !isCount(raw.bumped_items)) return null;
  if (!Object.values(raw.versions).every(isCount)) return null;
  return raw as unknown as PublishResultJson;
}

/** GET /api/settings/field-sets → { id: name }; {} for anything that is not a list of sets. */
export function parseSetNames(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!Array.isArray(raw)) return out;
  for (const s of raw) {
    if (isObj(s) && isId(s.id) && typeof s.name === "string") out[s.id] = s.name.trim();
  }
  return out;
}

// ---- versions -----------------------------------------------------------------------------------------
export type PublishVersion = { version: number; fromVersion: number };

/**
 * "גרסה N" of the dialog (spec §3.4.3, §10.2-4): the version the route on screen becomes — the kit
 * route on a kit, the item route on an item route — with the version it replaces ("v-1"). When that
 * route has no draft (only item routes change) it is the newest version of the batch, as the header
 * names the newest published one for a kit route never published. null when nothing is published.
 */
export function publishVersion(impact: Pick<PublishImpactJson, "routes">, ownId: number | null): PublishVersion | null {
  const own = impact.routes.find((r) => r.route_id === ownId);
  const pick = own ?? impact.routes.reduce<PublishImpactRouteJson | null>((best, r) => (best == null || r.to_version > best.to_version ? r : best), null);
  return pick ? { version: pick.to_version, fromVersion: pick.from_version } : null;
}

/** The version publish gave the route on screen (else the newest it made) — the Snackbar's number;
 *  null when the answer names none. */
export function publishedVersionOf(result: PublishResultJson | null, ownId: number | null): number | null {
  if (!result) return null;
  const own = ownId == null ? undefined : result.versions[ownId];
  if (own != null) return own;
  const all = Object.values(result.versions);
  return all.length > 0 ? Math.max(...all) : null;
}

/** The same number from the draft store, before the preview answers (the loading title): the
 *  version each route with a draft would become. null when no route has a draft. */
export function pendingVersion(model: DraftModel, ownId: number | null): number | null {
  const own = ownId == null ? undefined : model.routes[ownId];
  if (own && model.order.includes(own.routeId) && entryHasDraft(own)) return own.publishedVersion + 1;
  let best: number | null = null;
  for (const id of model.order) {
    const e = model.routes[id];
    if (e && entryHasDraft(e) && (best == null || e.publishedVersion + 1 > best)) best = e.publishedVersion + 1;
  }
  return best;
}

/** The scope the dialog opens with: "רק לפריטים חדשים (מומלץ)" (artboard 10, spec §5.11). */
export const APPLY_MODE_DEFAULT: ApplyMode = "new_only";

// ---- the warning note ---------------------------------------------------------------------------------
/** The warning note (artboard 10), or null when no route of the batch runs in another kit. */
export function sharedNoteText(impact: Pick<PublishImpactJson, "shared_outside">, context: FieldsContextJson): string | null {
  if (impact.shared_outside.length === 0) return null;
  const parts = impact.shared_outside.map((s) => sharedRoutePart(s.route_number, s.item_type_desc.trim(), s.kits.map((k) => k.desc.trim())));
  return sharedOutsideText(parts, context.kind === "package");
}

// ---- "מה השתנה" ---------------------------------------------------------------------------------------
/** The field set a change came from ("<id>:<ver>" in detail.from_set), or null. */
function fromSetId(c: Change): number | null {
  const ref = c.kind === "field_added" ? c.detail?.from_set : undefined;
  if (!ref) return null;
  const id = Number(ref.split(":")[0]);
  return isId(id) ? id : null;
}

/** The field sets the batch fills cells from — the names "מולאו מהערכה '{set}'" needs. */
export function fromSetIds(impact: Pick<PublishImpactJson, "routes">): number[] {
  const ids = new Set<number>();
  for (const r of impact.routes) for (const c of r.changes) {
    const id = fromSetId(c);
    if (id != null) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Where a step sits on screen: its station's name and its place in the map's order. */
type StepPlace = { label: string; order: number };

const stepKey = (routeId: number, stepUid: string) => routeId + ":" + stepUid;

/** Every (route, step) the map shows, column by column and row by row inside a column, with the
 *  column's station name. */
function mapPlaces(map: FieldsMapModel | null): Map<string, StepPlace> {
  const out = new Map<string, StepPlace>();
  if (!map) return out;
  let order = 0;
  map.columns.forEach((col, ci) => {
    for (const row of map.rows) {
      const cell = row.cells[ci];
      if (!cell || cell.na) continue;
      const key = stepKey(cell.binding.route_id, cell.binding.step_uid);
      if (!out.has(key)) out.set(key, { label: col.label, order: order++ });
    }
  });
  return out;
}

/** A step the map does not show: the station of its position on the route (fields-context), after
 *  every mapped step; a step that left the route keeps the name its change carries. */
function routePlace(context: FieldsContextJson, routeId: number, stepUid: string, c: Change, routeIndex: number): StepPlace {
  const r = contextRoutes(context).find((x) => x.route.test_route_id === routeId);
  const i = r ? r.route.step_uids.indexOf(stepUid) : -1;
  const typeId = r && i >= 0 && r.route.step_uids.length === r.route.route_steps.length ? r.route.route_steps[i] : null;
  const station = typeId != null ? context.stations[typeId]?.label.trim() : undefined;
  // A step-level row carries the station's label; a field row's label is the field's.
  const stepLevel = c.kind === "step_removed" || c.kind === "layout_changed";
  return { label: station || (stepLevel ? c.label : ""), order: 1_000_000 + routeIndex * 1_000 + (i >= 0 ? i : 999) };
}

type Bucket = { key: string; place: StepPlace; layout: boolean; route: PublishImpactRouteJson; changes: Change[]; seq: number };

/** The lines of one group (see the table above). */
export function groupLines(changes: readonly Change[], setNames: Readonly<Record<number, string>> = {}): PublishLine[] {
  const out: PublishLine[] = [];
  const sets = new Map<number, { at: number; cells: Set<string> }>();
  const generic = new Set<string>();
  const pushGeneric = (c: Change, badge: PublishBadge) => {
    const key = badge + "|" + targetKey(c.target) + "|" + (c.field_id ?? c.step_uid);
    if (generic.has(key)) return;
    generic.add(key);
    out.push({ badge, text: genericChangeText(c.label), warn: null });
  };
  for (const c of changes) {
    switch (c.kind) {
      case "field_added": {
        const setId = fromSetId(c);
        if (setId == null) {
          out.push({ badge: "add", text: fieldAddedText(c.label), warn: null });
          break;
        }
        let agg = sets.get(setId);
        if (!agg) {
          agg = { at: out.length, cells: new Set() };
          sets.set(setId, agg);
          out.push({ badge: "add", text: "", warn: null });   // filled in below, once its cells are known
        }
        agg.cells.add(targetKey(c.target));
        break;
      }
      case "field_removed":
        out.push({ badge: "del", text: fieldRemovedText(c.label), warn: filledWarnText(c.filled_count ?? 0) });
        break;
      case "field_changed": {
        const d = c.detail ?? {};
        if (d.option_added !== undefined) out.push({ badge: "edit", text: optionAddedText(c.label, d.option_added), warn: null });
        else if (d.required === true) out.push({ badge: "edit", text: requiredOnText(c.label), warn: null });
        else pushGeneric(c, "edit");
        break;
      }
      case "step_removed":
        pushGeneric(c, "del");
        break;
      default:
        // layout_changed (and any kind a newer server adds): no wording of its own.
        pushGeneric(c, "edit");
        break;
    }
  }
  for (const [setId, agg] of sets) out[agg.at].text = setFilledText(agg.cells.size, setNames[setId] ?? null);
  return out;
}

export type PublishGroupsInput = {
  impact: Pick<PublishImpactJson, "routes" | "shared_outside">;
  context: FieldsContextJson;
  /** The fields map on screen (useFieldsMap): the stations' names and their order. */
  map: FieldsMapModel | null;
  /** Field set names by id (GET /api/settings/field-sets); a missing one is undrawn. */
  setNames?: Readonly<Record<number, string>>;
};

/** "מה השתנה" (artboard 10): the groups, in map order, layout groups last. */
export function buildPublishGroups({ impact, context, map, setNames = {} }: PublishGroupsInput): PublishGroup[] {
  const places = mapPlaces(map);
  const shared = new Set(impact.shared_outside.map((s) => s.route_id));
  const kitId = contextKitId(context);
  const buckets = new Map<string, Bucket>();
  impact.routes.forEach((route, routeIndex) => {
    for (const c of route.changes) {
      const layout = c.kind === "layout_changed";
      const key = stepKey(route.route_id, c.step_uid) + (layout ? ":layout" : "");
      let b = buckets.get(key);
      if (!b) {
        const place = places.get(stepKey(route.route_id, c.step_uid)) ?? routePlace(context, route.route_id, c.step_uid, c, routeIndex);
        b = { key, place, layout, route, changes: [], seq: buckets.size };
        buckets.set(key, b);
      }
      b.changes.push(c);
    }
  });
  return [...buckets.values()]
    .sort((a, z) => Number(a.layout) - Number(z.layout) || a.place.order - z.place.order || a.seq - z.seq)
    .map((b) => {
      const lines = groupLines(b.changes, setNames);
      const kitRoute = kitId != null && b.route.item_type_id === kitId;
      return {
        key: b.key,
        title: b.layout ? layoutGroupTitleText(b.place.label) : groupTitleText(b.place.label, kitRoute ? null : b.route.item_type_desc.trim()),
        sub: b.route.label,
        shared: shared.has(b.route.route_id),
        count: groupCountText(lines.length),
        lines,
      };
    });
}
