"use client";
import * as React from "react";
import { ClipboardPaste, Library, X } from "lucide-react";
import { Button } from "@/components/ui";
import { BULK_TEXT, selectedCellsText } from "../../lib/labels";
import { PASTE_TSV_TEXT } from "../../lib/bulkLabels";

/**
 * The selection bar of the fields map (route-fields spec §5.4.4, §5.14; artboard 1), drawn while at
 * least one cell is selected. Artboard 1's outlined "עריכה משותפת" is NOT drawn: spec §5.14 has no
 * final artboard for the shared editor ("ב-k/n" is spec-only, לא אומת), so it waits for one.
 * The arrows move between the bar's buttons (the toolbar pattern); Tab still reaches each one.
 */

export type FieldsMapBulkBarProps = {
  /** Selected cells. */
  count: number;
  /** "החל ערכת שדות…" (artboard 9's dialog, which the page hosts). */
  onApplySet: () => void;
  onPaste: () => void;
  onCopy: () => void;
  onClear: () => void;
  onDeselect: () => void;
};

/** Arrow keys between the toolbar's buttons, by the bar's direction; Home / End to the ends. */
function moveInToolbar(e: React.KeyboardEvent<HTMLDivElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0 || buttons.length === 0) return;
  const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
  const forward = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
  const to = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (at + (forward ? 1 : -1) + buttons.length) % buttons.length;
  e.preventDefault();
  buttons[to].focus();
}

export default function FieldsMapBulkBar({ count, onApplySet, onPaste, onCopy, onClear, onDeselect }: FieldsMapBulkBarProps) {
  return (
    <div role="toolbar" aria-label={BULK_TEXT.toolbarLabel} className="rf-bulk" onKeyDown={moveInToolbar}>
      <span className="rf-bulk__count">{selectedCellsText(count)}</span>
      <Button variant="text" size="small" className="rf-bulk__btn" startIcon={<Library size={16} strokeWidth={1.75} aria-hidden />} onClick={onApplySet}>
        {BULK_TEXT.applySet}
      </Button>
      <Button
        variant="text"
        size="small"
        className="rf-bulk__btn"
        aria-keyshortcuts="Control+V Meta+V"
        startIcon={<ClipboardPaste size={16} strokeWidth={1.75} aria-hidden />}
        onClick={onPaste}
      >
        {BULK_TEXT.paste}
        <span className="rf-bulk__key" dir="ltr" aria-hidden="true">{PASTE_TSV_TEXT.pasteKeys}</span>
      </Button>
      <Button variant="text" size="small" className="rf-bulk__btn" aria-keyshortcuts="Control+C Meta+C" onClick={onCopy}>
        {BULK_TEXT.copy}
      </Button>
      <Button variant="text" size="small" color="error" className="rf-bulk__btn" onClick={onClear}>
        {BULK_TEXT.clear}
      </Button>
      <Button
        variant="text"
        size="small"
        className="rf-bulk__btn rf-bulk__deselect"
        aria-keyshortcuts="Escape"
        startIcon={<X size={16} strokeWidth={1.75} aria-hidden />}
        onClick={onDeselect}
      >
        {BULK_TEXT.deselect}
      </Button>
    </div>
  );
}
