import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { buildFieldsMap, columnNavKey, mapNavGrid } from "../../../lib/mapModel";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "../../../lib/draftModel";
import { ELEC, MECH, VISU, artboard1 } from "../../../lib/__tests__/fixtures";
import { firstNavKey, navPosition, navTarget } from "../useGridNavigation";
import type { NavGrid } from "../useGridNavigation";

/**
 * The arrows of the fields map (route-fields spec §5.16): a roving tabindex over the cells that can
 * hold fields; "—" is skipped; in RTL ArrowLeft moves toward the inline end.
 */

function artboard1Grid(): NavGrid {
  const ctx: FieldsContextJson = artboard1();
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  const m = buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
  return mapNavGrid(m.columns, m.rows);
}

const RTL = { rtl: true, bodyStart: 1 };
const LTR = { rtl: false, bodyStart: 1 };
const elec = `step:${ELEC}:1`;
const mech = `step:${MECH}:1`;
const visu = `step:${VISU}:1`;

test("the grid starts on the first cell of the body, not on a header", () => {
  const g = artboard1Grid();
  assert.equal(firstNavKey(g, 1), "box|kit:0");
  assert.equal(firstNavKey([[null, "a"], [null, null]], 1), "a", "a body with nothing to focus falls back to the headers");
  assert.equal(firstNavKey([[null], [null]], 1), null);
  assert.deepEqual(navPosition(g, "box|kit:1"), { row: 1, col: 4 });
  assert.equal(navPosition(g, "nope"), null);
});

test("RTL: ArrowLeft moves to the next column (the inline end), ArrowRight back — skipping '—'", () => {
  const g = artboard1Grid();
  // "הקופסה": only the two kit columns hold fields.
  assert.equal(navTarget(g, "box|kit:0", "ArrowLeft", RTL), "box|kit:1");
  assert.equal(navTarget(g, "box|kit:1", "ArrowRight", RTL), "box|kit:0");
  assert.equal(navTarget(g, "box|kit:1", "ArrowLeft", RTL), null, "the end of the row: no move");
  // The keyboard row skips the electrical station it does not pass.
  assert.equal(navTarget(g, "line:3|kit:0", "ArrowLeft", RTL), `line:3|${mech}`);
  // LTR is the mirror.
  assert.equal(navTarget(g, "line:3|kit:0", "ArrowRight", LTR), `line:3|${mech}`);
  assert.equal(navTarget(g, `line:3|${mech}`, "ArrowLeft", LTR), "line:3|kit:0");
});

test("ArrowUp / ArrowDown move in the column, over '—', up to the column header", () => {
  const g = artboard1Grid();
  assert.equal(navTarget(g, "box|kit:0", "ArrowDown", RTL), "each_item|kit:0");
  assert.equal(navTarget(g, `line:1|${elec}`, "ArrowUp", RTL), columnNavKey(elec), "the box rows are '—' there");
  assert.equal(navTarget(g, `line:2|${elec}`, "ArrowDown", RTL), null, "the keyboard and the mouse do not pass it");
  assert.equal(navTarget(g, columnNavKey(mech), "ArrowDown", RTL), `line:2|${mech}`);
  assert.equal(navTarget(g, columnNavKey(mech), "ArrowUp", RTL), null);
});

test("Home / End: the row's first and last; with Ctrl, the body's", () => {
  const g = artboard1Grid();
  assert.equal(navTarget(g, `line:2|${visu}`, "Home", RTL), "line:2|kit:0");
  assert.equal(navTarget(g, `line:2|${elec}`, "End", RTL), "line:2|kit:1");
  assert.equal(navTarget(g, `line:2|${visu}`, "Home", { ...RTL, ctrlKey: true }), "box|kit:0");
  assert.equal(navTarget(g, "box|kit:0", "End", { ...RTL, ctrlKey: true }), "line:4|kit:1");
  // In the header row: its first / last header.
  assert.equal(navTarget(g, columnNavKey(mech), "End", RTL), columnNavKey("kit:1"));
});

test("anything else is not a move", () => {
  const g = artboard1Grid();
  assert.equal(navTarget(g, "box|kit:0", "Enter", RTL), null);
  assert.equal(navTarget(g, "box|kit:0", " ", RTL), null);
  assert.equal(navTarget(g, "gone|key", "ArrowDown", RTL), null);
});
