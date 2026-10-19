"use client";
import * as React from "react";
import { Trash2 } from "lucide-react";
import {
  Alert, Button, ConfirmDialog, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField,
} from "@/components/ui";
import { Warning } from "@/components/ui/icons";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { apiFetch } from "@/lib/api/client";
import type { ItemRow } from "@/types";
import "./items.css";

/* =========================================================================
   EditItemDialog — "עריכת פריט". Built on the shared Dialog (Radix: focus
   trap, Escape, stacking, moved by its title). Only the base item fields are
   editable; the barcode (item_id) and status/progress (owned by the testing
   workflow) are shown read-only. A delete action lives in the footer, gated
   by a confirmation stacked on top of this dialog.

   Unsaved edits are never dropped silently: Escape, × or a click outside
   asks first (like TextEditorModal) when the form differs from the item.
   ========================================================================= */

export type Option = { value: string | number; label: string };
type ConnectedItem = { item_id: string; serial_no: string | null; model: string | null };

type EditItemForm = {
  customer: string; itemType: string;
  serialNumber: string; makat: string; model: string; manufacturer: string; manufacturerNo: string;
};

// Makat, model, manufacturer and its number are optional: an item in a box
// takes the box's (the shipment certificate's), which may leave them empty.
const REQUIRED: (keyof EditItemForm)[] = ["customer", "itemType", "serialNumber"];
const empty: EditItemForm = { customer: "", itemType: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" };

/** The form as the item stands — the baseline the unsaved-edits check compares to. */
function formOf(item: ItemRow): EditItemForm {
  return {
    customer: item.customer_id != null ? String(item.customer_id) : "",
    itemType: item.item_type_id != null ? String(item.item_type_id) : "",
    serialNumber: item.serial_no ?? "",
    makat: item.makat ?? "",
    model: item.model ?? "",
    manufacturer: item.manufacturer_name ?? "",
    manufacturerNo: item.manufacturer_no ?? "",
  };
}

/* Codes in an RTL form: typed and read left-to-right, aligned with the
   other fields' start edge. */
const LTR_CODE: React.InputHTMLAttributes<HTMLInputElement> = {
  dir: "ltr",
  style: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
};

type Props = {
  open: boolean;
  item: ItemRow | null;
  customerOptions: Option[];
  itemTypeOptions: Option[];
  onClose: () => void;
  onSaved: (success: boolean, message?: string) => void;
  onDeleted: (success: boolean, message?: string) => void;
};

export default function EditItemDialog({ open, item, customerOptions, itemTypeOptions, onClose, onSaved, onDeleted }: Props) {
  const [form, setForm] = React.useState<EditItemForm>(empty);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [connectedItems, setConnectedItems] = React.useState<ConnectedItem[] | null>(null);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  React.useEffect(() => {
    if (open && item) {
      setForm(formOf(item));
      setConfirmOpen(false);
      setConnectedItems(null);
      setDiscardOpen(false);
    }
  }, [open, item]);

  if (!open || !item) return null;

  const set = (k: keyof EditItemForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = REQUIRED.every((k) => form[k].trim() !== "");
  const baseline = formOf(item);
  const dirty = (Object.keys(baseline) as (keyof EditItemForm)[]).some((k) => form[k] !== baseline[k]);

  const isSubItem = item.package_id != null;
  const progressText = isSubItem
    ? "—"
    : item.current_status === 3 || item.is_finished
      ? (item.total_steps ? `${item.total_steps}/${item.total_steps}` : "הושלם")
      : item.total_steps
        ? `${item.current_route_step ?? 0}/${item.total_steps}`
        : "—";
  const hasProgress = !isSubItem && (item.current_status === 1 || item.current_status === 3 || !!item.is_finished || (item.current_route_step ?? 0) > 1);
  const typeChanged = form.itemType !== "" && form.itemType !== String(item.item_type_id ?? "");

  /** Escape / × / outside click: close, unless that would throw edits away. */
  const requestClose = () => {
    if (dirty) setDiscardOpen(true);
    else onClose();
  };

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/items/${item.item_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: Number(form.customer),
          itemType: Number(form.itemType),
          serialNumber: form.serialNumber,
          makat: form.makat,
          model: form.model,
          manufacturer: form.manufacturer,
          manufacturerNo: form.manufacturerNo,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "עדכון הפריט נכשל");
      }
      onSaved(true);
      onClose();
    } catch (e: any) {
      onSaved(false, e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async (cascade = false) => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/items/${item.item_id}`, {
        method: "DELETE",
        ...(cascade ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cascade: true }) } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409 && Array.isArray(err.connectedItems)) {
          // Not a failure — surface the connected items so the user can
          // decide to delete them together, instead of just erroring out.
          setConnectedItems(err.connectedItems);
          return;
        }
        throw new Error(err.error || "מחיקת הפריט נכשלה");
      }
      onDeleted(true);
      onClose();
    } catch (e: any) {
      onDeleted(false, e.message);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open onClose={requestClose} maxWidth="sm" fullWidth PaperProps={{ style: { maxWidth: 640 } }}>
        <DialogTitle onClose={requestClose}>
          <span style={{ minWidth: 0 }}>עריכת פריט #{item.item_id}</span>
        </DialogTitle>

        {/* Top divider only: DialogActions draws its own top edge, so `dividers`
            (top + bottom) would double the line above the footer. */}
        <DialogContent style={{ borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-ml)" }}>
          {/* read-only fields — not editable from here */}
          <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", marginBottom: "var(--space-ml)" }}>
            <ReadOnlyPill label="ברקוד" value={String(item.item_id)} />
            <ReadOnlyPill label="סטטוס" value={item.item_status_desc ?? "—"} />
            <ReadOnlyPill label="התקדמות" value={progressText} />
          </div>

          <div className="items-edit-grid">
            <Select label="לקוח" value={form.customer} onChange={(v) => set("customer", v)} placeholder="בחר לקוח" options={customerOptions} />
            <Select label="סוג פריט" value={form.itemType} onChange={(v) => set("itemType", v)} placeholder="בחר סוג" options={itemTypeOptions} />
            <TextField fullWidth label="מס׳ סיריאלי" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} inputProps={LTR_CODE} />
            <TextField fullWidth label="מק״ט" value={form.makat} onChange={(e) => set("makat", e.target.value)} inputProps={LTR_CODE} />
            <TextField fullWidth label="דגם" value={form.model} onChange={(e) => set("model", e.target.value)} />
            <TextField fullWidth label="יצרן" value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} />
            <TextField fullWidth label="מס׳ יצרן" value={form.manufacturerNo} onChange={(e) => set("manufacturerNo", e.target.value)} inputProps={LTR_CODE} />
          </div>

          {/* A type change is a re-route, not a field edit: another type can have
              a different set of stations, so the item goes back to step 1. Say so
              before the save, not after — this is not undoable from the UI. */}
          {typeChanged && (
            <Alert severity="warning" role="status" style={{ marginTop: "var(--space-ml)" }}>
              שינוי סוג הפריט יחזיר אותו לתחילת המסלול של הסוג החדש
              {hasProgress ? ", וההתקדמות הנוכחית שלו תתאפס" : ""}. תוצאות הבדיקה
              שכבר נרשמו נשמרות בהיסטוריה, אך המסלול הנוכחי לא ייספר כמסלול שהושלם.
            </Alert>
          )}
        </DialogContent>

        {/* Delete sits apart at the inline start; Cancel then Save at the end
            (DialogActions puts the filled action last). */}
        <DialogActions>
          <Button
            variant="outlined"
            color="error"
            onClick={() => { setConnectedItems(null); setConfirmOpen(true); }}
            startIcon={<Trash2 size={16} strokeWidth={1.75} aria-hidden />}
            style={{ marginInlineEnd: "auto" }}
          >
            מחק פריט
          </Button>
          <Button variant="outlined" color="inherit" onClick={requestClose}>ביטול</Button>
          <Button disabled={!valid} loading={saving} onClick={handleSave}>
            {saving ? "שומר…" : "שמור שינויים"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- delete confirmation (stacked above) ---- */}
      <ConfirmDialog
        open={confirmOpen && !connectedItems}
        draggable={false}
        destructive
        busy={deleting}
        title={`מחיקת פריט #${item.item_id}`}
        message={
          <>
            {hasProgress
              ? "פריט זה כבר נמצא בתהליך בדיקה (עבר שלב אחד או יותר). מחיקתו תמחק לצמיתות גם את היסטוריית הבדיקה ותוצאות הבדיקה שלו."
              : "האם אתה בטוח שברצונך למחוק פריט זה?"}
            {" "}מספר הפריטים במשלוח המשויך יתעדכן בהתאם. פעולה זו לא ניתנת לביטול.
          </>
        }
        confirmText={deleting ? "מוחק…" : "מחק לצמיתות"}
        onConfirm={() => handleDeleteConfirm(false)}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* 409: the item has connected items. Same confirmation shape as
          ConfirmDialog, with the list the decision is about. */}
      <Dialog
        open={confirmOpen && !!connectedItems}
        onClose={() => { if (!deleting) setConfirmOpen(false); }}
        maxWidth="xs"
        fullWidth
        draggable={false}
      >
        <DialogTitle style={{ justifyContent: "flex-start" }}>
          <Warning color="error" aria-hidden />
          <span style={{ flex: 1, minWidth: 0 }}>מחיקת פריט #{item.item_id}</span>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            לפריט זה יש {connectedItems?.length ?? 0} פריטים מחוברים — לא ניתן למחוק אותו לבדו. מחיקה תמחק גם אותם, לצמיתות:
          </DialogContentText>
          <ul style={{ margin: "var(--space-sm) 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {(connectedItems ?? []).map((c) => (
              <li key={c.item_id} style={{ fontSize: "var(--text-small)", background: "var(--color-canvas-parchment)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-sm)", padding: "6px 10px" }}>
                #{c.item_id}{c.model ? ` — ${c.model}` : ""}{c.serial_no ? ` (מס׳ סיריאלי ${c.serial_no})` : ""}
              </li>
            ))}
          </ul>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setConfirmOpen(false)} disabled={deleting} autoFocus>
            ביטול
          </Button>
          <Button color="error" loading={deleting} onClick={() => handleDeleteConfirm(true)}>
            {deleting ? "מוחק…" : "מחק את הפריט והפריטים המחוברים"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- unsaved edits: ask before throwing them away ---- */}
      <ConfirmDialog
        open={discardOpen}
        title="יש שינויים שלא נשמרו"
        message="סגירת החלון תבטל את השינויים שביצעת בפריט. האם לסגור בכל זאת?"
        confirmText="סגור בלי לשמור"
        cancelText="חזרה לעריכה"
        destructive
        onConfirm={() => { setDiscardOpen(false); onClose(); }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}

/* ---- small building blocks ---- */
function ReadOnlyPill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-fine)", fontWeight: 600, color: "var(--color-ink-muted-70)", background: "var(--color-canvas-parchment)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-pill)", padding: "6px 12px", whiteSpace: "nowrap" }}>
      {label}: <span style={{ color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

function Select({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder: string }) {
  const selected = options.find((o) => String(o.value) === value) ?? null;
  return (
    <SearchableCombobox<Option>
      label={label}
      options={options}
      value={selected}
      onChange={(opt) => onChange(opt ? String(opt.value) : "")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => String(a.value) === String(b.value)}
      placeholder={placeholder}
    />
  );
}
