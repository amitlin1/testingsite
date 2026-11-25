"use client";
import React, { useState } from "react";
import {
  Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, SearchInput, Alert, Checkbox, FormControlLabel,
  ConfirmDialog, Skeleton, Tag,
} from "@/components/ui";
import Link from "next/link";
import { Plus, Pencil, Trash2, LayoutTemplate } from "lucide-react";
import { ApiError, sendJson } from "@/lib/api/client";
import { readStaleAfterMinutes, type StationTypeRow } from "@/app/lib/lookups/contract";
import { DEFAULT_STALE_AFTER_MINUTES } from "@/lib/item-status";
import { useInvalidateLookup } from "@/app/components/lookups";
import { popupTemplatesHref } from "@/app/lib/links";
import { useSettingsToast } from "../components/useSettingsToast";
import { STATION_TYPES_URL, useStationTypeRows } from "./stationTypeRows";

/** The add / edit form: a station type as typed — the number fields hold the input's text. */
type StationTypeForm = Partial<Omit<StationTypeRow, "test_station_type_id" | "stale_after_minutes">> & {
  test_station_type_id?: number | string;
  stale_after_minutes?: number | string;
};

interface StationTypesTableProps {
  selectedId: number | null;
  /** null: the selection is cleared (the selected type was deleted). */
  onSelect: (id: number | null) => void;
}

type FormErrors = Partial<Record<"id" | "desc" | "stale", string>>;

const STALE_HELP =
  "כמה דקות פריט יכול לשבת בבדיקה או במחקר בעמדה מסוג זה ללא תוצאה, לפני שהמערכת מחזירה אותו לתור ומשחררת את העמדה. יש להתאים את הערך לזמן שבדיקה מסוג זה באמת אורכת. 0 = הסוג הזה לא משוחרר אוטומטית לעולם.";

export default function StationTypesTable({ selectedId, onSelect }: StationTypesTableProps) {
  const { rows, loading, failed: loadError, reload, update } = useStationTypeRows();
  const [searchTerm, setSearchTerm] = useState("");

  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<StationTypeRow | null>(null);
  const [formData, setFormData] = useState<StationTypeForm>({});
  // Validation is shown on the field it is about, not in a toast.
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saveLoading, setSaveLoading] = useState(false);

  const [rowToDelete, setRowToDelete] = useState<StationTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const notify = useSettingsToast({ dismissible: false });
  const invalidateLookup = useInvalidateLookup();

  const openAdd = () => {
    setEditingRow(null);
    setFormData({ stale_after_minutes: DEFAULT_STALE_AFTER_MINUTES });
    setFormErrors({});
    setOpenDialog(true);
  };
  const openEdit = (r: StationTypeRow) => { setEditingRow(r); setFormData({ ...r }); setFormErrors({}); setOpenDialog(true); };
  const setField = <K extends keyof StationTypeForm>(key: K, value: StationTypeForm[K], err?: keyof FormErrors) => {
    setFormData((f) => ({ ...f, [key]: value }));
    if (err && formErrors[err]) setFormErrors((e) => ({ ...e, [err]: undefined }));
  };

  const handleSave = async () => {
    const errors: FormErrors = {};
    if (!formData.test_type_desc?.trim()) errors.desc = "יש להזין תיאור לסוג העמדה";
    if (readStaleAfterMinutes(formData.stale_after_minutes) == null) errors.stale = "יש להזין מספר שלם של דקות, 0 או יותר";
    if (editingRow) {
      const idStr = `${formData.test_station_type_id ?? ""}`.trim();
      const idNum = parseInt(idStr, 10);
      if (!idStr || !Number.isInteger(idNum) || idNum <= 0) errors.id = "המזהה חייב להיות מספר שלם חיובי";
    }
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${STATION_TYPES_URL}/${editingRow.test_station_type_id}` : STATION_TYPES_URL;
      const savedRow = await sendJson<StationTypeRow>(url, method, formData, "שמירת סוג העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      if (editingRow && savedRow) {
        update((list) => list.map((r) => (r.test_station_type_id === editingRow.test_station_type_id ? savedRow : r)));
        if (selectedId === editingRow.test_station_type_id) onSelect(savedRow.test_station_type_id);
      } else {
        update((list) => [...list, savedRow]);
      }
      invalidateLookup("stationTypes");
      setOpenDialog(false);
      notify("סוג העמדה נשמר", "success");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "שמירת סוג העמדה נכשלה. נסה שוב.", "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    setDeleting(true);
    try {
      await sendJson(`${STATION_TYPES_URL}/${rowToDelete.test_station_type_id}`, "DELETE");
      update((list) => list.filter((r) => r.test_station_type_id !== rowToDelete.test_station_type_id));
      if (selectedId === rowToDelete.test_station_type_id) onSelect(null);
      invalidateLookup("stationTypes");
      notify("סוג העמדה נמחק", "success");
    } catch (err) {
      // A 409 is the server's refusal: the type still has stations.
      const message =
        err instanceof ApiError
          ? err.status === 409
            ? err.message
            : "מחיקת סוג העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב."
          : "מחיקת סוג העמדה נכשלה. נסה שוב.";
      notify(message, "error");
    } finally {
      setDeleting(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter((r) => r.test_type_desc.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div>
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
            <Button variant="outlined" color="inherit" size="small" onClick={() => reload()}>נסה שוב</Button>
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
            const select = () => onSelect(r.test_station_type_id);
            return (
              // The row's own button is the keyboard stop (aria-pressed = the
              // selected type); a click anywhere on the row still selects.
              <div
                key={r.test_station_type_id}
                className="set-row"
                data-selected={selected || undefined}
                onClick={select}
              >
                <button
                  type="button"
                  className="set-row__select"
                  aria-pressed={selected}
                  onClick={(e) => { e.stopPropagation(); select(); }}
                >
                  <span className="set-row__name">{r.test_type_desc}</span>
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
                  {/* The type's popup template (docs/popup-templates/PLAN.md step 1.6). */}
                  <IconButton
                    size="small"
                    className="set-act"
                    component={Link}
                    href={popupTemplatesHref(r.test_station_type_id)}
                    title={`תבנית החלון של ${r.test_type_desc}`}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <LayoutTemplate size={15} strokeWidth={1.75} aria-hidden />
                  </IconButton>
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
        open={rowToDelete != null}
        title="מחיקת סוג עמדה"
        message={rowToDelete ? `למחוק את סוג העמדה "${rowToDelete.test_type_desc}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק"
        destructive
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setRowToDelete(null)}
      />
    </div>
  );
}
