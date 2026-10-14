import { test } from "node:test";
import assert from "node:assert/strict";
import { stepConfigOf } from "@/app/lib/station-fields/schema";
import type { Field, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { EMPTY_DRAFT_MODEL, copyConfig, currentConfigs, draftReducer, summarize } from "../draftModel";
import type { ConfigMutator } from "../draftModel";
import type { IdSource } from "../editorModel";
import { buildFieldsMap, getCell, groupFieldsOf } from "../mapModel";
import type { FieldsMapModel, MapCell } from "../mapModel";
import type { RouteEdit } from "../bulkModel";
import {
  applyFieldSet, applyPreview, cellFieldsForSet, cellStations, duplicateLines, firstColumnCells, initialSetId, replaceCell,
  setTemplate, showsPackageNote, targetChips, visibleSets,
} from "../applySetModel";
import type { ApplySetSource } from "../applySetModel";
import {
  APPLY_SET_UNDRAWN_TEXT, applyButtonText, applySubText, applyTitleText, fieldMetaText, previewCountText, previewTitleText,
  savedAsSetText,
} from "../applySetLabels";
import { EDITOR_TEXT, cellMenuText } from "../labels";
import { ELEC, MECH, VISU, artboard1, choice } from "./fixtures";

/**
 * "החלת ערכת שדות" (route-fields spec §5.10; artboard 9; D8): what the cells take, add vs. replace,
 * "השאר מקושר", the duplicate rule, the preview's marks and lines, the chips — and ONE draft edit
 * per route touched.
 */

function ids(): IdSource {
  let n = 0;
  const next = (prefix: string) => prefix + "a" + (++n).toString(36).padStart(7, "0");
  return { field: () => next("f_"), option: () => next("o_"), item: () => next("c_") };
}

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
const fieldsOf = (configs: Record<number, RouteFieldsConfig>, c: MapCell) => groupFieldsOf(configs[c.binding.route_id], c.binding.step_uid, c.binding.target);
const labels = (fs: readonly Field[]) => fs.map((f) => f.label);
const elec = `step:${ELEC}:1`;
const visu = `step:${VISU}:1`;

/** Artboard 9's "קבלת פריט במארז" (2 fields), version 3, with a section header ahead. */
function pkgSet(): ApplySetSource {
  return {
    id: 9,
    version: 3,
    fields: [
      { id: "f_set00sec", type: "section", label: "קבלה" },
      choice("הפריט ארוז במקומו", ["pass", "warn", "fail", "fail"], { required: true, notes: "required_on_fail" }),
      choice("מצב חיצוני בסגירה", ["pass", "warn", "fail", "warn"], { notes: "required_on_fail", list_ref: { id: 4, ver: 2 } } as Partial<Field>),
    ],
  };
}

/** The closing step's each_item group holds "הפריט ארוז במקומו" — artboard 9's duplicate. */
function withPackedEachItem(configs: Record<number, RouteFieldsConfig>): void {
  const closing = stepConfigOf(configs[100], "s_kitclos1");
  assert.ok(closing);
  closing.groups.find((g) => g.target === "each_item")!.fields.push(choice("הפריט ארוז במקומו", ["pass", "fail"]));
}

// ---- what the cells take ---------------------------------------------------------------------------
test("setTemplate: deep copies; from_set {id, ver} on every input field when linked, none when not; sections bare", () => {
  const set = pkgSet();
  const linked = setTemplate(set, true);
  assert.deepEqual(linked.map((f) => (f.type === "section" ? null : f.from_set)), [null, { id: 9, ver: 3 }, { id: 9, ver: 3 }]);
  assert.deepEqual(linked[0], { id: "f_set00sec", type: "section", label: "קבלה" });
  const copy = setTemplate({ ...set, fields: [{ ...set.fields[1], from_set: { id: 1, ver: 1 } } as Field] }, false);
  assert.ok(copy[0].type !== "section" && copy[0].from_set === undefined, "an independent copy carries no link at all");
  // list_ref (a shared option list) stays: the field is still linked to its list.
  assert.deepEqual(linked[2].type === "choice_row" ? linked[2].list_ref : null, { id: 4, ver: 2 });
  linked[1].label = "שונה";
  assert.equal(set.fields[1].label, "הפריט ארוז במקומו", "the set itself is untouched");
});

test("add (artboard 9): four kit items at the closing station — the each_item duplicate skipped, the rest linked; one edit", () => {
  const b = bench();
  withPackedEachItem(b.configs);
  const m = b.map();
  const items = ["line:1", "line:2", "line:3", "line:4"].map((r) => cellAt(m, r, "kit:1"));
  const counts = applyFieldSet(b.edit, { set: pkgSet(), cells: items, mode: "add", linked: true }, ids());
  assert.deepEqual(b.edits, [100], "four cells of the kit route: one edit");
  assert.deepEqual(counts, { cells: 4, added: 4, skipped: 4, overflow: 0, outside: 0 });
  for (const c of items) {
    const fs = fieldsOf(b.configs, c);
    assert.deepEqual(labels(fs), ["קבלה", "מצב חיצוני בסגירה"], "the section comes along with the field under it");
    assert.ok(fs[0].type === "section" && !("from_set" in fs[0]));
    assert.ok(fs[1].type !== "section" && fs[1].from_set?.id === 9 && fs[1].from_set.ver === 3);
  }
  // Fresh ids, unique in the step (four copies of one template).
  const step = stepConfigOf(b.configs[100], "s_kitclos1");
  const allIds = step!.groups.flatMap((g) => g.fields.map((f) => f.id));
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(!allIds.includes("f_set00sec"));
  assert.doesNotThrow(() => parseRouteFieldsConfig(b.configs[100]));
});

test("add: after the cell's own fields; not linked → no from_set; cells of several routes → an edit per route", () => {
  const b = bench();
  const m = b.map();
  const pc = cellAt(m, "line:1", elec);       // מחשב · חשמל: 5 fields (route 101)
  const mon = cellAt(m, "line:2", elec);      // מסך · חשמל: 3 fields (route 102)
  const before = labels(fieldsOf(b.configs, pc));
  const counts = applyFieldSet(b.edit, { set: pkgSet(), cells: [pc, mon, pc], mode: "add", linked: false }, ids());
  assert.deepEqual([...b.edits].sort(), [101, 102]);
  assert.equal(counts.cells, 2, "the same cell twice is one cell");
  assert.deepEqual(labels(fieldsOf(b.configs, pc)), [...before, "קבלה", "הפריט ארוז במקומו", "מצב חיצוני בסגירה"]);
  assert.ok(fieldsOf(b.configs, mon).every((f) => f.type === "section" || f.from_set === undefined));
});

test("replace: the cell's fields become the set's under fresh ids — none reused; the step's other groups stay", () => {
  const b = bench();
  const m = b.map();
  const pcOpen = cellAt(m, "line:1", "kit:0");   // פתיחת מארז · מחשב: 2 fields
  const box = cellAt(m, "box", "kit:0");
  const oldIds = fieldsOf(b.configs, pcOpen).map((f) => f.id);
  const boxBefore = fieldsOf(b.configs, box);
  const counts = applyFieldSet(b.edit, { set: pkgSet(), cells: [pcOpen], mode: "replace", linked: true }, ids());
  assert.deepEqual(b.edits, [100]);
  assert.deepEqual(counts, { cells: 1, added: 2, skipped: 0, overflow: 0, outside: 0 });
  const now = fieldsOf(b.configs, pcOpen);
  assert.deepEqual(labels(now), ["קבלה", "הפריט ארוז במקומו", "מצב חיצוני בסגירה"]);
  assert.ok(now.every((f) => !oldIds.includes(f.id) && f.id.startsWith("f_a")));
  assert.deepEqual(fieldsOf(b.configs, box), boxBefore);
  assert.doesNotThrow(() => parseRouteFieldsConfig(b.configs[100]));
});

test("replace never skips — not even a name each_item holds (artboard 9 draws no 'יידלג' there)", () => {
  const b = bench();
  withPackedEachItem(b.configs);
  const m = b.map();
  const pcClose = cellAt(m, "line:1", "kit:1");
  applyFieldSet(b.edit, { set: pkgSet(), cells: [pcClose], mode: "replace", linked: false }, ids());
  assert.deepEqual(labels(fieldsOf(b.configs, pcClose)), ["קבלה", "הפריט ארוז במקומו", "מצב חיצוני בסגירה"]);
});

test("replaceCell creates the step when the config has none", () => {
  const b = bench();
  delete b.configs[104].steps.s_msvisu00;
  const m = b.map();
  const msVisu = cellAt(m, "line:4", visu);
  const cfg = copyConfig(b.configs[104]);
  assert.equal(replaceCell(cfg, msVisu.binding, msVisu.stepMeta, setTemplate(pkgSet(), true), ids()), 2);
  const made = stepConfigOf(cfg, "s_msvisu00");
  assert.deepEqual(made && [made.station_type_id, made.scope, made.groups.length], [VISU, "item", 1]);
});

// ---- the preview ------------------------------------------------------------------------------------
test("preview (artboard 9): 'יידלג' on the field every cell skips, one duplicate line for the each_item place", () => {
  const b = bench();
  withPackedEachItem(b.configs);
  const m = b.map();
  const items = ["line:1", "line:2", "line:3", "line:4"].map((r) => cellAt(m, r, "kit:1"));
  const p = applyPreview(b.configs, items, pkgSet().fields, "add");
  assert.equal(p.fieldCount, 2);
  assert.deepEqual(p.rows.map((r) => r.skip), [false, true, false]);
  assert.deepEqual(duplicateLines(m, p), ["שדה 'הפריט ארוז במקומו' כבר קיים ב'כל פריט במארז' — יידלג כדי למנוע כפילות"]);
  // Replace: nothing is skipped.
  const r = applyPreview(b.configs, items, pkgSet().fields, "replace");
  assert.deepEqual(r.rows.map((x) => x.skip), [false, false, false]);
  assert.deepEqual(r.skips, []);
});

test("preview: a field only some cells already have gets no Tag; its line names the cell by its chip", () => {
  const b = bench();
  const m = b.map();
  const kb = cellAt(m, "line:3", `step:${MECH}:1`);   // "מקשים 1", "מקשים 2"
  const mon = cellAt(m, "line:2", `step:${MECH}:1`);
  const set: ApplySetSource = { id: 2, version: 1, fields: [choice("מקשים 1", ["pass", "fail"]), choice("כבל", ["pass", "fail"])] };
  const p = applyPreview(b.configs, [mon, kb], set.fields, "add");
  assert.deepEqual(p.rows.map((x) => x.skip), [false, false]);
  assert.deepEqual(duplicateLines(m, p), ["שדה 'מקשים 1' כבר קיים ב'מכניקה · 04 מקלדת' — יידלג כדי למנוע כפילות"]);
  // The preview's walk is addToCell's: what it marks is what the apply skips.
  const counts = applyFieldSet(b.edit, { set, cells: [mon, kb], mode: "add", linked: true }, ids());
  assert.equal(counts.skipped, p.skips.length);
});

// ---- chips, stations, note -------------------------------------------------------------------------------
test("target chips (artboard 9): '{station} · {seq} {item}[ ×{qty}]' in map order; stations once each", () => {
  const b = bench();
  const m = b.map();
  const cells = [cellAt(m, "line:2", "kit:1"), cellAt(m, "line:1", "kit:1"), cellAt(m, "box", "kit:0")];
  assert.deepEqual(targetChips(m, cells).map((c) => c.text), [
    "פתיחת מארז · הקופסה",
    "סגירת מארז · 01 מחשב",
    "סגירת מארז · 02–03 מסך ×2",
  ]);
  assert.deepEqual(targetChips(m, [cells[0]])[0], { key: cells[0].key, station: "סגירת מארז", seq: "02–03", item: "מסך", qty: "×2", text: "סגירת מארז · 02–03 מסך ×2" });
  assert.deepEqual(cellStations(m, cells), ["פתיחת מארז", "סגירת מארז"]);
  assert.deepEqual(cellStations(m, cells.slice(0, 2)), ["סגירת מארז"]);
  assert.equal(showsPackageNote(cells.slice(0, 1)), true);
  assert.equal(showsPackageNote([cellAt(m, "box", "kit:1")]), false, "the box's fields are not in an item's row");
  assert.equal(showsPackageNote([cellAt(m, "line:1", elec)]), false);
});

test("entry points: the onboarding's first column; the editor's 'שמור כערכה…' fields", () => {
  const b = bench();
  const m = b.map();
  assert.deepEqual(firstColumnCells(m).map((c) => c.key), ["box", "each_item", "line:1", "line:2", "line:3", "line:4"].map((r) => r + "|kit:0"));
  let n = 0;
  const fs: Field[] = [
    { id: "f_sec00001", type: "section", label: "מקטע" },
    { ...choice("שדה", ["pass", "fail"]), from_set: { id: 7, ver: 2 } } as Field,
  ];
  const out = cellFieldsForSet(fs, () => "f_new0000" + ++n);
  assert.equal(out.length, 1);
  assert.ok(out[0].type !== "section" && out[0].from_set === undefined && out[0].id === "f_new00001");
  assert.ok(fs[1].type !== "section" && fs[1].from_set?.id === 7, "the cell's own field is untouched");
});

test("the set to start on, and the search", () => {
  const sets = [{ id: 3, name: "קבלת פריט במארז" }, { id: 5, name: "תקינות אריזה" }, { id: 8, name: "בדיקה חזותית בסיסית" }];
  assert.equal(initialSetId(sets, 5), 5);
  assert.equal(initialSetId(sets, 99), 3);
  assert.equal(initialSetId(sets, null), 3);
  assert.equal(initialSetId([], 5), null);
  assert.deepEqual(visibleSets(sets, " אריזה ").map((s) => s.id), [5]);
  assert.deepEqual(visibleSets(sets, "").length, 3);
});

// ---- strings ---------------------------------------------------------------------------------------------
test("artboard 9's strings, and the undrawn singulars", () => {
  assert.equal(applyTitleText(4), "החלת ערכת שדות · 4 תאים");
  assert.equal(applyTitleText(1), APPLY_SET_UNDRAWN_TEXT.titleOne);
  assert.equal(applyButtonText(4), "החל על 4 תאים");
  assert.equal(applyButtonText(1), APPLY_SET_UNDRAWN_TEXT.applyOne);
  assert.equal(applySubText("מארז עמדת עבודה", 1, ["סגירת מארז"]), "מארז עמדת עבודה · מסלול 1 · עמדת סגירת מארז");
  assert.equal(applySubText("מארז עמדת עבודה", 1, ["חשמל", "מכניקה"]), "מארז עמדת עבודה · מסלול 1 · 2 עמדות");
  assert.equal(previewTitleText("add", "קבלת פריט במארז"), "מה יתווסף לכל תא · קבלת פריט במארז");
  assert.equal(previewTitleText("replace", "קבלת פריט במארז"), "מה יהיה בכל תא · קבלת פריט במארז");
  assert.equal(previewCountText(2), "2 שדות · קריאה בלבד");
  assert.equal(previewCountText(1), "שדה אחד · קריאה בלבד");
  const [, packed, outer] = pkgSet().fields;
  assert.ok(packed.type !== "section" && outer.type !== "section");
  assert.equal(fieldMetaText(packed, null), "הערות: חובה בכשל");
  assert.equal(fieldMetaText(outer, "מצב חיצוני"), "רשימה: מצב חיצוני · הערות: חובה בכשל");
  assert.equal(fieldMetaText({ id: "f_num00001", type: "number", label: "מתח", required: false, notes: "optional", out_of_range_fail: true }, null), "מספר · הערות: אופציונלי");
  assert.equal(savedAsSetText("חשמל · מחשב"), "הערכה 'חשמל · מחשב' נשמרה בספריית הערכות");
});

test("the editor's ⋯ names only the items its menu has (artboard 2's label with all three)", () => {
  assert.equal(cellMenuText(["saveAsSet", "applySet", "clear"]), EDITOR_TEXT.cellMenuLabel);
  assert.equal(cellMenuText(["clear", "saveAsSet"]), "פעולות נוספות לתא: שמור כערכה, נקה את התא");
});
