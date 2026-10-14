"use client";
import * as React from "react";
import type { Field, FieldId, VersionRef } from "@/app/lib/station-fields/schema";
import type { Issue } from "@/app/lib/station-fields/validate";
import { EDITOR_TEXT } from "../../lib/labels";
import { dropField, duplicateField, issuesOfField, moveFieldBy, removeField, replaceField } from "../../lib/editorModel";
import type { EditorPopover } from "../../lib/editorModel";
import { FieldRowEditor } from "./FieldRowEditor";
import type { RowDnd } from "./FieldRowEditor";
// The table also serves the field set editor (spec §5.3, session 2d): it brings its own styles.
import "./editor.css";

/**
 * The rows table of the station field editor (artboard 2, spec §5.5.2 ג): a hairline frame (radius
 * 11), the column header — aria-hidden, parchment 36px, grid 28px 140px minmax(0,1fr) 100px 56px
 * 32px: "" | "שם השדה" | "אפשרויות · בחירה מהירה" | "הערות" | "חובה" | "" — and a FieldRowEditor per
 * field.
 *
 * Reordering (spec §5.16, "גרירה או Alt+חיצים לשינוי סדר"): HTML5 drag and drop from a row's handle
 * (no DnD library — spec §11.10), dropped before or after the row under the pointer; Alt+↑ / Alt+↓
 * on the handle or the name moves the row one place and keeps the focus on what moved.
 */

export type FocusPart = "name" | "grip";

export type FieldRowsTableProps = {
  fields: readonly Field[];
  /** Field ids of the cell's published version — the rest are "חדש בטיוטה". */
  publishedIds: ReadonlySet<FieldId>;
  freshId: FieldId | null;
  /** The lint issues of the cell's group. */
  issues: readonly Issue[];
  popover: EditorPopover | null;
  setPopover: React.Dispatch<React.SetStateAction<EditorPopover | null>>;
  expanded: ReadonlySet<FieldId>;
  onToggleExpanded: (id: FieldId) => void;
  onFieldsChange: (next: Field[]) => void;
  onNameBlur: (id: FieldId) => void;
  /** Enter in the last row's name: a new "שורת בדיקה". */
  onAddRow: () => void;
  /** Focus a row's control once it is drawn, or the add bar (null) when no row is left. */
  requestFocus: (target: { id: FieldId; part: FocusPart } | null) => void;
  stationLabel: string;
  rowLabel: string;
  listName: (ref: VersionRef) => string | null;
  /** In a field set (artboard 8): a linked field's "רשימה: {name}" opens the list in the library. */
  onOpenList?: (ref: VersionRef) => void;
  /** Extra class on the table frame — the field set's own column grid (library.css). */
  className?: string;
};

type Drop = { id: FieldId; after: boolean };

export function FieldRowsTable(props: FieldRowsTableProps) {
  const { fields, onFieldsChange, requestFocus } = props;
  const [dragId, setDragId] = React.useState<FieldId | null>(null);
  const [drop, setDrop] = React.useState<Drop | null>(null);

  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const dndOf = (id: FieldId): RowDnd => ({
    dragging: dragId === id,
    drop: drop && drop.id === id && dragId != null && dragId !== id ? (drop.after ? "after" : "before") : null,
    onDragStart: (e) => {
      setDragId(id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      const row = e.currentTarget.closest<HTMLElement>(".sfe-item");
      if (row) {
        const r = row.getBoundingClientRect();
        e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
      }
    },
    onDragEnd: endDrag,
    // Cancelling dragenter makes the row the drop target wherever the pointer enters it (HTML drag
    // and drop): without it a drop that ends on one of its buttons — the "חובה" chip, an option
    // chip, ⋯ — falls through to the page and nothing moves.
    onDragEnter: (e) => {
      if (dragId != null) e.preventDefault();
    },
    onDragOver: (e) => {
      if (dragId == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (!drop || drop.id !== id || drop.after !== after) setDrop({ id, after });
    },
    onDragLeave: (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && e.currentTarget.contains(to)) return;
      setDrop((d) => (d && d.id === id ? null : d));
    },
    onDrop: (e) => {
      if (dragId == null) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (dragId !== id) onFieldsChange(dropField(fields, dragId, id, after));
      endDrag();
    },
  });

  return (
    <div className="sfe-table-scroll">
      <div className={props.className ? "sfe-table " + props.className : "sfe-table"}>
        <div className="sfe-table__head" aria-hidden="true">
          <span />
          <span>{EDITOR_TEXT.colName}</span>
          <span>{EDITOR_TEXT.colOptions}</span>
          <span>{EDITOR_TEXT.colNotes}</span>
          <span>{EDITOR_TEXT.colRequired}</span>
          <span />
        </div>
        {fields.map((field, i) => (
          <FieldRowEditor
            key={field.id}
            field={field}
            fresh={props.freshId === field.id}
            isNew={!props.publishedIds.has(field.id)}
            issues={issuesOfField(props.issues, field.id)}
            popover={props.popover}
            setPopover={props.setPopover}
            expanded={props.expanded.has(field.id)}
            onToggleExpanded={() => props.onToggleExpanded(field.id)}
            onChange={(next) => onFieldsChange(replaceField(fields, next))}
            onRemove={() => {
              const neighbour = fields[i + 1] ?? fields[i - 1] ?? null;
              onFieldsChange(removeField(fields, field.id));
              requestFocus(neighbour ? { id: neighbour.id, part: "grip" } : null);
            }}
            onDuplicate={() => {
              const r = duplicateField(fields, field.id);
              onFieldsChange(r.fields);
              if (r.id) requestFocus({ id: r.id, part: "name" });
            }}
            onMove={(delta, from) => {
              const next = moveFieldBy(fields, field.id, delta);
              if (next.some((f, k) => f !== fields[k])) {
                onFieldsChange(next);
                requestFocus({ id: field.id, part: from });
              }
            }}
            onNameBlur={() => props.onNameBlur(field.id)}
            onNameEnter={() => {
              if (i === fields.length - 1) props.onAddRow();
            }}
            dnd={dndOf(field.id)}
            stationLabel={props.stationLabel}
            rowLabel={props.rowLabel}
            listName={props.listName}
            onOpenList={props.onOpenList}
          />
        ))}
      </div>
    </div>
  );
}

export default FieldRowsTable;
