import type { Field, FieldId, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { LIMITS, takenLabels } from "@/app/lib/station-fields/validate";
import { alongsideFields, groupFieldsOf, stepFieldIds } from "./cellGroups";
import type { CellBinding } from "./cellGroups";
import type { ConfigMutator } from "./draftModel";
import { DEFAULT_IDS } from "./editorModel";
import type { IdSource } from "./editorModel";
import { isInputField } from "./optionFields";

/**
 * Fields going into a cell — the map's paste, "החלת ערכת שדות" (and its preview), the editor's
 * "הדבק מאקסל" — through ONE walk, so a preview and its result never differ (route-fields spec
 * §5.10, §5.14; artboard 9; lead decision D8):
 *   - "add": after the cell's own fields (or after `after`). A field whose trimmed name the cell
 *     already has — or, for a kit item's group at a package-level step, the step's each_item group
 *     has (validate.takenLabels, artboard 9's rule) — is skipped, and so is a name repeated further
 *     down. Section headers come along, except one whose fields were all skipped. A cell never
 *     grows past LIMITS.fieldsPerList (the rest is `overflow`).
 *   - "replace": the cell's fields become the incoming ones; nothing is skipped.
 * Every copy gets a FRESH field id, unique in its step — none of the step's ids, the replaced ones
 * included (an id is minted once and never reused); option and checklist-item ids are kept (they
 * are unique per field).
 */

/** What a fill must respect in a cell. */
export type CellState = {
  fields: readonly Field[];
  /** Fields the worker sees on the same card ahead of the cell's (cellGroups.alongsideFields). */
  alongside: readonly Field[];
  /** Every field id the step uses, the cell's own included. */
  stepIds: ReadonlySet<string>;
};

export function cellStateOf(cfg: RouteFieldsConfig | null | undefined, binding: Pick<CellBinding, "step_uid" | "target">): CellState {
  return {
    fields: groupFieldsOf(cfg, binding.step_uid, binding.target),
    alongside: alongsideFields(cfg, binding),
    stepIds: stepFieldIds(cfg, binding.step_uid),
  };
}

/** Where a skipped field's name is already taken: the cell itself (or an earlier incoming field), or
 *  the each_item group alongside. */
export type SkipPlace = "cell" | "each_item";

export type FillResult = {
  /** The cell's fields after the fill. */
  fields: Field[];
  /** The copies that went in, in order (section headers included). */
  added: Field[];
  /** Input fields skipped for their name, and left out for want of room. */
  skipped: number;
  overflow: number;
  /** Each skipped incoming field by its index, with where its name is taken. */
  skips: { index: number; place: SkipPlace }[];
};

export type FillOptions = { mode?: "add" | "replace"; after?: FieldId | null; ids?: IdSource };

export function fillCell(cell: CellState, incoming: readonly Field[], { mode = "add", after = null, ids = DEFAULT_IDS }: FillOptions = {}): FillResult {
  type Entry = { field: Field; heads: boolean };
  const skips: FillResult["skips"] = [];
  let picked: Entry[];
  if (mode === "replace") {
    picked = incoming.map((field) => ({ field, heads: false }));
  } else {
    const own = takenLabels(cell.fields);
    const along = takenLabels(cell.alongside);
    // Section by section: a header goes in only when a field under it does, or when it headed
    // nothing in the first place.
    picked = [];
    let pending: Field | null = null;
    let pendingHeads = false;
    const flushPending = () => {
      if (pending && !pendingHeads) picked.push({ field: pending, heads: false });
      pending = null;
      pendingHeads = false;
    };
    incoming.forEach((f, index) => {
      if (!isInputField(f)) {
        flushPending();
        pending = f;
        return;
      }
      if (pending) pendingHeads = true;
      const name = f.label.trim();
      if (name && (own.has(name) || along.has(name))) {
        skips.push({ index, place: own.has(name) ? "cell" : "each_item" });
        return;
      }
      if (name) own.add(name);
      if (pending) {
        picked.push({ field: pending, heads: true });
        pending = null;
      }
      picked.push({ field: f, heads: false });
    });
    flushPending();
  }

  const room = Math.max(0, LIMITS.fieldsPerList - (mode === "add" ? cell.fields.length : 0));
  const kept = picked.slice(0, room);
  const overflow = picked.slice(room).filter((e) => isInputField(e.field)).length;
  while (kept.length > 0 && kept[kept.length - 1].heads) kept.pop();

  const used = new Set(cell.stepIds);
  const added = kept.map(({ field }) => {
    const copy = structuredClone(field);
    let id = ids.field();
    while (used.has(id)) id = ids.field();
    used.add(id);
    copy.id = id;
    return copy;
  });
  let fields: Field[];
  if (mode === "replace") fields = added;
  else {
    const at = after != null ? cell.fields.findIndex((f) => f.id === after) : -1;
    const pos = at >= 0 ? at + 1 : cell.fields.length;
    fields = [...cell.fields.slice(0, pos), ...added, ...cell.fields.slice(pos)];
  }
  return { fields, added, skipped: skips.length, overflow, skips };
}

// ---- one edit per route ------------------------------------------------------------------------------
/** draftStore.edit, or a test's stand-in: mutate the working copy of one route. */
export type RouteEdit = (routeId: number, mutate: ConfigMutator) => void;

/** `items` grouped by their route, then ONE edit per route touched that applies each item in turn
 *  (each route then autosaves on its own: a PUT per route, never one per cell). */
export function editByRoute<T>(edit: RouteEdit, items: readonly T[], routeOf: (item: T) => number, apply: (cfg: RouteFieldsConfig, item: T) => void): void {
  const byRoute = new Map<number, T[]>();
  for (const item of items) {
    const list = byRoute.get(routeOf(item)) ?? [];
    list.push(item);
    byRoute.set(routeOf(item), list);
  }
  for (const [routeId, list] of byRoute) {
    edit(routeId, (cfg) => {
      for (const item of list) apply(cfg, item);
    });
  }
}

/** The counts after a paste or an apply (bulkLabels.pastedText). */
export type PasteCounts = {
  /** Cells that took at least one field. */
  cells: number;
  added: number;
  skipped: number;
  overflow: number;
  /** Copied cells that landed on a "—" or off the map. */
  outside: number;
};
