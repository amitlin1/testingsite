import { isDbId } from "@/lib/http/request";
import { targetKey } from "@/app/lib/station-fields/schema";
import type { Change } from "@/app/lib/station-fields/diff";
import type {
  ApplyMode, FieldsContextJson, PublishImpactJson, PublishImpactRouteJson, PublishResultJson,
} from "@/app/lib/station-fields/admin-types";
import { entryHasDraft } from "./draftModel";
import type { DraftModel, RouteDraft } from "./draftModel";
import { alignedStepUids, contextRoutes, kitIdOf, ownOrNewest } from "./fieldsContext";
import type { FieldsMapModel } from "./mapModel";
import type { PublishScope } from "./publishScopes";
import {
  fieldAddedText, fieldRemovedText, filledWarnText, genericChangeText, groupTitleText,
  layoutGroupTitleText, optionAddedText, requiredOnText, setFilledText, sharedOutsideText, sharedRoutePart,
} from "./publishLabels";
import { changesText } from "./labels";

/**
 * The publish dialog's model (artboard 10, route-fields spec §5.11, §3.4.2, §3.4.3, §10.2-4) —
 * pure: the requests' bodies, the version the dialog names, and "מה השתנה" grouped from the
 * preview's changes. PublishDialog.tsx draws it.
 *
 * Groups: one per (route, station) — a station being the step a change sits on — titled by the
 * station and the item (the station alone on the kit's own route), under the route's label. A
 * step's layout rows are a group of their own, after every field group (artboard 10). Groups follow
 * the fields map: column by column, row by row inside a column; a step the map does not show comes
 * after, by route and position.
 *
 * Lines, in the order of the changes (artboard 10 table, spec §5.11):
 *   field_added                      fieldAddedText                badge add
 *   field_added with from_set        setFilledText — ONE line per set and group, counting the cells
 *                                    (targets) of the group it filled                  badge add
 *   field_changed + option_added     optionAddedText               badge edit
 *   field_changed + required: true   requiredOnText                badge edit
 *   field_removed                    fieldRemovedText + filledWarnText   badge del
 *   anything else (undrawn)          genericChangeText — once per field and cell   badge edit
 *   step_removed (undrawn)           genericChangeText of the station   badge del
 * A group's count is its lines (artboard 10 `count`).
 */

export type PublishBadge = "add" | "edit" | "del";

export type PublishLine = {
  badge: PublishBadge;
  text: string;
  /** Drawn in warning ink after the text, or null. */
  warn: string | null;
};

export type PublishGroup = {
  /** "{route_id}:{step_uid}" (":layout" for a layout group) — stable while the dialog is open. */
  key: string;
  title: string;
  /** The route's label from the preview (PublishImpactRouteJson.label). */
  sub: string;
  /** Other kits run this route (shared_outside) — the group's shared Tag. */
  shared: boolean;
  /** changesText of the lines. */
  count: string;
  lines: PublishLine[];
};

// ---- requests ------------------------------------------------------------------------------------------
/** POST …/fields/publish-preview: the routes with a draft, and the kit on screen — its route is the
 *  kit's route label and it is not "outside" for the warning note. */
export function previewRequestBody(routeIds: readonly number[], kitId: number): { route_ids: number[]; context_kit_id: number } {
  return { route_ids: [...routeIds], context_kit_id: kitId };
}

/** POST …/fields/publish: the same routes, at exactly the draft_revs the preview showed. */
export function publishRequestBody(
  routeIds: readonly number[], impact: Pick<PublishImpactJson, "base_revs">, applyMode: ApplyMode, note: string,
): { route_ids: number[]; base_revs: Record<number, number>; apply_mode: ApplyMode; note: string } {
  const baseRevs: Record<number, number> = {};
  for (const id of routeIds) baseRevs[id] = impact.base_revs[id];
  return { route_ids: [...routeIds], base_revs: baseRevs, apply_mode: applyMode, note };
}

// ---- versions -----------------------------------------------------------------------------------------
export type PublishVersion = { version: number; fromVersion: number };

/**
 * "גרסה N" of the dialog (spec §3.4.3, §10.2-4, fieldsContext.ownOrNewest): the version the kit's
 * route becomes, with the version it replaces ("v-1"). null when nothing is published.
 */
export function publishVersion(impact: Pick<PublishImpactJson, "routes">, ownId: number | null): PublishVersion | null {
  const pick = ownOrNewest(impact.routes, ownId, (r) => r.route_id, (r) => r.to_version);
  return pick ? { version: pick.to_version, fromVersion: pick.from_version } : null;
}

/** The version publish gave (the Snackbar's number); null when the answer names none. */
export function publishedVersionOf(result: PublishResultJson | null, ownId: number | null): number | null {
  if (!result) return null;
  const rows = Object.entries(result.versions).map(([id, version]) => ({ id: Number(id), version }));
  return ownOrNewest(rows, ownId, (r) => r.id, (r) => r.version)?.version ?? null;
}

/** The same number from the draft store, before the preview answers (the loading title). null when
 *  no route has a draft. */
export function pendingVersion(model: DraftModel, ownId: number | null): number | null {
  const drafts = model.order.map((id) => model.routes[id]).filter((e): e is RouteDraft => e != null && entryHasDraft(e));
  const pick = ownOrNewest(drafts, ownId, (e) => e.routeId, (e) => e.publishedVersion);
  return pick ? pick.publishedVersion + 1 : null;
}

/** How many items a scope moves, from the preview: "all" moves every item on the routes. */
export function scopeCount(scope: PublishScope, impact: Pick<PublishImpactJson, "not_started" | "not_reached" | "items_on_routes">): number {
  switch (scope) {
    case "not_started": return impact.not_started;
    case "not_reached": return impact.not_reached;
    case "all": return impact.items_on_routes;
  }
}

// ---- the warning note ---------------------------------------------------------------------------------
/** The warning note (artboard 10), or null when no route of the batch runs in another kit. */
export function sharedNoteText(impact: Pick<PublishImpactJson, "shared_outside">): string | null {
  if (impact.shared_outside.length === 0) return null;
  return sharedOutsideText(impact.shared_outside.map((s) => sharedRoutePart(s.route_number, s.item_type_desc.trim(), s.kits.map((k) => k.desc.trim()))));
}

// ---- "מה השתנה" ---------------------------------------------------------------------------------------
/** The field set a change came from ("<id>:<ver>" in detail.from_set), or null. */
function fromSetId(c: Change): number | null {
  const ref = c.kind === "field_added" ? c.detail?.from_set : undefined;
  if (!ref) return null;
  const id = Number(ref.split(":")[0]);
  return isDbId(id) ? id : null;
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
  const typeId = r && i >= 0 && alignedStepUids(r.route)[i] != null ? r.route.route_steps[i] : null;
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
  for (const [setId, agg] of sets) out[agg.at].text = setFilledText(agg.cells.size, setNames[setId]?.trim() ?? null);
  return out;
}

export type PublishGroupsInput = {
  impact: Pick<PublishImpactJson, "routes" | "shared_outside">;
  context: FieldsContextJson;
  /** The fields map on screen (useFieldsMap): the stations' names and their order. */
  map: FieldsMapModel | null;
  /** Field set names by id (resources.useFieldSetNames); a missing one is undrawn. */
  setNames?: Readonly<Record<number, string>>;
};

/** "מה השתנה" (artboard 10): the groups, in map order, layout groups last. */
export function buildPublishGroups({ impact, context, map, setNames = {} }: PublishGroupsInput): PublishGroup[] {
  const places = mapPlaces(map);
  const shared = new Set(impact.shared_outside.map((s) => s.route_id));
  const kitId = kitIdOf(context);
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
      const kitRoute = b.route.item_type_id === kitId;
      return {
        key: b.key,
        title: b.layout ? layoutGroupTitleText(b.place.label) : groupTitleText(b.place.label, kitRoute ? null : b.route.item_type_desc.trim()),
        sub: b.route.label,
        shared: shared.has(b.route.route_id),
        count: changesText(lines.length),
        lines,
      };
    });
}
