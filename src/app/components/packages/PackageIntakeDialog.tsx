"use client";
import React from "react";
import { Lock, Trash2, Plus, CircleAlert, Check } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { DialogTitle, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageLabelsDialog from "./PackageLabelsDialog";
import { PackageDialog } from "./PackageDialog";
import {
  BLUE, HAIR, HAIR_2, INK, INK_2, MUTED, RED, RED_BG, AMBER_INK, AMBER_BG, AMBER_BORDER,
  fmtId, seq2,
} from "./packageUi";

/**
 * קליטת מארז — design/Packages.dc.html (intake dialog, 1200px). Four steps in
 * one dialog: shipment + package type → package fields → items (serials) →
 * labels. One POST /api/packages creates the box and its items; the ids are
 * minted by the server (docs/packages/PLAN.md §6).
 */

type Shipment = {
  id: number; shipment_code: string; customer_id: number; customer_code?: string | null; customer_name?: string | null;
  makat?: string | null; is_sent?: boolean | null; source_id?: number | null;
  shipment_items?: { item_type_id: number; quantity: number; item_type_desc?: string | null }[] | null;
};
type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };
type Declared = { item_type_id: number; item_type_desc: string; total_quantity: number; sample_count: number };
type Route = { item_type_id: number; route_number: number; route_steps: number[] };
type ContentsLine = {
  item_type_id: number; item_type_desc: string; quantity: number;
  makat: string | null; model: string | null; manufacturer_name: string | null; manufacturer_no: string | null;
  route_number: number;
};
type Contents = { default_route_number: number | null; lines: ContentsLine[] };
type RouteOption = { value: string; label: string };
const routeOption = (n: number | string): RouteOption => ({ value: String(n), label: `מסלול ${n}` });

type Row = {
  key: number;
  itemType: number | "";
  typeDesc: string;
  fromTemplate: boolean;
  serial: string;
  makat: string;
  model: string;
  manufacturer: string;
  manufacturerNo: string;
  /** "" = the template default / route 1. */
  route: string;
  templateRoute: number | null;
  open: boolean;
};

const STEPS = [
  { key: "shipment", label: "משלוח וסוג מארז" },
  { key: "details", label: "פרטי המארז" },
  { key: "items", label: "פריטים במארז" },
  { key: "labels", label: "מדבקות" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

let rowKey = 1;

/** A field label tied to its input. */
function FieldLabel({ htmlFor, children, small }: { htmlFor?: string; children: React.ReactNode; small?: boolean }) {
  const style: React.CSSProperties = { display: "block", fontSize: small ? 11.5 : 12.5, color: MUTED, marginBottom: small ? 5 : 6 };
  return htmlFor ? <label htmlFor={htmlFor} style={style}>{children}</label> : <div style={style}>{children}</div>;
}

export default function PackageIntakeDialog({
  open, onClose, onCreated, initialShipmentId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (packageId: number) => void;
  initialShipmentId?: number | null;
}) {
  const [step, setStep] = React.useState<StepKey>("shipment");
  const [shipments, setShipments] = React.useState<Shipment[]>([]);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [routes, setRoutes] = React.useState<Route[]>([]);
  const [shipmentId, setShipmentId] = React.useState<number | "">("");
  const [declared, setDeclared] = React.useState<Declared[]>([]);
  const [packageType, setPackageType] = React.useState<number | "">("");
  const [contents, setContents] = React.useState<Contents | null>(null);
  const [routeNumber, setRouteNumber] = React.useState("");
  const [makat, setMakat] = React.useState("");
  const [model, setModel] = React.useState("");
  const [manufacturer, setManufacturer] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<{ rowIndex: number | null; text: string } | null>(null);
  const [labelsFor, setLabelsFor] = React.useState<{ packageId: number; itemIds: number[] } | null>(null);
  const serialRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const uid = React.useId();

  const shipment = shipments.find((s) => s.id === shipmentId) ?? null;
  const packageTypeDesc = itemTypes.find((t) => t.item_type_id === packageType)?.item_type_desc ?? "";
  const packageRoutes = routes.filter((r) => r.item_type_id === packageType).map((r) => r.route_number).sort((a, b) => a - b);
  const memberTypes = itemTypes.filter((t) => !t.is_package);

  // --- data --------------------------------------------------------------
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [sh, ty, rt] = await Promise.all([
        apiFetch("/api/shipments").then((r) => (r.ok ? r.json() : [])).catch(() => []),
        apiFetch("/api/itemTypes").then((r) => (r.ok ? r.json() : [])).catch(() => []),
        apiFetch("/api/testing-routes").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      if (cancelled) return;
      setShipments((Array.isArray(sh) ? sh : []).filter((s: Shipment) => !s.is_sent));
      setItemTypes(Array.isArray(ty) ? ty : []);
      setRoutes(Array.isArray(rt) ? rt : []);
    })();
    setStep("shipment"); setShipmentId(initialShipmentId ?? ""); setPackageType(""); setContents(null); setRows([]);
    setRouteNumber(""); setMakat(""); setModel(""); setManufacturer(""); setError(null); setLabelsFor(null);
    return () => { cancelled = true; };
  }, [open, initialShipmentId]);

  React.useEffect(() => {
    if (shipmentId === "") { setDeclared([]); return; }
    let cancelled = false;
    apiFetch(`/api/shipments/${shipmentId}/items`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      if (cancelled) return;
      setDeclared(Array.isArray(d) ? d : []);
    }).catch(() => setDeclared([]));
    const s = shipments.find((x) => x.id === shipmentId);
    if (s?.makat) setMakat(String(s.makat));
    return () => { cancelled = true; };
  }, [shipmentId, shipments]);

  const expandTemplate = React.useCallback((c: Contents | null): Row[] => {
    if (!c) return [];
    const out: Row[] = [];
    for (const l of c.lines) {
      for (let i = 0; i < Math.max(1, l.quantity); i++) {
        out.push({
          key: rowKey++, itemType: l.item_type_id, typeDesc: l.item_type_desc, fromTemplate: true, serial: "",
          makat: l.makat ?? "", model: l.model ?? "", manufacturer: l.manufacturer_name ?? "", manufacturerNo: l.manufacturer_no ?? "",
          route: "", templateRoute: l.route_number, open: false,
        });
      }
    }
    return out;
  }, []);

  React.useEffect(() => {
    if (packageType === "") { setContents(null); setRows([]); return; }
    let cancelled = false;
    apiFetch(`/api/settings/item-types/${packageType}/contents`).then((r) => (r.ok ? r.json() : null)).then((c: Contents | null) => {
      if (cancelled) return;
      setContents(c);
      setRows(expandTemplate(c));
      setRouteNumber(c?.default_route_number != null ? String(c.default_route_number) : "");
    }).catch(() => { setContents(null); setRows([]); });
    return () => { cancelled = true; };
  }, [packageType, expandTemplate]);

  if (!open) return null;

  // --- derived ----------------------------------------------------------
  const templateCount = contents ? contents.lines.reduce((n, l) => n + Math.max(1, l.quantity), 0) : 0;
  const filled = rows.filter((r) => r.serial.trim() !== "").length;
  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const declaredPackages = declared.filter((d) => itemTypes.find((t) => t.item_type_id === d.item_type_id)?.is_package);
  const routeLabel = (r: Row) => (r.route !== "" ? `מסלול ${r.route}` : r.templateRoute && r.templateRoute !== 1 ? `מסלול ${r.templateRoute}` : "ברירת מחדל 1");
  const routesOfType = (t: number | "") => routes.filter((x) => x.item_type_id === t).map((x) => x.route_number).sort((a, b) => a - b);

  const canNext = step === "shipment" ? shipmentId !== "" && packageType !== "" : step === "details" ? true : step === "items" ? rows.length > 0 : false;

  const patchRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => rs.concat([{ key: rowKey++, itemType: "", typeDesc: "", fromTemplate: false, serial: "", makat: "", model: "", manufacturer: "", manufacturerNo: "", route: "", templateRoute: null, open: true }]));

  const goNext = () => { if (!canNext) return; setError(null); if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key); };
  const goBack = () => { setError(null); if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key); };

  const validate = (): boolean => {
    if (!shipment || packageType === "") { setStep("shipment"); setError({ rowIndex: null, text: "יש לבחור משלוח וסוג מארז" }); return false; }
    if (rows.length === 0) { setStep("items"); setError({ rowIndex: null, text: "מארז חייב להכיל פריט אחד לפחות" }); return false; }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.itemType === "") { setStep("items"); setError({ rowIndex: i, text: `שורה ${i + 1} · יש לבחור סוג פריט` }); return false; }
      if (!r.serial.trim()) { setStep("items"); setError({ rowIndex: i, text: `שורה ${i + 1} · חסר מספר סריאלי` }); serialRefs.current[i]?.focus(); return false; }
      if (!r.makat.trim() || !r.model.trim() || !r.manufacturer.trim()) {
        setStep("items"); patchRow(i, { open: true }); setError({ rowIndex: i, text: `שורה ${i + 1} · יש למלא מק״ט, דגם ויצרן בפרטים` }); return false;
      }
    }
    return true;
  };

  const save = async (after: "close" | "another" | "labels") => {
    if (!validate() || !shipment) return;
    setSaving(true); setError(null);
    try {
      const res = await apiFetch("/api/packages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: shipment.customer_id, shipment: shipment.id, packageType,
          routeNumber: routeNumber === "" ? null : Number(routeNumber),
          makat, model, manufacturer,
          items: rows.map((r) => ({
            itemType: r.itemType, serialNumber: r.serial.trim(), makat: r.makat.trim(), model: r.model.trim(), manufacturer: r.manufacturer.trim(),
            manufacturerNo: r.manufacturerNo.trim() || null,
            routeNumber: r.route !== "" ? Number(r.route) : null,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text: string = data?.error || "יצירת המארז נכשלה";
        // The server names the item type of the row whose route does not
        // fit; find it so the banner can say which row.
        let rowIndex: number | null = typeof data?.itemIndex === "number" ? data.itemIndex : null;
        if (rowIndex == null && data?.code === "ITEM_ROUTE_SHAPE") {
          const desc = text.split(":")[0]?.trim();
          rowIndex = rows.findIndex((r) => r.typeDesc === desc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc === desc);
          if (rowIndex < 0) rowIndex = null;
        }
        if (data?.code === "ITEM_ROUTE_SHAPE" || rowIndex != null) setStep("items");
        setError({ rowIndex, text: rowIndex != null ? `שורה ${rowIndex + 1} · ${text.includes(":") ? text.split(":").slice(1).join(":").trim() : text}` : text });
        return;
      }
      const packageId: number = data.packageId;
      const itemIds: number[] = data.itemIds ?? [];
      onCreated(packageId);
      if (after === "labels") { setLabelsFor({ packageId, itemIds }); return; }
      if (after === "another") {
        setRows(expandTemplate(contents)); setStep("details"); setError(null);
        return;
      }
      onClose();
    } catch {
      setError({ rowIndex: null, text: "שגיאה בתקשורת" });
    } finally {
      setSaving(false);
    }
  };

  const sidebarSummary = shipment
    ? `${shipment.shipment_code} · ${rows.length} פריטים · ${filled} סריאליים הוזנו`
    : "בחר משלוח וסוג מארז";

  const labelItems = labelsFor ? rows.map((r, i) => ({ item_id: labelsFor.itemIds[i] ?? "", package_seq: i + 1, item_type_desc: r.typeDesc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc || "פריט", serial_no: r.serial })) : [];
  const stepHeading: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" };

  return (
    <>
      <PackageDialog open onClose={onClose} busy={saving} width="min(1200px, calc(100vw - 48px))" height="min(760px, 92vh)" fullScreenBelow760>
        <div className="pkg-wiz">
          {/* Sidebar */}
          <div className="pkg-wiz-rail" style={{ width: 288, padding: "22px 20px" }}>
            <div data-drag-handle="">
              <DialogTitle style={{ padding: 0, display: "block" }}>קליטת מארז</DialogTitle>
              <div className="pkg-wiz-sub" style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>המארז והפריטים נוצרים יחד בשמירה אחת.</div>
            </div>
            <nav aria-label="שלבי הקליטה" className="pkg-wiz-steps" style={{ marginTop: 22 }}>
              {STEPS.map((s, i) => {
                const active = s.key === step;
                const done = i < stepIdx;
                const note = s.key === "shipment" ? (shipment ? `${shipment.shipment_code} · ${packageTypeDesc || "בחר סוג מארז"}` : "בחר משלוח וסוג")
                  : s.key === "details" ? "מסלול, מק״ט, דגם" : s.key === "items" ? "סריאלי לכל פריט" : "קופסה + פריטים";
                return (
                  <button key={s.key} type="button" aria-current={active ? "step" : undefined} onClick={() => { if (i <= stepIdx || canNext) setStep(s.key); }}
                    className="pkg-step" style={{ gap: 11, padding: "10px 11px" }}>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", background: active ? BLUE : done ? "var(--color-success-bg)" : "var(--color-canvas)", color: active ? "var(--color-on-primary)" : done ? "var(--color-success-ink)" : MUTED, fontSize: 12, fontWeight: 700, border: `1px solid ${active ? BLUE : HAIR}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {done ? <Check size={13} strokeWidth={2.5} aria-hidden /> : i + 1}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: active ? BLUE : INK }}>{s.label}{done && <span className="pkg-sr-only"> (הושלם)</span>}</span>
                      <span className="pkg-wiz-sub" style={{ display: "block", fontSize: 11.5, color: MUTED, marginTop: 2 }}>{note}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <div className="pkg-wiz-sub" style={{ marginTop: "auto", background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 12, padding: "13px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>המארז שייווצר</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 7 }}>{packageTypeDesc || "—"}</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{sidebarSummary}</div>
            </div>
          </div>

          {/* Content */}
          <div className="pkg-wiz-main">
            <div className="pkg-wiz-body">
              {step === "shipment" && (
                <>
                  <h3 style={stepHeading}>משלוח וסוג מארז</h3>
                  <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>בחר משלוח, ואז סוג מארז מתוך מה שהוצהר עליו.</div>
                  <div style={{ maxWidth: 420, marginTop: 18 }}>
                    <FieldLabel>משלוח</FieldLabel>
                    <SearchableCombobox<Shipment>
                      dense
                      options={shipments}
                      value={shipment}
                      onChange={(s) => { setShipmentId(s ? s.id : ""); setPackageType(""); }}
                      getOptionLabel={(s) => s.shipment_code}
                      getOptionSubtitle={(s) => s.customer_name ?? s.customer_code ?? null}
                      isOptionEqualToValue={(a, b) => a.id === b.id}
                      placeholder="בחר משלוח…"
                    />
                  </div>
                  {shipmentId !== "" && (
                    <>
                      <div style={{ fontSize: 12.5, color: MUTED, margin: "20px 0 8px" }}>מה הוצהר על המשלוח</div>
                      <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "var(--color-canvas-parchment)" }}>
                              <th className="pkg-th" style={{ paddingInline: 16 }}>סוג מארז</th>
                              <th className="pkg-th pkg-th--center">הוצהר</th>
                              <th className="pkg-th pkg-th--center">נקלט</th>
                              <th className="pkg-th pkg-th--center">נותר</th>
                              <th className="pkg-th" style={{ paddingInline: 16 }}><span className="pkg-sr-only">בחירה</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {declaredPackages.length === 0 && (
                              <tr><td colSpan={5} style={{ padding: "18px 16px", fontSize: 13.5, color: MUTED }}>על המשלוח הזה לא הוצהרו סוגי מארז.</td></tr>
                            )}
                            {declaredPackages.map((d) => {
                              const left = Math.max(0, Number(d.total_quantity) - Number(d.sample_count));
                              const picked = packageType === d.item_type_id;
                              const doneRow = left === 0;
                              return (
                                // Pick a declared type: Tab + Enter / Space, like a click.
                                <tr key={d.item_type_id} className="pkg-row" tabIndex={doneRow ? -1 : 0} aria-selected={picked} aria-disabled={doneRow || undefined}
                                  onClick={() => { if (!doneRow) setPackageType(d.item_type_id); }}
                                  onKeyDown={(e) => { if (!doneRow && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPackageType(d.item_type_id); } }}
                                  style={{ borderTop: `1px solid ${HAIR_2}` }}>
                                  <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600 }}>{d.item_type_desc}</td>
                                  <td style={{ padding: 12, fontSize: 14, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{d.total_quantity}</td>
                                  <td style={{ padding: 12, fontSize: 14, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{d.sample_count}</td>
                                  <td style={{ padding: 12, fontSize: 14, textAlign: "center", fontWeight: 600, color: doneRow ? MUTED : AMBER_INK, fontVariantNumeric: "tabular-nums" }}>{left}</td>
                                  <td style={{ padding: "12px 16px", textAlign: "end", fontSize: 13, fontWeight: 600, color: doneRow ? MUTED : BLUE, whiteSpace: "nowrap" }}>{doneRow ? "הושלם" : picked ? "נבחר" : "בחר"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {step === "details" && (
                <>
                  <h3 style={stepHeading}>פרטי המארז</h3>
                  <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>למארז אין מספר סריאלי. המזהה נוצר בשמירה ומסתיים ב-00.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, maxWidth: 660, marginTop: 20 }}>
                    <div>
                      <FieldLabel>מסלול המארז</FieldLabel>
                      <SearchableCombobox<RouteOption>
                        dense
                        options={packageRoutes.map(routeOption)}
                        value={routeNumber === "" ? null : routeOption(routeNumber)}
                        onChange={(o) => setRouteNumber(o ? o.value : "")}
                        isOptionEqualToValue={(a, b) => a.value === b.value}
                        placeholder={`מסלול ${contents?.default_route_number ?? 1} (ברירת מחדל)`}
                      />
                    </div>
                    <div>
                      <FieldLabel>סוג מארז</FieldLabel>
                      <SearchableCombobox<RouteOption> dense locked options={[]} value={{ value: String(packageType), label: packageTypeDesc }} onChange={() => {}} />
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>סוג המארז נקבע בקליטה ואינו ניתן לשינוי אחר כך.</div>
                    </div>
                    <div>
                      <FieldLabel htmlFor={`${uid}-makat`}>מק״ט</FieldLabel>
                      <input id={`${uid}-makat`} dir="ltr" value={makat} onChange={(e) => setMakat(e.target.value)} className="pkg-field pkg-field--code" />
                      {shipment?.makat && makat === String(shipment.makat) && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>מולא מהמשלוח</div>}
                    </div>
                    <div>
                      <FieldLabel htmlFor={`${uid}-model`}>דגם (אופציונלי)</FieldLabel>
                      <input id={`${uid}-model`} value={model} onChange={(e) => setModel(e.target.value)} className="pkg-field" />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`${uid}-mfr`}>יצרן (אופציונלי)</FieldLabel>
                      <input id={`${uid}-mfr`} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className="pkg-field" />
                    </div>
                    <div>
                      <FieldLabel>מספר סריאלי</FieldLabel>
                      <div className="pkg-field pkg-field--static">אין סריאלי למארז<Lock size={14} strokeWidth={1.75} aria-hidden /></div>
                    </div>
                  </div>
                </>
              )}

              {step === "items" && (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
                    <div>
                      <h3 style={stepHeading}>פריטים במארז</h3>
                      <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>השורות נפרשו מתכולת המארז. הקלד סריאלי ולחץ Enter למעבר לשורה הבאה.</div>
                    </div>
                    <div style={{ textAlign: "center", background: "var(--color-canvas-parchment)", borderRadius: 12, padding: "10px 18px", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{rows.length}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>פריטים במארז</div>
                    </div>
                  </div>
                  {contents && rows.length !== templateCount && (
                    <div style={{ marginTop: 14, fontSize: 12.5, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>
                      התבנית מצפה ל-{templateCount} פריטים, כרגע יש {rows.length}. אפשר לשמור — ההפרש יירשם בקליטה.
                    </div>
                  )}
                  <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--color-canvas-parchment)" }}>
                          <th className="pkg-th" style={{ paddingInline: 16, width: 48 }}>#</th>
                          <th className="pkg-th">סוג פריט</th>
                          <th className="pkg-th" style={{ width: 210 }}>מספר סריאלי</th>
                          <th className="pkg-th">מסלול</th>
                          <th className="pkg-th" style={{ width: 92 }}>פרטים</th>
                          <th className="pkg-th" style={{ paddingInline: 16, width: 52 }}><span className="pkg-sr-only">הסרה</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const typeName = r.typeDesc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc || `שורה ${i + 1}`;
                          const detailsId = `${uid}-row-${r.key}`;
                          return (
                          <React.Fragment key={r.key}>
                            <tr style={{ borderTop: `1px solid ${HAIR_2}`, background: error?.rowIndex === i ? RED_BG : "var(--color-canvas)" }}>
                              <td style={{ padding: "10px 16px", fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {r.fromTemplate ? (
                                    <>
                                      <span style={{ fontSize: 14, fontWeight: 600 }}>{r.typeDesc}</span>
                                      <Tag tone="neutral">מהתבנית</Tag>
                                    </>
                                  ) : (
                                    <div style={{ minWidth: 186 }}>
                                      <SearchableCombobox<ItemTypeOption>
                                        dense
                                        denseHeight={38}
                                        options={memberTypes}
                                        value={memberTypes.find((t) => t.item_type_id === r.itemType) ?? null}
                                        onChange={(t) => patchRow(i, { itemType: t ? t.item_type_id : "", typeDesc: t?.item_type_desc ?? "", route: "" })}
                                        getOptionLabel={(t) => t.item_type_desc}
                                        isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                                        placeholder="בחר סוג פריט…"
                                      />
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                {/* Serials are codes: typed left-to-right, kept on the RTL edge. */}
                                <input ref={(el) => { serialRefs.current[i] = el; }} value={r.serial} placeholder="סרוק או הקלד" dir="ltr"
                                  aria-label={`מספר סריאלי · שורה ${i + 1} · ${typeName}`} aria-invalid={error?.rowIndex === i || undefined}
                                  onChange={(e) => patchRow(i, { serial: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); serialRefs.current[i + 1]?.focus(); } }}
                                  className="pkg-field pkg-field--sm pkg-field--code" />
                              </td>
                              <td style={{ padding: "10px 12px", fontSize: 13.5, color: INK_2, whiteSpace: "nowrap" }}>
                                {routesOfType(r.itemType).length > 1 ? (
                                  <div style={{ minWidth: 170 }}>
                                    <SearchableCombobox<RouteOption>
                                      dense
                                      denseHeight={34}
                                      options={routesOfType(r.itemType).map(routeOption)}
                                      value={r.route === "" ? null : routeOption(r.route)}
                                      onChange={(o) => patchRow(i, { route: o ? o.value : "" })}
                                      isOptionEqualToValue={(a, b) => a.value === b.value}
                                      placeholder={routeLabel({ ...r, route: "" })}
                                    />
                                  </div>
                                ) : routeLabel(r)}
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <button type="button" onClick={() => patchRow(i, { open: !r.open })} aria-expanded={r.open} aria-controls={r.open ? detailsId : undefined}
                                  className="pkg-link pkg-link--hit" style={{ fontSize: 13 }}>{r.open ? "סגור" : "פרטים"}</button>
                              </td>
                              <td style={{ padding: "10px 16px", textAlign: "center" }}>
                                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`הסר שורה ${i + 1} · ${typeName}`} title="הסר שורה"
                                  className="pkg-iconbtn pkg-iconbtn--trash">
                                  <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                                </button>
                              </td>
                            </tr>
                            {r.open && (
                              <tr id={detailsId} style={{ background: "var(--color-surface-pearl)", borderTop: `1px solid ${HAIR_2}` }}>
                                <td></td>
                                <td colSpan={5} style={{ padding: "4px 12px 16px" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, maxWidth: 760 }}>
                                    {([["מק״ט", "makat", true], ["דגם", "model", false], ["יצרן", "manufacturer", false], ["מק״ט יצרן", "manufacturerNo", true]] as const).map(([label, field, code]) => (
                                      <div key={field}>
                                        <FieldLabel htmlFor={`${detailsId}-${field}`} small>{label}</FieldLabel>
                                        <input id={`${detailsId}-${field}`} value={r[field]} dir={code ? "ltr" : undefined} onChange={(e) => patchRow(i, { [field]: e.target.value } as Partial<Row>)}
                                          className={code ? "pkg-field pkg-field--xs pkg-field--code" : "pkg-field pkg-field--xs"} />
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    <button type="button" onClick={addRow} className="pkg-addrow">
                      <Plus size={15} strokeWidth={2} aria-hidden />הוסף פריט
                    </button>
                  </div>
                  {error && (
                    <div role="alert" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid color-mix(in srgb, var(--color-destructive) 25%, transparent)", borderRadius: 10, padding: "11px 14px" }}>
                      <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} aria-hidden /></span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error.text}</div>
                        {error.rowIndex != null && <div style={{ fontSize: 12.5, color: INK_2, marginTop: 3 }}>בחר מסלול אחר לשורה, או תקן את המסלול במסך מסלולי הבדיקה.</div>}
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === "labels" && (
                <>
                  <h3 style={stepHeading}>מדבקות</h3>
                  <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>בחר מה להדפיס בשמירה. המזהים נוצרים בשרת.</div>
                  <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
                    <div style={{ width: 300, border: `1px solid ${HAIR}`, borderRadius: 14, padding: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>מדבקת קופסה</div>
                      <div aria-hidden style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 56, marginTop: 14 }}>
                        {Array.from({ length: 28 }, (_, i) => <div key={i} style={{ width: (i % 3) + 1, height: "100%", background: i % 4 === 0 ? INK : i % 3 === 0 ? INK_2 : INK }} />)}
                      </div>
                      {/* A placeholder id: the real one is minted on save. */}
                      <div style={{ fontSize: 14, letterSpacing: 2, marginTop: 10, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right", color: MUTED }}>{fmtId("0000000000000000").head} 00</div>
                      <div style={{ fontSize: 13, color: INK_2, marginTop: 8 }}>{packageTypeDesc} · {shipment?.customer_name ?? shipment?.customer_code ?? ""}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{rows.length} פריטים</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 10 }}>
                      {rows.map((r, i) => (
                        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${HAIR}`, borderRadius: 12, padding: "12px 14px" }}>
                          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--color-primary-soft)", color: BLUE, fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(i + 1)}</span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.typeDesc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc || "פריט"}</div>
                            <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{r.makat || "—"} · {r.serial || "ללא סריאלי"}</div>
                          </div>
                          <div style={{ fontSize: 12.5, color: MUTED }}>פריט {seq2(i + 1)} מתוך {seq2(rows.length)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {error && <div role="alert" style={{ marginTop: 14, fontSize: 13, color: RED }}>{error.text}</div>}
                </>
              )}
            </div>

            <div className="pkg-wiz-foot">
              <div style={{ fontSize: 12.5, color: MUTED }}>{step === "items" ? "Enter בשדה סריאלי מקדם לשורה הבאה" : "המזהים נוצרים בשרת בשמירה"}</div>
              <div className="pkg-dlg-foot-actions">
                <button type="button" onClick={onClose} disabled={saving} className="pkg-pill pkg-pill--ghost">ביטול</button>
                <button type="button" onClick={goBack} disabled={saving || stepIdx === 0} className="pkg-pill pkg-pill--ghost">הקודם</button>
                {step === "labels" ? (
                  <>
                    <button type="button" onClick={() => save("another")} disabled={saving} className="pkg-pill pkg-pill--ghost">שמור והוסף מארז נוסף</button>
                    <button type="button" onClick={() => save("close")} disabled={saving} className="pkg-pill pkg-pill--ghost">שמור</button>
                    <button type="button" onClick={() => save("labels")} disabled={saving} aria-busy={saving || undefined} className="pkg-pill pkg-pill--primary" style={{ paddingInline: 22 }}>{saving ? "שומר…" : "שמור והדפס מדבקות"}</button>
                  </>
                ) : (
                  <button type="button" onClick={goNext} disabled={!canNext} className="pkg-pill pkg-pill--primary" style={{ paddingInline: 22 }}>הבא</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </PackageDialog>

      {labelsFor && shipment && (
        // Mounted after the intake dialog, so it stacks above it.
        <PackageLabelsDialog
          open
          onClose={() => { setLabelsFor(null); onClose(); }}
          packageId={labelsFor.packageId}
          packageType={packageTypeDesc}
          customerLine={`${shipment.customer_name ?? shipment.customer_code ?? ""} · משלוח ${shipment.shipment_code}`}
          sourceId={shipment.source_id ?? null}
          items={labelItems}
        />
      )}
    </>
  );
}
