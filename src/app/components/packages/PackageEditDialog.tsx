"use client";
import React from "react";
import { X, Info, Trash2, Plus } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageIdText from "./PackageIdText";
import LastItemDialog from "./LastItemDialog";
import { DIALOG_Z, BLUE, HAIR, HAIR_2, INK, INK_2, MUTED, MUTED_LT, RED, SHADOW, fieldInput, overlay, pillGhost, pillPrimary, seq2 } from "./packageUi";

/**
 * עריכת מארז — design/Package Dialogs.dc.html ("edit"). Type, route,
 * customer and shipment are locked (PLAN.md §4); makat / model / manufacturer
 * are open. Items can be removed (never the last one) and, while the box is
 * still at its opening step, added.
 */
type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };

/** Hoisted (not defined inside the dialog) so its inputs keep focus across re-renders.
 *  Locked fields are the selection fields fixed at intake, so they are the
 *  locked combobox rather than a text box. */
function Field({ label, value, locked, hint, onChange, weight = 400 }: { label: string; value: string; locked?: boolean; hint?: string | null; onChange?: (v: string) => void; weight?: number }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>{label}</div>
      {locked ? (
        <SearchableCombobox<{ label: string }> dense locked options={[]} value={value ? { label: value } : null} onChange={() => {}} placeholder="—" />
      ) : (
        <input value={value} onChange={(e) => onChange?.(e.target.value)} style={{ ...fieldInput, fontWeight: weight }} />
      )}
      {hint && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

export default function PackageEditDialog({
  open, pkg, onClose, onChanged, onDeleteRequest,
}: {
  open: boolean;
  pkg: PackageView | null;
  onClose: () => void;
  /** Something changed on the server — reload. */
  onChanged: () => void;
  onDeleteRequest: () => void;
}) {
  const [makat, setMakat] = React.useState("");
  const [model, setModel] = React.useState("");
  const [manufacturer, setManufacturer] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastItem, setLastItem] = React.useState<PackageView["items"][number] | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [add, setAdd] = React.useState({ itemType: "", serialNumber: "", makat: "", model: "", manufacturer: "" });
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    if (!open || !pkg) return;
    setMakat(pkg.makat ?? ""); setModel(pkg.model ?? ""); setManufacturer(pkg.manufacturer_name ?? "");
    setError(null); setAddOpen(false); setAdd({ itemType: "", serialNumber: "", makat: "", model: "", manufacturer: "" });
    apiFetch("/api/itemTypes").then((r) => (r.ok ? r.json() : [])).then((d) => setItemTypes(Array.isArray(d) ? d : [])).catch(() => setItemTypes([]));
  }, [open, pkg]);

  if (!open || !pkg) return null;

  const opening = (pkg.current_route_step ?? 1) <= 1 && !pkg.is_finished && (pkg.status === "queue" || pkg.status === "test");
  const memberTypes = itemTypes.filter((t) => !t.is_package);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await apiFetch(`/api/packages/${pkg.item_id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makat, model, manufacturer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "שמירת המארז נכשלה"); return; }
      onChanged();
      onClose();
    } catch {
      setError("שגיאה בתקשורת");
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (it: PackageView["items"][number]) => {
    if (pkg.items.length === 1) { setLastItem(it); return; }
    setRemoving(it.item_id); setError(null);
    try {
      const res = await apiFetch(`/api/items/${it.item_id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.code === "LAST_PACKAGE_ITEM") { setLastItem(it); return; }
      if (!res.ok) { setError(data?.error || "הסרת הפריט נכשלה"); return; }
      onChanged();
    } catch {
      setError("שגיאה בתקשורת");
    } finally {
      setRemoving(null);
    }
  };

  const addItem = async () => {
    if (!add.itemType || !add.serialNumber.trim() || !add.makat.trim() || !add.model.trim() || !add.manufacturer.trim()) {
      setError("להוספת פריט יש למלא סוג, סריאלי, מק״ט, דגם ויצרן"); return;
    }
    setAdding(true); setError(null);
    try {
      const res = await apiFetch(`/api/packages/${pkg.item_id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: Number(add.itemType), serialNumber: add.serialNumber, makat: add.makat, model: add.model, manufacturer: add.manufacturer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "הוספת הפריט נכשלה"); return; }
      setAdd({ itemType: "", serialNumber: "", makat: "", model: "", manufacturer: "" }); setAddOpen(false);
      onChanged();
    } catch {
      setError("שגיאה בתקשורת");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div onClick={() => !saving && onClose()} style={{ ...overlay, zIndex: DIALOG_Z - 10 }}>
        <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(680px, 94vw)", maxHeight: "92vh", background: "#fff", borderRadius: 18, boxShadow: SHADOW, display: "flex", flexDirection: "column", overflow: "hidden", color: INK }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 24px", borderBottom: `1px solid ${HAIR}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>עריכת מארז</div>
              <div style={{ marginTop: 5 }}><PackageIdText id={pkg.item_id} size={14} /></div>
            </div>
            <button type="button" onClick={onClose} style={{ width: 34, height: 34, border: 0, borderRadius: 9999, background: "#f5f5f7", color: INK, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
              <Field label="סוג מארז" value={pkg.item_type_desc} locked hint="נקבע בקליטה" weight={600} />
              <Field label="מסלול המארז" value={`מסלול ${pkg.route_number ?? 1}`} locked hint="נקבע בקליטה" weight={600} />
              <Field label="לקוח" value={pkg.customer_name ?? pkg.customer_code ?? ""} locked hint="נקבע במשלוח" weight={600} />
              <Field label="משלוח" value={pkg.shipment_code ?? String(pkg.shipment_id)} locked weight={600} />
              <Field label="מק״ט" value={makat} onChange={setMakat} />
              <Field label="דגם" value={model} onChange={setModel} hint="אופציונלי" />
              <Field label="יצרן" value={manufacturer} onChange={setManufacturer} hint="אופציונלי" />
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#f5f5f7", borderRadius: 12, padding: "14px 16px", marginTop: 20 }}>
              <span style={{ color: MUTED, marginTop: 1, display: "inline-flex" }}><Info size={18} strokeWidth={1.75} /></span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>סוג המארז אינו ניתן לשינוי</div>
                <div style={{ fontSize: 13, color: INK_2, marginTop: 3, lineHeight: 1.5 }}>סוג המארז קובע את התכולה שנפרשה בקליטה ואת המסלול של כל פריט. כדי לשנות אותו מחק את המארז וקלוט אותו מחדש מהמשלוח.</div>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>תכולת המארז</div>
              <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden", marginTop: 11 }}>
                {pkg.items.map((it) => {
                  const last = pkg.items.length === 1;
                  return (
                    <div key={it.item_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: `1px solid ${HAIR_2}` }}>
                      <span style={{ width: 28, height: 28, borderRadius: 8, background: "#f5f5f7", color: MUTED, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{seq2(it.package_seq)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.item_type_desc}</div>
                        <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}</div>
                      </div>
                      <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap" }}>{it.state_label}</div>
                      <button type="button" title={last ? "לא ניתן להסיר את הפריט האחרון" : "הסר פריט"} disabled={removing === it.item_id} onClick={() => removeItem(it)}
                        style={{ width: 30, height: 30, borderRadius: 8, background: "#f5f5f7", color: last ? "#c4c4cc" : MUTED, border: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <Trash2 size={15} strokeWidth={1.75} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 9 }}>אפשר להוסיף ולהסיר פריטים. מארז חייב להכיל פריט אחד לפחות.</div>

              {opening ? (
                addOpen ? (
                  <div style={{ marginTop: 12, border: `1px solid ${HAIR}`, borderRadius: 12, padding: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    {/* The inputs take the field height (44) so they line up with the type field. */}
                    <SearchableCombobox<ItemTypeOption>
                      dense
                      options={memberTypes}
                      value={memberTypes.find((t) => String(t.item_type_id) === add.itemType) ?? null}
                      onChange={(t) => setAdd({ ...add, itemType: t ? String(t.item_type_id) : "" })}
                      getOptionLabel={(t) => t.item_type_desc}
                      isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                      placeholder="סוג פריט…"
                    />
                    <input placeholder="מספר סריאלי" value={add.serialNumber} onChange={(e) => setAdd({ ...add, serialNumber: e.target.value })} style={fieldInput} />
                    <input placeholder="מק״ט" value={add.makat} onChange={(e) => setAdd({ ...add, makat: e.target.value })} style={fieldInput} />
                    <input placeholder="דגם" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} style={fieldInput} />
                    <input placeholder="יצרן" value={add.manufacturer} onChange={(e) => setAdd({ ...add, manufacturer: e.target.value })} style={fieldInput} />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" onClick={() => setAddOpen(false)} style={{ ...pillGhost, padding: "9px 16px" }}>ביטול</button>
                      <button type="button" onClick={addItem} disabled={adding} style={{ ...pillPrimary, padding: "9px 18px" }}>הוסף</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddOpen(true)} style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: BLUE, background: "transparent", border: 0, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                    <Plus size={15} strokeWidth={2} />הוסף פריט
                  </button>
                )
              ) : (
                <div style={{ fontSize: 12, color: MUTED_LT, marginTop: 6 }}>הוספת פריטים אפשרית רק בזמן פתיחת המארז.</div>
              )}
            </div>

            {error && <div style={{ marginTop: 14, fontSize: 13, color: RED }}>{error}</div>}
          </div>

          <div style={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={onDeleteRequest} style={{ ...pillGhost, color: RED }}>מחיקת מארז</button>
            <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" onClick={onClose} disabled={saving} style={{ ...pillGhost, padding: "11px 20px" }}>ביטול</button>
              <button type="button" onClick={save} disabled={saving} style={{ ...pillPrimary, padding: "11px 24px", fontSize: 15, opacity: saving ? 0.7 : 1 }}>שמור שינויים</button>
            </div>
          </div>
        </div>
      </div>

      <LastItemDialog open={lastItem != null} item={lastItem} onClose={() => setLastItem(null)} onDeletePackage={() => { setLastItem(null); onDeleteRequest(); }} />
    </>
  );
}
