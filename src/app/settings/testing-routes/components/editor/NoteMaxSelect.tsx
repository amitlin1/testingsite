"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { NOTE_MAX_CHOICES, NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import type { NoteMax } from "@/app/lib/station-fields/schema";
import { EDITOR_TEXT, noteMaxAria, noteMaxOptionText, noteMaxText } from "../../lib/labels";
import { ListboxPopover } from "./ListboxPopover";
import type { ListboxOption } from "./ListboxPopover";

/**
 * "אורך מרבי" of a field's note — artboard 2's version (spec §5.5.2: artboard 2 wins over 7א): a
 * ghost 24px "עד {n} תווים" under the notes select, and its listbox "אורך מרבי להערה" — 500 / 1000
 * (the default) / 2000 — with the footnote on the worker's counter. The row hides it while the notes
 * are "ללא". Saved as note_max; the default 1000 is stored as no note_max at all (spec §2.2).
 */

const OPTIONS: readonly ListboxOption<NoteMax>[] = NOTE_MAX_CHOICES.map((n) => ({
  value: n,
  label: noteMaxOptionText(n, n === NOTE_MAX_DEFAULT),
}));

export type NoteMaxSelectProps = {
  value: NoteMax;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (n: NoteMax) => void;
};

export function NoteMaxSelect({ value, open, onOpenChange, onChange }: NoteMaxSelectProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="sfe-notemax"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={noteMaxAria(value)}
        title={EDITOR_TEXT.noteMaxTitle}
        onClick={() => onOpenChange(!open)}
      >
        <span>{noteMaxText(value)}</span>
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
      </button>
      <ListboxPopover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={buttonRef}
        id={listId}
        label={EDITOR_TEXT.noteMaxTitle}
        header={EDITOR_TEXT.noteMaxHeader}
        options={OPTIONS}
        value={value}
        sideOffset={4}
        onPick={(n) => {
          if (n !== value) onChange(n);
          onOpenChange(false);
        }}
        footnote={EDITOR_TEXT.noteMaxFootnote}
      />
    </>
  );
}

export default NoteMaxSelect;
