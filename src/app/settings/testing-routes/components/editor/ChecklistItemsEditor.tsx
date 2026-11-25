"use client";
import * as React from "react";
import type { ChecklistField, ChecklistItem, ChecklistItemId } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import {
  FIELD_SETTINGS_UNDRAWN_TEXT, checklistGroupLabel, checklistItemEditLabel, checklistItemRemoveLabel,
} from "../../lib/labels";
import { addChecklistItem, canAddChecklistItem, removeChecklistItem, renameChecklistItem } from "../../lib/editorModel";
import type { EditorPopover } from "../../lib/editorModel";
import { ChipView, chipInputWidth } from "./OptionChip";

/**
 * The boxes of a checklist row (spec §5.5.2: "checklist: items[]"; no artboard draws them): a chip per
 * box, like the option chips without a tone. A press renames the box in place — Enter or Escape end it
 * and give the chip its focus back, leaving the input ends it too; the input after the chips adds one
 * on Enter. Every word is undrawn.
 *
 * A box in rename is the list's one open popover (EditorPopover "checkItem"), so opening anything
 * else ends it. What blocks a publish — no box at all, a box without a name — is the lint's, shown
 * under the row with the field's other errors.
 */

export type ChecklistItemsEditorProps = {
  field: ChecklistField;
  popover: EditorPopover | null;
  setPopover: React.Dispatch<React.SetStateAction<EditorPopover | null>>;
  onChange: (next: ChecklistField) => void;
};

export function ChecklistItemsEditor({ field, popover, setPopover, onChange }: ChecklistItemsEditorProps) {
  const [draft, setDraft] = React.useState("");
  const addRef = React.useRef<HTMLInputElement>(null);
  const editingId = popover?.kind === "checkItem" && popover.fieldId === field.id ? popover.itemId : null;
  const isMine = (p: EditorPopover | null, itemId: ChecklistItemId) => p?.kind === "checkItem" && p.fieldId === field.id && p.itemId === itemId;
  const room = canAddChecklistItem(field);

  const add = () => {
    const r = addChecklistItem(field, draft);
    if (!r.itemId) return;
    onChange(r.field);
    setDraft("");
  };

  return (
    <div role="group" aria-label={checklistGroupLabel(field.label)} className="sfe-chips">
      {field.items.map((it) => (
        <ChecklistItemChip
          key={it.id}
          item={it}
          editing={editingId === it.id}
          onEdit={() => setPopover((p) => (isMine(p, it.id) ? null : { kind: "checkItem", fieldId: field.id, itemId: it.id }))}
          onClose={() => setPopover((p) => (isMine(p, it.id) ? null : p))}
          onRename={(label) => onChange(renameChecklistItem(field, it.id, label))}
          onRemove={() => {
            setPopover((p) => (isMine(p, it.id) ? null : p));
            onChange(removeChecklistItem(field, it.id));
            addRef.current?.focus();
          }}
        />
      ))}
      <input
        ref={addRef}
        className="sfe-check-add"
        aria-label={FIELD_SETTINGS_UNDRAWN_TEXT.checklistAddLabel}
        placeholder={FIELD_SETTINGS_UNDRAWN_TEXT.checklistAddPlaceholder}
        dir="auto"
        autoComplete="off"
        value={draft}
        maxLength={LIMITS.checklistLabel}
        disabled={!room}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          add();
        }}
      />
    </div>
  );
}

type ChecklistItemChipProps = {
  item: ChecklistItem;
  editing: boolean;
  /** Start (or, while renaming, end) the rename. */
  onEdit: () => void;
  /** End the rename. */
  onClose: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
};

function ChecklistItemChip({ item, editing, onEdit, onClose, onRename, onRemove }: ChecklistItemChipProps) {
  const chipRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Set when a rename ends by Enter / Escape: the plain chip takes the focus back.
  const refocus = React.useRef(false);
  // The rename is ending: the input's blur (it unmounts) must not end it a second time.
  const ending = React.useRef(false);

  React.useEffect(() => {
    if (editing) {
      ending.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      chipRef.current?.focus();
    }
  }, [editing]);

  const end = (back: boolean) => {
    if (ending.current) return;
    ending.current = true;
    refocus.current = back;
    onClose();
  };

  if (!editing) {
    return (
      <ChipView
        buttonRef={chipRef}
        label={item.label}
        editLabel={checklistItemEditLabel(item.label)}
        removeLabel={checklistItemRemoveLabel(item.label)}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    );
  }

  return (
    <span className="sfe-chip">
      <span className="sfe-chip__edit">
        <input
          ref={inputRef}
          className="sfe-chip__input"
          aria-label={FIELD_SETTINGS_UNDRAWN_TEXT.checklistItemName}
          dir="auto"
          value={item.label}
          maxLength={LIMITS.checklistLabel}
          style={{ width: chipInputWidth(item.label) }}
          onChange={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" && !e.nativeEvent.isComposing) || e.key === "Escape") {
              e.preventDefault();
              end(true);
            }
          }}
          onBlur={() => end(false)}
        />
      </span>
    </span>
  );
}
