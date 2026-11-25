"use client";
import React, { useState } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, ConfirmDialog,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Pencil, Trash2, Plus } from "lucide-react";
import SettingsToolbar from "./SettingsToolbar";
import { useSettingsToast } from "./useSettingsToast";
import { ApiError, getArray, sendJson } from "@/lib/api/client";
import { useListQuery } from "@/lib/hooks/useListQuery";
import { omit } from "@/lib/omit";
import { NAME_TAKEN } from "@/app/lib/lookups/contract";
import { useInvalidateLookup, type LookupTable } from "@/app/components/lookups";

/** A row as the settings API returns it: a JSON record, read by the columns' field names. */
export type Row = Record<string, unknown>;

export interface Column {
  field: string;
  headerName: string;
  width?: string | number;
  /** Custom cell (a pill, a link…). Display only — the edit dialog still
   *  binds the field as text, so pair it with `readOnly` for derived fields. */
  renderCell?: (row: Row) => React.ReactNode;
  /** Shown in the table, left out of the add/edit form and the required check. */
  readOnly?: boolean;
  align?: "start" | "center" | "end";
}

interface CrudTableProps {
  apiUrl: string;
  columns: Column[];
  idField: string;
  nameField: string;
  entityName: string;
  /** Items-style page header title, e.g. "ניהול לקוחות". */
  title: string;
  /** Header subtitle line under the title. */
  subtitle?: string;
  /** Plural noun for the header count pill, e.g. "לקוחות". */
  countLabel?: string;
  /** The app's pickers of this table, read again after a write. */
  lookup?: LookupTable;
}

const SAVE_FAILED = "השמירה נכשלה. בדוק את החיבור לשרת ונסה שוב.";
const DELETE_FAILED = "המחיקה נכשלה. ייתכן שהרשומה בשימוש במסכים אחרים; בדוק ונסה שוב.";

export default function CrudTable({ apiUrl, columns, idField, nameField, entityName, title, subtitle, countLabel, lookup }: CrudTableProps) {
  const { rows, loading, failed: loadError, reload, update } = useListQuery<Row>([apiUrl], () => getArray<Row>(apiUrl));
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [formData, setFormData] = useState<Row>({});
  // Validation is shown on the field it is about, not in a toast.
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [rowToDelete, setRowToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showSnackbar = useSettingsToast({ duration: 6000 });
  const invalidateLookup = useInvalidateLookup();
  const changed = () => { if (lookup) invalidateLookup(lookup); };

  const handleAdd = () => { setEditingRow(null); setFormData({}); setFormErrors({}); setOpenDialog(true); };
  const handleEdit = (row: Row) => { setEditingRow(row); setFormData({ ...row }); setFormErrors({}); setOpenDialog(true); };
  const handleDeleteClick = (row: Row) => { setRowToDelete(row); };

  const handleSave = async () => {
    const errors: Record<string, string> = {};
    for (const col of columns) {
      if (col.field === idField || col.readOnly) continue;
      if (!formData[col.field] || !String(formData[col.field]).trim()) {
        errors[col.field] = `יש להזין ${col.headerName}`;
      }
    }
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow[idField]}` : apiUrl;
      const savedRow = await sendJson<Row>(url, method, formData, SAVE_FAILED);
      if (editingRow && savedRow) {
        update((list) => list.map((r) => (r[idField] === savedRow[idField] ? savedRow : r)));
        showSnackbar(`${entityName} עודכן בהצלחה`, "success");
      } else {
        update((list) => [...list, savedRow]);
        showSnackbar(`${entityName} נוצר בהצלחה`, "success");
      }
      changed();
      setOpenDialog(false);
    } catch (err) {
      // The server owns the unique-name rule; its refusal is shown on the field.
      if (err instanceof ApiError && err.body.code === NAME_TAKEN) setFormErrors({ [nameField]: "ערך זה כבר קיים. בחר ערך אחר." });
      else showSnackbar(err instanceof ApiError ? err.message : SAVE_FAILED, "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      await sendJson(`${apiUrl}/${rowToDelete[idField]}`, "DELETE", undefined, DELETE_FAILED);
      update((list) => list.filter((r) => r[idField] !== rowToDelete[idField]));
      changed();
      showSnackbar(`${entityName} נמחק בהצלחה`, "success");
    } catch (err) {
      showSnackbar(err instanceof ApiError ? err.message : DELETE_FAILED, "error");
    } finally {
      setDeleting(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((row) => {
    if (!searchTerm) return true;
    return columns.some((col) => String(row[col.field]).toLowerCase().includes(searchTerm.toLowerCase()));
  });

  const dtColumns: DTColumn<Row>[] = [
    ...columns.map((col) => ({
      key: col.field,
      header: col.headerName,
      cell: (row: Row) => (col.renderCell ? col.renderCell(row) : (row[col.field] ?? "—")) as React.ReactNode,
      width: typeof col.width === "number" ? col.width : undefined,
      align: col.align,
      nowrap: true,
      bold: col.field === nameField,
    })),
    {
      key: "__actions",
      header: "פעולות",
      align: "center" as const,
      width: 120,
      cell: (row: Row) => (
        <RowActions>
          <IconAction title={`ערוך את ${row[nameField] ?? entityName}`} onClick={() => handleEdit(row)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title={`מחק את ${row[nameField] ?? entityName}`} danger onClick={() => handleDeleteClick(row)}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  // Two different empties: nothing exists yet vs. the search hides everything.
  const empty = searchTerm ? (
    <div className="settings-empty settings-empty--bare">
      <div className="settings-empty__title">אין תוצאות עבור &quot;{searchTerm}&quot;</div>
      <div>נסה מילה אחרת, או נקה את החיפוש כדי לראות את כל הרשימה.</div>
      <Button variant="outlined" color="inherit" size="small" onClick={() => setSearchTerm("")}>נקה חיפוש</Button>
    </div>
  ) : (
    <div className="settings-empty settings-empty--bare">
      <div className="settings-empty__title">עדיין אין {countLabel ?? "רשומות"}</div>
      <div>הוסף {entityName} ראשון כדי שיופיע כאן ובמסכי המערכת.</div>
      <Button size="small" onClick={handleAdd} startIcon={<Plus size={16} strokeWidth={2} aria-hidden />}>הוסף {entityName}</Button>
    </div>
  );

  return (
    <div className="settings-fill">
      <SettingsToolbar
        title={title}
        subtitle={subtitle}
        // No count while it is unknown — never a "0" that is not true.
        count={loading || loadError ? undefined : rows.length}
        countLabel={countLabel}
        onAdd={handleAdd}
        addLabel={`הוסף ${entityName}`}
        search={searchTerm}
        onSearch={setSearchTerm}
        searchPlaceholder="חיפוש…"
      />

      <div style={{ flex: 1, minHeight: 0 }}>
        {loadError ? (
          <div className="settings-card settings-error">
            <Alert severity="error">טעינת הרשימה נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
            <Button variant="outlined" color="inherit" onClick={() => reload()}>נסה שוב</Button>
          </div>
        ) : (
          <DataTable
            columns={dtColumns}
            rows={filteredRows}
            getRowKey={(r) => String(r[idField])}
            loading={loading}
            minWidth={520}
            maxHeight="100%"
            empty={empty}
          />
        )}
      </div>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? `עריכת ${entityName}` : `${entityName} חדש`}</DialogTitle>
        <DialogContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {columns.map((col) => {
              if (col.field === idField || col.readOnly) return null;
              return (
                <TextField
                  key={col.field}
                  label={col.headerName}
                  value={String(formData[col.field] ?? "")}
                  onChange={(e) => {
                    setFormData({ ...formData, [col.field]: e.target.value });
                    if (formErrors[col.field]) setFormErrors((errors) => omit(errors, [col.field]));
                  }}
                  error={!!formErrors[col.field]}
                  helperText={formErrors[col.field]}
                  fullWidth
                  required
                />
              );
            })}
          </div>
        </DialogContent>
        {/* Cancel first, the action last (DialogActions puts it at the end). */}
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setOpenDialog(false)}>ביטול</Button>
          <Button onClick={handleSave} variant="contained" loading={saveLoading}>שמור</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={rowToDelete != null}
        title={`מחיקת ${entityName}`}
        message={rowToDelete ? `למחוק את ${entityName} "${rowToDelete[nameField]}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק"
        destructive
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setRowToDelete(null)}
      />
    </div>
  );
}
