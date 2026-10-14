"use client";
import * as React from "react";
import { Trash2, X } from "lucide-react";
import { AnchoredPopover } from "@/components/ui";
import { TONES, TONE_WORD } from "@/app/lib/station-fields/schema";
import type { Tone } from "@/app/lib/station-fields/schema";
import { ToneDot } from "@/app/testing/fields/ToneDot";
import { EDITOR_TEXT } from "../../lib/labels";

/**
 * "סוג האפשרות" — the menu over an option chip being renamed (artboard 2, spec §5.5.2): role="dialog"
 * "עריכת אפשרות", 200px, radius 12; the title and × "סגירה"; a radiogroup תקין / אזהרה / כשל / ניטרלי
 * (32px rows, the tone's dot, the chosen one on tint / 600); a divider; "מחק אפשרות" in red.
 *
 * Focus stays in the chip's rename input when it opens (the input is the anchor, so pressing or
 * focusing it never closes the menu); Tab there moves it into the radios (`groupRef` — the menu is
 * portaled, so the page's Tab order would skip it), and Tab then cycles inside the menu. Arrows
 * walk the radios and choose as they go, like any radio group. `onClose` says why it closed: Escape
 * and × hand focus back to the chip; a press elsewhere leaves it where it went.
 */

export type ToneMenuCloseReason = "escape" | "button" | "outside";

export type ToneMenuProps = {
  open: boolean;
  onClose: (reason: ToneMenuCloseReason) => void;
  /** The chip in rename mode. */
  anchorRef: React.RefObject<HTMLElement | null>;
  tone: Tone;
  onTone: (tone: Tone) => void;
  onDelete: () => void;
  /** The radiogroup's element, for the rename input's Tab (see above). */
  groupRef?: React.RefObject<HTMLDivElement | null>;
};

export function ToneMenu({ open, onClose, anchorRef, tone, onTone, onDelete, groupRef: outerGroupRef }: ToneMenuProps) {
  const ownGroupRef = React.useRef<HTMLDivElement>(null);
  const groupRef = outerGroupRef ?? ownGroupRef;
  const reason = React.useRef<ToneMenuCloseReason>("outside");

  const onRadioKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === "ArrowDown" || e.key === "ArrowLeft" ? 1 : e.key === "ArrowUp" || e.key === "ArrowRight" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const at = TONES.indexOf(tone);
    const next = TONES[(at + delta + TONES.length) % TONES.length];
    onTone(next);
    groupRef.current?.querySelector<HTMLElement>(`[data-tone="${next}"]`)?.focus();
  };

  return (
    <AnchoredPopover
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose(reason.current);
        reason.current = "outside";
      }}
      anchorRef={anchorRef}
      side="top"
      align="start"
      sideOffset={8}
      aria-label={EDITOR_TEXT.toneMenuLabel}
      className="sfe-pop sfe-tone-menu"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onEscapeKeyDown={() => {
        reason.current = "escape";
      }}
      onInteractOutside={(e) => {
        const target = e.target as Node | null;
        if (target && anchorRef.current?.contains(target)) e.preventDefault();
      }}
    >
      <>
        <div className="sfe-tone-menu__head">
          <span className="sfe-tone-menu__title">{EDITOR_TEXT.toneMenuTitle}</span>
          <button type="button" className="sfe-tone-menu__close" aria-label={EDITOR_TEXT.close} onClick={() => onClose("button")}>
            <X size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div ref={groupRef} role="radiogroup" aria-label={EDITOR_TEXT.toneMenuTitle} className="sfe-tone-menu__group" onKeyDown={onRadioKey}>
          {TONES.map((t) => {
            const checked = t === tone;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                data-tone={t}
                className="sfe-tone"
                onClick={() => {
                  if (!checked) onTone(t);
                }}
              >
                <span className="sfe-tone__ring" aria-hidden="true" />
                <span className="sfe-tone__word">{TONE_WORD[t]}</span>
                <ToneDot tone={t} />
              </button>
            );
          })}
        </div>
        <div className="sfe-tone-menu__divider" aria-hidden="true" />
        <button type="button" className="sfe-tone-menu__delete" onClick={onDelete}>
          <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          {EDITOR_TEXT.deleteOption}
        </button>
      </>
    </AnchoredPopover>
  );
}

export default ToneMenu;
