"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, Checkbox, FormControlLabel,
} from "@/components/ui";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface StationType {
  test_station_type_id: number;
  test_type_desc: string;
  /** Queue lists parent items only — accessories are tested alongside the parent. */
  parents_only?: boolean;
  station_count?: number;
}

interface StationTypesTableProps {
  selectedId: number | null;
  onSelect: (id: number, name: string) => void;
}

export default function StationTypesTable({ selectedId, onSelect }: StationTypesTableProps) {
  const [rows, setRows] = useState<StationType[]>([]);
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
      const res = await apiFetch(apiUrl);
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

  // A selection can arrive from outside the table — the command palette
  // deep-links ?type=<id>, which the page turns into `selectedId` before the
  // rows exist. Once they load, resolve that id to its name and report it back
  // so the detail pane gets a real header instead of an empty one. The ref
  // guards against re-reporting (and thus re-rendering) on every fetch.
  const reportedRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (!selectedId || reportedRef.current === selectedId) return;
    const match = rows.find((r) => r.test_station_type_id === selectedId);
    if (!match) return;
    reportedRef.current = selectedId;
    onSelect(match.test_station_type_id, match.test_type_desc);
  }, [rows, selectedId, onSelect]);

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
      const res = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
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
      const res = await apiFetch(`${apiUrl}/${rowToDelete.test_station_type_id}`, { method: "DELETE" });
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

  return (
    <div dir="rtl">
      <style>{`
        .stz-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:13px 16px; border-top:1px solid #f0f0f0; cursor:pointer; border-inline-start:3px solid transparent; transition:background 0.12s ease; }
        .stz-row:hover { background:#f5f5f7; }
        .stz-row.stz-selected { background:#f3f8ff; border-inline-start-color:#0066cc; }
        .stz-iconbtn { width:28px; height:28px; border:0; border-radius:7px; background:transparent; color:#9a9aa0; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.12s ease, color 0.12s ease; }
        .stz-iconbtn:hover { background:#ececf0; color:#0066cc; }
        .stz-iconbtn.stz-danger:hover { background:rgba(191,53,53,0.08); color:#bf3535; }
      `}</style>

      <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 16, overflow: "hidden" }}>
        {/* card header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #e0e0e0" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#1d1d1f" }}>סוגי עמדות</span>
          <button
            onClick={() => { setEditingRow(null); setFormData({}); setOpenDialog(true); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#0066cc", color: "#fff", border: 0, borderRadius: 9999, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            <Plus size={15} strokeWidth={2.2} />הוסף
          </button>
        </div>

        {/* search */}
        <div style={{ position: "relative", padding: "10px 12px", borderBottom: "1px solid #f0f0f0" }}>
          <span style={{ position: "absolute", insetInlineStart: 24, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex" }}>
            <Search size={15} strokeWidth={1.75} />
          </span>
          <input
            className="shx-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="חיפוש..."
            style={{ height: 38, borderRadius: 9, paddingInlineStart: 36, paddingInlineEnd: 12, fontSize: 14 }}
          />
        </div>

        {/* rows */}
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7a7a7a", fontSize: 14 }}>טוען…</div>
        ) : filteredRows.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#7a7a7a", fontSize: 14 }}>לא נמצאו סוגי עמדות.</div>
        ) : (
          filteredRows.map((r) => {
            const selected = selectedId === r.test_station_type_id;
            return (
              <div
                key={r.test_station_type_id}
                className={"stz-row" + (selected ? " stz-selected" : "")}
                onClick={() => onSelect(r.test_station_type_id, r.test_type_desc)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: selected ? 600 : 400, color: "#1d1d1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.test_type_desc}
                  </span>
                  {r.parents_only && (
                    <span title="בעמדות מסוג זה נשלפים רק פריטי אב" style={{ fontSize: 11, color: "#0066cc", background: "#f3f8ff", border: "1px solid #cfe3fb", borderRadius: 9999, padding: "2px 8px", flexShrink: 0, whiteSpace: "nowrap" }}>
                      פריטי אב בלבד
                    </span>
                  )}
                  {r.station_count != null && (
                    <span style={{ fontSize: 11, color: "#9a9aa0", background: "#f5f5f7", border: "1px solid #e0e0e0", borderRadius: 9999, padding: "2px 8px", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                      {r.station_count}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                  <button className="stz-iconbtn" title="ערוך" onClick={(e) => { e.stopPropagation(); setEditingRow(r); setFormData({ ...r }); setOpenDialog(true); }}>
                    <Pencil size={14} strokeWidth={1.75} />
                  </button>
                  <button className="stz-iconbtn stz-danger" title="מחק" onClick={(e) => { e.stopPropagation(); setRowToDelete(r); setDeleteConfirmOpen(true); }}>
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            );
          })
        )}
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
          <FormControlLabel
            control={
              <Checkbox
                checked={Boolean(formData.parents_only)}
                onChange={(_e, checked) => setFormData({ ...formData, parents_only: checked })}
              />
            }
            label="שלוף רק פריטי אב (הפריטים הנלווים נבדקים יחד עם פריט האב)"
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
