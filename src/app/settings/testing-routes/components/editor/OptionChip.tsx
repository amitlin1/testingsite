"use client";
import * as React from "react";
import { X } from "lucide-react";
import type { ChoiceOption, Tone } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import { ToneDot } from "@/app/testing/fields/ToneDot";
import { EDITOR_TEXT, optionEditLabel, optionRemoveLabel } from "../../lib/labels";
import { ToneMenu } from "./ToneMenu";
import type { ToneMenuCloseReason } from "./ToneMenu";

/**
 * One option of a choice row (artboard 2, spec §5.5.2). A press renames it in place and opens ToneMenu
 * above it; Enter, Escape or × end the rename and give the chip its focus back. Every change goes up
 * as is; the row applies artboard 2's rule (any change to an option unlinks the field from its list).
 */

export type OptionChipProps = {
  option: ChoiceOption;
  editing: boolean;
  /** Start (or, while editing, end) the rename. */
  onToggleEdit: () => void;
  /** End the rename. */
  onClose: () => void;
  onRename: (label: string) => void;
  onTone: (tone: Tone) => void;
  onRemove: () => void;
};

/** Artboard 2 `inW`: a chip's rename input grows with the label. */
export const chipInputWidth = (label: string) => Math.max(36, Math.round(label.length * 7.4) + 6);

export type ChipViewProps = {
  buttonRef: React.Ref<HTMLButtonElement>;
  label: string;
  /** The chip button's aria-label (a press renames). */
  editLabel: string;
  removeLabel: string;
  /** Before the label (an option's tone dot). */
  lead?: React.ReactNode;
  onEdit: () => void;
  onRemove: () => void;
};

/** A chip not in rename: the label (marked when empty) and its ×. */
export function ChipView({ buttonRef, label, editLabel, removeLabel, lead, onEdit, onRemove }: ChipViewProps) {
  return (
    <span className="sfe-chip">
      <button
        ref={buttonRef}
        type="button"
        className="sfe-chip__btn"
        aria-label={editLabel}
        data-empty={label.trim() === "" || undefined}
        onClick={onEdit}
      >
        {lead}
        <span className="sfe-chip__label">{label}</span>
      </button>
      <button type="button" className="sfe-chip__x" aria-label={removeLabel} onClick={onRemove}>
        <X size={12} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

export function OptionChip({ option, editing, onToggleEdit, onClose, onRename, onTone, onRemove }: OptionChipProps) {
  const chipRef = React.useRef<HTMLButtonElement>(null);
  const editRef = React.useRef<HTMLSpanElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const toneGroupRef = React.useRef<HTMLDivElement>(null);
  // Set when a rename ends by Enter / Escape / ×: the plain chip takes the focus back.
  const refocus = React.useRef(false);

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      chipRef.current?.focus();
    }
  }, [editing]);

  const end = (back: boolean) => {
    refocus.current = back;
    onClose();
  };

  if (!editing) {
    return (
      <ChipView
        buttonRef={chipRef}
        label={option.label}
        editLabel={optionEditLabel(option.label, option.tone)}
        removeLabel={optionRemoveLabel(option.label)}
        lead={<ToneDot tone={option.tone} />}
        onEdit={onToggleEdit}
        onRemove={onRemove}
      />
    );
  }

  return (
    <span className="sfe-chip">
      <span ref={editRef} className="sfe-chip__edit">
        <ToneDot tone={option.tone} />
        <input
          ref={inputRef}
          className="sfe-chip__input"
          aria-label={EDITOR_TEXT.optionNameLabel}
          value={option.label}
          maxLength={LIMITS.optionLabel}
          style={{ width: chipInputWidth(option.label) }}
          onChange={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              end(true);
            } else if (e.key === "Tab" && !e.shiftKey) {
              // The menu is portaled to the end of the page: Tab goes into its radios rather than
              // past the chip (which would close it before the keyboard could reach a tone).
              const radio = toneGroupRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
              if (radio) {
                e.preventDefault();
                radio.focus();
              }
            }
          }}
        />
      </span>
      <ToneMenu
        open
        groupRef={toneGroupRef}
        anchorRef={editRef}
        tone={option.tone}
        onTone={onTone}
        onDelete={onRemove}
        onClose={(reason: ToneMenuCloseReason) => end(reason !== "outside")}
      />
    </span>
  );
}
