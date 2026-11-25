"use client";
import * as React from "react";
import { ChevronDown, ClipboardPaste, Plus } from "lucide-react";
import { Button, DialogReturnFocus } from "@/components/ui";
import type { FieldType } from "@/app/lib/station-fields/schema";
import type { PasteCounts } from "../../lib/cellFill";
import { EDITOR_TEXT } from "../../lib/labels";
import { BULK_UNDRAWN_TEXT, PASTE_TSV_TEXT, pastedText } from "../../lib/bulkLabels";
import { PasteTextDialog } from "../shared/PasteTextDialog";
import { readClipboardText } from "../shared/clipboard";
import { NoticeSnackbar, useNotice } from "../shared/Notice";
import { FIELD_TYPE_PICKER_ID, FieldTypePicker } from "./FieldTypePicker";
import { ADD_ROW_ID, PASTE_TSV_ID } from "./useFieldListEditor";

/**
 * The add bar under the rows table (artboard 2, spec §5.5.2 ד). "הדבק מאקסל" (spec §5.14) reads the
 * system clipboard and hands its text to `onPasteTsv`, which makes one draft edit. When the page may
 * not read the clipboard — no permission, or plain http, where the browser has no clipboard API — a
 * paste box takes Ctrl V instead (undrawn). The message after the paste is undrawn too.
 */

/** What a paste did, for the message after it. */
export type TsvPasteOutcome = Pick<PasteCounts, "added" | "skipped" | "overflow">;

export type AddFieldBarProps = {
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onAddRow: () => void;
  /** "+ כותרת מקטע"; without it the button is not drawn (a field set — artboard 8 has none: a section
   *  comes from the type picker there). */
  onAddSection?: () => void;
  /** A type from the picker (the picker closes itself). */
  onPick: (type: FieldType) => void;
  /** "הדבק מאקסל": the clipboard's text in, what was pasted out (null: no rows in it). Without it the
   *  button is not drawn. */
  onPasteTsv?: (text: string) => TsvPasteOutcome | null;
};

export function AddFieldBar({ pickerOpen, onPickerOpenChange, onAddRow, onAddSection, onPick, onPasteTsv }: AddFieldBarProps) {
  // The picker hangs from this button and leaves presses on it alone: the button is its toggle.
  const typeRef = React.useRef<HTMLButtonElement>(null);
  const pasteRef = React.useRef<HTMLButtonElement>(null);
  const [pasteBoxOpen, setPasteBoxOpen] = React.useState(false);
  const { notice, say, close } = useNotice();

  // After the paste box the paste button takes the focus back — unless a pasted row took it.
  const returnFocus = React.useCallback(
    () => (document.activeElement == null || document.activeElement === document.body ? pasteRef.current : null),
    [],
  );
  const paste = (text: string) => {
    const r = onPasteTsv?.(text) ?? null;
    say(r ? pastedText({ ...r, cells: 1, outside: 0 }) : BULK_UNDRAWN_TEXT.nothingToPaste);
  };
  const pasteFromClipboard = async () => {
    const text = await readClipboardText();
    if (text == null) setPasteBoxOpen(true);
    else paste(text);
  };

  return (
    <div className="sfe-addbar">
      <button id={ADD_ROW_ID} type="button" className="route-add sfe-addbar__row" onClick={onAddRow}>
        <span className="sfe-addbar__lead">
          <Plus size={18} strokeWidth={1.75} aria-hidden />
          {EDITOR_TEXT.addRow}
        </span>
        <span className="sfe-addbar__caption">{EDITOR_TEXT.addRowCaption}</span>
      </button>
      <Button
        ref={typeRef}
        variant="outlined"
        size="small"
        className="sfe-addbar__type"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-controls={pickerOpen ? FIELD_TYPE_PICKER_ID : undefined}
        endIcon={<ChevronDown size={14} strokeWidth={1.75} aria-hidden />}
        onClick={() => onPickerOpenChange(!pickerOpen)}
      >
        {EDITOR_TEXT.otherType}
      </Button>
      {onAddSection && (
        <Button
          variant="text"
          size="small"
          className="sfe-addbar__section"
          startIcon={<Plus size={15} strokeWidth={1.75} aria-hidden />}
          onClick={onAddSection}
        >
          {EDITOR_TEXT.addSection}
        </Button>
      )}
      {onPasteTsv && (
        <Button
          ref={pasteRef}
          id={PASTE_TSV_ID}
          variant="text"
          size="small"
          // The same ghost as "+ כותרת מקטע" beside it (artboard 2 draws the two alike).
          className="sfe-addbar__section"
          title={PASTE_TSV_TEXT.title}
          startIcon={<ClipboardPaste size={15} strokeWidth={1.75} aria-hidden />}
          onClick={() => void pasteFromClipboard()}
        >
          {PASTE_TSV_TEXT.button}
        </Button>
      )}
      <FieldTypePicker open={pickerOpen} onOpenChange={onPickerOpenChange} anchorRef={typeRef} onPick={onPick} />
      {onPasteTsv && (
        <>
          <DialogReturnFocus.Provider value={returnFocus}>
            <PasteTextDialog
              open={pasteBoxOpen}
              title={PASTE_TSV_TEXT.button}
              onCancel={() => setPasteBoxOpen(false)}
              onPaste={(text) => {
                setPasteBoxOpen(false);
                paste(text);
              }}
            />
          </DialogReturnFocus.Provider>
          <NoticeSnackbar notice={notice} onClose={close} />
        </>
      )}
    </div>
  );
}
