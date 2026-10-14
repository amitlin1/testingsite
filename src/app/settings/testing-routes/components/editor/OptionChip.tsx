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
 * One option of a choice row (artboard 2, spec §5.5.2): a 32px parchment chip with the tone's dot and
 * the label; × "הסרת האפשרות {label}" shows on hover / focus. A press renames it in place — an input
 * "שם האפשרות" with the focus edge and halo — and opens ToneMenu above it. Tab in the input goes to
 * the menu's radios. Enter, Escape or × end the rename and give the chip its focus back.
 *
 * Every change goes up as is; the row applies artboard 2's rule (any change to an option unlinks the
 * field from its shared list).
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

/** Artboard 2 `inW`: the rename input grows with the label. */
const inputWidth = (label: string) => Math.max(36, Math.round(label.length * 7.4) + 6);

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
    const empty = option.label.trim() === "";
    return (
      <span className="sfe-chip">
        <button
          ref={chipRef}
          type="button"
          className="sfe-chip__btn"
          aria-label={optionEditLabel(option.label, option.tone)}
          data-empty={empty || undefined}
          onClick={onToggleEdit}
        >
          <ToneDot tone={option.tone} />
          <span className="sfe-chip__label">{option.label}</span>
        </button>
        <button type="button" className="sfe-chip__x" aria-label={optionRemoveLabel(option.label)} onClick={onRemove}>
          <X size={12} strokeWidth={1.75} aria-hidden />
        </button>
      </span>
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
          style={{ width: inputWidth(option.label) }}
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

export default OptionChip;
