"use client";
import React, { useState } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, SearchInput, Alert, Switch, FormControlLabel,
  ConfirmDialog, Tag, SearchableCombobox,
} from "@/components/ui";
import DataTable, { StatusPill, RowActions, IconAction, type Column as DTColumn } from "@/components/DataTable";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { ApiError, getArray, sendJson } from "@/lib/api/client";
import { useListQuery } from "@/lib/hooks/useListQuery";
import type { StationStatusRow, TestStationRow as TestStation } from "@/app/lib/lookups/contract";
import { StationStatus } from "@/lib/item-status";
import { useInvalidateLookup } from "@/app/components/lookups";
import { useSettingsToast } from "../components/useSettingsToast";
import { useStationTypeRows } from "./stationTypeRows";

interface StationsTableProps {
  typeId: number;
  /** Station deep-linked from the command palette (?station=) — highlighted once loaded. */
  highlightStationId?: number | null;
}

const API_URL = "/api/settings/test-stations";
const STATUSES_URL = "/api/settings/test-station-status";

export default function StationsTable({ typeId, highlightStationId }: StationsTableProps) {
  const typeName = useStationTypeRows().rows.find((t) => t.test_station_type_id === typeId)?.test_type_desc ?? "";
  const stationsUrl = `${API_URL}?typeId=${typeId}`;
  const { rows, loading, failed: loadError, reload, update } = useListQuery<TestStation>(
    [stationsUrl],
    () => getArray<TestStation>(stationsUrl),
  );
  const { rows: statuses } = useListQuery<StationStatusRow>([STATUSES_URL], () => getArray<StationStatusRow>(STATUSES_URL));
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<TestStation | null>(null);
  const [formData, setFormData] = useState<Partial<TestStation>>({});
  // Validation is shown on the field, not in a toast.
  const [descError, setDescError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);

  const [rowToDelete, setRowToDelete] = useState<TestStation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const notify = useSettingsToast({ dismissible: false });
  const invalidateLookup = useInvalidateLookup();

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
      setSearchTerm(match.test_station_desc);
    }
  }

  const handleAdd = () => {
    setEditingRow(null);
    setFormData({ test_station_type_id: typeId, status: StationStatus.Active, is_research: false });
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
      const url = editingRow ? `${API_URL}/${editingRow.test_station_id}` : API_URL;
      const savedRow = await sendJson<TestStation>(url, method, formData);
      if (editingRow && savedRow) {
        update((list) => list.map((r) => (r.test_station_id === savedRow.test_station_id ? savedRow : r)));
      } else if (savedRow) {
        update((list) => [...list, savedRow]);
      }
      invalidateLookup("stations");
      setOpenDialog(false);
      notify("העמדה נשמרה", "success");
    } catch (err) {
      console.error(err);
      notify("שמירת העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.", "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      await sendJson(`${API_URL}/${rowToDelete.test_station_id}`, "DELETE");
      update((list) => list.filter((r) => r.test_station_id !== rowToDelete.test_station_id));
      invalidateLookup("stations");
      notify("העמדה נמחקה", "success");
    } catch (err) {
      // A 409 is the server's refusal: the station is still in use.
      const message =
        err instanceof ApiError
          ? err.status === 409
            ? err.message
            : "מחיקת העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב."
          : "מחיקת העמדה נכשלה. נסה שוב.";
      notify(message, "error");
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
        return <StatusPill label={d} tone={r.status === StationStatus.Active ? "active" : "neutral"} />;
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
    <div className="settings-card">
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
          <Button variant="outlined" color="inherit" size="small" onClick={() => reload()}>נסה שוב</Button>
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
            <SearchableCombobox<StationStatusRow>
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
        open={rowToDelete != null}
        title="מחיקת עמדה"
        message={rowToDelete ? `למחוק את העמדה "${rowToDelete.test_station_desc}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק"
        destructive
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setRowToDelete(null)}
      />
    </div>
  );
}
