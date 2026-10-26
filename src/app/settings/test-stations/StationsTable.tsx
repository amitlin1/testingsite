"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, SearchInput, Snackbar, Alert, Switch, FormControlLabel,
  ConfirmDialog, Tag,
} from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import DataTable, { StatusPill, RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { TestStation, TestStationStatus } from "@/types";
import { apiFetch } from "@/lib/api/client";

interface StationsTableProps {
  typeId: number;
  typeName: string;
  /** Station deep-linked from the command palette (?station=) — highlighted once loaded. */
  highlightStationId?: number | null;
}

/** The type's stations, or null when they could not be read. */
async function readStations(typeId: number): Promise<TestStation[] | null> {
  try {
    const res = await apiFetch(`/api/settings/test-stations?typeId=${typeId}`);
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(err);
    return null;
  }
}

export default function StationsTable({ typeId, typeName, highlightStationId }: StationsTableProps) {
  const [rows, setRows] = useState<TestStation[]>([]);
  const [statuses, setStatuses] = useState<TestStationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load is not "no stations": it gets its own band and a retry.
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<TestStation | null>(null);
  const [formData, setFormData] = useState<Partial<TestStation>>({});
  // Validation is shown on the field, not in a toast.
  const [descError, setDescError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);

  const [rowToDelete, setRowToDelete] = useState<TestStation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });

  const apiUrl = "/api/settings/test-stations";

  useEffect(() => {
    apiFetch("/api/settings/test-station-status")
      .then((res) => res.json())
      .then((data) => setStatuses(data))
      .catch((err) => console.error("Failed to load statuses", err));
  }, []);

  const applyRows = useCallback((list: TestStation[] | null) => {
    if (list) setRows(list);
    else setLoadError(true);
    setLoading(false);
  }, []);

  const fetchData = useCallback(async () => {
    if (!typeId) return;
    setLoading(true);
    setLoadError(false);
    applyRows(await readStations(typeId));
  }, [typeId, applyRows]);

  // Another type starts its load during render; the effect only reads, and
  // applies the reply. (`loading` starts true for the first one.)
  const [loadingTypeId, setLoadingTypeId] = useState(typeId);
  if (loadingTypeId !== typeId) {
    setLoadingTypeId(typeId);
    if (typeId) { setLoading(true); setLoadError(false); }
  }
  useEffect(() => {
    if (typeId) readStations(typeId).then(applyRows);
  }, [typeId, applyRows]);

  // Arriving from the command palette's ?station=<id> deep link: once the rows
  // are in, pre-fill the search box with that station's description so the user
  // lands on exactly the row they picked. It's a seed, not a lock — clearing
  // the box restores the full list, and `seededFor` stops us re-seeding after
  // that. Seeded during render, so the unfiltered table is never painted.
  const [seededFor, setSeededFor] = useState<number | null>(null);
  if (highlightStationId && seededFor !== highlightStationId) {
    const match = rows.find((r) => r.test_station_id === highlightStationId);
    if (match) {
      setSeededFor(highlightStationId);
      setSearchTerm(match.test_station_desc.trim());
    }
  }

  const handleAdd = () => {
    setEditingRow(null);
    setFormData({ test_station_type_id: typeId, status: 1, is_research: false });
    setDescError("");
    setOpenDialog(true);
  };
  const handleEdit = (row: TestStation) => { setEditingRow(row); setFormData({ ...row }); setDescError(""); setOpenDialog(true); };

  const handleSave = async () => {
    if (!formData.test_station_desc?.trim()) {
      setDescError("יש להזין תיאור לעמדה");
      return;
    }
    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.test_station_id}` : apiUrl;
      const res = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (!res.ok) throw new Error("שמירת העמדה נכשלה");
      const savedRow = await res.json();
      if (editingRow && savedRow) {
        setRows(rows.map((r) => (r.test_station_id === savedRow.test_station_id ? savedRow : r)));
      } else if (savedRow) {
        setRows([...rows, savedRow]);
      }
      setOpenDialog(false);
      setSnackbar({ open: true, message: "העמדה נשמרה", severity: "success" });
    } catch (err) {
      console.error(err);
      setSnackbar({ open: true, message: "שמירת העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.", severity: "error" });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${apiUrl}/${rowToDelete.test_station_id}`, { method: "DELETE" });
      if (!res.ok) {
        if (res.status === 409) throw new Error("לא ניתן למחוק כי העמדה בשימוש. שחרר אותה מבדיקות ומסלולים קודם.");
        throw new Error("מחיקת העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      }
      setRows(rows.filter((r) => r.test_station_id !== rowToDelete.test_station_id));
      setSnackbar({ open: true, message: "העמדה נמחקה", severity: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "מחיקת העמדה נכשלה. נסה שוב.";
      setSnackbar({ open: true, message, severity: "error" });
    } finally {
      setDeleting(false);
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
        ? <Tag tone="primary">מחקר</Tag>
        : <span style={{ color: "var(--color-ink-muted-48)" }} aria-label="לא">—</span>),
    },
    {
      key: "__actions", header: "פעולות", align: "center", width: 120,
      cell: (r) => (
        <RowActions>
          <IconAction title={`ערוך את ${r.test_station_desc}`} onClick={() => handleEdit(r)}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title={`מחק את ${r.test_station_desc}`} danger onClick={() => setRowToDelete(r)}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  return (
    <div dir="rtl" className="settings-card">
      {/* card header — the compact add pill of Settings.dc.html */}
      <div className="settings-card__head" style={{ paddingInline: 18 }}>
        <span className="settings-card__title">עמדות · {typeName}</span>
        <Button size="small" onClick={handleAdd} startIcon={<Plus size={16} strokeWidth={2} aria-hidden />}>
          הוסף עמדה
        </Button>
      </div>

      <div className="settings-card__search">
        <div style={{ maxWidth: 340 }}>
          <SearchInput
            fullWidth
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="חיפוש עמדה…"
            aria-label="חיפוש עמדה"
          />
        </div>
      </div>

      {/* table (embedded — no double card chrome) */}
      {loadError ? (
        <div className="settings-error">
          <Alert severity="error">טעינת העמדות נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={fetchData}>נסה שוב</Button>
        </div>
      ) : (
        <DataTable
          columns={dtColumns}
          rows={filteredRows}
          getRowKey={(r) => r.test_station_id}
          loading={loading}
          loadingRows={4}
          minWidth={520}
          plain
          empty={searchTerm ? (
            <div className="settings-empty settings-empty--bare">
              <div className="settings-empty__title">אין עמדות שתואמות לחיפוש</div>
              <div>נסה מילה אחרת, או נקה את החיפוש.</div>
            </div>
          ) : (
            <div className="settings-empty settings-empty--bare">
              <div className="settings-empty__title">אין עמדות לסוג זה</div>
              <div>הוסף עמדה כדי שתופיע בתור הבדיקות.</div>
            </div>
          )}
        />
      )}

      {/* Dialogs */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? "עריכת עמדה" : "עמדה חדשה"}</DialogTitle>
        <DialogContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <TextField
              label="תיאור עמדה"
              required
              fullWidth
              value={formData.test_station_desc || ""}
              onChange={(e) => { setFormData({ ...formData, test_station_desc: e.target.value }); if (descError) setDescError(""); }}
              error={!!descError}
              helperText={descError}
            />
            <SearchableCombobox<TestStationStatus>
              options={statuses}
              value={statuses.find((s) => s.test_station_status_id === formData.status) ?? null}
              onChange={(v) => { if (v) setFormData({ ...formData, status: Number(v.test_station_status_id) }); }}
              getOptionLabel={(s) => s.test_station_status_desc}
              isOptionEqualToValue={(a, b) => a.test_station_status_id === b.test_station_status_id}
              disableClearable
              label="סטטוס"
            />
            <FormControlLabel
              control={<Switch checked={formData.is_research || false} onChange={(e) => setFormData({ ...formData, is_research: e.target.checked })} />}
              label="עמדת מחקר"
            />
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
        title="מחיקת עמדה"
        message={rowToDelete ? `למחוק את העמדה "${rowToDelete.test_station_desc}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק"
        destructive
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setRowToDelete(null)}
      />

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </div>
  );
}
