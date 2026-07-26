"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, Snackbar, Box, Typography,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Pencil, Trash2 } from "lucide-react";
import SettingsToolbar from "./SettingsToolbar";
import { apiFetch } from "@/lib/api/client";

export interface Column {
  field: string;
  headerName: string;
  width?: string | number;
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

export default function CrudTable({ apiUrl, columns, idField, nameField, entityName, title, subtitle, countLabel }: CrudTableProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<any | null>(null);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });
  const showSnackbar = (message: string, severity: "success" | "error") => setSnackbar({ open: true, message, severity });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      showSnackbar("שגיאה בטעינת נתונים", "error");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = () => { setEditingRow(null); setFormData({}); setOpenDialog(true); };
  const handleEdit = (row: any) => { setEditingRow(row); setFormData({ ...row }); setOpenDialog(true); };
  const handleDeleteClick = (row: any) => { setRowToDelete(row); setDeleteConfirmOpen(true); };

  const handleSave = async () => {
    for (const col of columns) {
      if (col.field === idField) continue;
      if (!formData[col.field] || !String(formData[col.field]).trim()) {
        showSnackbar(`${col.headerName} שדה חובה`, "error");
        return;
      }
    }
    const isDuplicate = rows.some((r) =>
      r[nameField].toLowerCase().trim() === formData[nameField].toLowerCase().trim() &&
      r[idField] !== editingRow?.[idField]
    );
    if (isDuplicate) { showSnackbar("ערך זה כבר קיים", "error"); return; }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow[idField]}` : apiUrl;
      const res = await apiFetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData),
      });
      if (!res.ok) { const errorData = await res.json(); throw new Error(errorData.error || "Failed to save"); }
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
    try {
      const res = await apiFetch(`${apiUrl}/${rowToDelete[idField]}`, { method: "DELETE" });
      if (!res.ok) { const errorData = await res.json(); throw new Error(errorData.error || "Failed to delete"); }
      setRows(rows.filter((r) => r[idField] !== rowToDelete[idField]));
      showSnackbar(`${entityName} נמחק בהצלחה`, "success");
    } catch (err: any) {
      showSnackbar(err.message, "error");
    } finally {
      setDeleteConfirmOpen(false);
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
      cell: (row: any) => (row[col.field] ?? "—") as React.ReactNode,
      width: typeof col.width === "number" ? col.width : undefined,
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
          <IconAction title="ערוך" onClick={() => handleEdit(row)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title="מחק" danger onClick={() => handleDeleteClick(row)}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  return (
    <div dir="rtl" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Items-style header: title + subtitle + count pill, blue add pill, then search row */}
      <SettingsToolbar
        title={title}
        subtitle={subtitle}
        count={rows.length}
        countLabel={countLabel}
        onAdd={handleAdd}
        addLabel={`הוסף ${entityName}`}
        search={searchTerm}
        onSearch={setSearchTerm}
        searchPlaceholder="חיפוש..."
      />

      {/* Table */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={dtColumns}
          rows={filteredRows}
          getRowKey={(r) => r[idField]}
          loading={loading}
          minWidth={520}
          maxHeight="100%"
        />
      </div>

      {/* Edit/Add Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? `ערוך ${entityName}` : `הוסף ${entityName}`}</DialogTitle>
        <DialogContent dir="rtl">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            {columns.map((col) => {
              if (col.field === idField) return null;
              return (
                <TextField
                  key={col.field}
                  label={col.headerName}
                  value={formData[col.field] || ""}
                  onChange={(e) => setFormData({ ...formData, [col.field]: e.target.value })}
                  fullWidth
                  required
                />
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>
            {saveLoading ? "שומר..." : "שמור"}
          </Button>
          <Button variant="outlined" onClick={() => setOpenDialog(false)}>ביטול</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>מחיקת {entityName}</DialogTitle>
        <DialogContent dir="rtl">
          <Typography>
            האם אתה בטוח שברצונך למחוק את {entityName} &quot;{rowToDelete?.[nameField]}&quot;?
          </Typography>
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
            פעולה זו לא ניתנת לביטול.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">מחק</Button>
          <Button variant="outlined" onClick={() => setDeleteConfirmOpen(false)}>ביטול</Button>
        </DialogActions>
      </Dialog>

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
