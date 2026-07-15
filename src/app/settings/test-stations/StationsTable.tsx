"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, Box, Switch, FormControlLabel,
} from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import DataTable, { StatusPill, RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Search, Plus, Pencil, Trash2, Check } from "lucide-react";
import { TestStation, TestStationStatus } from "@/types";

interface StationsTableProps {
  typeId: number;
  typeName: string;
}

export default function StationsTable({ typeId, typeName }: StationsTableProps) {
  const [rows, setRows] = useState<TestStation[]>([]);
  const [statuses, setStatuses] = useState<TestStationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<TestStation | null>(null);
  const [formData, setFormData] = useState<Partial<TestStation>>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<TestStation | null>(null);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });

  const apiUrl = "/api/settings/test-stations";

  useEffect(() => {
    fetch("/api/settings/test-station-status")
      .then((res) => res.json())
      .then((data) => setStatuses(data))
      .catch((err) => console.error("Failed to load statuses", err));
  }, []);

  const fetchData = useCallback(async () => {
    if (!typeId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}?typeId=${typeId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setSnackbar({ open: true, message: "שגיאה בטעינת עמדות", severity: "error" });
    } finally {
      setLoading(false);
    }
  }, [typeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = () => {
    setEditingRow(null);
    setFormData({ test_station_type_id: typeId, status: 1, is_research: false });
    setOpenDialog(true);
  };
  const handleEdit = (row: TestStation) => { setEditingRow(row); setFormData({ ...row }); setOpenDialog(true); };

  const handleSave = async () => {
    if (!formData.test_station_desc?.trim()) {
      setSnackbar({ open: true, message: "תיאור חובה", severity: "error" });
      return;
    }
    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.test_station_id}` : apiUrl;
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (!res.ok) throw new Error("Failed to save");
      const savedRow = await res.json();
      if (editingRow && savedRow) {
        setRows(rows.map((r) => (r.test_station_id === savedRow.test_station_id ? savedRow : r)));
      } else if (savedRow) {
        setRows([...rows, savedRow]);
      }
      setOpenDialog(false);
      setSnackbar({ open: true, message: "נשמר בהצלחה", severity: "success" });
    } catch (err) {
      console.error(err);
      setSnackbar({ open: true, message: "שגיאה בשמירה", severity: "error" });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete.test_station_id}`, { method: "DELETE" });
      if (!res.ok) {
        if (res.status === 409) throw new Error("לא ניתן למחוק כי העמדה בשימוש");
        throw new Error("Failed to delete");
      }
      setRows(rows.filter((r) => r.test_station_id !== rowToDelete.test_station_id));
      setSnackbar({ open: true, message: "נמחק בהצלחה", severity: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה במחיקה";
      setSnackbar({ open: true, message, severity: "error" });
    } finally {
      setDeleteConfirmOpen(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((r) => r.test_station_desc.toLowerCase().includes(searchTerm.toLowerCase()));

  const dtColumns: DTColumn<TestStation>[] = [
    { key: "desc", header: "תיאור", bold: true, nowrap: true, cell: (r) => r.test_station_desc },
    {
      key: "status", header: "סטטוס",
      cell: (r) => {
        const d = statuses.find((s) => s.test_station_status_id === r.status)?.test_station_status_desc || String(r.status);
        return <StatusPill label={d} active={r.status === 1} />;
      },
    },
    {
      key: "research", header: "מחקר", align: "center", width: 90,
      cell: (r) => (r.is_research ? <Check size={16} strokeWidth={2} color="#0066cc" /> : <span style={{ color: "#7a7a7a" }}>—</span>),
    },
    {
      key: "__actions", header: "פעולות", align: "center", width: 120,
      cell: (r) => (
        <RowActions>
          <IconAction title="ערוך" onClick={() => handleEdit(r)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title="מחק" danger onClick={() => { setRowToDelete(r); setDeleteConfirmOpen(true); }}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  return (
    <div dir="rtl" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>עמדות עבור: {typeName}</div>
        <button className="shx-btn shx-btn-primary" onClick={handleAdd}>
          <Plus size={18} strokeWidth={2} />הוסף עמדה
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
          placeholder="חיפוש עמדה..."
          style={{ height: 42, borderRadius: 10, paddingInlineStart: 40, paddingInlineEnd: 14, fontSize: 14 }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <DataTable columns={dtColumns} rows={filteredRows} getRowKey={(r) => r.test_station_id} loading={loading} minWidth={520} maxHeight="100%" empty={<div style={{ fontSize: 15 }}>אין עמדות</div>} />
      </div>

      {/* Dialogs */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? "ערוך עמדה" : "הוסף עמדה"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField label="תיאור עמדה" fullWidth value={formData.test_station_desc || ""} onChange={(e) => setFormData({ ...formData, test_station_desc: e.target.value })} />
            <SearchableCombobox<TestStationStatus>
              options={statuses}
              value={statuses.find((s) => s.test_station_status_id === formData.status) ?? null}
              onChange={(v) => { if (v) setFormData({ ...formData, status: Number(v.test_station_status_id) }); }}
              getOptionLabel={(s) => s.test_station_status_desc}
              isOptionEqualToValue={(a, b) => a.test_station_status_id === b.test_station_status_id}
              disableClearable
              floatingLabel="סטטוס"
            />
            <FormControlLabel
              control={<Switch checked={formData.is_research || false} onChange={(e) => setFormData({ ...formData, is_research: e.target.checked })} />}
              label="עמדת מחקר"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>שמור</Button>
          <Button variant="outlined" onClick={() => setOpenDialog(false)}>ביטול</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>מחיקה</DialogTitle>
        <DialogContent>בטוח שברצונך למחוק את העמדה &quot;{rowToDelete?.test_station_desc}&quot;?</DialogContent>
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
