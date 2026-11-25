import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import { stepConfigOf } from "@/app/lib/station-fields/schema";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer } from "../draftModel";
import type { ConfigMutator } from "../draftModel";
import type { IdSource } from "../editorModel";
import { buildFieldsMap } from "../mapModel";
import { cellStateOf, editByRoute, fillCell } from "../cellFill";
import type { CellState, RouteEdit } from "../cellFill";
import { applyFieldSet, applyPreview } from "../applySetModel";
import { MECH, artboard1, cellAt, choice } from "./fixtures";

/**
 * One fill for every way fields go into a cell (route-fields spec §5.10, §5.14; artboard 9; D8): what
 * the apply-set preview marks is what the apply skips; headers, room, ids and place are the fill's.
 */

function ids(): IdSource {
  let n = 0;
  const next = (prefix: string) => prefix + "z" + (++n).toString(36).padStart(7, "0");
  return { field: () => next("f_"), option: () => next("o_"), item: () => next("c_") };
}

const sec = (label: string, id: string): Field => ({ id, type: "section", label });
const labels = (fs: readonly Field[]) => fs.map((f) => f.label);
const cell = (fields: Field[], alongside: Field[] = []): CellState => ({ fields, alongside, stepIds: new Set(fields.map((f) => f.id)) });

function bench() {
  const ctx = artboard1();
  const configs: Record<number, RouteFieldsConfig> = currentConfigs(draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx }));
  const edits: number[] = [];
  const edit: RouteEdit = (routeId: number, mutate: ConfigMutator) => {
    edits.push(routeId);
    const copy = structuredClone(configs[routeId]);
    configs[routeId] = mutate(copy) ?? copy;
  };
  return { configs, edits, edit, map: () => buildFieldsMap({ context: ctx, configs }) };
}

test("the preview is the apply: the fields it marks are the ones the apply skips, cell by cell", () => {
  const b = bench();
  // The closing step's each_item group holds one of the set's names; the keyboard's mechanical cell another.
  stepConfigOf(b.configs[100], "s_kitclos1")!.groups.find((g) => g.target === "each_item")!.fields.push(choice("הפריט ארוז במקומו", ["pass", "fail"]));
  const m = b.map();
  const targets = [cellAt(m, "line:1", "kit:1"), cellAt(m, "line:2", "kit:1"), cellAt(m, "line:3", `step:${MECH}:1`), cellAt(m, "line:2", `step:${MECH}:1`)];
  const set = { id: 9, version: 1, fields: [sec("קבלה", "f_set00sec"), choice("הפריט ארוז במקומו", ["pass", "fail"]), choice("מקשים 1", ["pass", "fail"]), choice("כבל", ["pass", "fail"])] };

  const preview = applyPreview(b.configs, targets, set.fields, "add");
  const perCell = targets.map((c) => fillCell(cellStateOf(b.configs[c.binding.route_id], c.binding), set.fields).skips.map((s) => s.index));
  const counts = applyFieldSet(b.edit, { set, cells: targets, mode: "add", linked: true }, ids());
  assert.equal(counts.skipped, perCell.flat().length);
  assert.equal(counts.skipped, 3, "two kit items × the each_item name, the keyboard × its own name");
  // "יידלג" only on a field every target skips; none here.
  assert.deepEqual(preview.rows.map((r) => r.skip), [false, false, false, false]);
  assert.deepEqual(preview.skips.map((s) => [s.field, s.place.kind]), [["הפריט ארוז במקומו", "each_item"], ["מקשים 1", "cell"]]);
});

test("add: a section header comes along only over a field that goes in, or over nothing at all", () => {
  const r = fillCell(cell([choice("מקשים 1", ["pass"]), choice("מקשים 2", ["pass"])]), [
    sec("ראשון", "f_sec00001"), choice("מקשים 1", ["pass", "fail"]),            // all skipped → header dropped
    sec("שני", "f_sec00002"), choice("כבל", ["pass", "fail"]), choice("מקשים 2", ["pass", "fail"]),
    sec("ריק", "f_sec00003"),                                                   // headed nothing: kept
  ], { ids: ids() });
  assert.deepEqual(labels(r.fields), ["מקשים 1", "מקשים 2", "שני", "כבל", "ריק"]);
  assert.deepEqual(labels(r.added), ["שני", "כבל", "ריק"]);
  assert.equal(r.skipped, 2);
  assert.equal(r.overflow, 0);
});

test("add: a name the each_item group holds is skipped there; a name repeated further down too", () => {
  const r = fillCell(cell([], [choice("ארוז", ["pass"])]), [choice("ארוז", ["pass"]), choice("כבל", ["pass"]), choice(" כבל ", ["fail"])], { ids: ids() });
  assert.deepEqual(labels(r.fields), ["כבל"]);
  assert.deepEqual(r.skips, [{ index: 0, place: "each_item" }, { index: 2, place: "cell" }]);
});

test("a cell never grows past LIMITS.fieldsPerList: the rest is overflow, and a header left with nothing goes", () => {
  const own = Array.from({ length: LIMITS.fieldsPerList - 2 }, (_, i) => choice("קיים " + i, ["pass"]));
  const incoming = [choice("א", ["pass"]), choice("ב", ["pass"]), sec("אחרי", "f_sec00009"), choice("ג", ["pass"]), choice("ד", ["pass"])];
  const r = fillCell(cell(own), incoming, { ids: ids() });
  assert.equal(r.fields.length, LIMITS.fieldsPerList);
  assert.deepEqual(labels(r.added), ["א", "ב"]);
  assert.equal(r.overflow, 2);
  assert.equal(r.skipped, 0);
});

test("copies take fresh ids none of the step uses — the replaced ones included; option ids are kept", () => {
  const taken = choice("קיים", ["pass"]);
  const incoming = [{ ...choice("חדש", ["pass", "fail"]), id: taken.id }];
  const state: CellState = { fields: [taken], alongside: [], stepIds: new Set([taken.id, "f_z0000001"]) };
  for (const mode of ["add", "replace"] as const) {
    const r = fillCell(state, incoming, { mode, ids: ids() });
    assert.equal(r.added[0].id, "f_z0000002", mode + ": the step's ids are passed over");
    assert.deepEqual(r.added[0].type === "choice_row" && r.added[0].options.map((o) => o.id), incoming[0].type === "choice_row" && incoming[0].options.map((o) => o.id));
    assert.notEqual(r.added[0], incoming[0], "a copy, not the template");
  }
});

test("add goes after `after` (or at the end when the cell has no such field); replace skips nothing", () => {
  const a = choice("א", ["pass"]);
  const b = choice("ב", ["pass"]);
  const incoming = [choice("ג", ["pass"]), choice("א", ["pass"])];
  assert.deepEqual(labels(fillCell(cell([a, b]), incoming, { after: a.id, ids: ids() }).fields), ["א", "ג", "ב"]);
  assert.deepEqual(labels(fillCell(cell([a, b]), incoming, { after: "f_nothere1", ids: ids() }).fields), ["א", "ב", "ג"]);
  const replaced = fillCell(cell([a, b]), incoming, { mode: "replace", ids: ids() });
  assert.deepEqual(labels(replaced.fields), ["ג", "א"]);
  assert.deepEqual(replaced.skips, []);
});

test("editByRoute: one edit per route, each applying its items in turn", () => {
  const edits: number[] = [];
  const seen: string[] = [];
  const edit: RouteEdit = (routeId, mutate) => {
    edits.push(routeId);
    mutate({ schema: 1, steps: {} });
  };
  editByRoute(edit, [{ r: 2, n: "a" }, { r: 1, n: "b" }, { r: 2, n: "c" }], (x) => x.r, (_, x) => seen.push(x.n));
  assert.deepEqual(edits, [2, 1]);
  assert.deepEqual(seen, ["a", "c", "b"]);
});
