"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, Box, Switch, FormControlLabel,
} from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import DataTable, { StatusPill, RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
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
      key: "research", header: "מחקר", width: 90,
      cell: (r) => (r.is_research
        ? <span style={{ fontSize: 11, fontWeight: 600, color: "#0066cc", background: "rgba(0,102,204,0.08)", borderRadius: 9999, padding: "4px 10px" }}>מחקר</span>
        : <span style={{ fontSize: 13, color: "#c0c0c8" }}>—</span>),
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
    <div dir="rtl" style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16, overflow: "hidden" }}>
      {/* card header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderBottom: "1px solid #e0e0e0", flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#1d1d1f" }}>עמדות · {typeName}</span>
        <button
          onClick={handleAdd}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0066cc", color: "#fff", border: 0, borderRadius: 9999, padding: "8px 15px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          <Plus size={16} strokeWidth={2.1} />הוסף עמדה
        </button>
      </div>

      {/* search */}
      <div style={{ position: "relative", padding: "10px 14px", borderBottom: "1px solid #f0f0f0", maxWidth: 360 }}>
        <span style={{ position: "absolute", insetInlineStart: 26, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex" }}>
          <Search size={15} strokeWidth={1.75} />
        </span>
        <input
          className="shx-input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="חיפוש עמדה..."
          style={{ height: 38, borderRadius: 9, paddingInlineStart: 36, paddingInlineEnd: 12, fontSize: 14 }}
        />
      </div>

      {/* table (embedded — no double card chrome) */}
      <DataTable columns={dtColumns} rows={filteredRows} getRowKey={(r) => r.test_station_id} loading={loading} minWidth={520} plain empty={<div style={{ fontSize: 14 }}>אין עמדות. הוסף עמדה לסוג זה.</div>} />

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
