import { test } from "node:test";
import assert from "node:assert/strict";
import type { Issue } from "@/app/lib/station-fields/validate";
import { FIELDS_UNDRAWN_TEXT as SF_UNDRAWN_TEXT, LINT_TEXT } from "@/app/lib/station-fields/labels";
import {
  MAP_FILTERS, buildFieldsMap, cellMatchesFilter, columnNavKey, filterCounts, mapErrorBar, mapNavGrid, visibleRows,
} from "../mapModel";
import { filterChipText } from "../labels";
import { ELEC, MECH, artboard1, artboard11, config, fields, getCell, mapFor, step } from "./fixtures";

/**
 * What FieldsMap draws from the model (route-fields spec §5.4.4, §5.16; artboards 1, 11): the
 * toolbar's filter chips and the rows they leave, the grid the arrows walk, the error bar.
 */

test("artboard 1: the chips read 'הכל · 20', 'ללא שדות · 5', 'שגיאות · 1', 'לא פורסמו · 1'", () => {
  const m = mapFor(artboard1());
  const counts = filterCounts(m);
  assert.deepEqual(counts, { all: 20, empty: 5, errors: 1, unpublished: 1 });
  assert.deepEqual(MAP_FILTERS.map((f) => filterChipText({ all: "הכל", empty: "ללא שדות", errors: "שגיאות", unpublished: "לא פורסמו" }[f], counts[f])),
    ["הכל · 20", "ללא שדות · 5", "שגיאות · 1", "לא פורסמו · 1"]);
});

test("a filter keeps the rows with a matching cell; 'הכל' keeps every row", () => {
  const m = mapFor(artboard1());
  const keys = (f: (typeof MAP_FILTERS)[number]) => visibleRows(m, f).map((r) => r.key);
  assert.deepEqual(keys("all"), ["box", "each_item", "line:1", "line:2", "line:3", "line:4"]);
  // The empty cells: the four closing cells of the lines and the mouse's opening cell.
  assert.deepEqual(keys("empty"), ["line:1", "line:2", "line:3", "line:4"]);
  assert.deepEqual(keys("errors"), ["line:2"]);
  assert.deepEqual(keys("unpublished"), ["line:1"]);
  // A row drawn under a filter keeps all its cells (the non-matching ones shown as they are).
  assert.equal(visibleRows(m, "errors")[0].cells.length, m.columns.length);
});

test("a '—' cell never matches a filter", () => {
  const m = mapFor(artboard1());
  const na = getCell(m, "box", `step:${ELEC}:1`);
  assert.ok(na?.na);
  for (const f of MAP_FILTERS) assert.equal(cellMatchesFilter(na, f), false);
  const empty = getCell(m, "line:4", "kit:0");
  assert.ok(empty && !empty.na);
  assert.equal(cellMatchesFilter(empty, "empty"), true);
  assert.equal(cellMatchesFilter(empty, "all"), true);
  assert.equal(cellMatchesFilter(empty, "errors"), false);
});

test("the navigation grid: the headers first, then a key per cell that can hold fields, null for '—'", () => {
  const m = mapFor(artboard1());
  const { grid, bodyStart } = mapNavGrid(m.columns, m.rows);
  assert.equal(bodyStart, 1);
  assert.equal(grid.length, 1 + m.rows.length);
  assert.deepEqual(grid[0], m.columns.map((c) => columnNavKey(c.key)));
  assert.deepEqual(grid[1], ["box|kit:0", null, null, null, "box|kit:1"]);
  // The keyboard does not pass through the electrical station (artboard 1's tooltip cell).
  assert.equal(grid[5][1], null);
  assert.equal(grid[5][2], `line:3|step:${MECH}:1`);
  // Only the rows drawn: the error filter leaves the screen's row.
  const filtered = mapNavGrid(m.columns, visibleRows(m, "errors")).grid;
  assert.equal(filtered.length, 2);
  assert.equal(filtered[1][2], `line:2|step:${MECH}:1`);
});

test("artboard 1's error bar: 'מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'' and 'עבור לשדה' to that field", () => {
  const ctx = artboard1();
  const m = mapFor(ctx);
  const bar = mapErrorBar(m, ctx);
  assert.ok(bar);
  assert.equal(bar.text, "מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'");
  assert.equal(bar.cell?.key, `line:2|step:${MECH}:1`);
  assert.deepEqual(bar.cell?.binding, { route_id: 102, step_uid: "s_momech00", target: "item" });
  const vesa = ctx.lines[1].route!.published!.steps.s_momech00.groups[0].fields[1];
  assert.equal(bar.fieldId, vesa.id);
});

test("no error, no bar", () => {
  const ctx = artboard11();
  assert.equal(mapErrorBar(mapFor(ctx), ctx), null);
});

test("several errors: the bar shows the first, in column then row order", () => {
  const ctx = artboard1();
  const pcElec = ctx.lines[0].route!.published!.steps.s_pcelec00.groups[0].fields[0];
  const issues: Record<number, Issue[]> = {
    102: [{ level: "error", code: "OPTION_LABEL_EMPTY", step_uid: "s_momech00", target: "item", field_id: "f_unknown0", message: "x" }],
    101: [{ level: "error", code: "FIELD_LABEL_EMPTY", step_uid: "s_pcelec00", target: "item", field_id: pcElec.id, message: LINT_TEXT.fieldLabelEmpty }],
  };
  const m = mapFor(ctx, { issues });
  const bar = mapErrorBar(m, ctx);
  assert.equal(bar?.text, "חשמל · מחשב: " + LINT_TEXT.fieldLabelEmpty, "the electrical column comes before the mechanical one");
  assert.equal(m.totals.errors, 2);
});

test("an error on no cell: named by its route's item and its step's station, without 'עבור לשדה'", () => {
  // The computer's route holds a step that left the route.
  const ctx = artboard1();
  ctx.lines[0].route!.draft = config(step("s_igone000", MECH, "item", [{ target: "item", fields: fields(1, ["pass", "fail"]) }]));
  const routeId = ctx.lines[0].route!.route.test_route_id;
  const unknown: Issue = { level: "error", code: "STEP_UNKNOWN", step_uid: "s_igone000", message: SF_UNDRAWN_TEXT.stepUnknown };
  const m = buildFieldsMap({ context: ctx, issues: { [routeId]: [unknown] } });
  assert.equal(m.errors.length, 1);
  assert.equal(m.errors[0].cell, null);
  const bar = mapErrorBar(m, ctx);
  assert.deepEqual(bar, { text: "מכניקה · מחשב: " + SF_UNDRAWN_TEXT.stepUnknown, cell: null, fieldId: null });
  // A step the context's configs do not know either: the item and the message.
  const lost = buildFieldsMap({ context: ctx, issues: { [routeId]: [{ ...unknown, step_uid: "s_nowhere0" }] } });
  assert.equal(mapErrorBar(lost, ctx)?.text, "מחשב: " + SF_UNDRAWN_TEXT.stepUnknown);
  // The kit's own route: named by the kit.
  const kitId = ctx.kit!.route.test_route_id;
  const onKit = buildFieldsMap({ context: ctx, issues: { [kitId]: [{ ...unknown, step_uid: "s_nowhere0" }] } });
  assert.equal(mapErrorBar(onKit, ctx)?.text, ctx.subject.desc + ": " + SF_UNDRAWN_TEXT.stepUnknown);
});
