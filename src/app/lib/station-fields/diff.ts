import { NOTE_MAX_DEFAULT, stepConfigOf, targetKey } from "./schema";
import type {
  ChoiceOption, Field, FieldGroup, FieldId, FieldType, GroupTarget, NoteMax, NotesMode,
  RouteFieldsConfig, StepConfig, StepUid, VersionRef,
} from "./schema";

/**
 * "What changed" between two configs of one route (route-fields spec §3.4.1). The header count
 * ("טיוטה · 6 שינויים") is the number of rows; the publish dialog lists them; publish stores them
 * in route_field_versions.changes.
 *
 * Steps match by uid, groups by target, fields by id. One row per aspect: a field that was renamed
 * and made required is two rows. Order is deterministic: steps in the new config's key order, then
 * removed steps; inside a step its groups in order, then groups that disappeared; inside a group the
 * new field order, then removed fields.
 */

export type ChangeKind = "field_added" | "field_removed" | "field_changed" | "step_removed" | "layout_changed";

export type ChangeDetail = {
  option_added?: string;     // the option's label
  option_removed?: string;   // the option's label
  required?: boolean;        // the new value
  notes?: NotesMode;         // the new mode
  type?: FieldType;          // the new type
  renamed_from?: string;     // the previous label (Change.label is the new one)
  tone_changed?: string;     // the option's label
  list_linked?: boolean;     // true = linked or relinked to a shared list, false = unlinked
  note_max?: NoteMax;        // the new effective maximum
  from_set?: string;         // "<set id>:<ver>" of the new field-set link, "" when unlinked
  moved?: boolean;           // the field's place in the cell changed
  /** Any other property: help, unit, min/max, ref/tol_pct, out_of_range_fail, photo min,
   *  checklist items, the wording or order of options both versions share. */
  other?: boolean;
};

export type Change = {
  route_id: number;
  step_uid: StepUid;
  /** The group's target; a step-level row (step_removed, layout_changed) carries "item" for a
   *  per-item step and "box" for a package-level one. */
  target: GroupTarget;
  kind: ChangeKind;
  field_id?: FieldId;
  /** The field's label (the new one when renamed), or the station label on a step-level row. */
  label: string;
  detail?: ChangeDetail;
  /** field_removed only: "מולא ב-38 בדיקות" — counted by publish-preview, never by this module. */
  filled_count?: number;
};

export function diffConfigs(prev: RouteFieldsConfig | null, next: RouteFieldsConfig, routeId: number): Change[] {
  const out: Change[] = [];
  for (const uid of Object.keys(next.steps)) {
    diffStep(routeId, uid, prev ? stepConfigOf(prev, uid) : undefined, next.steps[uid], out);
  }
  if (prev) {
    for (const uid of Object.keys(prev.steps)) {
      if (stepConfigOf(next, uid)) continue;
      const removed = prev.steps[uid];
      out.push({ route_id: routeId, step_uid: uid, target: stepTarget(removed), kind: "step_removed", label: removed.station_label });
    }
  }
  return out;
}

const stepTarget = (s: StepConfig): GroupTarget => (s.scope === "item" ? "item" : "box");

function diffStep(routeId: number, uid: StepUid, prev: StepConfig | undefined, next: StepConfig, out: Change[]): void {
  const prevGroups = new Map<string, FieldGroup>();
  for (const g of prev?.groups ?? []) {
    const key = targetKey(g.target);
    if (!prevGroups.has(key)) prevGroups.set(key, g);
  }
  const seen = new Set<string>();
  for (const g of next.groups) {
    const key = targetKey(g.target);
    if (seen.has(key)) continue;   // the shape check allows one group per target
    seen.add(key);
    diffGroup(routeId, uid, g.target, prevGroups.get(key)?.fields ?? [], g.fields, out);
  }
  for (const [key, g] of prevGroups) {
    if (!seen.has(key)) diffGroup(routeId, uid, g.target, g.fields, [], out);
  }
  // A new step only counts its layout when it brings one (undefined and {} are the same: no layout).
  if (!jsonEqual(prev?.layout ?? {}, next.layout ?? {})) {
    out.push({ route_id: routeId, step_uid: uid, target: stepTarget(next), kind: "layout_changed", label: next.station_label });
  }
}

function diffGroup(
  routeId: number, uid: StepUid, target: GroupTarget,
  prevFields: readonly Field[], nextFields: readonly Field[], out: Change[],
): void {
  const row = (kind: ChangeKind, f: Field, detail?: ChangeDetail): Change => ({
    route_id: routeId, step_uid: uid, target, kind, field_id: f.id, label: f.label, ...(detail ? { detail } : {}),
  });
  const prevById = new Map<FieldId, { f: Field; i: number }>();
  prevFields.forEach((f, i) => prevById.set(f.id, { f, i }));
  const nextIds = new Set(nextFields.map((f) => f.id));
  // Of the fields both sides share, the longest run that kept its relative order stays put; the
  // rest are the ones the admin moved (one row per moved field, not per shifted neighbour).
  const shared = nextFields.filter((f) => prevById.has(f.id));
  const stay = longestIncreasingRun(shared.map((f) => prevById.get(f.id)!.i));
  const moved = new Set(shared.filter((_, k) => !stay.has(k)).map((f) => f.id));

  for (const f of nextFields) {
    const before = prevById.get(f.id);
    if (!before) {
      const fromSet = f.type !== "section" && f.from_set ? { from_set: refText(f.from_set) } : undefined;
      out.push(row("field_added", f, fromSet));
      continue;
    }
    for (const detail of fieldChanges(before.f, f, moved.has(f.id))) out.push(row("field_changed", f, detail));
  }
  for (const f of prevFields) {
    if (!nextIds.has(f.id)) out.push(row("field_removed", f));
  }
}

/** One detail per changed aspect, in a fixed order. */
function fieldChanges(prev: Field, next: Field, moved: boolean): ChangeDetail[] {
  const rows: ChangeDetail[] = [];
  if (prev.label !== next.label) rows.push({ renamed_from: prev.label });
  if (prev.type !== "section" && next.type !== "section") {
    if (prev.required !== next.required) rows.push({ required: next.required });
    if (prev.notes !== next.notes) rows.push({ notes: next.notes });
    const nextMax = next.note_max ?? NOTE_MAX_DEFAULT;
    if ((prev.note_max ?? NOTE_MAX_DEFAULT) !== nextMax) rows.push({ note_max: nextMax });
  }
  if (prev.type !== next.type) rows.push({ type: next.type });
  const prevOpts = optionsOf(prev);
  const nextOpts = optionsOf(next);
  if (prevOpts && nextOpts) {
    const prevById = new Map(prevOpts.map((o) => [o.id, o]));
    const nextIds = new Set(nextOpts.map((o) => o.id));
    for (const o of nextOpts) if (!prevById.has(o.id)) rows.push({ option_added: o.label });
    for (const o of prevOpts) if (!nextIds.has(o.id)) rows.push({ option_removed: o.label });
    for (const o of nextOpts) {
      const before = prevById.get(o.id);
      if (before && before.tone !== o.tone) rows.push({ tone_changed: o.label });
    }
    const nextRef = listRefOf(next);
    if (!refEqual(listRefOf(prev), nextRef)) rows.push({ list_linked: nextRef !== undefined });
  }
  if (prev.type !== "section" && next.type !== "section" && !refEqual(prev.from_set, next.from_set)) {
    rows.push({ from_set: next.from_set ? refText(next.from_set) : "" });
  }
  if (moved) rows.push({ moved: true });
  if (otherChanged(prev, next)) rows.push({ other: true });
  return rows;
}

function optionsOf(f: Field): readonly ChoiceOption[] | null {
  return f.type === "choice_row" || f.type === "multi_choice" ? f.options : null;
}
function listRefOf(f: Field): VersionRef | undefined {
  return f.type === "choice_row" || f.type === "multi_choice" ? f.list_ref : undefined;
}
function refEqual(a: VersionRef | undefined, b: VersionRef | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.id === b.id && a.ver === b.ver;
}
const refText = (r: VersionRef): string => `${r.id}:${r.ver}`;

/** Everything that has no row of its own (see ChangeDetail.other). */
function otherChanged(prev: Field, next: Field): boolean {
  if (prev.type !== "section" && next.type !== "section" && (prev.help ?? "") !== (next.help ?? "")) return true;
  const prevOpts = optionsOf(prev);
  const nextOpts = optionsOf(next);
  if (prevOpts && nextOpts) {
    const nextById = new Map(nextOpts.map((o) => [o.id, o]));
    const prevShared = prevOpts.filter((o) => nextById.has(o.id));
    const nextShared = nextOpts.filter((o) => prevShared.some((p) => p.id === o.id));
    if (prevShared.some((o) => nextById.get(o.id)!.label !== o.label)) return true;   // reworded
    if (prevShared.some((o, i) => o.id !== nextShared[i].id)) return true;            // reordered
  }
  if (prev.type === "number" && next.type === "number") {
    return (prev.unit ?? "") !== (next.unit ?? "") || prev.min !== next.min || prev.max !== next.max
      || prev.ref !== next.ref || prev.tol_pct !== next.tol_pct || prev.out_of_range_fail !== next.out_of_range_fail;
  }
  if (prev.type === "checklist" && next.type === "checklist") {
    return prev.items.length !== next.items.length
      || prev.items.some((it, i) => it.id !== next.items[i].id || it.label !== next.items[i].label);
  }
  // photo_type is not compared: the field owns its photo group, whatever a config stores (schema.ts).
  if (prev.type === "photo" && next.type === "photo") return prev.min !== next.min;
  return false;
}

/** Positions (into seq) of one longest strictly increasing subsequence — O(n log n). */
function longestIncreasingRun(seq: readonly number[]): Set<number> {
  const tails: number[] = [];                       // tails[len - 1] = position ending the best run of that length
  const before: number[] = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) before[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = before[k]) keep.add(k);
  return keep;
}

/** Structural equality of JSON values, key order ignored. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}
