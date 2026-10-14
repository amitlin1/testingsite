"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { AnchoredPopover } from "@/components/ui";

/**
 * The editor's small select lists (artboard 2: "מצב הערות", "אורך מרבי להערה"): a 196px listbox in an
 * AnchoredPopover under its button, with a Check column, the chosen option on tint / blue / 600 and a
 * footnote. Shared by NotesModeSelect and NoteMaxSelect.
 *
 * The button is the anchor, not a Radix trigger, so it keeps aria-haspopup="listbox": a press on it
 * is not an outside press (the button itself toggles), arrows / Home / End move between the options,
 * Enter / Space pick one, Escape closes and puts focus back on the button.
 */

export type ListboxOption<V extends string | number> = { value: V; label: string };

export type ListboxPopoverProps<V extends string | number> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** The listbox's id (the button's aria-controls). */
  id: string;
  /** The listbox's accessible name. */
  label: string;
  /** A muted header line above the options (aria-hidden: the label already says it). */
  header?: string;
  options: readonly ListboxOption<V>[];
  value: V;
  onPick: (value: V) => void;
  footnote: string;
  sideOffset?: number;
};

export function ListboxPopover<V extends string | number>({
  open, onOpenChange, anchorRef, id, label, header, options, value, onPick, footnote, sideOffset = 6,
}: ListboxPopoverProps<V>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  // Closed by a press elsewhere: focus stays where the press put it.
  const pressedOutside = React.useRef(false);

  const optionEls = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const els = optionEls();
    if (els.length === 0) return;
    const at = els.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % els.length;
    else if (e.key === "ArrowUp") next = at < 0 ? els.length - 1 : (at - 1 + els.length) % els.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    if (next < 0) return;
    e.preventDefault();
    els[next].focus();
  };

  return (
    <AnchoredPopover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      side="bottom"
      align="start"
      sideOffset={sideOffset}
      aria-label={label}
      className="sfe-pop sfe-listbox-pop"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        pressedOutside.current = false;
        const els = optionEls();
        (els.find((el) => el.getAttribute("aria-selected") === "true") ?? els[0])?.focus();
      }}
      onInteractOutside={(e) => {
        const target = e.target as Node | null;
        if (target && anchorRef.current?.contains(target)) {
          e.preventDefault();
          return;
        }
        pressedOutside.current = true;
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (!pressedOutside.current) anchorRef.current?.focus();
        pressedOutside.current = false;
      }}
    >
      <div dir="rtl">
        {header && <div aria-hidden="true" className="sfe-listbox__head">{header}</div>}
        <div ref={listRef} id={id} role="listbox" aria-label={label} className="sfe-listbox" onKeyDown={onKeyDown}>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="sfe-listbox__opt"
                onClick={() => onPick(o.value)}
              >
                <span className="sfe-listbox__check" aria-hidden="true">
                  {selected && <Check size={15} strokeWidth={1.75} />}
                </span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
        <p className="sfe-listbox__foot">{footnote}</p>
      </div>
    </AnchoredPopover>
  );
}

export default ListboxPopover;
