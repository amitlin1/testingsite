"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Alert, Snackbar, Box, Typography, FormControlLabel, Checkbox,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Search, Plus, Pencil, Trash2, Check } from "lucide-react";
import { Worker } from "@/types";

export default function WorkersTable() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<Worker | null>(null);
  const [formData, setFormData] = useState<Partial<Worker>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  const [errors, setErrors] = useState<{ worker_id?: string; worker_name?: string }>({});

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<Worker | null>(null);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });
  const showSnackbar = (message: string, severity: "success" | "error") => setSnackbar({ open: true, message, severity });

  const apiUrl = "/api/settings/workers";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      showSnackbar("שגיאה בטעינת נתונים", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const validateForm = (): boolean => {
    const newErrors: { worker_id?: string; worker_name?: string } = {};
    if (!editingRow) {
      if (!formData.worker_id || String(formData.worker_id).trim() === "") {
        newErrors.worker_id = "מזהה עובד הוא שדה חובה";
      } else {
        const idValue = String(formData.worker_id).trim();
        if (!/^\d+$/.test(idValue)) {
          newErrors.worker_id = "מזהה עובד חייב להיות מספר שלם";
        } else {
          const numValue = parseInt(idValue, 10);
          if (isNaN(numValue) || numValue <= 0) newErrors.worker_id = "מזהה עובד חייב להיות מספר חיובי";
        }
      }
    }
    if (!formData.worker_name || String(formData.worker_name).trim() === "") {
      newErrors.worker_name = "שם עובד הוא שדה חובה";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAdd = () => { setEditingRow(null); setFormData({}); setErrors({}); setOpenDialog(true); };
  const handleEdit = (row: Worker) => { setEditingRow(row); setFormData({ ...row }); setErrors({}); setOpenDialog(true); };
  const handleDeleteClick = (row: Worker) => { setRowToDelete(row); setDeleteConfirmOpen(true); };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.worker_id}` : apiUrl;
      const payload: Partial<Worker> = {
        worker_name: String(formData.worker_name).trim(),
        stokekeeper: !!formData.stokekeeper,
      };
      if (!editingRow) payload.worker_id = parseInt(String(formData.worker_id).trim(), 10);
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const errorData = await res.json(); throw new Error(errorData.error || "שגיאה בשמירה"); }
      const savedRow = await res.json();
      if (editingRow && savedRow) {
        setRows(rows.map((r) => (r.worker_id === savedRow.worker_id ? savedRow : r)));
        showSnackbar("עובד עודכן בהצלחה", "success");
      } else {
        setRows([...rows, savedRow]);
        showSnackbar("עובד נוצר בהצלחה", "success");
      }
      setOpenDialog(false); setFormData({}); setErrors({});
    } catch (err: any) {
      showSnackbar(err.message || "שגיאה בשמירה", "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete.worker_id}`, { method: "DELETE" });
      if (!res.ok) { const errorData = await res.json(); throw new Error(errorData.error || "שגיאה במחיקה"); }
      setRows(rows.filter((r) => r.worker_id !== rowToDelete.worker_id));
      showSnackbar("עובד נמחק בהצלחה", "success");
    } catch (err: any) {
      showSnackbar(err.message || "שגיאה במחיקה", "error");
    } finally {
      setDeleteConfirmOpen(false); setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((row) => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return String(row.worker_id).toLowerCase().includes(s) || String(row.worker_name || "").toLowerCase().includes(s);
  });

  const dtColumns: DTColumn<Worker>[] = [
    { key: "worker_id", header: "מזהה עובד", width: 110, nums: true, cell: (r) => r.worker_id },
    { key: "worker_name", header: "שם עובד", bold: true, nowrap: true, cell: (r) => r.worker_name },
    {
      key: "stokekeeper", header: "מחסנאי", align: "center", width: 110,
      cell: (r) => (r.stokekeeper ? <Check size={16} strokeWidth={2} color="#0066cc" /> : <span style={{ color: "#7a7a7a" }}>—</span>),
    },
    {
      key: "__actions", header: "פעולות", align: "center", width: 120,
      cell: (r) => (
        <RowActions>
          <IconAction title="ערוך" onClick={() => handleEdit(r)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title="מחק" danger onClick={() => handleDeleteClick(r)}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  return (
    <div dir="rtl" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 320 }}>
          <span style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex" }}>
            <Search size={16} strokeWidth={1.75} />
          </span>
          <input
            className="shx-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="חיפוש..."
            style={{ height: 42, borderRadius: 10, paddingInlineStart: 40, paddingInlineEnd: 14, fontSize: 14 }}
          />
        </div>
        <button className="shx-btn shx-btn-primary" onClick={handleAdd}>
          <Plus size={18} strokeWidth={2} />הוסף עובד
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataTable columns={dtColumns} rows={filteredRows} getRowKey={(r) => r.worker_id} loading={loading} minWidth={520} maxHeight="100%" />
      </div>

      {/* Edit/Add Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? "ערוך עובד" : "הוסף עובד"}</DialogTitle>
        <DialogContent dir="rtl">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="מזהה עובד"
              value={formData.worker_id || ""}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "" || /^\d+$/.test(value)) {
                  setFormData({ ...formData, worker_id: value ? Number(value) : undefined });
                  if (errors.worker_id) setErrors({ ...errors, worker_id: undefined });
                }
              }}
              fullWidth
              required={!editingRow}
              disabled={!!editingRow}
              error={!!errors.worker_id}
              helperText={errors.worker_id}
              inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
            />
            <TextField
              label="שם עובד"
              value={formData.worker_name || ""}
              onChange={(e) => {
                setFormData({ ...formData, worker_name: e.target.value });
                if (errors.worker_name) setErrors({ ...errors, worker_name: undefined });
              }}
              fullWidth
              required
              error={!!errors.worker_name}
              helperText={errors.worker_name}
            />
            <FormControlLabel
              control={<Checkbox checked={!!formData.stokekeeper} onChange={(e) => setFormData({ ...formData, stokekeeper: e.target.checked })} />}
              label="מחסנאי (Store Keeper)"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>{saveLoading ? "שומר..." : "שמור"}</Button>
          <Button variant="outlined" onClick={() => { setOpenDialog(false); setFormData({}); setErrors({}); }}>ביטול</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>מחיקת עובד</DialogTitle>
        <DialogContent dir="rtl">
          <Typography>האם אתה בטוח שברצונך למחוק את העובד &quot;{rowToDelete?.worker_name}&quot;?</Typography>
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>פעולה זו לא ניתנת לביטול.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">מחק</Button>
          <Button variant="outlined" onClick={() => setDeleteConfirmOpen(false)}>ביטול</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </div>
  );
}
