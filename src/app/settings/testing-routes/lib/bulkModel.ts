import { stepConfigOf } from "@/app/lib/station-fields/schema";
import type { Field, RouteFieldsConfig, StepUid } from "@/app/lib/station-fields/schema";
import { LIMITS, takenLabels } from "@/app/lib/station-fields/validate";
import { setGroupFields } from "./draftModel";
import type { ConfigMutator } from "./draftModel";
import { DEFAULT_IDS } from "./editorModel";
import type { IdSource, SharedListLike } from "./editorModel";
import { bindingKey, groupFieldsOf } from "./mapModel";
import type { CellBinding, FieldsMapModel, MapCell, StepMeta } from "./mapModel";
import { parseTsvRows, tsvRowField } from "./pasteTsv";
import type { TsvRow } from "./pasteTsv";

/**
 * The map's multi-cell actions on the drafts (route-fields spec §5.14, §5.4.4, §5.4.6; artboards 1
 * and 9): copy, paste and clear on the selected cells, by their bindings (route, step uid, target).
 * Pure — FieldsMap / FieldsMapBulkBar run them through draftStore.edit, ONE edit per route touched
 * (each route then autosaves on its own: a PUT per route, never one per cell).
 *
 * Copy: the clipboard keeps a deep copy of every copied cell's fields with the cell's place in the
 * map (row and column of the whole map, relative to the copied block's top-left), and the same
 * fields as TSV for the system clipboard — a line per field, "name⇥option 1⇥option 2⇥…" (section
 * headers are left out; a field without options is its name alone).
 *
 * Paste ("הוסף לשדות הקיימים" — nothing a cell has is replaced or removed):
 *   - a clipboard of ONE cell goes into every target cell;
 *   - a clipboard of SEVERAL cells keeps its shape, like a spreadsheet: its top-left lands on the
 *     top-left of the targets' bounding box (rows and columns of the whole map, whatever the filter
 *     shows), every other copied cell at the same offset from there; a place that is "—" or off
 *     the map takes nothing (counted as `outside`). The rest of the selection takes nothing either;
 *   - text from the system clipboard that is not the internal copy is parsed as TSV (pasteTsv) and
 *     its rows go into every target cell.
 *   In a cell, a field whose trimmed name the cell already has is skipped — artboard 9's rule: for
 *   a kit item's group at a package-level step the each_item group's names count too
 *   (validate.takenLabels; the box is a card of its own). Every copy gets a FRESH field id (unique
 *   in its step); option and checklist-item ids are kept (they are unique per field). Section
 *   headers come along, except one whose copied fields were all skipped. A cell never grows past
 *   LIMITS.fieldsPerList (the rest is `overflow`).
 * Clear: every field of the target cells goes (setGroupFields with [] — the step stays, see
 * draftModel); "ביטול הטיוטה" brings them back.
 * Targets are deduplicated by binding: two rows showing one group (two lines on one route) are one
 * cell to change.
 */

// ---- cells and their groups ----------------------------------------------------------------------
/** The fields the worker sees on the same card ahead of the cell's own: each_item's, for a kit
 *  item's group at a package-level step (the order of validate.lintRouteFieldsConfig). */
export function alongsideFields(cfg: RouteFieldsConfig | null | undefined, binding: Pick<CellBinding, "step_uid" | "target">): Field[] {
  if (!cfg || typeof binding.target !== "object") return [];
  const step = stepConfigOf(cfg, binding.step_uid);
  if (!step || step.scope !== "package") return [];
  return groupFieldsOf(cfg, binding.step_uid, "each_item");
}

/** The names a field added to the cell must not repeat (artboard 9's rule; validate.takenLabels). */
export function cellTakenLabels(cfg: RouteFieldsConfig | null | undefined, binding: Pick<CellBinding, "step_uid" | "target">): Set<string> {
  return takenLabels([...alongsideFields(cfg, binding), ...groupFieldsOf(cfg, binding.step_uid, binding.target)]);
}

/** Every field id of a step, across its groups (field ids are unique per step — validate.ts). */
export function stepFieldIds(cfg: RouteFieldsConfig | null | undefined, stepUid: StepUid): Set<string> {
  const step = cfg ? stepConfigOf(cfg, stepUid) : undefined;
  const out = new Set<string>();
  for (const g of step?.groups ?? []) for (const f of g.fields) out.add(f.id);
  return out;
}

/** The cells once per group, in the order given. */
export function uniqueByBinding(cells: readonly MapCell[]): MapCell[] {
  const seen = new Set<string>();
  return cells.filter((c) => {
    const k = bindingKey(c.binding);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A cell's place in the whole map: its row and column index, or null. */
export function cellPosition(model: FieldsMapModel, cell: Pick<MapCell, "rowKey" | "columnKey">): { row: number; col: number } | null {
  const row = model.rows.findIndex((r) => r.key === cell.rowKey);
  const col = model.columns.findIndex((c) => c.key === cell.columnKey);
  return row >= 0 && col >= 0 ? { row, col } : null;
}

/** The cells in reading order of the map (row, then column). */
export function inMapOrder(model: FieldsMapModel, cells: readonly MapCell[]): MapCell[] {
  const at = new Map(cells.map((c) => [c.key, cellPosition(model, c)]));
  return [...cells].sort((a, b) => {
    const pa = at.get(a.key);
    const pb = at.get(b.key);
    if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
    return pa.row - pb.row || pa.col - pb.col;
  });
}

// ---- copy ----------------------------------------------------------------------------------------
/** One copied cell: its offset from the copied block's top-left, and a deep copy of its fields. */
export type ClipCell = { row: number; col: number; fields: Field[] };

export type BulkClipboard = {
  cells: ClipCell[];
  /** What went to the system clipboard (fieldsToTsv of every copied field, in map order). */
  tsv: string;
  /** Input fields copied (section headers do not count). */
  fieldCount: number;
};

const copyFields = (fields: readonly Field[]): Field[] => JSON.parse(JSON.stringify(fields)) as Field[];
const cleanCell = (s: string): string => s.replace(/[\t\r\n]+/g, " ").trim();

/** The system clipboard's text of a field list: a line per field, "name⇥option 1⇥option 2⇥…" —
 *  the format "הדבק מאקסל" reads (spec §5.14). Section headers are left out. */
export function fieldsToTsv(fields: readonly Field[]): string {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.type === "section") continue;
    const options = f.type === "choice_row" || f.type === "multi_choice" ? f.options.map((o) => cleanCell(o.label)) : [];
    lines.push([cleanCell(f.label), ...options].join("\t"));
  }
  return lines.join("\n");
}

/** The clipboard of `cells` from the working copies `configs` (draftModel.currentConfigs). */
export function copyCells(model: FieldsMapModel, configs: Readonly<Record<number, RouteFieldsConfig>>, cells: readonly MapCell[]): BulkClipboard {
  const placed = inMapOrder(model, cells)
    .map((c) => ({ cell: c, pos: cellPosition(model, c) }))
    .filter((x): x is { cell: MapCell; pos: { row: number; col: number } } => x.pos != null);
  const top = Math.min(...placed.map((x) => x.pos.row));
  const left = Math.min(...placed.map((x) => x.pos.col));
  const out: ClipCell[] = placed.map(({ cell, pos }) => ({
    row: pos.row - top,
    col: pos.col - left,
    fields: copyFields(groupFieldsOf(configs[cell.binding.route_id], cell.binding.step_uid, cell.binding.target)),
  }));
  const all = out.flatMap((c) => c.fields);
  return { cells: out, tsv: fieldsToTsv(all), fieldCount: all.filter((f) => f.type !== "section").length };
}

// ---- where a paste comes from --------------------------------------------------------------------
export type PasteSource =
  | { kind: "internal"; clip: BulkClipboard }
  | { kind: "tsv"; rows: TsvRow[] }
  | { kind: "empty" };

const normalizeText = (s: string): string => s.replace(/\r\n?/g, "\n").trim();

/**
 * What a paste uses. `systemText` is the system clipboard's text (null: it could not be read);
 * `clipOnSystem` says whether the internal clipboard's TSV reached the system clipboard.
 *   - the internal clipboard when the system clipboard holds its own TSV, is empty or unreadable, or
 *     never got the TSV (then the internal copy is the newer one);
 *   - else the system text parsed as TSV, when it has rows;
 *   - else the internal clipboard, if any.
 */
export function pasteSource(clip: BulkClipboard | null, systemText: string | null, clipOnSystem: boolean): PasteSource {
  const text = systemText == null ? null : normalizeText(systemText);
  if (clip && (text == null || text === "" || !clipOnSystem || text === normalizeText(clip.tsv))) return { kind: "internal", clip };
  if (text) {
    const rows = parseTsvRows(text);
    if (rows.length > 0) return { kind: "tsv", rows };
  }
  return clip ? { kind: "internal", clip } : { kind: "empty" };
}

// ---- paste ---------------------------------------------------------------------------------------
/** What goes into one cell. The fields are templates: addToCell copies them with fresh ids. */
export type CellAddition = { cell: MapCell; fields: readonly Field[] };

/** Where the internal clipboard goes among `targets` (see the module comment). */
export function planInternalPaste(model: FieldsMapModel, clip: BulkClipboard, targets: readonly MapCell[]): { additions: CellAddition[]; outside: number } {
  const cells = uniqueByBinding(inMapOrder(model, targets));
  if (clip.cells.length === 0 || cells.length === 0) return { additions: [], outside: 0 };
  if (clip.cells.length === 1) return { additions: cells.map((cell) => ({ cell, fields: clip.cells[0].fields })), outside: 0 };
  const positions = cells.map((c) => cellPosition(model, c)).filter((p): p is { row: number; col: number } => p != null);
  if (positions.length === 0) return { additions: [], outside: clip.cells.length };
  const top = Math.min(...positions.map((p) => p.row));
  const left = Math.min(...positions.map((p) => p.col));
  const additions: CellAddition[] = [];
  let outside = 0;
  for (const c of clip.cells) {
    const row = model.rows[top + c.row];
    const column = model.columns[left + c.col];
    const cell = row && column ? row.cells.find((x) => x.columnKey === column.key) : undefined;
    if (!cell || cell.na) outside += 1;
    else additions.push({ cell, fields: c.fields });
  }
  return { additions, outside };
}

/** The TSV rows as fields, the same rows for every target cell (addToCell copies them). */
export function planTsvPaste(rows: readonly TsvRow[], targets: readonly MapCell[], lists: readonly SharedListLike[] | null = null, ids: IdSource = DEFAULT_IDS): CellAddition[] {
  const fields: Field[] = rows.map((r) => tsvRowField(r, lists, ids));
  return uniqueByBinding(targets).map((cell) => ({ cell, fields }));
}

export type AddResult = { added: number; skipped: number; overflow: number };

/**
 * Copies of `incoming` after the cell's fields (see the module comment): duplicates by name skipped,
 * fresh field ids, section headers kept unless every field they head was skipped, at most
 * LIMITS.fieldsPerList in the cell. Mutates `cfg` (the copy draftStore.edit hands out); leaves it
 * alone when nothing is added.
 */
export function addToCell(cfg: RouteFieldsConfig, binding: CellBinding, meta: StepMeta, incoming: readonly Field[], ids: IdSource = DEFAULT_IDS): AddResult {
  const current = groupFieldsOf(cfg, binding.step_uid, binding.target);
  const taken = cellTakenLabels(cfg, binding);
  const used = stepFieldIds(cfg, binding.step_uid);
  // Walk the incoming list section by section: a header goes in only when a field under it does,
  // or when it headed nothing in the first place.
  type Entry = { field: Field; heads: boolean };
  const picked: Entry[] = [];
  let skipped = 0;
  let pending: Field | null = null;
  let pendingHeads = false;
  const flushPending = () => {
    if (pending && !pendingHeads) picked.push({ field: pending, heads: false });
    pending = null;
    pendingHeads = false;
  };
  for (const f of incoming) {
    if (f.type === "section") {
      flushPending();
      pending = f;
      continue;
    }
    if (pending) pendingHeads = true;
    const name = f.label.trim();
    if (name && taken.has(name)) {
      skipped += 1;
      continue;
    }
    if (name) taken.add(name);
    if (pending) {
      picked.push({ field: pending, heads: true });
      pending = null;
    }
    picked.push({ field: f, heads: false });
  }
  flushPending();

  // The cell's room: what does not fit is left out, and a header left with nothing under it too.
  const room = Math.max(0, LIMITS.fieldsPerList - current.length);
  const kept = picked.slice(0, room);
  const overflow = picked.slice(room).filter((e) => e.field.type !== "section").length;
  while (kept.length > 0 && kept[kept.length - 1].heads) kept.pop();
  if (kept.length === 0) return { added: 0, skipped, overflow };

  const out = kept.map(({ field }) => {
    const copy = JSON.parse(JSON.stringify(field)) as Field;
    let id = ids.field();
    while (used.has(id)) id = ids.field();
    used.add(id);
    copy.id = id;
    return copy;
  });
  setGroupFields(cfg, binding, meta, [...current, ...out]);
  return { added: out.filter((f) => f.type !== "section").length, skipped, overflow };
}

/** draftStore.edit, or a test's stand-in: mutate the working copy of one route. */
export type RouteEdit = (routeId: number, mutate: ConfigMutator) => void;

export type PasteCounts = {
  /** Cells that took at least one field. */
  cells: number;
  added: number;
  skipped: number;
  overflow: number;
  outside: number;
};

/** The additions grouped by route: ONE edit per route touched. */
export function applyAdditions(edit: RouteEdit, additions: readonly CellAddition[], ids: IdSource = DEFAULT_IDS, outside = 0): PasteCounts {
  const counts: PasteCounts = { cells: 0, added: 0, skipped: 0, overflow: 0, outside };
  const byRoute = new Map<number, CellAddition[]>();
  for (const a of additions) {
    const list = byRoute.get(a.cell.binding.route_id) ?? [];
    list.push(a);
    byRoute.set(a.cell.binding.route_id, list);
  }
  for (const [routeId, list] of byRoute) {
    edit(routeId, (cfg) => {
      const filled = new Set<string>();
      for (const a of list) {
        const r = addToCell(cfg, a.cell.binding, a.cell.stepMeta, a.fields, ids);
        counts.added += r.added;
        counts.skipped += r.skipped;
        counts.overflow += r.overflow;
        if (r.added > 0) filled.add(bindingKey(a.cell.binding));
      }
      counts.cells += filled.size;
    });
  }
  return counts;
}

// ---- clear ---------------------------------------------------------------------------------------
/** "נקה": every field of every target cell, ONE edit per route. Answers the cells that had any. */
export function clearCells(edit: RouteEdit, targets: readonly MapCell[]): number {
  const byRoute = new Map<number, MapCell[]>();
  for (const c of uniqueByBinding(targets)) {
    const list = byRoute.get(c.binding.route_id) ?? [];
    list.push(c);
    byRoute.set(c.binding.route_id, list);
  }
  let cleared = 0;
  for (const [routeId, cells] of byRoute) {
    edit(routeId, (cfg) => {
      for (const c of cells) {
        if (groupFieldsOf(cfg, c.binding.step_uid, c.binding.target).length > 0) cleared += 1;
        setGroupFields(cfg, c.binding, c.stepMeta, []);
      }
    });
  }
  return cleared;
}
