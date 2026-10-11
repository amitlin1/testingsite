"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, SearchInput, Snackbar, Alert, Checkbox, FormControlLabel,
  ConfirmDialog, Skeleton, Tag,
} from "@/components/ui";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface StationType {
  test_station_type_id: number;
  test_type_desc: string;
  /** Queue lists parent items only — accessories are tested alongside the parent. */
  package_level?: boolean;
  /** Minutes in test/research with no result before the item is auto-released. 0 = never. */
  stale_after_minutes?: number;
  station_count?: number;
}

interface StationTypesTableProps {
  selectedId: number | null;
  onSelect: (id: number, name: string) => void;
}

type FormErrors = Partial<Record<"id" | "desc" | "stale", string>>;

const STALE_HELP =
  "כמה דקות פריט יכול לשבת בבדיקה או במחקר בעמדה מסוג זה ללא תוצאה, לפני שהמערכת מחזירה אותו לתור ומשחררת את העמדה. יש להתאים את הערך לזמן שבדיקה מסוג זה באמת אורכת. 0 = הסוג הזה לא משוחרר אוטומטית לעולם.";

export default function StationTypesTable({ selectedId, onSelect }: StationTypesTableProps) {
  const [rows, setRows] = useState<StationType[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load is not "no types": it gets its own band and a retry.
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  // Validation is shown on the field it is about, not in a toast.
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [rowToDelete, setRowToDelete] = useState<StationType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success",
  });

  const apiUrl = "/api/settings/test-stations-type";

  /** The column's own DEFAULT — a new type is fail-safe unless it says otherwise. */
  const DEFAULT_STALE_AFTER_MINUTES = 30;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
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

  const openAdd = () => {
    setEditingRow(null);
    setFormData({ stale_after_minutes: DEFAULT_STALE_AFTER_MINUTES });
    setFormErrors({});
    setOpenDialog(true);
  };
  const openEdit = (r: StationType) => { setEditingRow(r); setFormData({ ...r }); setFormErrors({}); setOpenDialog(true); };
  const setField = (key: string, value: unknown, err?: keyof FormErrors) => {
    setFormData((f: any) => ({ ...f, [key]: value }));
    if (err && formErrors[err]) setFormErrors((e) => ({ ...e, [err]: undefined }));
  };

  const handleSave = async () => {
    const errors: FormErrors = {};
    if (!formData.test_type_desc?.trim()) errors.desc = "יש להזין תיאור לסוג העמדה";
    const staleStr = `${formData.stale_after_minutes ?? ""}`.trim();
    const staleNum = Number(staleStr);
    if (!staleStr || !Number.isInteger(staleNum) || staleNum < 0) {
      errors.stale = "יש להזין מספר שלם של דקות, 0 או יותר";
    }
    if (editingRow) {
      const idStr = `${formData.test_station_type_id ?? ""}`.trim();
      const idNum = parseInt(idStr, 10);
      if (!idStr || !Number.isInteger(idNum) || idNum <= 0) errors.id = "המזהה חייב להיות מספר שלם חיובי";
    }
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.test_station_type_id}` : apiUrl;
      const res = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || "שמירת סוג העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      }
      const savedRow = await res.json();
      if (editingRow && savedRow) {
        setRows(rows.map((r) => (r.test_station_type_id === editingRow.test_station_type_id ? savedRow : r)));
        if (selectedId === editingRow.test_station_type_id) onSelect(savedRow.test_station_type_id, savedRow.test_type_desc);
      } else {
        setRows([...rows, savedRow]);
      }
      setOpenDialog(false);
      setSnackbar({ open: true, message: "סוג העמדה נשמר", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שמירת סוג העמדה נכשלה. נסה שוב.", severity: "error" });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${apiUrl}/${rowToDelete.test_station_type_id}`, { method: "DELETE" });
      if (!res.ok) {
        if (res.status === 409) throw new Error("לא ניתן למחוק כי קיימות עמדות משויכות. מחק או העבר אותן קודם.");
        throw new Error("מחיקת סוג העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      }
      setRows(rows.filter((r) => r.test_station_type_id !== rowToDelete.test_station_type_id));
      if (selectedId === rowToDelete.test_station_type_id) onSelect(0, "");
      setSnackbar({ open: true, message: "סוג העמדה נמחק", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "מחיקת סוג העמדה נכשלה. נסה שוב.", severity: "error" });
    } finally {
      setDeleting(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((r) => r.test_type_desc.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div dir="rtl">
      <div className="settings-card">
        {/* card header — the compact add pill of Settings.dc.html */}
        <div className="settings-card__head">
          <span className="settings-card__title">סוגי עמדות</span>
          <Button size="small" onClick={openAdd} startIcon={<Plus size={15} strokeWidth={2} aria-hidden />}>
            הוסף
          </Button>
        </div>

        <div className="settings-card__search">
          <SearchInput
            fullWidth
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="חיפוש סוג עמדה…"
            aria-label="חיפוש סוג עמדה"
          />
        </div>

        {/* rows */}
        {loadError ? (
          <div className="settings-error">
            <Alert severity="error">טעינת סוגי העמדות נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
            <Button variant="outlined" color="inherit" size="small" onClick={fetchData}>נסה שוב</Button>
          </div>
        ) : loading ? (
          <div aria-busy="true" aria-label="טוען סוגי עמדות">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} aria-hidden style={{ padding: "16px var(--space-md)", borderTop: "1px solid var(--color-divider-soft)" }}>
                <Skeleton width={`${70 - i * 8}%`} height={14} />
              </div>
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="settings-empty" style={{ padding: "40px var(--space-md)" }}>
            {searchTerm ? (
              <>
                <div className="settings-empty__title">אין סוגי עמדות שתואמים לחיפוש</div>
                <div>נסה מילה אחרת, או נקה את החיפוש.</div>
              </>
            ) : (
              <>
                <div className="settings-empty__title">עדיין אין סוגי עמדות</div>
                <div>הוסף סוג עמדה ראשון, ואז שייך אליו עמדות.</div>
              </>
            )}
          </div>
        ) : (
          filteredRows.map((r) => {
            const selected = selectedId === r.test_station_type_id;
            const select = () => onSelect(r.test_station_type_id, r.test_type_desc);
            return (
              // The row's own button is the keyboard stop (aria-pressed = the
              // selected type); a click anywhere on the row still selects.
              <div
                key={r.test_station_type_id}
                className="stz-row"
                data-selected={selected || undefined}
                onClick={select}
              >
                <button
                  type="button"
                  className="stz-row__select"
                  aria-pressed={selected}
                  onClick={(e) => { e.stopPropagation(); select(); }}
                >
                  <span className="stz-row__name">{r.test_type_desc}</span>
                  {r.package_level && (
                    <Tag tone="primary" title="עמדה ברמת מארז: בתור מופיעים מארזים בלבד, והפריטים שבתוכם נבדקים יחד איתם">
                      עמדה ברמת מארז
                    </Tag>
                  )}
                  {r.stale_after_minutes != null && (
                    <Tag
                      tone="neutral"
                      title={r.stale_after_minutes === 0
                        ? "פריט בעמדה מסוג זה לא משוחרר אוטומטית לעולם"
                        : `פריט שיושב בבדיקה בעמדה מסוג זה ${r.stale_after_minutes} דקות ללא תוצאה משוחרר אוטומטית`}
                    >
                      {r.stale_after_minutes === 0 ? "ללא שחרור אוטומטי" : `שחרור אחרי ${r.stale_after_minutes} דק׳`}
                    </Tag>
                  )}
                  {r.station_count != null && (
                    <Tag tone="neutral" style={{ fontVariantNumeric: "tabular-nums" }} aria-label={`${r.station_count} עמדות`}>
                      {r.station_count}
                    </Tag>
                  )}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                  <IconButton
                    size="small"
                    className="set-act"
                    title={`ערוך את ${r.test_type_desc}`}
                    onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                  >
                    <Pencil size={15} strokeWidth={1.75} aria-hidden />
                  </IconButton>
                  <IconButton
                    size="small"
                    className="set-act set-act--danger"
                    title={`מחק את ${r.test_type_desc}`}
                    onClick={(e) => { e.stopPropagation(); setRowToDelete(r); }}
                  >
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                  </IconButton>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add / edit — one column with a real gap between the fields. */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? "עריכת סוג עמדה" : "סוג עמדה חדש"}</DialogTitle>
        <DialogContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {editingRow && (
              <TextField
                label="מזהה (ID)"
                type="number"
                fullWidth
                value={formData.test_station_type_id ?? ""}
                onChange={(e) => setField("test_station_type_id", e.target.value, "id")}
                error={!!formErrors.id}
                helperText={formErrors.id ?? "שינוי המזהה יעדכן גם את כל העמדות והמסלולים המשויכים"}
                inputProps={{ dir: "ltr", style: { textAlign: "right" } }}
              />
            )}
            <TextField
              autoFocus
              label="תיאור סוג עמדה"
              required
              fullWidth
              value={formData.test_type_desc || ""}
              onChange={(e) => setField("test_type_desc", e.target.value, "desc")}
              error={!!formErrors.desc}
              helperText={formErrors.desc}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={Boolean(formData.package_level)}
                  onChange={(_e, checked) => setField("package_level", checked)}
                />
              }
              label="עמדה ברמת מארז (פתיחת מארז / סגירת מארז): בתור מופיעים מארזים בלבד"
            />
            <TextField
              label="שחרור אוטומטי אחרי (דקות)"
              type="number"
              fullWidth
              value={formData.stale_after_minutes ?? ""}
              onChange={(e) => setField("stale_after_minutes", e.target.value, "stale")}
              error={!!formErrors.stale}
              helperText={formErrors.stale ?? STALE_HELP}
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
        title="מחיקת סוג עמדה"
        message={rowToDelete ? `למחוק את סוג העמדה "${rowToDelete.test_type_desc}"? פעולה זו אינה ניתנת לביטול.` : ""}
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
