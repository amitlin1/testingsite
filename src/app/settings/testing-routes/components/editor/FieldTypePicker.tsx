"use client";
import * as React from "react";
import {
  AlignRight, Camera, Hash, Heading, ListChecks, ListPlus, ListTodo, ScanBarcode, Search, ToggleLeft, Type,
  type LucideIcon,
} from "lucide-react";
import { AnchoredPopover, Tag } from "@/components/ui";
import type { FieldType } from "@/app/lib/station-fields/schema";
import { FIELD_TYPE_TEXT, TYPE_PICKER_TEXT } from "../../lib/labels";
import { DEFAULT_FIELD_TYPE, activeTypeIn, filterFieldTypes, stepActiveType, visibleTypes } from "../../lib/fieldTypes";
import "./editor-popovers.css";

/**
 * "סוג שדה אחר" — the popover that adds a field of any type (artboard 3, spec §5.6).
 *
 * A search (38px, focused on open, filtering by name or description) over the ten types in five
 * groups; a type is a 48px row with its icon tile, name and description, "שורת בדיקה" tagged
 * "ברירת מחדל". The active row (aria-current, parchment, "Enter" hint) follows the arrow keys and
 * the pointer; Enter or a click picks it. Escape closes the popover and gives focus back to the
 * anchor; so does a press on the anchor itself (the anchor's click is expected to toggle `open`).
 *
 * After a pick the popover closes WITHOUT taking focus back: the editor adds the row (spec §5.6:
 * "opens it expanded when it has settings") and moves focus where it belongs.
 *
 * The anchor carries aria-haspopup="dialog", aria-expanded and aria-controls={FIELD_TYPE_PICKER_ID}
 * (the editor's button; artboard 3).
 */

/** The picker's id — the anchor's aria-controls (artboard 3: `type-picker`). */
export const FIELD_TYPE_PICKER_ID = "rf-type-picker";

/** Each type's icon (artboard 3; spec §5.6 table) — the picker's tiles, and any row tile that
 *  shows a field's type. */
export const FIELD_TYPE_ICON: Record<FieldType, LucideIcon> = {
  choice_row: ListChecks,
  pass_fail: ToggleLeft,
  number: Hash,
  text: Type,
  textarea: AlignRight,
  checklist: ListTodo,
  multi_choice: ListPlus,
  photo: Camera,
  scan: ScanBarcode,
  section: Heading,
};

export interface FieldTypePickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The "סוג שדה אחר" button the popover hangs from (below it, aligned to its start). */
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick(type: FieldType): void;
}

export function FieldTypePicker({ open, onOpenChange, anchorRef, onPick }: FieldTypePickerProps) {
  const searchRef = React.useRef<HTMLInputElement>(null);
  /** False once the popover closes for a reason that put focus elsewhere (a pick, a press outside). */
  const restoreFocusRef = React.useRef(true);

  const pick = (type: FieldType) => {
    restoreFocusRef.current = false;
    onPick(type);
    onOpenChange(false);
  };

  return (
    <AnchoredPopover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      side="bottom"
      align="start"
      sideOffset={6}
      className="rf-tp"
      aria-label={TYPE_PICKER_TEXT.dialogLabel}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        restoreFocusRef.current = true;
        searchRef.current?.focus();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (restoreFocusRef.current) anchorRef.current?.focus();
      }}
      onInteractOutside={(e) => {
        // A press on the anchor is its own toggle: closing here would reopen it on the click.
        const target = e.target;
        if (target instanceof Node && anchorRef.current?.contains(target)) {
          e.preventDefault();
          return;
        }
        restoreFocusRef.current = false;
      }}
    >
      <PickerBody searchRef={searchRef} onPick={pick} />
    </AnchoredPopover>
  );
}

/** The popover's content. Mounted on every opening, so the search and the active row start fresh. */
function PickerBody({ searchRef, onPick }: { searchRef: React.RefObject<HTMLInputElement | null>; onPick: (type: FieldType) => void }) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<FieldType | null>(DEFAULT_FIELD_TYPE);
  const itemRefs = React.useRef(new Map<FieldType, HTMLButtonElement>());

  const groups = filterFieldTypes(query);
  const list = visibleTypes(groups);
  const current = activeTypeIn(list, active);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = stepActiveType(list, current, e.key === "ArrowDown" ? 1 : -1);
      if (next == null) return;
      setActive(next);
      const el = itemRefs.current.get(next);
      // In the search the focus stays put (keep typing); on a row it moves with the active row.
      if (e.target !== searchRef.current) el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && e.target === searchRef.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (current) onPick(current);
    }
  };

  return (
    <div id={FIELD_TYPE_PICKER_ID} className="rf-tp__body" onKeyDown={onKeyDown}>
      <div className="rf-tp__search">
        <div className="rf-tp__search-box">
          <Search size={16} strokeWidth={1.75} className="rf-tp__search-icon" aria-hidden />
          <input
            ref={searchRef}
            type="text"
            className="sh-input rf-tp__search-input"
            aria-label={TYPE_PICKER_TEXT.searchLabel}
            placeholder={TYPE_PICKER_TEXT.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="rf-tp__list">
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.name} className="rf-tp__group">
            <div className="rf-tp__group-name" aria-hidden="true">{g.name}</div>
            {g.types.map((t) => {
              const Icon = FIELD_TYPE_ICON[t];
              const isActive = t === current;
              const text = FIELD_TYPE_TEXT[t];
              return (
                <button
                  key={t}
                  ref={(el) => {
                    if (el) itemRefs.current.set(t, el);
                    else itemRefs.current.delete(t);
                  }}
                  type="button"
                  className="rf-tp__item"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onPick(t)}
                  onFocus={() => setActive(t)}
                  onMouseMove={() => { if (!isActive) setActive(t); }}
                >
                  <span className="rf-tp__tile" aria-hidden="true">
                    <Icon size={18} strokeWidth={1.75} />
                  </span>
                  <span className="rf-tp__text">
                    <span className="rf-tp__name">
                      {text.name}
                      {t === DEFAULT_FIELD_TYPE && <Tag tone="primary">{TYPE_PICKER_TEXT.defaultTag}</Tag>}
                    </span>
                    <span className="rf-tp__desc">{text.desc}</span>
                  </span>
                  {isActive && <span className="rf-tp__key" dir="ltr" aria-hidden="true">{TYPE_PICKER_TEXT.enterKey}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="rf-tp__empty" role="status">
            <span className="rf-tp__empty-title">{TYPE_PICKER_TEXT.noResultsTitle}</span>
            <span className="rf-tp__empty-text">{TYPE_PICKER_TEXT.noResultsText}</span>
          </div>
        )}
      </div>

      <div className="rf-tp__foot">
        {TYPE_PICKER_TEXT.tipLead}
        <span className="rf-ltr" dir="ltr">{TYPE_PICKER_TEXT.tipKey}</span>
        {TYPE_PICKER_TEXT.tipTail}
      </div>
    </div>
  );
}

export default FieldTypePicker;
