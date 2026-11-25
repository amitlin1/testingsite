"use client";
import * as React from "react";
import type { Field, FieldId, FieldType } from "@/app/lib/station-fields/schema";
import { DEFAULT_IDS, newField, opensExpanded } from "../../lib/editorModel";
import type { EditorPopover, SharedListLike } from "../../lib/editorModel";

/**
 * The editing session of a field list — the station editor's cell and the library's field set share
 * it: the one open popover, the row just added (its name's placeholder and halo), the rows whose
 * settings are open, and where the focus goes once a change is drawn. FieldRowsTable and
 * AddFieldBar take what it returns (tableProps, addBarProps); the DOM ids of a row's controls are
 * this module's.
 */

export type FocusPart = "name" | "grip";
export type FocusTarget = { id: FieldId; part: FocusPart } | null;

/** DOM ids of a row's controls. */
export const rowIds = (fieldId: string) => ({
  name: "sfe-nm-" + fieldId,
  grip: "sfe-grip-" + fieldId,
  error: "sfe-err-" + fieldId,
  numberSettings: "sfe-num-" + fieldId,
  numberToggle: "sfe-numsum-" + fieldId,
  unit: "sfe-unit-" + fieldId,
  max: "sfe-max-" + fieldId,
  photoMin: "sfe-photomin-" + fieldId,
});

/** The add-row button: the focus lands here when the last row is removed. */
export const ADD_ROW_ID = "sfe-add-row";
/** "הדבק מאקסל": pressing it keeps the row that had the focus as the place to paste after. */
export const PASTE_TSV_ID = "sfe-paste-tsv";

/** A row's name, scrolled into the middle of the view ("עבור לשדה"). */
export function focusRowName(fieldId: FieldId): void {
  const el = document.getElementById(rowIds(fieldId).name);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}

export type FieldListEditorInput = {
  fields: readonly Field[];
  setFields: (next: Field[]) => void;
  /** The shared option lists: a new "שורת בדיקה" links to the default one (editorModel.newField). */
  lists: readonly SharedListLike[] | null;
};

export function useFieldListEditor({ fields, setFields, lists }: FieldListEditorInput) {
  const [popover, setPopover] = React.useState<EditorPopover | null>(null);
  const [freshId, setFreshId] = React.useState<FieldId | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<FieldId>>(() => new Set());
  const [focusReq, setFocusReq] = React.useState<{ target: FocusTarget; seq: number } | null>(null);

  const requestFocus = React.useCallback((target: FocusTarget) => {
    setFocusReq((p) => ({ target, seq: (p?.seq ?? 0) + 1 }));
  }, []);

  React.useEffect(() => {
    if (!focusReq) return;
    const t = focusReq.target;
    const id = t == null ? ADD_ROW_ID : t.part === "name" ? rowIds(t.id).name : rowIds(t.id).grip;
    document.getElementById(id)?.focus();
  }, [focusReq]);

  const addField = (type: FieldType) => {
    const f = newField(type, DEFAULT_IDS, lists);
    setFields([...fields, f]);
    setFreshId(type === "section" ? null : f.id);
    if (opensExpanded(type)) setExpanded((s) => new Set(s).add(f.id));
    requestFocus({ id: f.id, part: "name" });
  };

  const toggleExpanded = (id: FieldId) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** The list emptied: nothing is fresh or open, and the add bar takes the focus. */
  const reset = () => {
    setFreshId(null);
    setExpanded(new Set());
    requestFocus(null);
  };

  // The row that had the focus last; focus moving to another control of the list forgets it —
  // except to the paste button itself. Focus inside a portal (a popover, a dialog) is not the list's.
  const lastRowRef = React.useRef<FieldId | null>(null);
  const onListFocus = (e: React.FocusEvent<HTMLElement>) => {
    const el = e.target;
    if (!(el instanceof Element) || !e.currentTarget.contains(el)) return;
    const row = el.closest<HTMLElement>("[data-field-id]");
    if (row) lastRowRef.current = row.dataset.fieldId ?? null;
    else if (!el.closest("#" + PASTE_TSV_ID)) lastRowRef.current = null;
  };

  const pickerOpen = popover?.kind === "picker";
  return {
    popover,
    setPopover,
    requestFocus,
    addField,
    reset,
    /** The row that had the focus last (the place "הדבק מאקסל" pastes after), or null. */
    lastFocusedRow: () => lastRowRef.current,
    /** onFocus of the element around the table and the add bar. */
    onListFocus,
    tableProps: {
      fields,
      freshId,
      popover,
      setPopover,
      expanded,
      onToggleExpanded: toggleExpanded,
      onFieldsChange: setFields,
      onNameBlur: (id: FieldId) => setFreshId((f) => (f === id ? null : f)),
      onAddRow: () => addField("choice_row"),
      requestFocus,
    },
    addBarProps: {
      pickerOpen,
      onPickerOpenChange: (o: boolean) => setPopover((p) => (o ? { kind: "picker" } : p?.kind === "picker" ? null : p)),
      onAddRow: () => addField("choice_row"),
      onPick: (type: FieldType) => {
        setPopover((p) => (p?.kind === "picker" ? null : p));
        addField(type);
      },
    },
  };
}
