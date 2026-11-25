"use client";
import { DEFAULT_ROUTE_NUMBER } from "@/app/lib/packages/template-wire";
import { NO_CONNECTION_TEXT, failureText } from "@/app/components/failureText";
import React from "react";
import { Info, Trash2, Plus } from "lucide-react";
import { isAtOpening, type PackageView } from "@/app/lib/packages/contract";
import { useItemTypes } from "@/app/components/lookups";
import type { ItemTypeLite } from "@/app/lib/lookups/contract";
import { addBoxItem, canAddBoxItem, memberTypesOf, patchBox } from "./data";
import { ApiError } from "@/lib/api/client";
import { deleteItem } from "@/app/lib/items/edit";
import { SearchableCombobox } from "@/components/ui";
import IdText from "@/app/components/IdText";
import LastItemDialog from "./LastItemDialog";
import { ArtboardDialog, ArtboardDialogHeader } from "@/components/ui/ArtboardDialog";
import { HAIR, HAIR_2, INK_2, MUTED, RED } from "@/components/ui/colors";
import { seq2 } from "@/app/lib/packages/ids";

/**
 * עריכת מארז — design/Package Dialogs.dc.html ("edit"). Type, route,
 * customer and shipment are locked (PLAN.md §4); makat / model / manufacturer
 * are open. Items can be removed (never the last one) and, while the box is
 * still at its opening step, added.
 */
/** An added item starts with the box's details (its shipment certificate's);
 *  only its type and serial are required. */
const blankAdd = (pkg: PackageView | null) => ({
  itemType: "", serialNumber: "",
  makat: pkg?.makat?.trim() ?? "", model: pkg?.model?.trim() ?? "", manufacturer: pkg?.manufacturer_name?.trim() ?? "",
});

/** Hoisted (not defined inside the dialog) so its inputs keep focus across re-renders.
 *  Locked fields are the selection fields fixed at intake, so they are the
 *  locked combobox rather than a text box. */
function Field({ label, value, locked, hint, onChange, weight = 400, code }: { label: string; value: string; locked?: boolean; hint?: string | null; onChange?: (v: string) => void; weight?: number; code?: boolean }) {
  const id = React.useId();
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, color: MUTED, marginBottom: 6 };
  return (
    <div>
      {locked ? <div style={labelStyle}>{label}</div> : <label htmlFor={id} style={labelStyle}>{label}</label>}
      {locked ? (
        <SearchableCombobox<{ label: string }> dense locked options={[]} value={value ? { label: value } : null} onChange={() => {}} placeholder="—" />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange?.(e.target.value)} dir={code ? "ltr" : undefined}
          className={code ? "pkg-field pkg-field--code" : "pkg-field"} style={{ fontWeight: weight }} />
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
  const [addOpen, setAddOpen] = React.useState(false);
  const [add, setAdd] = React.useState(() => blankAdd(pkg));
  const [adding, setAdding] = React.useState(false);
  // A failed load leaves the add-item type list empty, with no message (P49).
  const itemTypes = useItemTypes();

  // Opening, or the box reloaded from the server, seeds the form from it. Done
  // during render.
  const [seeded, setSeeded] = React.useState<{ open: boolean; pkg: PackageView | null }>({ open: false, pkg: null });
  if (seeded.open !== open || seeded.pkg !== pkg) {
    setSeeded({ open, pkg });
    if (open && pkg) {
      setMakat(pkg.makat ?? ""); setModel(pkg.model ?? ""); setManufacturer(pkg.manufacturer_name ?? "");
      setError(null); setAddOpen(false); setAdd(blankAdd(pkg));
    }
  }

  if (!open || !pkg) return null;

  const opening = isAtOpening(pkg);
  const memberTypes = memberTypesOf(itemTypes.data ?? []);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await patchBox(pkg.item_id, { makat, model, manufacturer });
      onChanged();
      onClose();
    } catch (e) {
      setError(failureText(e, "שמירת המארז נכשלה", NO_CONNECTION_TEXT));
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (it: PackageView["items"][number]) => {
    if (pkg.items.length === 1) { setLastItem(it); return; }
    setRemoving(it.item_id); setError(null);
    try {
      await deleteItem(it.item_id);
      onChanged();
    } catch (e) {
      // The server refuses to empty a box: its last item goes only with the box.
      if (e instanceof ApiError && e.status === 409 && e.body.code === "LAST_PACKAGE_ITEM") setLastItem(it);
      else setError(failureText(e, "הסרת הפריט נכשלה", NO_CONNECTION_TEXT));
    } finally {
      setRemoving(null);
    }
  };

  const addItem = async () => {
    if (!canAddBoxItem(add.itemType, add.serialNumber)) {
      setError("להוספת פריט יש למלא סוג וסריאלי"); return;
    }
    setAdding(true); setError(null);
    try {
      await addBoxItem(pkg.item_id, { itemType: Number(add.itemType), serialNumber: add.serialNumber, makat: add.makat, model: add.model, manufacturer: add.manufacturer });
      setAdd(blankAdd(pkg)); setAddOpen(false);
      onChanged();
    } catch (e) {
      setError(failureText(e, "הוספת הפריט נכשלה", NO_CONNECTION_TEXT));
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <ArtboardDialog open onClose={onClose} busy={saving} width="min(680px, 94vw)">
        <ArtboardDialogHeader title="עריכת מארז" onClose={onClose} subtitle={<div style={{ marginTop: 5 }}><IdText id={pkg.item_id} size={14} /></div>} />

        <div className="pkg-dlg-body" style={{ paddingBlock: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
            <Field label="סוג מארז" value={pkg.item_type_desc} locked hint="נקבע בקליטה" weight={600} />
            <Field label="מסלול המארז" value={`מסלול ${pkg.route_number ?? DEFAULT_ROUTE_NUMBER}`} locked hint="נקבע בקליטה" weight={600} />
            <Field label="לקוח" value={pkg.customer_name ?? pkg.customer_code ?? ""} locked hint="נקבע במשלוח" weight={600} />
            <Field label="משלוח" value={pkg.shipment_code ?? String(pkg.shipment_id)} locked weight={600} />
            <Field label="מק״ט" value={makat} onChange={setMakat} code />
            <Field label="דגם" value={model} onChange={setModel} hint="אופציונלי" />
            <Field label="יצרן" value={manufacturer} onChange={setManufacturer} hint="אופציונלי" />
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--color-canvas-parchment)", borderRadius: 12, padding: "14px 16px", marginTop: 20 }}>
            <span style={{ color: MUTED, marginTop: 1, display: "inline-flex" }}><Info size={18} strokeWidth={1.75} aria-hidden /></span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>סוג המארז אינו ניתן לשינוי</div>
              <div style={{ fontSize: 13, color: INK_2, marginTop: 3, lineHeight: 1.5 }}>סוג המארז קובע את התכולה שנפרשה בקליטה ואת המסלול של כל פריט. כדי לשנות אותו מחק את המארז וקלוט אותו מחדש מהמשלוח.</div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>תכולת המארז</div>
            <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden", marginTop: 11 }}>
              {pkg.items.map((it) => {
                const last = pkg.items.length === 1;
                const removeLabel = last ? "לא ניתן להסיר את הפריט האחרון" : `הסר את ${seq2(it.package_seq)} · ${it.item_type_desc}`;
                return (
                  <div key={it.item_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: `1px solid ${HAIR_2}` }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--color-canvas-parchment)", color: MUTED, fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{seq2(it.package_seq)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.item_type_desc}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "nowrap" }}>{it.state_label}</div>
                    {/* The last item's trash still answers — it explains why it can't go. */}
                    <button type="button" title={removeLabel} aria-label={removeLabel} disabled={removing === it.item_id} onClick={() => removeItem(it)}
                      className={last ? "pkg-iconbtn pkg-iconbtn--trash pkg-iconbtn--muted" : "pkg-iconbtn pkg-iconbtn--trash"}>
                      <Trash2 size={15} strokeWidth={1.75} aria-hidden />
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
                  <SearchableCombobox<ItemTypeLite>
                    dense
                    options={memberTypes}
                    value={memberTypes.find((t) => String(t.item_type_id) === add.itemType) ?? null}
                    onChange={(t) => setAdd({ ...add, itemType: t ? String(t.item_type_id) : "" })}
                    getOptionLabel={(t) => t.item_type_desc}
                    isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                    placeholder="סוג פריט…"
                  />
                  <input placeholder="מספר סריאלי" aria-label="מספר סריאלי" dir="ltr" value={add.serialNumber} onChange={(e) => setAdd({ ...add, serialNumber: e.target.value })} className="pkg-field pkg-field--code" />
                  <input placeholder="מק״ט" aria-label="מק״ט" dir="ltr" value={add.makat} onChange={(e) => setAdd({ ...add, makat: e.target.value })} className="pkg-field pkg-field--code" />
                  <input placeholder="דגם" aria-label="דגם" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} className="pkg-field" />
                  <input placeholder="יצרן" aria-label="יצרן" value={add.manufacturer} onChange={(e) => setAdd({ ...add, manufacturer: e.target.value })} className="pkg-field" />
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" onClick={() => setAddOpen(false)} className="pkg-pill pkg-pill--ghost" style={{ padding: "9px 16px" }}>ביטול</button>
                    <button type="button" onClick={addItem} disabled={adding} aria-busy={adding || undefined} className="pkg-pill pkg-pill--primary" style={{ padding: "9px 18px" }}>הוסף</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setAddOpen(true)} className="pkg-link pkg-link--hit" style={{ marginTop: 2, gap: 7, fontSize: 13.5 }}>
                  <Plus size={15} strokeWidth={2} aria-hidden />הוסף פריט
                </button>
              )
            ) : (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>הוספת פריטים אפשרית רק בזמן פתיחת המארז.</div>
            )}
          </div>

          {error && <div role="alert" style={{ marginTop: 14, fontSize: 13, color: RED }}>{error}</div>}
        </div>

        <div className="pkg-dlg-foot">
          <button type="button" onClick={onDeleteRequest} className="pkg-pill pkg-pill--ghost pkg-pill--danger-text" style={{ padding: "11px 18px" }}>מחיקת מארז</button>
          <div className="pkg-dlg-foot-actions">
            <button type="button" onClick={onClose} disabled={saving} className="pkg-pill pkg-pill--ghost" style={{ padding: "11px 20px" }}>ביטול</button>
            <button type="button" onClick={save} disabled={saving} aria-busy={saving || undefined} className="pkg-pill pkg-pill--primary" style={{ padding: "11px 24px", fontSize: 15 }}>שמור שינויים</button>
          </div>
        </div>
      </ArtboardDialog>

      <LastItemDialog open={lastItem != null} item={lastItem} onClose={() => setLastItem(null)} onDeletePackage={() => { setLastItem(null); onDeleteRequest(); }} />
    </>
  );
}
