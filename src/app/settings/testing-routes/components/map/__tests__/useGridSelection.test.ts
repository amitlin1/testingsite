import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { buildFieldsMap, columnNavKey, mapNavGrid } from "../../../lib/mapModel";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "../../../lib/draftModel";
import { selectedCellsText } from "../../../lib/labels";
import { ELEC, MECH, VISU, artboard1 } from "../../../lib/__tests__/fixtures";
import {
  EMPTY_SELECTION, columnKeys, extendTo, isBodyKey, pickColumn, rangeKeys, toggleKey, visibleSelection,
} from "../useGridSelection";
import type { NavGrid } from "../useGridNavigation";

/**
 * The map's multi-select (route-fields spec §5.14, §5.16; artboard 1): Ctrl / ⌘ + click or Space
 * toggles, Shift a rectangle that never takes a "—", a column header the column, Escape clears.
 */

function artboard1Grid(): NavGrid {
  const ctx: FieldsContextJson = artboard1();
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const m = buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
  return mapNavGrid(m.columns, m.rows);
}

const elec = `step:${ELEC}:1`;
const mech = `step:${MECH}:1`;
const visu = `step:${VISU}:1`;
const B = 1;

test("Ctrl / ⌘ + click or Space: a cell in and out; four cells → '4 תאים נבחרו'", () => {
  const g = artboard1Grid();
  let s = EMPTY_SELECTION;
  for (const k of ["box|kit:0", `line:1|${elec}`, `line:2|${mech}`, "line:4|kit:1"]) s = toggleKey(s, k);
  const sel = visibleSelection(s, g, B);
  assert.equal(sel.length, 4);
  assert.equal(selectedCellsText(sel.length), "4 תאים נבחרו");
  assert.equal(selectedCellsText(1), "תא אחד נבחר");
  s = toggleKey(s, `line:1|${elec}`);
  assert.deepEqual(visibleSelection(s, g, B), ["box|kit:0", `line:2|${mech}`, "line:4|kit:1"], "reading order");
  assert.equal(s.anchor, `line:1|${elec}`);
});

test("Shift: the rectangle from the anchor, without the '—' places, on top of what was selected before", () => {
  const g = artboard1Grid();
  const rect = rangeKeys(g, `line:1|${elec}`, `line:3|${visu}`, B);
  // מחשב: חשמל, ויזואלית (no מכניקה); מסך: all three; מקלדת: מכניקה, ויזואלית (no חשמל).
  assert.deepEqual(rect, [
    `line:1|${elec}`, `line:1|${visu}`,
    `line:2|${elec}`, `line:2|${mech}`, `line:2|${visu}`,
    `line:3|${mech}`, `line:3|${visu}`,
  ]);
  assert.deepEqual(rangeKeys(g, columnNavKey(elec), `line:1|${elec}`, B), [], "a header is not a corner of a range");

  let s = toggleKey(EMPTY_SELECTION, "box|kit:0");
  s = toggleKey(s, `line:1|${elec}`);
  s = extendTo(s, `line:3|${visu}`, g, B);
  assert.equal(visibleSelection(s, g, B).length, 1 + rect.length);
  // The range shrinks back from the same anchor; the cell selected before it stays.
  s = extendTo(s, `line:2|${mech}`, g, B);
  assert.deepEqual(visibleSelection(s, g, B), ["box|kit:0", `line:1|${elec}`, `line:2|${elec}`, `line:2|${mech}`]);
});

test("Shift with no anchor: from the cell that had the focus, else the cell alone", () => {
  const g = artboard1Grid();
  const s = extendTo(EMPTY_SELECTION, `line:2|${visu}`, g, B, `line:1|${visu}`);
  assert.deepEqual(visibleSelection(s, g, B), [`line:1|${visu}`, `line:2|${visu}`]);
  assert.equal(s.anchor, `line:1|${visu}`);
  const alone = extendTo(EMPTY_SELECTION, `line:2|${visu}`, g, B, columnNavKey(visu));
  assert.deepEqual(visibleSelection(alone, g, B), [`line:2|${visu}`]);
  assert.equal(extendTo(EMPTY_SELECTION, columnNavKey(visu), g, B), EMPTY_SELECTION, "a header is never selected");
  // A cell toggled on and off again anchors nothing: the focused cell does.
  const offAgain = toggleKey(toggleKey(EMPTY_SELECTION, `line:3|${visu}`), `line:3|${visu}`);
  assert.deepEqual(visibleSelection(extendTo(offAgain, `line:2|${visu}`, g, B, `line:1|${visu}`), g, B), [`line:1|${visu}`, `line:2|${visu}`]);
});

test("a column header: the column's cells instead of the selection — with Ctrl / ⌘ on top of it", () => {
  const g = artboard1Grid();
  const col = g[0].indexOf(columnNavKey(elec));
  assert.deepEqual(columnKeys(g, col, B), [`line:1|${elec}`, `line:2|${elec}`], "artboard 1: 'מוגדרים 2/2'");
  const kit = columnKeys(g, 0, B);
  assert.equal(kit.length, 6, "the kit column: box, each item, four lines");
  let s = toggleKey(EMPTY_SELECTION, `line:3|${mech}`);
  s = pickColumn(s, columnKeys(g, col, B), false);
  assert.deepEqual(visibleSelection(s, g, B), [`line:1|${elec}`, `line:2|${elec}`]);
  s = pickColumn(s, kit, true);
  assert.equal(visibleSelection(s, g, B).length, 8, "kit and item columns mix");
  assert.equal(s.anchor, kit[0]);
});

test("only keys the grid shows count; isBodyKey knows the body from the headers and '—'", () => {
  const g = artboard1Grid();
  const s = toggleKey(toggleKey(EMPTY_SELECTION, "line:9|nothing"), `line:1|${elec}`);
  assert.deepEqual(visibleSelection(s, g, B), [`line:1|${elec}`]);
  assert.ok(isBodyKey(g, `line:1|${elec}`, B));
  assert.ok(!isBodyKey(g, columnNavKey(elec), B));
  assert.ok(!isBodyKey(g, `line:3|${elec}`, B), "מקלדת · חשמל is '—'");
  assert.ok(!isBodyKey(g, null, B));
});
