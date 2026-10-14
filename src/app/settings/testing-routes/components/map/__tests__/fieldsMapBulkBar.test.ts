import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/Tooltip";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { buildFieldsMap, getCell, getColumn, getRow } from "../../../lib/mapModel";
import type { FieldsMapModel } from "../../../lib/mapModel";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "../../../lib/draftModel";
import { ELEC, artboard1 } from "../../../lib/__tests__/fixtures";
import { BULK_UNDRAWN_TEXT, clearCellsMessage, clearCellsTitle, copiedText, pastedText } from "../../../lib/bulkLabels";
import FieldsMapBulkBar from "../FieldsMapBulkBar";
import FieldsMapCell from "../FieldsMapCell";

/**
 * The selection bar and the selected cell as markup (route-fields spec §5.4.3, §5.4.4; artboard 1),
 * and the undrawn messages around them.
 */

const html = (el: ReactElement): string => renderToStaticMarkup(createElement(TooltipProvider, null, el));
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, "");
const noop = () => {};

function mapOf(ctx: FieldsContextJson): FieldsMapModel {
  const model = draftReducer(EMPTY_DRAFT_MODEL, { type: "load", context: ctx });
  return buildFieldsMap({ context: ctx, configs: currentConfigs(model), issues: summarize(model).issuesByRoute });
}

test("the bar: role=toolbar with artboard 1's name, the count, then הדבק · העתק · נקה · בטל בחירה", () => {
  const out = html(createElement(FieldsMapBulkBar, { count: 4, onPaste: noop, onCopy: noop, onClear: noop, onDeselect: noop }));
  assert.match(out, /role="toolbar" aria-label="פעולות על התאים שנבחרו"/);
  const text = textOf(out);
  assert.ok(text.startsWith("4 תאים נבחרו"));
  const order = ["הדבק", "Ctrl V", "העתק", "נקה", "בטל בחירה"].map((w) => text.indexOf(w));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), text);
  assert.ok(!text.includes("החל ערכת שדות…"), "no apply-set without onApplySet");
  assert.ok(!text.includes("עריכה משותפת"), "the shared editor has no final artboard yet");
  assert.match(out, /<span class="rf-bulk__key" dir="ltr" aria-hidden="true">Ctrl V<\/span>/);
  assert.match(out, /aria-keyshortcuts="Control\+V Meta\+V"/);
  assert.match(out, /sh-btn--error[^>]*>נקה</);
});

test("the bar with onApplySet: 'החל ערכת שדות…' after the count, before 'הדבק'", () => {
  const text = textOf(html(createElement(FieldsMapBulkBar, { count: 1, onApplySet: noop, onPaste: noop, onCopy: noop, onClear: noop, onDeselect: noop })));
  assert.ok(text.startsWith("תא אחד נבחר"));
  assert.ok(text.indexOf("החל ערכת שדות…") > 0 && text.indexOf("החל ערכת שדות…") < text.indexOf("הדבק"));
});

test("a selected cell: the gridcell is aria-selected, the tile framed, the badge drawn; unselected has none", () => {
  const m = mapOf(artboard1());
  const cell = getCell(m, "line:1", `step:${ELEC}:1`);
  assert.ok(cell && !cell.na);
  const props = {
    cell, row: getRow(m, "line:1")!, column: getColumn(m, `step:${ELEC}:1`)!, firstRow: false, lastRow: false,
    sharedState: false, setName: null, navKey: cell.key, tabIndex: -1 as const, onActivate: noop,
  };
  const on = html(createElement(FieldsMapCell, { ...props, selected: true }));
  assert.match(on, /role="gridcell" aria-selected="true"/);
  assert.match(on, /class="rf-cell rf-cell--defined rf-cell--selected"/);
  assert.match(on, /rf-cell__check/);
  assert.doesNotMatch(on, /aria-pressed/);
  const off = html(createElement(FieldsMapCell, { ...props, selected: false }));
  assert.match(off, /aria-selected="false"/);
  assert.doesNotMatch(off, /rf-cell__check/);
  const none = html(createElement(FieldsMapCell, props));
  assert.doesNotMatch(none, /aria-selected/);
});

test("undrawn messages: the clear confirm, after a copy, after a paste", () => {
  assert.equal(clearCellsTitle(1), "לנקות את התא?");
  assert.equal(clearCellsTitle(4), "לנקות 4 תאים?");
  assert.equal(clearCellsMessage(4), "כל השדות של 4 התאים יוסרו מהטיוטה. ביטול הטיוטה מחזיר אותם.");
  assert.equal(copiedText(1), "התא הועתק");
  assert.equal(copiedText(3), "3 תאים הועתקו");
  assert.equal(pastedText({ cells: 1, added: 1, skipped: 0, overflow: 0, outside: 0 }), "נוסף שדה אחד");
  assert.equal(pastedText({ cells: 4, added: 4, skipped: 4, overflow: 0, outside: 0 }), "נוספו 4 שדות ב-4 תאים · 4 שדות דולגו כדי למנוע כפילות");
  assert.equal(pastedText({ cells: 0, added: 0, skipped: 1, overflow: 0, outside: 1 }), "לא נוספו שדות · שדה אחד דולג כדי למנוע כפילות · תא אחד לא במסלול");
  assert.equal(BULK_UNDRAWN_TEXT.nothingToPaste, "אין מה להדביק");
});
