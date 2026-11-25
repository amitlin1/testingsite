import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { getColumn, getRow } from "../../../lib/mapModel";
import { ELEC, artboard1, cellAt, mapFor } from "../../../lib/__tests__/fixtures";
import { clearCellsTitle, copiedText, pastedText } from "../../../lib/bulkLabels";
import FieldsMapBulkBar from "../FieldsMapBulkBar";
import FieldsMapCell from "../FieldsMapCell";

/**
 * The selection bar and the selected cell as markup (route-fields spec §5.4.3, §5.4.4; artboard 1),
 * and the undrawn messages around them.
 */

const html = (el: ReactElement): string => renderToStaticMarkup(createElement(TooltipProvider, null, el));
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, "");
const noop = () => {};

test("the bar: role=toolbar with artboard 1's name, the count, then החל ערכת שדות… · הדבק · העתק · נקה · בטל בחירה", () => {
  const out = html(createElement(FieldsMapBulkBar, { count: 4, onApplySet: noop, onPaste: noop, onCopy: noop, onClear: noop, onDeselect: noop }));
  assert.match(out, /role="toolbar" aria-label="פעולות על התאים שנבחרו"/);
  const text = textOf(out);
  assert.ok(text.startsWith("4 תאים נבחרו"));
  const order = ["החל ערכת שדות…", "הדבק", "Ctrl V", "העתק", "נקה", "בטל בחירה"].map((w) => text.indexOf(w));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), text);
  // The key hint is for the eye only; the shortcut is announced on the button.
  assert.match(out, /dir="ltr" aria-hidden="true">Ctrl V</);
  assert.match(out, /aria-keyshortcuts="Control\+V Meta\+V"/);
  assert.ok(textOf(html(createElement(FieldsMapBulkBar, { count: 1, onApplySet: noop, onPaste: noop, onCopy: noop, onClear: noop, onDeselect: noop }))).startsWith("תא אחד נבחר"));
});

test("a selected cell: the gridcell is aria-selected, not a toggle; without a selection there is no aria-selected", () => {
  const m = mapFor(artboard1());
  const cell = cellAt(m, "line:1", `step:${ELEC}:1`);
  const props = {
    cell, row: getRow(m, "line:1")!, column: getColumn(m, `step:${ELEC}:1`)!, firstRow: false, lastRow: false,
    sharedState: false, setName: null, navKey: cell.key, tabIndex: -1 as const, onActivate: noop,
  };
  const on = html(createElement(FieldsMapCell, { ...props, selected: true }));
  assert.match(on, /role="gridcell" aria-selected="true"/);
  assert.doesNotMatch(on, /aria-pressed/);
  assert.match(html(createElement(FieldsMapCell, { ...props, selected: false })), /aria-selected="false"/);
  assert.doesNotMatch(html(createElement(FieldsMapCell, props)), /aria-selected/);
});

test("undrawn messages: one cell or many, and what a paste did", () => {
  assert.equal(clearCellsTitle(1), "לנקות את התא?");
  assert.equal(clearCellsTitle(4), "לנקות 4 תאים?");
  assert.equal(copiedText(1), "התא הועתק");
  assert.equal(copiedText(3), "3 תאים הועתקו");
  assert.equal(pastedText({ cells: 1, added: 1, skipped: 0, overflow: 0, outside: 0 }), "נוסף שדה אחד");
  assert.equal(pastedText({ cells: 4, added: 4, skipped: 4, overflow: 0, outside: 0 }), "נוספו 4 שדות ב-4 תאים · 4 שדות דולגו כדי למנוע כפילות");
  assert.equal(pastedText({ cells: 0, added: 0, skipped: 1, overflow: 0, outside: 1 }), "לא נוספו שדות · שדה אחד דולג כדי למנוע כפילות · תא אחד לא במסלול");
});
