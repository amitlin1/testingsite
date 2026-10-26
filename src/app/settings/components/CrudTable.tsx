"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, Snackbar, ConfirmDialog,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Pencil, Trash2, Plus } from "lucide-react";
import SettingsToolbar from "./SettingsToolbar";
import { apiFetch } from "@/lib/api/client";

export interface Column {
  field: string;
  headerName: string;
  width?: string | number;
  /** Custom cell (a pill, a link…). Display only — the edit dialog still
   *  binds the field as text, so pair it with `readOnly` for derived fields. */
  renderCell?: (row: any) => React.ReactNode;
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
}

/** The table's rows, or null when they could not be read. */
async function readRows(apiUrl: string): Promise<any[] | null> {
  try {
    const res = await apiFetch(apiUrl);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return null;
  }
}

export default function CrudTable({ apiUrl, columns, idField, nameField, entityName, title, subtitle, countLabel }: CrudTableProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load is not an empty table: it gets its own band and a retry.
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  // Validation is shown on the field it is about, not in a toast.
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [rowToDelete, setRowToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });
  const showSnackbar = (message: string, severity: "success" | "error") => setSnackbar({ open: true, message, severity });

  const applyRows = useCallback((list: any[] | null) => {
    if (list) setRows(list);
    else setLoadError(true);
    setLoading(false);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    applyRows(await readRows(apiUrl));
  }, [apiUrl, applyRows]);

  // Another table starts its load during render; the effect only reads, and
  // applies the reply. (`loading` starts true for the first one.)
  const [loadingUrl, setLoadingUrl] = useState(apiUrl);
  if (loadingUrl !== apiUrl) {
    setLoadingUrl(apiUrl);
    setLoading(true);
    setLoadError(false);
  }
  useEffect(() => { readRows(apiUrl).then(applyRows); }, [apiUrl, applyRows]);

  const handleAdd = () => { setEditingRow(null); setFormData({}); setFormErrors({}); setOpenDialog(true); };
  const handleEdit = (row: any) => { setEditingRow(row); setFormData({ ...row }); setFormErrors({}); setOpenDialog(true); };
  const handleDeleteClick = (row: any) => { setRowToDelete(row); };

  const handleSave = async () => {
    const errors: Record<string, string> = {};
    for (const col of columns) {
      if (col.field === idField || col.readOnly) continue;
      if (!formData[col.field] || !String(formData[col.field]).trim()) {
        errors[col.field] = `יש להזין ${col.headerName}`;
      }
    }
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    const isDuplicate = rows.some((r) =>
      r[nameField].toLowerCase().trim() === formData[nameField].toLowerCase().trim() &&
      r[idField] !== editingRow?.[idField]
    );
    if (isDuplicate) { setFormErrors({ [nameField]: "ערך זה כבר קיים. בחר ערך אחר." }); return; }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow[idField]}` : apiUrl;
      const res = await apiFetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "השמירה נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      }
      const savedRow = await res.json();
      if (editingRow && savedRow) {
        setRows(rows.map((r) => (r[idField] === savedRow[idField] ? savedRow : r)));
        showSnackbar(`${entityName} עודכן בהצלחה`, "success");
      } else {
        setRows([...rows, savedRow]);
        showSnackbar(`${entityName} נוצר בהצלחה`, "success");
      }
      setOpenDialog(false);
    } catch (err: any) {
      showSnackbar(err.message, "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${apiUrl}/${rowToDelete[idField]}`, { method: "DELETE" });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "המחיקה נכשלה. ייתכן שהרשומה בשימוש במסכים אחרים; בדוק ונסה שוב.");
      }
      setRows(rows.filter((r) => r[idField] !== rowToDelete[idField]));
      showSnackbar(`${entityName} נמחק בהצלחה`, "success");
    } catch (err: any) {
      showSnackbar(err.message, "error");
    } finally {
      setDeleting(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((row) => {
    if (!searchTerm) return true;
    return columns.some((col) => String(row[col.field]).toLowerCase().includes(searchTerm.toLowerCase()));
  });

  const dtColumns: DTColumn<any>[] = [
    ...columns.map((col) => ({
      key: col.field,
      header: col.headerName,
      cell: (row: any) => (col.renderCell ? col.renderCell(row) : (row[col.field] ?? "—")) as React.ReactNode,
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
      cell: (row: any) => (
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
    <div dir="rtl" className="settings-fill">
      {/* Settings header: title + subtitle + count pill, blue add pill, then search row */}
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

      {/* Table */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {loadError ? (
          <div className="settings-card settings-error">
            <Alert severity="error">טעינת הרשימה נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
            <Button variant="outlined" color="inherit" onClick={fetchData}>נסה שוב</Button>
          </div>
        ) : (
          <DataTable
            columns={dtColumns}
            rows={filteredRows}
            getRowKey={(r) => r[idField]}
            loading={loading}
            minWidth={520}
            maxHeight="100%"
            empty={empty}
          />
        )}
      </div>

      {/* Edit/Add Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? `עריכת ${entityName}` : `${entityName} חדש`}</DialogTitle>
        <DialogContent dir="rtl">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {columns.map((col) => {
              if (col.field === idField || col.readOnly) return null;
              return (
                <TextField
                  key={col.field}
                  label={col.headerName}
                  value={formData[col.field] || ""}
                  onChange={(e) => {
                    setFormData({ ...formData, [col.field]: e.target.value });
                    if (formErrors[col.field]) setFormErrors(({ [col.field]: _drop, ...rest }) => rest);
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
        draggable={false}
        open={rowToDelete != null}
        title={`מחיקת ${entityName}`}
        message={rowToDelete ? `למחוק את ${entityName} "${rowToDelete[nameField]}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק"
        destructive
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setRowToDelete(null)}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  );
}
