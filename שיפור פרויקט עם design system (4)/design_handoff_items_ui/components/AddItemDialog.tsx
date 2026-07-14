"use client";
import * as React from "react";
import { X, ScanLine, Plus, Trash2, Package, Check } from "lucide-react";

/* =========================================================================
   AddItemDialog — Shifthouse-styled "הוסף פריט חדש לבדיקה" popup.
   Flat (no MUI elevation), RTL, one Action Blue, single product shadow on
   the modal card. Replaces insertPopup.tsx's chrome while keeping the same
   data shape (NewItem) and flow (shipment → items table → fields → sub-items).

   Requires: import "@/styles/shifthouse.css" once in the app.
   Comboboxes are rendered here as styled native selects for a self-contained
   drop-in; swap them for your existing <SearchableCombobox> if you want async
   search — the wrappers already carry the Shifthouse look.
   ========================================================================= */

export type Option = { value: string | number; label: string };
export type ShipmentItemRow = {
  id: number;
  item_type_id: number;
  item_type_desc: string;
  total_quantity: number;
  sample_count: number;
  makat: number | null;
};
export type NewItemForm = {
  shipment: string; customer: string; itemType: string; routeNumber: string;
  serialNumber: string; makat: string; model: string; manufacturer: string; manufacturerNo: string;
};
export type SubItemForm = { itemType: string; serialNumber: string; makat: string; model: string; manufacturer: string; manufacturerNo: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: NewItemForm, subItems: SubItemForm[]) => void;
  onScan?: () => void;
  shipmentOptions: Option[];
  customerOptions: Option[];
  itemTypeOptions: Option[];
  routeOptions: Option[];
  shipmentItems?: ShipmentItemRow[];
  loadingShipmentItems?: boolean;
  batchIndex?: number;   // 1-based; 0 = not a batch
  batchTotal?: number;
  /** Fires on every field change so the container can react (e.g. filter
      routeOptions by the selected itemType, refetch shipmentItems, etc). */
  onFormChange?: (form: NewItemForm) => void;
};

const REQUIRED: (keyof NewItemForm)[] = ["shipment", "customer", "itemType", "routeNumber", "serialNumber", "makat", "model", "manufacturer", "manufacturerNo"];
const empty: NewItemForm = { shipment: "", customer: "", itemType: "", routeNumber: "", serialNumber: "", makat: "", model: "", manufacturer: "", manufacturerNo: "" };

export default function AddItemDialog(props: Props) {
  const { open, onClose, onSubmit, onScan, shipmentOptions, customerOptions, itemTypeOptions, routeOptions, shipmentItems = [], loadingShipmentItems = false, batchIndex = 0, batchTotal = 0 } = props;
  const [form, setForm] = React.useState<NewItemForm>(empty);
  const [subs, setSubs] = React.useState<SubItemForm[]>([]);

  React.useEffect(() => { if (open) { setForm(empty); setSubs([]); } }, [open]);
  React.useEffect(() => { props.onFormChange?.(form); }, [form]);   // lift state so parent can filter routes by itemType
  if (!open) return null;

  const set = (k: keyof NewItemForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = REQUIRED.every((k) => form[k].trim() !== "");
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={stop} dir="rtl" className="shx-scroll" style={{ width: "min(680px,94vw)", maxHeight: "88vh", overflow: "hidden", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 18, boxShadow: "rgba(0,0,0,0.22) 3px 5px 30px 0", fontFamily: "var(--shx-font)", color: "#1d1d1f" }}>

        {/* ---- header ---- */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: "1px solid #e0e0e0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>הוספת פריט חדש לבדיקה</div>
            {batchTotal > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "#0066cc", background: "#eaf3ff", border: "1px solid #cfe4ff", borderRadius: 9999, padding: "4px 11px", whiteSpace: "nowrap" }}>
                פריט {batchIndex} מתוך {batchTotal}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {onScan && (
              <button onClick={onScan} title="סרוק ברקוד" className="shx-btn shx-btn-secondary" style={{ padding: "8px 14px", fontSize: 14 }}>
                <ScanLine size={17} strokeWidth={1.75} />סרוק
              </button>
            )}
            <button onClick={onClose} aria-label="סגור" style={{ width: 34, height: 34, border: 0, borderRadius: 9999, background: "#f5f5f7", color: "#1d1d1f", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* ---- body ---- */}
        <div className="shx-scroll" style={{ padding: 24, overflowY: "auto" }}>
          {/* shipment (full width) */}
          <Field label="משלוח">
            <Select value={form.shipment} onChange={(v) => set("shipment", v)} placeholder="בחר משלוח" options={shipmentOptions} />
          </Field>

          {/* shipment items table */}
          {form.shipment && (
            <div style={{ marginTop: 16, border: "1px solid #e0e0e0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "#f5f5f7", borderBottom: "1px solid #e0e0e0" }}>
                <Package size={18} strokeWidth={1.75} color="#0066cc" />
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>פריטים במשלוח</span>
                {shipmentItems.length > 0 && (
                  <span style={{ marginInlineStart: "auto", fontSize: 12, color: "#7a7a7a", fontVariantNumeric: "tabular-nums" }}>{shipmentItems.length} סוגים</span>
                )}
              </div>
              {loadingShipmentItems ? (
                <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ height: 38, borderRadius: 8, background: "linear-gradient(90deg,#eee,#f5f5f7,#eee)", backgroundSize: "200% 100%", animation: "shx-shimmer 1.4s infinite" }} />
                  <div style={{ height: 38, borderRadius: 8, background: "linear-gradient(90deg,#eee,#f5f5f7,#eee)", backgroundSize: "200% 100%", animation: "shx-shimmer 1.4s infinite" }} />
                </div>
              ) : shipmentItems.length > 0 ? (
                <table className="shx-table">
                  <thead>
                    <tr>
                      <th className="shx-th">סוג פריט</th>
                      <th className="shx-th shx-th--center">מק״ט</th>
                      <th className="shx-th shx-th--center">כמות</th>
                      <th className="shx-th shx-th--center">מדגם</th>
                      <th className="shx-th" style={{ width: 150 }}>התקדמות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipmentItems.map((it) => {
                      const pct = it.total_quantity > 0 ? Math.min(Math.round((it.sample_count / it.total_quantity) * 100), 100) : 0;
                      const on = String(it.item_type_id) === form.itemType;
                      return (
                        <tr
                          key={it.id}
                          className="shx-row shx-row--clickable"
                          style={on ? { background: "#f3f8ff", borderInlineStart: "3px solid #0066cc" } : undefined}
                          onClick={() => { set("itemType", String(it.item_type_id)); if (it.makat != null) set("makat", String(it.makat)); }}
                        >
                          <td className="shx-td" style={{ fontWeight: 600 }}>{it.item_type_desc}</td>
                          <td className="shx-td" style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"}</td>
                          <td className="shx-td" style={{ textAlign: "center", color: "#444", fontVariantNumeric: "tabular-nums" }}>{it.total_quantity}</td>
                          <td className="shx-td" style={{ textAlign: "center", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{it.sample_count}</td>
                          <td className="shx-td">
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ flex: 1, height: 5, borderRadius: 9999, background: pct >= 100 ? "#dbe9fb" : "#f0f0f0", overflow: "hidden", minWidth: 60 }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: "#0066cc", borderRadius: 9999 }} />
                              </div>
                              <span style={{ fontSize: 12, color: "#7a7a7a", fontVariantNumeric: "tabular-nums", minWidth: 34 }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: "#9a9aa0" }}>אין פריטים מוגדרים למשלוח זה</div>
              )}
            </div>
          )}

          {/* fields grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
            <Field label="לקוח"><Select value={form.customer} onChange={(v) => set("customer", v)} placeholder="בחר לקוח" options={customerOptions} /></Field>
            <Field label="סוג פריט"><Select value={form.itemType} onChange={(v) => set("itemType", v)} placeholder="בחר סוג" options={itemTypeOptions} /></Field>
            <Field label="מסלול בדיקה"><Select value={form.routeNumber} onChange={(v) => set("routeNumber", v)} placeholder="בחר מסלול" options={routeOptions} disabled={!form.itemType} /></Field>
            <Field label="מס׳ סיריאלי"><input className="shx-input" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} placeholder="לדוגמה: 88312" style={{ fontVariantNumeric: "tabular-nums" }} /></Field>
            <Field label="מק״ט"><input className="shx-input" value={form.makat} onChange={(e) => set("makat", e.target.value)} placeholder="לדוגמה: 4567" style={{ fontVariantNumeric: "tabular-nums" }} /></Field>
            <Field label="דגם"><input className="shx-input" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="תיאור הדגם" /></Field>
            <Field label="יצרן"><input className="shx-input" value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} placeholder="שם היצרן" /></Field>
            <Field label="מס׳ יצרן"><input className="shx-input" value={form.manufacturerNo} onChange={(e) => set("manufacturerNo", e.target.value)} placeholder="מס׳ יצרן" /></Field>
          </div>

          {/* sub-items */}
          <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>פריטים מחוברים</div>
              <button
                className="shx-btn shx-btn-secondary"
                style={{ padding: "7px 13px", fontSize: 13, color: "#0066cc", borderColor: "#cfe0f5" }}
                onClick={() => setSubs((s) => [...s, { itemType: "", serialNumber: "", makat: "", model: "", manufacturer: form.manufacturer, manufacturerNo: form.manufacturerNo }])}
              >
                <Plus size={15} strokeWidth={2} />הוסף פריט מחובר
              </button>
            </div>
            {subs.map((sub, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12, padding: 14, border: "1px solid #e0e0e0", borderRadius: 12, background: "#fafafc" }}>
                <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Select value={sub.itemType} onChange={(v) => setSubs((s) => s.map((x, j) => j === i ? { ...x, itemType: v } : x))} placeholder="סוג פריט" options={itemTypeOptions} />
                  <input className="shx-input" placeholder="מס׳ סיריאלי" value={sub.serialNumber} onChange={(e) => setSubs((s) => s.map((x, j) => j === i ? { ...x, serialNumber: e.target.value } : x))} />
                  <input className="shx-input" placeholder="מק״ט" value={sub.makat} onChange={(e) => setSubs((s) => s.map((x, j) => j === i ? { ...x, makat: e.target.value } : x))} />
                  <input className="shx-input" placeholder="דגם" value={sub.model} onChange={(e) => setSubs((s) => s.map((x, j) => j === i ? { ...x, model: e.target.value } : x))} />
                </div>
                <button onClick={() => setSubs((s) => s.filter((_, j) => j !== i))} aria-label="הסר" style={{ width: 36, height: 36, flexShrink: 0, border: 0, borderRadius: 8, background: "transparent", color: "#7a7a7a", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  onMouseEnter={(e) => { const t = e.currentTarget; t.style.background = "rgba(191,53,53,0.08)"; t.style.color = "#bf3535"; }}
                  onMouseLeave={(e) => { const t = e.currentTarget; t.style.background = "transparent"; t.style.color = "#7a7a7a"; }}
                >
                  <Trash2 size={17} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ---- footer ---- */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderTop: "1px solid #e0e0e0", background: "#fafafc" }}>
          <div style={{ flex: 1 }} />
          <button className="shx-btn shx-btn-secondary" onClick={onClose}>ביטול</button>
          <button className="shx-btn shx-btn-primary" disabled={!valid} onClick={() => onSubmit(form, subs)}>
            {batchTotal > 0 ? `הוסף פריט (${batchIndex}/${batchTotal})` : "הוסף פריט"}
          </button>
        </div>
      </div>
      <style>{`@keyframes shx-shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }`}</style>
    </div>
  );
}

/* ---- small building blocks ---- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>{label}</label>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, placeholder, disabled }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder: string; disabled?: boolean }) {
  return (
    <div style={{ position: "relative" }}>
      <select
        className="shx-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ appearance: "none", WebkitAppearance: "none", paddingInlineEnd: 34, color: value ? "#1d1d1f" : "#9a9aa0", cursor: disabled ? "not-allowed" : "pointer", background: disabled ? "#f5f5f7" : "#fff" }}
      >
        <option value="" disabled>{placeholder}</option>
        {options.map((o) => <option key={o.value} value={String(o.value)} style={{ color: "#1d1d1f" }}>{o.label}</option>)}
      </select>
      <span style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#7a7a7a", display: "flex" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </span>
    </div>
  );
}
