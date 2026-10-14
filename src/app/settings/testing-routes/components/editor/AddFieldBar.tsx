"use client";
import * as React from "react";
import { ChevronDown, ClipboardPaste, Plus } from "lucide-react";
import { Button, Snackbar } from "@/components/ui";
import type { FieldType } from "@/app/lib/station-fields/schema";
import { EDITOR_TEXT } from "../../lib/labels";
import { BULK_UNDRAWN_TEXT, PASTE_TSV_TEXT, pastedText } from "../../lib/bulkLabels";
import { PasteTextDialog, readClipboardText } from "../map/FieldsMapBulkBar";
import { FIELD_TYPE_PICKER_ID, FieldTypePicker } from "./FieldTypePicker";

/**
 * The add bar under the rows table (artboard 2, spec §5.5.2 ד): the full-width dashed "הוסף שורת
 * בדיקה" (44px, Plus, the caption "שם · בחירה מתוך 4 אפשרויות · הערות"); outlined small "סוג שדה אחר ▾"
 * that opens the type picker (artboard 3 — on tint with a halo while open); ghost "+ כותרת מקטע";
 * ghost "הדבק מאקסל" (ClipboardPaste, title "הדביקו שורות: שם⇥אפשרות 1⇥אפשרות 2⇥…").
 *
 * "הדבק מאקסל" (spec §5.14) reads the system clipboard (navigator.clipboard.readText) and hands its
 * text to `onPasteTsv`, which parses it (pasteTsv) and makes one draft edit. When the page may not
 * read the clipboard — no permission, or plain http, where the browser has no clipboard API — a
 * paste box takes Ctrl V instead (undrawn). The message after the paste is undrawn too.
 */

/** The add-row button's id: focus lands here when the last row is removed. */
export const ADD_ROW_ID = "sfe-add-row";
/** "הדבק מאקסל"'s id: pressing it keeps the row that had the focus as the place to paste after. */
export const PASTE_TSV_ID = "sfe-paste-tsv";

/** What a paste did, for the message after it. */
export type TsvPasteOutcome = { added: number; skipped: number; overflow: number };

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
  const [pasteBoxOpen, setPasteBoxOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<{ text: string; seq: number } | null>(null);
  const say = (text: string) => setNotice((n) => ({ text, seq: (n?.seq ?? 0) + 1 }));

  // ui/Dialog has no trigger to give the focus back to: after the paste box, the button takes it —
  // unless a pasted row did (the editor focuses the first new row's name).
  const refocusButtonSoon = () => {
    window.setTimeout(() => {
      if (document.activeElement == null || document.activeElement === document.body) document.getElementById(PASTE_TSV_ID)?.focus();
    }, 0);
  };
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
          <PasteTextDialog
            open={pasteBoxOpen}
            title={PASTE_TSV_TEXT.button}
            onCancel={() => {
              setPasteBoxOpen(false);
              refocusButtonSoon();
            }}
            onPaste={(text) => {
              setPasteBoxOpen(false);
              paste(text);
              refocusButtonSoon();
            }}
          />
          <Snackbar
            key={notice?.seq ?? 0}
            open={notice != null}
            message={notice?.text}
            autoHideDuration={5000}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            onClose={() => setNotice(null)}
          />
        </>
      )}
    </div>
  );
}

export default AddFieldBar;
