"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { NOTES_MODE_LABEL } from "@/app/lib/station-fields/schema";
import type { NotesMode } from "@/app/lib/station-fields/schema";
import { EDITOR_TEXT, notesModeAria } from "../../lib/labels";
import { ListboxPopover } from "./ListboxPopover";
import type { ListboxOption } from "./ListboxPopover";

/**
 * "הערות" of a field row (artboard 2, spec §5.5.2): a 38px button (aria-haspopup="listbox",
 * aria-label "הערות: {mode}") and its 196px listbox "מצב הערות" — אופציונלי / חובה בכשל / חובה / ללא,
 * in the artboard's order — with the footnote on "חובה בכשל".
 */

/** The artboard script's `NM` order. */
const ORDER: readonly NotesMode[] = ["optional", "required_on_fail", "required", "off"];
const OPTIONS: readonly ListboxOption<NotesMode>[] = ORDER.map((m) => ({ value: m, label: NOTES_MODE_LABEL[m] }));

export type NotesModeSelectProps = {
  value: NotesMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (mode: NotesMode) => void;
};

export function NotesModeSelect({ value, open, onOpenChange, onChange }: NotesModeSelectProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();
  const label = NOTES_MODE_LABEL[value];
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="sfe-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={notesModeAria(label)}
        onClick={() => onOpenChange(!open)}
      >
        <span className="sfe-select__value">{label}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <ListboxPopover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={buttonRef}
        id={listId}
        label={EDITOR_TEXT.notesListLabel}
        options={OPTIONS}
        value={value}
        onPick={(mode) => {
          if (mode !== value) onChange(mode);
          onOpenChange(false);
        }}
        footnote={EDITOR_TEXT.notesFootnote}
      />
    </>
  );
}

export default NotesModeSelect;
