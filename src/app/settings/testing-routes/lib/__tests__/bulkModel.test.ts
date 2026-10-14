import { test } from "node:test";
import assert from "node:assert/strict";
import { stepConfigOf } from "@/app/lib/station-fields/schema";
import type { Field, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { LIMITS, parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { EMPTY_DRAFT_MODEL, copyConfig, currentConfigs, draftReducer, summarize } from "../draftModel";
import type { ConfigMutator } from "../draftModel";
import type { IdSource } from "../editorModel";
import { buildFieldsMap, getCell, groupFieldsOf } from "../mapModel";
import type { FieldsMapModel, MapCell } from "../mapModel";
import {
  addToCell, alongsideFields, applyAdditions, cellTakenLabels, clearCells, copyCells, fieldsToTsv, inMapOrder, pasteSource,
  planInternalPaste, planTsvPaste, stepFieldIds, uniqueByBinding,
} from "../bulkModel";
import type { RouteEdit } from "../bulkModel";
import { parseTsvRows } from "../pasteTsv";
import { pastedText } from "../bulkLabels";
import { ELEC, MECH, VISU, artboard1, choice } from "./fixtures";

/**
 * The map's multi-cell actions (route-fields spec §5.14; artboards 1 and 9): copy keeps the cells'
 * fields and their shape, paste adds (never replaces) with artboard 9's duplicate rule and fresh
 * ids, clear empties the groups — and every action is ONE edit per route touched.
 */

function ids(): IdSource {
  let n = 0;
  const next = (prefix: string) => prefix + "q" + (++n).toString(36).padStart(7, "0");
  return { field: () => next("f_"), option: () => next("o_"), item: () => next("c_") };
}

/** The working copies of a context, and an edit that records which route it touched. */
function bench(ctx: FieldsContextJson = artboard1()) {
  const model0 = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const configs: Record<number, RouteFieldsConfig> = currentConfigs(model0);
  const edits: number[] = [];
  const edit: RouteEdit = (routeId: number, mutate: ConfigMutator) => {
    edits.push(routeId);
    const copy = copyConfig(configs[routeId]);
    configs[routeId] = mutate(copy) ?? copy;
  };
  const map = (): FieldsMapModel => buildFieldsMap({ context: ctx, configs, issues: summarize(model0).issuesByRoute });
  return { ctx, configs, edits, edit, map };
}

const cellAt = (m: FieldsMapModel, row: string, col: string): MapCell => {
  const c = getCell(m, row, col);
  assert.ok(c && !c.na, `expected a cell at ${row} · ${col}`);
  return c;
};
const elec = `step:${ELEC}:1`;
const mech = `step:${MECH}:1`;
const visu = `step:${VISU}:1`;
const fieldsOf = (configs: Record<number, RouteFieldsConfig>, c: MapCell) => groupFieldsOf(configs[c.binding.route_id], c.binding.step_uid, c.binding.target);
const labels = (fs: readonly Field[]) => fs.map((f) => f.label);

// ---- copy --------------------------------------------------------------------------------------------
test("copy keeps a deep copy of each cell's fields, its offset in the copied block, and the TSV", () => {
  const b = bench();
  const m = b.map();
  const pcElec = cellAt(m, "line:1", elec);
  const monElec = cellAt(m, "line:2", elec);
  const clip = copyCells(m, b.configs, [monElec, pcElec]);
  assert.deepEqual(clip.cells.map((c) => [c.row, c.col]), [[0, 0], [1, 0]], "map order, from the block's top-left");
  assert.equal(clip.cells[0].fields.length, 5, "the draft's five fields of חשמל · מחשב");
  assert.equal(clip.fieldCount, 8);
  assert.equal(clip.tsv.split("\n").length, 8);
  assert.equal(clip.tsv.split("\n")[4], "בדיקת בידוד\tבדיקת בידוד 1\tבדיקת בידוד 2");
  // A copy, not the working copy itself.
  clip.cells[0].fields[0].label = "שונה";
  assert.notEqual(fieldsOf(b.configs, pcElec)[0].label, "שונה");
});

test("fieldsToTsv: a line per field, options after the name; no section headers; no tabs or line breaks inside", () => {
  const fs: Field[] = [
    { id: "f_sec00001", type: "section", label: "מקטע" },
    choice("נורית\tמתח", ["pass", "fail"]),
    { id: "f_num00001", type: "number", label: "מתח\nכניסה", required: false, notes: "optional", out_of_range_fail: true },
  ];
  assert.equal(fieldsToTsv(fs), "נורית מתח\tנורית\tמתח 1\tנורית\tמתח 2\nמתח כניסה".replace("נורית\tמתח 1", "נורית מתח 1").replace("נורית\tמתח 2", "נורית מתח 2"));
  assert.equal(fieldsToTsv([]), "");
});

// ---- where a paste comes from --------------------------------------------------------------------------
test("pasteSource: our own copy while the system clipboard holds its TSV (or nothing we can read); else the text as TSV", () => {
  const b = bench();
  const m = b.map();
  const clip = copyCells(m, b.configs, [cellAt(m, "line:1", elec)]);
  assert.equal(pasteSource(clip, clip.tsv.replace(/\n/g, "\r\n") + "\r\n", true).kind, "internal", "CRLF and a last line break are the same text");
  assert.equal(pasteSource(clip, null, true).kind, "internal");
  assert.equal(pasteSource(clip, "", true).kind, "internal");
  const other = pasteSource(clip, "כבל\tתקין\tפגום", true);
  assert.equal(other.kind, "tsv");
  assert.equal(pasteSource(clip, "כבל\tתקין\tפגום", false).kind, "internal", "a copy that never reached the system clipboard is the newer one");
  assert.equal(pasteSource(null, "כבל", true).kind, "tsv");
  assert.equal(pasteSource(null, " \n\t\n", true).kind, "empty");
  assert.equal(pasteSource(null, null, false).kind, "empty");
});

// ---- paste ------------------------------------------------------------------------------------------------
test("one copied cell goes into every selected cell, each edit once per route; duplicates by name skipped", () => {
  const b = bench();
  const m = b.map();
  const source = cellAt(m, "line:3", mech);       // מכניקה · מקלדת: "מקשים 1", "מקשים 2"
  const clip = copyCells(m, b.configs, [source]);
  const targets = [cellAt(m, "line:1", elec), cellAt(m, "line:1", visu), cellAt(m, "line:2", mech), source];
  const plan = planInternalPaste(m, clip, targets);
  assert.equal(plan.additions.length, 4);
  const counts = applyAdditions(b.edit, plan.additions, ids(), plan.outside);
  // Routes: מחשב (two cells), מסך, מקלדת — three edits.
  assert.deepEqual([...b.edits].sort(), [101, 102, 103]);
  assert.deepEqual(counts, { cells: 3, added: 6, skipped: 2, overflow: 0, outside: 0 });
  assert.deepEqual(labels(fieldsOf(b.configs, targets[0])).slice(-2), ["מקשים 1", "מקשים 2"]);
  assert.deepEqual(labels(fieldsOf(b.configs, source)), ["מקשים 1", "מקשים 2"], "the source already has both names");
  assert.equal(pastedText(counts), "נוספו 6 שדות ב-3 תאים · 2 שדות דולגו כדי למנוע כפילות");
  // Every config still passes the shape check (fresh ids are unique per step).
  for (const id of [101, 102, 103]) assert.doesNotThrow(() => parseRouteFieldsConfig(b.configs[id]));
});

test("pasted copies get fresh field ids; option ids are kept", () => {
  const b = bench();
  const m = b.map();
  const source = cellAt(m, "line:3", mech);
  const target = cellAt(m, "line:2", mech);
  const clip = copyCells(m, b.configs, [source]);
  applyAdditions(b.edit, planInternalPaste(m, clip, [target]).additions, ids());
  const pasted = fieldsOf(b.configs, target).slice(-2);
  const copied = clip.cells[0].fields;
  assert.ok(pasted.every((f, i) => f.id !== copied[i].id && f.id.startsWith("f_q")));
  const opts = (f: Field) => (f.type === "choice_row" ? f.options.map((o) => o.id) : []);
  assert.deepEqual(pasted.map(opts), copied.map(opts));
});

test("several copied cells keep their shape from the targets' top-left; '—' and off-map places take nothing", () => {
  const b = bench();
  const m = b.map();
  const clip = copyCells(m, b.configs, [cellAt(m, "line:1", elec), cellAt(m, "line:2", elec)]);
  // Onto the visual column: מחשב, מסך — whatever else is selected below.
  const plan = planInternalPaste(m, clip, [cellAt(m, "line:2", visu), cellAt(m, "line:1", visu), cellAt(m, "line:4", visu)]);
  assert.deepEqual(plan.additions.map((a) => a.cell.key), [`line:1|${visu}`, `line:2|${visu}`]);
  assert.equal(plan.outside, 0);
  // From מסך · חשמל down: מקלדת · חשמל is "—".
  const onto = planInternalPaste(m, clip, [cellAt(m, "line:2", elec)]);
  assert.deepEqual(onto.additions.map((a) => a.cell.key), [`line:2|${elec}`]);
  assert.equal(onto.outside, 1);
  // From the last row: the second copied cell is off the map.
  assert.equal(planInternalPaste(m, clip, [cellAt(m, "line:4", visu)]).outside, 1);
  // Kit and item columns mix: a block from the kit column lands on item cells as well.
  const kitClip = copyCells(m, b.configs, [cellAt(m, "box", "kit:0"), cellAt(m, "each_item", "kit:0")]);
  assert.deepEqual(planInternalPaste(m, kitClip, [cellAt(m, "line:1", elec)]).additions.map((a) => a.cell.key), [`line:1|${elec}`, `line:2|${elec}`]);
});

test("artboard 9's rule: a kit item's group also counts the step's each_item names; the box does not", () => {
  const b = bench();
  // The closing step's each_item group holds "הפריט ארוז במקומו".
  const kit = b.configs[100];
  const closing = stepConfigOf(kit, "s_kitclos1");
  assert.ok(closing);
  closing.groups.find((g) => g.target === "each_item")!.fields.push(choice("הפריט ארוז במקומו", ["pass", "fail"]));
  const m = b.map();
  const set = [choice("הפריט ארוז במקומו", ["pass", "warn", "fail"]), choice("מצב חיצוני בסגירה", ["pass", "fail"])];
  const items = ["line:1", "line:2", "line:3", "line:4"].map((r) => cellAt(m, r, "kit:1"));
  const box = cellAt(m, "box", "kit:1");
  assert.ok(cellTakenLabels(kit, items[0].binding).has("הפריט ארוז במקומו"));
  assert.deepEqual(labels(alongsideFields(kit, items[0].binding)), ["סגירה 1", "הפריט ארוז במקומו"]);
  assert.deepEqual(alongsideFields(kit, box.binding), []);
  const counts = applyAdditions(b.edit, [...items, box].map((cell) => ({ cell, fields: set })), ids());
  assert.deepEqual(b.edits, [100], "five cells of one route: one edit");
  assert.equal(counts.skipped, 4);
  assert.equal(counts.added, 4 + 2);
  for (const c of items) assert.deepEqual(labels(fieldsOf(b.configs, c)), ["מצב חיצוני בסגירה"]);
  assert.deepEqual(labels(fieldsOf(b.configs, box)).slice(-2), ["הפריט ארוז במקומו", "מצב חיצוני בסגירה"]);
});

test("section headers come along, unless every field under one was skipped; a cell never passes the field limit", () => {
  const b = bench();
  const m = b.map();
  const target = cellAt(m, "line:3", mech);   // "מקשים 1", "מקשים 2"
  const sec = (label: string, id: string): Field => ({ id, type: "section", label });
  const incoming: Field[] = [
    sec("ראשון", "f_sec00001"), choice("מקשים 1", ["pass", "fail"]),            // all skipped → header dropped
    sec("שני", "f_sec00002"), choice("כבל", ["pass", "fail"]), choice("מקשים 2", ["pass", "fail"]),
    sec("ריק", "f_sec00003"),                                                   // headed nothing: kept
  ];
  const cfg = copyConfig(b.configs[103]);
  const r = addToCell(cfg, target.binding, target.stepMeta, incoming, ids());
  assert.deepEqual(r, { added: 1, skipped: 2, overflow: 0 });
  assert.deepEqual(labels(groupFieldsOf(cfg, target.binding.step_uid, target.binding.target)), ["מקשים 1", "מקשים 2", "שני", "כבל", "ריק"]);

  const room = LIMITS.fieldsPerList - 2;
  const many = Array.from({ length: room + 3 }, (_, i) => choice("שדה " + i, ["pass", "fail"]));
  const cfg2 = copyConfig(b.configs[103]);
  const r2 = addToCell(cfg2, target.binding, target.stepMeta, many, ids());
  assert.deepEqual(r2, { added: room, skipped: 0, overflow: 3 });
  assert.equal(groupFieldsOf(cfg2, target.binding.step_uid, target.binding.target).length, LIMITS.fieldsPerList);
});

test("TSV text goes into every selected cell; a cell without a step gets one", () => {
  const b = bench();
  delete b.configs[104].steps.s_msvisu00;
  const m = b.map();
  const empty = cellAt(m, "line:4", visu);                 // בדיקה ויזואלית · עכבר: no step in the config
  const pcVisu = cellAt(m, "line:1", visu);
  const rows = parseTsvRows("שם השדה\tאפשרות 1\nכבל\tתקין\tפגום\nמאוורר");
  const counts = applyAdditions(b.edit, planTsvPaste(rows, [empty, pcVisu, pcVisu], null, ids()), ids());
  assert.deepEqual(counts, { cells: 2, added: 4, skipped: 0, overflow: 0, outside: 0 });
  assert.deepEqual(labels(fieldsOf(b.configs, empty)), ["כבל", "מאוורר"]);
  const made = stepConfigOf(b.configs[104], "s_msvisu00");
  assert.deepEqual(made && [made.station_type_id, made.station_label, made.scope], [VISU, "בדיקה ויזואלית", "item"]);
  assert.deepEqual(b.edits.sort(), [101, 104]);
  assert.equal(stepFieldIds(b.configs[101], pcVisu.binding.step_uid).size, 5);
});

// ---- clear ----------------------------------------------------------------------------------------
test("clear empties the groups — the step stays, with its other groups — one edit per route", () => {
  const b = bench();
  const m = b.map();
  const targets = [cellAt(m, "box", "kit:0"), cellAt(m, "line:1", "kit:0"), cellAt(m, "line:1", elec), cellAt(m, "line:4", "kit:1")];
  const cleared = clearCells(b.edit, [...targets, targets[0]]);
  assert.equal(cleared, 3, "the mouse's closing cell had nothing to clear");
  assert.deepEqual(b.edits.sort(), [100, 101]);
  for (const c of targets) assert.deepEqual(fieldsOf(b.configs, c), []);
  const opening = stepConfigOf(b.configs[100], "s_kitopen1");
  assert.ok(opening);
  assert.deepEqual(opening.groups.map((g) => (typeof g.target === "object" ? g.target.item_type_id : g.target)), ["each_item", 4, 5]);
  assert.ok(stepConfigOf(b.configs[101], "s_pcelec00"), "an emptied step is kept (groups [])");
  assert.equal(stepConfigOf(b.configs[100], `s_kitclos1`)?.groups.length, 2, "nothing to clear: untouched");
});

// ---- helpers -----------------------------------------------------------------------------------------
test("targets are taken once per group, in map order", () => {
  const b = bench();
  const m = b.map();
  const a = cellAt(m, "line:2", elec);
  const c = cellAt(m, "box", "kit:0");
  assert.deepEqual(inMapOrder(m, [a, c]).map((x) => x.key), [c.key, a.key]);
  assert.deepEqual(uniqueByBinding([a, c, a]).map((x) => x.key), [a.key, c.key]);
});
