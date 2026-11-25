"use client";
import * as React from "react";
import type { Field, FieldId, VersionRef } from "@/app/lib/station-fields/schema";
import type { Issue } from "@/app/lib/station-fields/validate";
import { EDITOR_TEXT } from "../../lib/labels";
import { dropField, duplicateField, issuesOfField, moveFieldBy, removeField, replaceField } from "../../lib/editorModel";
import type { EditorPopover } from "../../lib/editorModel";
import { FieldRowEditor } from "./FieldRowEditor";
import type { FocusTarget } from "./useFieldListEditor";
import { useReorderDrag } from "./useReorderDrag";
import "./editor.css";

/**
 * The rows table of a field list (artboard 2, spec §5.5.2 ג; the field set's too): the column header
 * and a FieldRowEditor per field. Reordering (spec §5.16): drag a row's handle, or Alt+↑ / Alt+↓ on
 * the handle or the name — the focus stays on what moved.
 */

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
  requestFocus: (target: FocusTarget) => void;
  stationLabel: string;
  rowLabel: string;
  listName: (ref: VersionRef) => string | null;
  /** In a field set (artboard 8): a linked field's "רשימה: {name}" opens the list in the library. */
  onOpenList?: (ref: VersionRef) => void;
  /** Extra class on the table frame — the field set's own column grid (library.css). */
  className?: string;
};

export function FieldRowsTable(props: FieldRowsTableProps) {
  const { fields, onFieldsChange, requestFocus } = props;
  const reorder = useReorderDrag<FieldId>(({ from, to, after }) => onFieldsChange(dropField(fields, from, to, after)));

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
            dnd={{
              dragging: reorder.dragging(field.id),
              drop: reorder.dropAt(field.id),
              onDragStart: (e) => {
                reorder.start(field.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", field.id);
                const row = e.currentTarget.closest<HTMLElement>(".sfe-item");
                if (row) {
                  const r = row.getBoundingClientRect();
                  e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
                }
              },
              onDragEnd: reorder.end,
              ...reorder.targetProps(field.id),
            }}
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
