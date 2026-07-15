"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";

interface StationTypesTableProps {
  selectedId: number | null;
  onSelect: (id: number, name: string) => void;
}

export default function StationTypesTable({ selectedId, onSelect }: StationTypesTableProps) {
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

  const apiUrl = "/api/settings/test-stations-type";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setSnackbar({ open: true, message: "שגיאה בטעינת נתונים", severity: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async () => {
    if (!formData.test_type_desc?.trim()) {
      setSnackbar({ open: true, message: "תיאור חובה", severity: "error" });
      return;
    }
    if (editingRow) {
      const idStr = `${formData.test_station_type_id ?? ""}`.trim();
      const idNum = parseInt(idStr, 10);
      if (!idStr || !Number.isInteger(idNum) || idNum <= 0) {
        setSnackbar({ open: true, message: "מזהה חייב להיות מספר שלם חיובי", severity: "error" });
        return;
      }
    }
    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.test_station_type_id}` : apiUrl;
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (!res.ok) { const errBody = await res.json().catch(() => null); throw new Error(errBody?.error || "Failed to save"); }
      const savedRow = await res.json();
      if (editingRow && savedRow) {
        setRows(rows.map((r) => (r.test_station_type_id === editingRow.test_station_type_id ? savedRow : r)));
        if (selectedId === editingRow.test_station_type_id) onSelect(savedRow.test_station_type_id, savedRow.test_type_desc);
      } else {
        setRows([...rows, savedRow]);
      }
      setOpenDialog(false);
      setSnackbar({ open: true, message: "נשמר בהצלחה", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שגיאה בשמירה", severity: "error" });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete.test_station_type_id}`, { method: "DELETE" });
      if (!res.ok) {
        if (res.status === 409) throw new Error("לא ניתן למחוק כי קיימות עמדות משויכות");
        throw new Error("Failed to delete");
      }
      setRows(rows.filter((r) => r.test_station_type_id !== rowToDelete.test_station_type_id));
      if (selectedId === rowToDelete.test_station_type_id) onSelect(0, "");
      setSnackbar({ open: true, message: "נמחק בהצלחה", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שגיאה במחיקה", severity: "error" });
    } finally {
      setDeleteConfirmOpen(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((r) => r.test_type_desc.toLowerCase().includes(searchTerm.toLowerCase()));

  const dtColumns: DTColumn<any>[] = [
    { key: "id", header: "מזהה", align: "center", width: 80, nums: true, cell: (r) => r.test_station_type_id },
    { key: "desc", header: "תיאור", bold: true, nowrap: true, cell: (r) => r.test_type_desc },
    {
      key: "__actions", header: "פעולות", align: "center", width: 100,
      cell: (r) => (
        <RowActions>
          <IconAction title="ערוך" onClick={() => { setEditingRow(r); setFormData({ ...r }); setOpenDialog(true); }}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title="מחק" danger onClick={() => { setRowToDelete(r); setDeleteConfirmOpen(true); }}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  return (
    <div dir="rtl" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>סוגי עמדות</div>
        <button className="shx-btn shx-btn-primary" onClick={() => { setEditingRow(null); setFormData({}); setOpenDialog(true); }}>
          <Plus size={18} strokeWidth={2} />הוסף
        </button>
      </div>

      <div style={{ position: "relative", flexShrink: 0, maxWidth: 320 }}>
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

      <div style={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={dtColumns}
          rows={filteredRows}
          getRowKey={(r) => r.test_station_type_id}
          onRowClick={(r) => onSelect(r.test_station_type_id, r.test_type_desc)}
          rowSelected={(r) => selectedId === r.test_station_type_id}
          loading={loading}
          minWidth={380}
          maxHeight="100%"
        />
      </div>

      {/* Dialogs */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? "ערוך סוג" : "הוסף סוג"}</DialogTitle>
        <DialogContent>
          {editingRow && (
            <TextField
              margin="dense"
              label="מזהה (ID)"
              type="number"
              fullWidth
              value={formData.test_station_type_id ?? ""}
              onChange={(e) => setFormData({ ...formData, test_station_type_id: e.target.value })}
              helperText="שינוי המזהה יעדכן גם את כל העמדות והמסלולים המשויכים"
            />
          )}
          <TextField
            autoFocus
            margin="dense"
            label="תיאור סוג עמדה"
            fullWidth
            value={formData.test_type_desc || ""}
            onChange={(e) => setFormData({ ...formData, test_type_desc: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>שמור</Button>
          <Button variant="outlined" onClick={() => setOpenDialog(false)}>ביטול</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>מחיקה</DialogTitle>
        <DialogContent>בטוח שברצונך למחוק?</DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">מחק</Button>
          <Button variant="outlined" onClick={() => setDeleteConfirmOpen(false)}>ביטול</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </div>
  );
}
