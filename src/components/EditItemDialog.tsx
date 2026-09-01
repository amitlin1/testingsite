"use client";
import * as React from "react";
import { X, Trash2, AlertTriangle } from "lucide-react";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { apiFetch } from "@/lib/api/client";
import type { ItemRow } from "@/types";

/* =========================================================================
   EditItemDialog — "עריכת פריט" popup, same Shifthouse chrome as
   AddItemDialog. Only the base item fields are editable; the barcode
   (item_id) and status/progress (owned by the testing workflow) are shown
   read-only. A delete action lives in the footer, gated by a confirmation
   overlay stacked on top of this dialog.
   ========================================================================= */

export type Option = { value: string | number; label: string };
type ConnectedItem = { item_id: string; serial_no: string | null; model: string | null };

type EditItemForm = {
  customer: string; itemType: string; shipment: string;
  serialNumber: string; makat: string; model: string; manufacturer: string; manufacturerNo: string;
};

const REQUIRED: (keyof EditItemForm)[] = ["customer", "itemType", "shipment", "serialNumber", "makat", "model", "manufacturer", "manufacturerNo"];
const empty: EditItemForm = { customer: "", itemType: "", shipment: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" };

type Props = {
  open: boolean;
  item: ItemRow | null;
  customerOptions: Option[];
  itemTypeOptions: Option[];
  shipmentOptions: Option[];
  onClose: () => void;
  onSaved: (success: boolean, message?: string) => void;
  onDeleted: (success: boolean, message?: string) => void;
};

export default function EditItemDialog({ open, item, customerOptions, itemTypeOptions, shipmentOptions, onClose, onSaved, onDeleted }: Props) {
  const [form, setForm] = React.useState<EditItemForm>(empty);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [connectedItems, setConnectedItems] = React.useState<ConnectedItem[] | null>(null);

  React.useEffect(() => {
    if (open && item) {
      setForm({
        customer: item.customer_id != null ? String(item.customer_id) : "",
        itemType: item.item_type_id != null ? String(item.item_type_id) : "",
        shipment: item.shipment_id != null ? String(item.shipment_id) : "",
        serialNumber: item.serial_no ?? "",
        makat: item.makat ?? "",
        model: item.model ?? "",
        manufacturer: item.manufacturer_name ?? "",
        manufacturerNo: item.manufacturer_no ?? "",
      });
      setConfirmOpen(false);
      setConnectedItems(null);
    }
  }, [open, item]);

  if (!open || !item) return null;

  const set = (k: keyof EditItemForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = REQUIRED.every((k) => form[k].trim() !== "");
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const isSubItem = item.parent_item_id != null;
  const progressText = isSubItem
    ? "—"
    : item.current_status === 3 || item.is_finished
      ? (item.total_steps ? `${item.total_steps}/${item.total_steps}` : "הושלם")
      : item.total_steps
        ? `${item.current_route_step ?? 0}/${item.total_steps}`
        : "—";
  const hasProgress = !isSubItem && (item.current_status === 1 || item.current_status === 3 || !!item.is_finished || (item.current_route_step ?? 0) > 1);

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
          shipment: Number(form.shipment),
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={stop} dir="rtl" className="shx-scroll" style={{ width: "min(640px,94vw)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 18, boxShadow: "rgba(0,0,0,0.22) 3px 5px 30px 0", fontFamily: "var(--shx-font)", color: "#1d1d1f" }}>

        {/* ---- header ---- */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>עריכת פריט #{item.item_id}</div>
          <button onClick={onClose} aria-label="סגור" style={{ width: 34, height: 34, border: 0, borderRadius: 9999, background: "#f5f5f7", color: "#1d1d1f", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* ---- body ---- */}
        <div className="shx-scroll" style={{ padding: 24, overflowY: "auto" }}>
          {/* read-only fields — not editable from here */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <ReadOnlyPill label="ברקוד" value={String(item.item_id)} />
            <ReadOnlyPill label="סטטוס" value={item.item_status_desc ?? "—"} />
            <ReadOnlyPill label="התקדמות" value={progressText} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Field label="לקוח"><Select value={form.customer} onChange={(v) => set("customer", v)} placeholder="בחר לקוח" options={customerOptions} /></Field>
            <Field label="סוג פריט"><Select value={form.itemType} onChange={(v) => set("itemType", v)} placeholder="בחר סוג" options={itemTypeOptions} /></Field>
            <Field label="משלוח"><Select value={form.shipment} onChange={(v) => set("shipment", v)} placeholder="בחר משלוח" options={shipmentOptions} /></Field>
            <Field label="מס׳ סיריאלי"><input className="shx-input" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} style={{ fontVariantNumeric: "tabular-nums" }} /></Field>
            <Field label="מק״ט"><input className="shx-input" value={form.makat} onChange={(e) => set("makat", e.target.value)} style={{ fontVariantNumeric: "tabular-nums" }} /></Field>
            <Field label="דגם"><input className="shx-input" value={form.model} onChange={(e) => set("model", e.target.value)} /></Field>
            <Field label="יצרן"><input className="shx-input" value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} /></Field>
            <Field label="מס׳ יצרן"><input className="shx-input" value={form.manufacturerNo} onChange={(e) => set("manufacturerNo", e.target.value)} /></Field>
          </div>
        </div>

        {/* ---- footer ---- */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderTop: "1px solid #e0e0e0", background: "#fafafc" }}>
          <button
            className="shx-btn shx-btn-secondary"
            onClick={() => { setConnectedItems(null); setConfirmOpen(true); }}
            style={{ color: "#bf3535", borderColor: "#f0cccc" }}
          >
            <Trash2 size={15} strokeWidth={2} />מחק פריט
          </button>
          <div style={{ flex: 1 }} />
          <button className="shx-btn shx-btn-secondary" onClick={onClose}>ביטול</button>
          <button className="shx-btn shx-btn-primary" disabled={!valid || saving} onClick={handleSave}>
            {saving ? "שומר…" : "שמור שינויים"}
          </button>
        </div>
      </div>

      {/* ---- delete confirmation (stacked above) ---- */}
      {confirmOpen && (
        <div onClick={stop} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div dir="rtl" style={{ width: "min(440px,92vw)", background: "#fff", borderRadius: 16, boxShadow: "rgba(0,0,0,0.25) 3px 5px 30px 0", fontFamily: "var(--shx-font)", color: "#1d1d1f", padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={20} color="#bf3535" strokeWidth={2} />
              <div style={{ fontSize: 17, fontWeight: 700 }}>מחיקת פריט #{item.item_id}</div>
            </div>
            {connectedItems ? (
              <>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: "#333" }}>
                  לפריט זה יש {connectedItems.length} פריטים מחוברים — לא ניתן למחוק אותו לבדו. מחיקה תמחק גם אותם, לצמיתות:
                </div>
                <ul style={{ margin: "10px 0 0", padding: "0 4px 0 0", listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                  {connectedItems.map((c) => (
                    <li key={c.item_id} style={{ fontSize: 13.5, background: "#f5f5f7", border: "1px solid #e0e0e0", borderRadius: 8, padding: "6px 10px" }}>
                      #{c.item_id}{c.model ? ` — ${c.model}` : ""}{c.serial_no ? ` (מס׳ סיריאלי ${c.serial_no})` : ""}
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
                  <button className="shx-btn shx-btn-secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>ביטול</button>
                  <button
                    className="shx-btn shx-btn-primary"
                    style={{ background: "#bf3535" }}
                    onClick={() => handleDeleteConfirm(true)}
                    disabled={deleting}
                  >
                    {deleting ? "מוחק…" : "מחק את הפריט והפריטים המחוברים"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: "#333" }}>
                  {hasProgress
                    ? "פריט זה כבר נמצא בתהליך בדיקה (עבר שלב אחד או יותר). מחיקתו תמחק לצמיתות גם את היסטוריית הבדיקה ותוצאות הבדיקה שלו."
                    : "האם אתה בטוח שברצונך למחוק פריט זה?"}
                  {" "}מספר הפריטים במשלוח המשויך יתעדכן בהתאם. פעולה זו לא ניתנת לביטול.
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
                  <button className="shx-btn shx-btn-secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>ביטול</button>
                  <button
                    className="shx-btn shx-btn-primary"
                    style={{ background: "#bf3535" }}
                    onClick={() => handleDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    {deleting ? "מוחק…" : "מחק לצמיתות"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- small building blocks (mirrors AddItemDialog's) ---- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>{label}</label>
      {children}
    </div>
  );
}

function ReadOnlyPill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#5a5a5f", background: "#f5f5f7", border: "1px solid #e0e0e0", borderRadius: 9999, padding: "6px 12px", whiteSpace: "nowrap" }}>
      {label}: <span style={{ color: "#1d1d1f" }}>{value}</span>
    </span>
  );
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder: string }) {
  const selected = options.find((o) => String(o.value) === value) ?? null;
  return (
    <SearchableCombobox<Option>
      options={options}
      value={selected}
      onChange={(opt) => onChange(opt ? String(opt.value) : "")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => String(a.value) === String(b.value)}
      placeholder={placeholder}
    />
  );
}
