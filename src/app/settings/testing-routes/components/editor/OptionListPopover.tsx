"use client";
import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { CircleAlert, CircleCheck, GripVertical, Link2, Plus, X } from "lucide-react";
import { AnchoredPopover, Button, IconButton, cn } from "@/components/ui";
import { TONE_WORD } from "@/app/lib/station-fields/schema";
import type { ChoiceOption, ChoiceRowField, MultiChoiceField } from "@/app/lib/station-fields/schema";
import { newOptionId } from "@/app/lib/station-fields/step-uids";
import { LIMITS, optionListLine } from "@/app/lib/station-fields/validate";
import {
  OPTION_LIST_TEXT, localOptionsNote, localOptionsTitle, optionDragLabel, optionKeyTitle, optionListTitle,
  optionNameLabel, optionRemoveLabel, optionRowLabel, optionsCountText, toneButtonLabel,
} from "../../lib/labels";
import {
  addOption, applyLocalOptions, canAddOption, cycleOptionTone, moveOption, nextTone, optionKey, removeOption,
  renameOption,
} from "../../lib/optionsModel";
import "./editor-popovers.css";

/**
 * "אפשרויות · {field}" — the options of a choice field (artboard 4, spec §5.7): a 560 × 600 popover
 * against the row's "רשימה: …" link, the editor dimmed behind it (the app's scrim, 40%).
 *
 * Session 2b builds the LOCAL mode only ("רק לשדה הזה"): the field's own options, edited on a
 * working copy — reorder (drag the handle, or Alt+↑/↓), quick keys 1–4, the tone button cycling
 * תקין ← אזהרה ← כשל ← ניטרלי, rename, remove, add (Enter or "הוסף"; a new option is neutral) — with
 * artboard 4's validation line (validate.ts optionListLine). "החל על השדה" hands back the field with
 * these options and WITHOUT list_ref (a local list is the field's own); "ביטול", ×, Escape and a
 * press outside drop the copy. Focus goes back to the anchor whenever it closes.
 *
 * Session 2d seam: the "רשימה משותפת" segment is drawn but disabled (aria-disabled) until the
 * option-lists API exists. Shared mode adds the lists column (inline-start, 200px), "שם הרשימה", the
 * impact note, "שמור כרשימה חדשה…" in the footer and its own apply (PUT the list + propagate) —
 * see `OptionsSource` below. The list's name for the local note ('הועתקו מהרשימה "{list}".') comes
 * with it; until then a linked field's note reads COPY-PENDING.
 *
 * The anchor carries aria-haspopup="dialog", aria-expanded and aria-controls={OPTION_LIST_POPOVER_ID}
 * (the editor's link button; artboard 4).
 */

/** The popover body's id — the anchor's aria-controls (artboard 4: `opt-pop`). */
export const OPTION_LIST_POPOVER_ID = "rf-option-list";

type ChoiceField = ChoiceRowField | MultiChoiceField;

/** Where the options come from (artboard 4's segmented control). Session 2b: "local" only. */
type OptionsSource = "shared" | "local";

/** Session 2d turns this on together with the shared mode. */
const SHARED_LISTS_AVAILABLE = false;

export interface OptionListPopoverProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The row's "רשימה: …" link; the popover opens beside it (artboard 4: at its inline-end side). */
  anchorRef: React.RefObject<HTMLElement | null>;
  field: ChoiceField;
  /** "{station}" and "{item}" of "אפשרויות מקומיות · {station} · {item}" — the editor's column and row. */
  stationLabel: string;
  rowLabel: string;
  onApply(next: ChoiceField): void;
}

export function OptionListPopover({ open, onOpenChange, anchorRef, field, stationLabel, rowLabel, onApply }: OptionListPopoverProps) {
  const titleId = React.useId();
  const firstFocusRef = React.useRef<HTMLInputElement>(null);

  return (
    <>
      {open && typeof document !== "undefined" && createPortal(<div className="rf-olp-scrim" aria-hidden="true" />, document.body)}
      <AnchoredPopover
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={anchorRef}
        side="left"
        align="center"
        sideOffset={14}
        className="rf-olp"
        aria-labelledby={titleId}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstFocusRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          // Behind a scrim every way out hands focus back to the link that opened it.
          e.preventDefault();
          anchorRef.current?.focus();
        }}
        onInteractOutside={(e) => {
          // A press on the anchor is its own toggle: closing here would reopen it on the click.
          const target = e.target;
          if (target instanceof Node && anchorRef.current?.contains(target)) e.preventDefault();
        }}
      >
        <OptionListBody
          titleId={titleId}
          firstFocusRef={firstFocusRef}
          field={field}
          stationLabel={stationLabel}
          rowLabel={rowLabel}
          onCancel={() => onOpenChange(false)}
          onApply={(next) => {
            onApply(next);
            onOpenChange(false);
          }}
        />
      </AnchoredPopover>
    </>
  );
}

type DragState = { from: number; over: number | null; place: "before" | "after" };

/** The drag payload's type: an option id, private to this list. */
const OPTION_DRAG_TYPE = "application/x-rf-option";

/** The popover's content. Mounted on every opening, so the working copy starts from the field. */
function OptionListBody({
  titleId, firstFocusRef, field, stationLabel, rowLabel, onCancel, onApply,
}: {
  titleId: string;
  firstFocusRef: React.RefObject<HTMLInputElement | null>;
  field: ChoiceField;
  stationLabel: string;
  rowLabel: string;
  onCancel: () => void;
  onApply: (next: ChoiceField) => void;
}) {
  // Session 2d: the segments switch this ("רשימה משותפת" copies nothing; "רק לשדה הזה" copies the
  // shared list's options into the working copy, artboard 4 `goLocal`).
  const [source] = React.useState<OptionsSource>("local");
  const [options, setOptions] = React.useState<ChoiceOption[]>(() => field.options.map((o) => ({ ...o })));
  const [draft, setDraft] = React.useState("");
  /** The row whose handle is pressed: only that row is draggable, so text in the inputs stays selectable. */
  const [armed, setArmed] = React.useState<number | null>(null);
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const addRef = React.useRef<HTMLInputElement>(null);
  const removeRefs = React.useRef(new Map<string, HTMLButtonElement>());

  // The list's name arrives with the option-lists API (session 2d).
  const listName: string | null = null;
  const fieldName = field.label.trim();
  const line = optionListLine(options);
  const roomForMore = canAddOption(options);

  const add = () => {
    const next = addOption(options, draft, () => newOptionId());
    if (next.length === options.length) return;
    setOptions(next);
    setDraft("");
  };

  const remove = (index: number) => {
    // Focus moves to the × of the option that takes its place, else the one before, else the add field.
    const neighbour = options[index + 1] ?? options[index - 1];
    setOptions(removeOption(options, index));
    const el = neighbour ? removeRefs.current.get(neighbour.id) : null;
    (el ?? addRef.current)?.focus();
  };

  /** Alt+↑ / Alt+↓ anywhere in a row moves its option; focus stays on the control it was on. */
  const onRowKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const to = index + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= options.length) return;
    e.preventDefault();
    const focused = e.target as HTMLElement;
    flushSync(() => setOptions(moveOption(options, index, to)));
    focused.focus();
  };

  const endDrag = () => {
    setDrag(null);
    setArmed(null);
  };

  const dropAt = (index: number) => {
    if (!drag) return;
    const place = drag.over === index ? drag.place : "before";
    let to = place === "before" ? index : index + 1;
    if (drag.from < to) to -= 1;
    setOptions(moveOption(options, drag.from, to));
    endDrag();
  };

  return (
    <div id={OPTION_LIST_POPOVER_ID} className="rf-olp__frame">
      <div className="rf-olp__head">
        <h2 id={titleId} className="rf-olp__title">{optionListTitle(field.label)}</h2>
        <div role="group" aria-label={OPTION_LIST_TEXT.sourceGroup} className="rf-olp__seg">
          <button
            type="button"
            className="rf-olp__seg-btn"
            aria-pressed={source === "shared"}
            aria-disabled={SHARED_LISTS_AVAILABLE ? undefined : true}
          >
            <Link2 size={14} strokeWidth={1.75} aria-hidden />
            {OPTION_LIST_TEXT.shared}
          </button>
          <button type="button" className="rf-olp__seg-btn" aria-pressed={source === "local"}>
            {OPTION_LIST_TEXT.local}
          </button>
        </div>
        <IconButton size="small" className="rf-olp__close" aria-label={OPTION_LIST_TEXT.close} onClick={onCancel}>
          <X size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>

      <div className="rf-olp__body">
        <div className="rf-olp__main">
          <div className="rf-olp__local">
            <span className="rf-olp__local-title">{localOptionsTitle(stationLabel, rowLabel)}</span>
            {field.list_ref && <span className="rf-olp__local-note">{localOptionsNote(fieldName, listName)}</span>}
          </div>

          <div className="rf-olp__opts">
            <div className="rf-olp__opts-head">
              <span className="rf-olp__opts-count">{optionsCountText(options.length, source === "local")}</span>
              <span className="rf-olp__opts-keys">
                {OPTION_LIST_TEXT.keysLead}
                <span dir="ltr" className="rf-ltr">{OPTION_LIST_TEXT.keysRange}</span>
                {OPTION_LIST_TEXT.keysTail}
              </span>
            </div>

            <div role="list" aria-label={OPTION_LIST_TEXT.list} className="rf-olp__list">
              {options.map((o, i) => {
                const key = optionKey(i);
                const empty = !o.label.trim();
                return (
                  <div
                    key={o.id}
                    role="listitem"
                    aria-label={optionRowLabel(i, o.label, o.tone)}
                    className="rf-olp__row"
                    draggable={armed === i}
                    data-dragging={drag?.from === i || undefined}
                    data-drop={drag && drag.over === i && drag.from !== i ? drag.place : undefined}
                    onKeyDown={onRowKeyDown(i)}
                    onDragStart={(e) => {
                      if (armed !== i) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.effectAllowed = "move";
                      // Some data is required to start a drag (Firefox); not text, so no input accepts it.
                      e.dataTransfer.setData(OPTION_DRAG_TYPE, o.id);
                      setDrag({ from: i, over: null, place: "before" });
                    }}
                    // The row is the drop target wherever the pointer enters it (HTML drag and drop):
                    // without this a drop on its handle or tone button — the column the handle is
                    // dragged down — falls through to the page and nothing moves.
                    onDragEnter={(e) => {
                      if (drag) e.preventDefault();
                    }}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const box = e.currentTarget.getBoundingClientRect();
                      const place = e.clientY < box.top + box.height / 2 ? "before" : "after";
                      if (drag.over !== i || drag.place !== place) setDrag({ ...drag, over: i, place });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropAt(i);
                    }}
                    onDragEnd={endDrag}
                  >
                    <button
                      type="button"
                      className="rf-olp__drag"
                      aria-label={optionDragLabel(o.label)}
                      onPointerDown={() => setArmed(i)}
                      onPointerUp={() => { if (!drag) setArmed(null); }}
                    >
                      <GripVertical size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                    <span className={cn("rf-olp__key", key == null && "rf-olp__key--none")} title={optionKeyTitle(i)} dir="ltr">
                      {key ?? OPTION_LIST_TEXT.noKey}
                    </span>
                    <button
                      type="button"
                      className="rf-olp__tone"
                      title={OPTION_LIST_TEXT.toneTitle}
                      aria-label={toneButtonLabel(o.tone, nextTone(o.tone))}
                      onClick={() => setOptions(cycleOptionTone(options, i))}
                    >
                      <span className="rf-olp__dot" data-tone={o.tone} />
                    </button>
                    <input
                      ref={i === 0 ? firstFocusRef : undefined}
                      className={cn("sh-input rf-olp__label", empty && "sh-input--error")}
                      aria-label={optionNameLabel(i)}
                      aria-invalid={empty || undefined}
                      dir="auto"
                      autoComplete="off"
                      value={o.label}
                      maxLength={LIMITS.optionLabel}
                      onChange={(e) => setOptions(renameOption(options, i, e.target.value))}
                    />
                    <span className="rf-olp__word">{TONE_WORD[o.tone]}</span>
                    <IconButton
                      ref={(el: HTMLButtonElement | null) => {
                        if (el) removeRefs.current.set(o.id, el);
                        else removeRefs.current.delete(o.id);
                      }}
                      size="small"
                      className="rf-olp__remove"
                      aria-label={optionRemoveLabel(o.label)}
                      onClick={() => remove(i)}
                    >
                      <X size={16} strokeWidth={1.75} aria-hidden />
                    </IconButton>
                  </div>
                );
              })}
            </div>

            <div className="rf-olp__add">
              <div className="rf-olp__add-box">
                <Plus size={16} strokeWidth={1.75} className="rf-olp__add-icon" aria-hidden />
                <input
                  ref={(el) => {
                    addRef.current = el;
                    if (options.length === 0) firstFocusRef.current = el;
                  }}
                  className="sh-input rf-olp__add-input"
                  aria-label={OPTION_LIST_TEXT.addLabel}
                  placeholder={OPTION_LIST_TEXT.addPlaceholder}
                  dir="auto"
                  autoComplete="off"
                  value={draft}
                  maxLength={LIMITS.optionLabel}
                  disabled={!roomForMore}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    add();
                  }}
                />
              </div>
              {draft.trim() && roomForMore && (
                <Button size="small" onClick={add}>{OPTION_LIST_TEXT.add}</Button>
              )}
            </div>

            <span role="status" className="rf-olp__status" data-level={line.level}>
              {line.level === "ok"
                ? <CircleCheck size={14} strokeWidth={1.75} aria-hidden />
                : <CircleAlert size={14} strokeWidth={1.75} aria-hidden />}
              {line.text}
            </span>
          </div>
        </div>
      </div>

      <div className="rf-olp__foot">
        {/* Session 2d: "שמור כרשימה חדשה…" (ghost) opens the footer at its inline-start. */}
        <div className="rf-olp__foot-end">
          <Button variant="outlined" color="inherit" size="small" onClick={onCancel}>{OPTION_LIST_TEXT.cancel}</Button>
          <Button size="small" onClick={() => onApply(applyLocalOptions(field, options))}>{OPTION_LIST_TEXT.apply}</Button>
        </div>
      </div>
    </div>
  );
}

export default OptionListPopover;
