"use client";
import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import type { FieldType } from "@/app/lib/station-fields/schema";
import { EDITOR_TEXT } from "../../lib/labels";
import { FIELD_TYPE_PICKER_ID, FieldTypePicker } from "./FieldTypePicker";

/**
 * The add bar under the rows table (artboard 2, spec §5.5.2 ד): the full-width dashed "הוסף שורת
 * בדיקה" (44px, Plus, the caption "שם · בחירה מתוך 4 אפשרויות · הערות"); outlined small "סוג שדה אחר ▾"
 * that opens the type picker (artboard 3 — on tint with a halo while open); ghost "+ כותרת מקטע".
 * "הדבק מאקסל" joins in session 2e.
 */

/** The add-row button's id: focus lands here when the last row is removed. */
export const ADD_ROW_ID = "sfe-add-row";

export type AddFieldBarProps = {
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onAddRow: () => void;
  /** "+ כותרת מקטע"; without it the button is not drawn (a field set — artboard 8 has none: a section
   *  comes from the type picker there). */
  onAddSection?: () => void;
  /** A type from the picker (the picker closes itself). */
  onPick: (type: FieldType) => void;
};

export function AddFieldBar({ pickerOpen, onPickerOpenChange, onAddRow, onAddSection, onPick }: AddFieldBarProps) {
  // The picker hangs from this button and leaves presses on it alone: the button is its toggle.
  const typeRef = React.useRef<HTMLButtonElement>(null);
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
      <FieldTypePicker open={pickerOpen} onOpenChange={onPickerOpenChange} anchorRef={typeRef} onPick={onPick} />
    </div>
  );
}

export default AddFieldBar;
