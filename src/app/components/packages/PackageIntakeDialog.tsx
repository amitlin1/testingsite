"use client";
import React from "react";
import { Lock, Trash2, Plus, CircleAlert, Check } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageLabelsDialog from "./PackageLabelsDialog";
import {
  DIALOG_Z, BLUE, FOCUS, HAIR, HAIR_2, INK, INK_2, MUTED, MUTED_LT, RED, RED_BG, AMBER, AMBER_INK, AMBER_BG, AMBER_BORDER, SHADOW,
  fieldInput, fmtId, overlay, pillGhost, pillPrimary, seq2,
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

  return (
    <>
      <div onClick={() => !saving && onClose()} style={overlay}>
        <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: 1200, maxWidth: "100%", height: "min(760px, 92vh)", background: "#fff", borderRadius: 18, boxShadow: SHADOW, display: "flex", overflow: "hidden", color: INK }}>
          {/* Sidebar */}
          <div style={{ width: 288, flexShrink: 0, background: "#f5f5f7", borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", padding: "22px 20px" }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px" }}>קליטת מארז</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>המארז והפריטים נוצרים יחד בשמירה אחת.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 22 }}>
              {STEPS.map((s, i) => {
                const active = s.key === step;
                const done = i < stepIdx;
                const note = s.key === "shipment" ? (shipment ? `${shipment.shipment_code} · ${packageTypeDesc || "בחר סוג מארז"}` : "בחר משלוח וסוג")
                  : s.key === "details" ? "מסלול, מק״ט, דגם" : s.key === "items" ? "סריאלי לכל פריט" : "קופסה + פריטים";
                return (
                  <div key={s.key} onClick={() => { if (i <= stepIdx || canNext) setStep(s.key); }} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "10px 11px", borderRadius: 10, background: active ? "#e6efff" : "transparent", cursor: "pointer" }}>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", background: active ? BLUE : done ? "#eaf5ef" : "#fff", color: active ? "#fff" : done ? "#1f8a5b" : MUTED, fontSize: 12, fontWeight: 700, border: `1px solid ${active ? BLUE : HAIR}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: active ? BLUE : INK }}>{s.label}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{note}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: "auto", background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 12, padding: "13px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>המארז שייווצר</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 7 }}>{packageTypeDesc || "—"}</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{sidebarSummary}</div>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 28px" }}>
              {step === "shipment" && (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>משלוח וסוג מארז</div>
                  <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>בחר משלוח, ואז סוג מארז מתוך מה שהוצהר עליו.</div>
                  <div style={{ maxWidth: 420, marginTop: 18 }}>
                    <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>משלוח</div>
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
                            <tr style={{ background: "#f5f5f7" }}>
                              <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 16px" }}>סוג מארז</th>
                              <th style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px" }}>הוצהר</th>
                              <th style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px" }}>נקלט</th>
                              <th style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px" }}>נותר</th>
                              <th style={{ padding: "11px 16px" }}></th>
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
                                <tr key={d.item_type_id} onClick={() => { if (!doneRow) setPackageType(d.item_type_id); }} style={{ borderTop: `1px solid ${HAIR_2}`, cursor: doneRow ? "default" : "pointer", background: picked ? "#f7fbff" : "#fff" }}>
                                  <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 600 }}>{d.item_type_desc}</td>
                                  <td style={{ padding: 12, fontSize: 14, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{d.total_quantity}</td>
                                  <td style={{ padding: 12, fontSize: 14, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{d.sample_count}</td>
                                  <td style={{ padding: 12, fontSize: 14, textAlign: "center", fontWeight: 600, color: doneRow ? MUTED_LT : AMBER, fontVariantNumeric: "tabular-nums" }}>{left}</td>
                                  <td style={{ padding: "12px 16px", textAlign: "end", fontSize: 13, fontWeight: 600, color: doneRow ? MUTED_LT : BLUE, whiteSpace: "nowrap" }}>{doneRow ? "הושלם" : picked ? "נבחר" : "בחר"}</td>
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
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>פרטי המארז</div>
                  <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>למארז אין מספר סריאלי. המזהה נוצר בשמירה ומסתיים ב-00.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, maxWidth: 660, marginTop: 20 }}>
                    <div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>מסלול המארז</div>
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
                      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>סוג מארז</div>
                      <SearchableCombobox<RouteOption> dense locked options={[]} value={{ value: String(packageType), label: packageTypeDesc }} onChange={() => {}} />
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>סוג המארז נקבע בקליטה ואינו ניתן לשינוי אחר כך.</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>מק״ט</div>
                      <input value={makat} onChange={(e) => setMakat(e.target.value)} style={fieldInput} />
                      {shipment?.makat && makat === String(shipment.makat) && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>מולא מהמשלוח</div>}
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>דגם (אופציונלי)</div>
                      <input value={model} onChange={(e) => setModel(e.target.value)} style={fieldInput} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>יצרן (אופציונלי)</div>
                      <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} style={fieldInput} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>מספר סריאלי</div>
                      <div style={{ ...fieldInput, background: "#f5f5f7", color: MUTED_LT, display: "flex", alignItems: "center", justifyContent: "space-between" }}>אין סריאלי למארז<Lock size={14} strokeWidth={1.75} color={MUTED_LT} /></div>
                    </div>
                  </div>
                </>
              )}

              {step === "items" && (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>פריטים במארז</div>
                      <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>השורות נפרשו מתכולת המארז. הקלד סריאלי ולחץ Enter למעבר לשורה הבאה.</div>
                    </div>
                    <div style={{ textAlign: "center", background: "#f5f5f7", borderRadius: 12, padding: "10px 18px", flexShrink: 0 }}>
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
                        <tr style={{ background: "#f5f5f7" }}>
                          <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 16px", width: 48 }}>#</th>
                          <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px" }}>סוג פריט</th>
                          <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px", width: 210 }}>מספר סריאלי</th>
                          <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px" }}>מסלול</th>
                          <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px", width: 92 }}>פרטים</th>
                          <th style={{ padding: "11px 16px", width: 52 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <React.Fragment key={r.key}>
                            <tr style={{ borderTop: `1px solid ${HAIR_2}`, background: error?.rowIndex === i ? RED_BG : "#fff" }}>
                              <td style={{ padding: "10px 16px", fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {r.fromTemplate ? (
                                    <>
                                      <span style={{ fontSize: 14, fontWeight: 600 }}>{r.typeDesc}</span>
                                      <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, background: "#f5f5f7", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "2px 8px" }}>מהתבנית</span>
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
                                <input ref={(el) => { serialRefs.current[i] = el; }} value={r.serial} placeholder="סרוק או הקלד"
                                  onChange={(e) => patchRow(i, { serial: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); serialRefs.current[i + 1]?.focus(); } }}
                                  style={{ ...fieldInput, height: 38, borderRadius: 9, padding: "0 11px", borderColor: r.serial.trim() === "" ? HAIR : FOCUS, fontVariantNumeric: "tabular-nums" }} />
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
                                <button type="button" onClick={() => patchRow(i, { open: !r.open })} style={{ fontSize: 13, fontWeight: 600, color: BLUE, background: "transparent", border: 0, cursor: "pointer", padding: 0, fontFamily: "inherit", whiteSpace: "nowrap" }}>{r.open ? "סגור" : "פרטים"}</button>
                              </td>
                              <td style={{ padding: "10px 16px", textAlign: "center" }}>
                                <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} style={{ width: 30, height: 30, borderRadius: 8, background: "#f5f5f7", color: MUTED, border: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                  <Trash2 size={15} strokeWidth={1.75} />
                                </button>
                              </td>
                            </tr>
                            {r.open && (
                              <tr style={{ background: "#fafafc", borderTop: `1px solid ${HAIR_2}` }}>
                                <td></td>
                                <td colSpan={5} style={{ padding: "4px 12px 16px" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, maxWidth: 760 }}>
                                    {([["מק״ט", "makat"], ["דגם", "model"], ["יצרן", "manufacturer"], ["מק״ט יצרן", "manufacturerNo"]] as const).map(([label, field]) => (
                                      <div key={field}>
                                        <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 5 }}>{label}</div>
                                        <input value={r[field]} onChange={(e) => patchRow(i, { [field]: e.target.value } as Partial<Row>)} style={{ ...fieldInput, height: 36, borderRadius: 9, padding: "0 10px", fontSize: 13.5 }} />
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" onClick={addRow} style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "12px 16px", borderTop: `1px solid ${HAIR_2}`, fontSize: 13.5, fontWeight: 600, color: BLUE, background: "transparent", border: 0, borderRadius: 0, cursor: "pointer", fontFamily: "inherit" }}>
                      <Plus size={15} strokeWidth={2} />הוסף פריט
                    </button>
                  </div>
                  {error && (
                    <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid rgba(191,53,53,0.25)", borderRadius: 10, padding: "11px 14px" }}>
                      <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} /></span>
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
                  <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>מדבקות</div>
                  <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>בחר מה להדפיס בשמירה. המזהים נוצרים בשרת.</div>
                  <div style={{ display: "flex", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
                    <div style={{ width: 300, border: `1px solid ${HAIR}`, borderRadius: 14, padding: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>מדבקת קופסה</div>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 56, marginTop: 14 }}>
                        {Array.from({ length: 28 }, (_, i) => <div key={i} style={{ width: (i % 3) + 1, height: "100%", background: i % 4 === 0 ? INK : i % 3 === 0 ? INK_2 : INK }} />)}
                      </div>
                      <div style={{ fontFamily: "'Inter', monospace", fontSize: 14, letterSpacing: 2, marginTop: 10, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right", color: MUTED_LT }}>{fmtId("0000000000000000").head} 00</div>
                      <div style={{ fontSize: 13, color: INK_2, marginTop: 8 }}>{packageTypeDesc} · {shipment?.customer_name ?? shipment?.customer_code ?? ""}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{rows.length} פריטים</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column", gap: 10 }}>
                      {rows.map((r, i) => (
                        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${HAIR}`, borderRadius: 12, padding: "12px 14px" }}>
                          <span style={{ width: 30, height: 30, borderRadius: 8, background: "#e6efff", color: BLUE, fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(i + 1)}</span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.typeDesc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc || "פריט"}</div>
                            <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{r.makat || "—"} · {r.serial || "ללא סריאלי"}</div>
                          </div>
                          <div style={{ fontSize: 12.5, color: MUTED }}>פריט {seq2(i + 1)} מתוך {seq2(rows.length)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {error && <div style={{ marginTop: 14, fontSize: 13, color: RED }}>{error.text}</div>}
                </>
              )}
            </div>

            <div style={{ flexShrink: 0, borderTop: `1px solid ${HAIR}`, padding: "14px 28px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 12.5, color: MUTED }}>{step === "items" ? "Enter בשדה סריאלי מקדם לשורה הבאה" : "המזהים נוצרים בשרת בשמירה"}</div>
              <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={onClose} disabled={saving} style={{ ...pillGhost, padding: "10px 18px" }}>ביטול</button>
                <button type="button" onClick={goBack} disabled={saving || stepIdx === 0} style={{ ...pillGhost, padding: "10px 18px", color: stepIdx === 0 ? MUTED_LT : INK }}>הקודם</button>
                {step === "labels" ? (
                  <>
                    <button type="button" onClick={() => save("another")} disabled={saving} style={{ ...pillGhost, padding: "10px 18px" }}>שמור והוסף מארז נוסף</button>
                    <button type="button" onClick={() => save("close")} disabled={saving} style={{ ...pillGhost, padding: "10px 18px" }}>שמור</button>
                    <button type="button" onClick={() => save("labels")} disabled={saving} style={{ ...pillPrimary, padding: "10px 22px", opacity: saving ? 0.7 : 1 }}>{saving ? "שומר…" : "שמור והדפס מדבקות"}</button>
                  </>
                ) : (
                  <button type="button" onClick={goNext} disabled={!canNext} style={{ ...pillPrimary, padding: "10px 22px", opacity: canNext ? 1 : 0.5, cursor: canNext ? "pointer" : "not-allowed" }}>הבא</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {labelsFor && shipment && (
        <PackageLabelsDialog
          open
          zIndex={DIALOG_Z + 10} // the intake overlay stays mounted underneath
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
