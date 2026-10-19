"use client";
import React from "react";
import { Lock, Trash2, Plus, CircleAlert, Check, ClipboardList, Undo2, Volume2, VolumeX } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { DialogTitle, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageLabelsDialog, { type LabelSource } from "./PackageLabelsDialog";
import PackageBatchLabelsDialog from "./PackageBatchLabelsDialog";
import { PackageDialog } from "./PackageDialog";
import { serialKey, type SerialMatch } from "@/app/lib/packages/serial-key";
import { playCue, setSoundOn, soundOn, subscribeSound } from "./scanSound";
import { typeAsUsKeyboard } from "@/app/lib/scannerKeys";
import {
  BLUE, HAIR, HAIR_2, INK, INK_2, MUTED, RED, RED_BG, AMBER_INK, AMBER_BG, AMBER_BORDER,
  fmtId, seq2,
} from "./packageUi";

/**
 * קליטת מארז — design/Packages.dc.html (intake dialog, 1200px). Four steps in
 * one dialog: shipment + package type → package fields → items (serials) →
 * labels. One POST /api/packages creates the box and its items; the ids are
 * minted by the server (docs/packages/PLAN.md §6).
 *
 * A run of boxes: "שמור והמשך למארז הבא" (or Enter in the last serial field)
 * saves the box and opens the next one on the items step with the same
 * shipment, type and details — only the serials are typed. The run's labels
 * print together at the end (PackageBatchLabelsDialog).
 *
 * Serials: a repeat inside the box or the run, or one already taken in by
 * this shipment for the same type, is red and blocks the save; one known
 * elsewhere is amber, for information (lib/packages/serials.ts). A pasted
 * list fills the box from that row down and queues the rest for the next
 * boxes.
 *
 * A shipment with a single package type still open skips straight to the
 * serials (steps 1–2 hold nothing to choose). Saves chime and stops buzz
 * (scanSound.ts). "בטל מארז אחרון" deletes the run's last box while nobody
 * has worked on it, and puts its serials back in the open box to fix.
 */

type Shipment = {
  id: number; shipment_code: string; customer_id: number; customer_code?: string | null; customer_name?: string | null;
  makat?: string | null; is_sent?: boolean | null; source_id?: number | null;
  shipment_items?: { item_type_id: number; quantity: number; item_type_desc?: string | null }[] | null;
};
type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };
type Declared = { item_type_id: number; item_type_desc: string; total_quantity: number; sample_count: number; is_package?: boolean };
type Route = { item_type_id: number; route_number: number; route_steps: number[] };
type ContentsLine = {
  item_type_id: number; item_type_desc: string; quantity: number;
  makat: string | null; model: string | null; manufacturer_name: string | null; manufacturer_no: string | null;
  route_number: number;
};
type Contents = { default_route_number: number | null; lines: ContentsLine[] };
type RouteOption = { value: string; label: string };
const routeOption = (n: number | string): RouteOption => ({ value: String(n), label: `מסלול ${n}` });

/** Red blocks the save; amber only tells. */
type SerialFlag = { tone: "error" | "warn"; text: string };
/** The first thing that keeps a box from saving. */
type Problem = { rowIndex: number | null; text: string; openDetails?: boolean; focus?: boolean };

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

/** A box saved in this run: its labels, and its rows for "בטל מארז אחרון". */
type RunBox = LabelSource & { rows: Row[] };

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
  open, onClose, onCreated, onDeleted, initialShipmentId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (packageId: number) => void;
  /** "בטל מארז אחרון" removed a box this dialog had created. */
  onDeleted?: (packageId: number) => void;
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
  // `route`: the server refused the row's route, the only error the route hint answers.
  const [error, setError] = React.useState<{ rowIndex: number | null; text: string; route?: boolean } | null>(null);
  const [labelsFor, setLabelsFor] = React.useState<LabelSource | null>(null);
  // Boxes saved with "שמור והמשך למארז הבא"; their labels wait for the end of the run.
  const [run, setRun] = React.useState<RunBox[]>([]);
  const [batchLabels, setBatchLabels] = React.useState<LabelSource[] | null>(null);
  // Pasted serials past the open box; each next box takes its share.
  const [queue, setQueue] = React.useState<string[]>([]);
  // "שמור את כולם" in progress: boxes saved so far / boxes it set out to save.
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  // serialKey → items already carrying it. No entry = not asked yet.
  const [known, setKnown] = React.useState<Record<string, SerialMatch[]>>({});
  const serialRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  // The serial field to focus once the rows it belongs to have rendered.
  const focusSerial = React.useRef<number | null>(null);
  // The shipment whose package type was already picked for the worker (once
  // per shipment, so stepping back to step 1 stays there), and whether the
  // dialog should move on to the serials once that type's rows are in.
  const autoPicked = React.useRef<number | "">("");
  const skipToItems = React.useRef(false);
  const sound = React.useSyncExternalStore(subscribeSound, soundOn, () => true);
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
    setRun([]); setBatchLabels(null); setQueue([]); setKnown({});
    autoPicked.current = ""; skipToItems.current = false;
    return () => { cancelled = true; };
  }, [open, initialShipmentId]);

  React.useEffect(() => {
    if (focusSerial.current == null) return;
    serialRefs.current[focusSerial.current]?.focus();
    focusSerial.current = null;
  }, [rows, step]);

  const lookupSerials = React.useCallback((serials: string[]) => {
    const keys = [...new Set(serials.map(serialKey).filter(Boolean))];
    if (keys.length === 0) return;
    apiFetch("/api/items/serials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serials: keys }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const matches: SerialMatch[] = Array.isArray(d.matches) ? d.matches : [];
        setKnown((k) => {
          const out = { ...k };
          for (const key of keys) out[key] = matches.filter((m) => m.serial === key);
          return out;
        });
      })
      .catch(() => {});
  }, []);

  // Ask about the serials in the box once the typing pauses.
  React.useEffect(() => {
    const missing = rows.map((r) => serialKey(r.serial)).filter((k) => k && !(k in known));
    if (missing.length === 0) return;
    const t = setTimeout(() => lookupSerials(missing), 350);
    return () => clearTimeout(t);
  }, [rows, known, lookupSerials]);

  React.useEffect(() => {
    if (shipmentId === "") { setDeclared([]); return; }
    let cancelled = false;
    apiFetch(`/api/shipments/${shipmentId}/items`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      if (cancelled) return;
      const lines: Declared[] = Array.isArray(d) ? d : [];
      setDeclared(lines);
      // One package type still open on this shipment: nothing to choose in
      // steps 1–2 (the details have their defaults) — pick it and go on to
      // the serials once its rows are in.
      if (autoPicked.current === shipmentId) return;
      autoPicked.current = shipmentId;
      const openTypes = lines.filter((l) => l.is_package && Number(l.total_quantity) > Number(l.sample_count));
      if (openTypes.length === 1) {
        skipToItems.current = true;
        setPackageType(openTypes[0].item_type_id);
      }
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
    setQueue([]);
    if (packageType === "") { setContents(null); setRows([]); return; }
    let cancelled = false;
    apiFetch(`/api/settings/item-types/${packageType}/contents`).then((r) => (r.ok ? r.json() : null)).then((c: Contents | null) => {
      if (cancelled) return;
      const expanded = expandTemplate(c);
      setContents(c);
      setRows(expanded);
      setRouteNumber(c?.default_route_number != null ? String(c.default_route_number) : "");
      if (skipToItems.current) {
        // Picked for the worker: straight to the serials, unless the type has
        // no template to lay out rows from (then step 1 stays, type chosen).
        skipToItems.current = false;
        if (expanded.length > 0) { focusSerial.current = 0; setStep("items"); }
      }
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
  const detailsDone = (r: Row) => !!(r.makat.trim() && r.model.trim() && r.manufacturer.trim());
  // A row added by hand starts as a copy of the row above (type, details,
  // route), so only its serial is left to type.
  const addRow = () => {
    const above = rows[rows.length - 1];
    if (above) focusSerial.current = rows.length;
    setRows((rs) => rs.concat([above
      ? { ...above, key: rowKey++, fromTemplate: false, serial: "", open: !detailsDone(above) }
      : { key: rowKey++, itemType: "", typeDesc: "", fromTemplate: false, serial: "", makat: "", model: "", manufacturer: "", manufacturerNo: "", route: "", templateRoute: null, open: true }]));
  };
  // The next box of a run: the template again, keeping what the worker set in
  // the previous box's details row by row (same position, same type). Without
  // a template, the previous box's rows. Either way only the serials are new.
  const nextBoxRows = (prev: Row[]): Row[] => {
    const fresh = expandTemplate(contents);
    if (fresh.length === 0) return prev.map((r) => ({ ...r, key: rowKey++, serial: "", open: !detailsDone(r) }));
    return fresh.map((r, i) => {
      const p = prev[i];
      return p && p.itemType === r.itemType
        ? { ...r, makat: p.makat, model: p.model, manufacturer: p.manufacturer, manufacturerNo: p.manufacturerNo, route: p.route }
        : r;
    });
  };

  const goNext = () => { if (!canNext) return; setError(null); if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key); };
  const goBack = () => { setError(null); if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key); };

  // What row i's serial collides with, worst first. `others`: the boxes
  // saved earlier in this run.
  const serialFlag = (box: Row[], i: number, others: LabelSource[]): SerialFlag | null => {
    const key = serialKey(box[i].serial);
    if (!key) return null;
    const first = box.findIndex((r) => serialKey(r.serial) === key);
    if (first < i) return { tone: "error", text: `כבר הוזן בשורה ${first + 1}` };
    const inRun = others.findIndex((p) => p.items.some((it) => serialKey(it.serial_no) === key));
    if (inRun >= 0) return { tone: "error", text: `כבר נקלט במארז ${inRun + 1} ברצף` };
    const matches = known[key] ?? [];
    if (matches.some((m) => m.shipment_id === shipmentId && m.item_type_id === box[i].itemType)) return { tone: "error", text: "כבר נקלט במשלוח הזה" };
    const m = matches[0];
    if (m) return { tone: "warn", text: `קיים במערכת · ${m.item_type_desc}${m.shipment_code ? ` · משלוח ${m.shipment_code}` : ""}` };
    return null;
  };

  const checkBox = (box: Row[], others: LabelSource[]): Problem | null => {
    if (box.length === 0) return { rowIndex: null, text: "מארז חייב להכיל פריט אחד לפחות" };
    for (let i = 0; i < box.length; i++) {
      const r = box[i];
      if (r.itemType === "") return { rowIndex: i, text: `שורה ${i + 1} · יש לבחור סוג פריט` };
      if (!r.serial.trim()) return { rowIndex: i, text: `שורה ${i + 1} · חסר מספר סריאלי`, focus: true };
      const flag = serialFlag(box, i, others);
      if (flag?.tone === "error") return { rowIndex: i, text: `שורה ${i + 1} · הסריאלי ${r.serial.trim()} ${flag.text}`, focus: true };
      if (!detailsDone(r)) return { rowIndex: i, text: `שורה ${i + 1} · יש למלא מק״ט, דגם ויצרן בפרטים`, openDetails: true };
    }
    return null;
  };
  // The box a problem is shown on, with the details of its row opened when that is what is missing.
  const withProblem = (box: Row[], p: Problem): Row[] =>
    p.openDetails && p.rowIndex != null ? box.map((r, j) => (j === p.rowIndex ? { ...r, open: true } : r)) : box;

  // Pasted serials past the open box fill the next boxes, a box's worth at a time.
  const fillFromQueue = (box: Row[], q: string[]) => {
    const take = Math.min(box.length, q.length);
    return { box: box.map((r, i) => (i < take ? { ...r, serial: q[i] } : r)), queue: q.slice(take), full: box.length > 0 && take === box.length };
  };
  const firstEmpty = (box: Row[]) => { const i = box.findIndex((r) => !r.serial.trim()); return i < 0 ? Math.max(0, box.length - 1) : i; };

  // A list pasted into a serial field (an Excel column, a supplier's list)
  // fills this box from that row down; the rest waits in `queue`. A list that
  // repeats itself, or repeats a serial already in the box above or in the
  // run, is refused whole before anything changes.
  const onSerialPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const list = e.clipboardData.getData("text").split(/[\r\n\t,;]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length < 2) return;
    e.preventDefault();
    const where = new Map<string, string>();
    rows.forEach((r, j) => { if (j < i && serialKey(r.serial)) where.set(serialKey(r.serial), `בשורה ${j + 1}`); });
    run.forEach((p, b) => p.items.forEach((it) => { if (serialKey(it.serial_no)) where.set(serialKey(it.serial_no), `במארז ${b + 1} ברצף`); }));
    const keys = list.map(serialKey);
    const clashes = list.flatMap((s, j) =>
      keys.indexOf(keys[j]) < j ? [`${s} מופיע ברשימה פעמיים`] : where.has(keys[j]) ? [`${s} כבר הוזן ${where.get(keys[j])}`] : []);
    if (clashes.length > 0) {
      setError({ rowIndex: null, text: `ההדבקה לא בוצעה · ${clashes.slice(0, 3).join(" · ")}${clashes.length > 3 ? ` · ועוד ${clashes.length - 3}` : ""}` });
      playCue("error");
      return;
    }
    const here = Math.min(rows.length - i, list.length);
    setError(null);
    focusSerial.current = Math.min(i + here, rows.length - 1);
    setRows((rs) => rs.map((r, j) => (j >= i && j < i + here ? { ...r, serial: list[j - i] } : r)));
    setQueue(list.slice(here));
    lookupSerials(list);
  };

  const customerLine = shipment ? `${shipment.customer_name ?? shipment.customer_code ?? ""} · משלוח ${shipment.shipment_code}` : "";
  const typeNameOf = (r: Row) => r.typeDesc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc || "פריט";

  // In a run, every way out ends with the run's labels: the boxes are saved,
  // their labels are not printed yet.
  const requestClose = () => { if (run.length > 0) setBatchLabels(run); else onClose(); };

  // POSTs one box. A refusal is shown (and buzzed) against `box`, on its row
  // when the server names one, and answers with that row.
  const postBox = async (box: Row[]): Promise<{ saved: RunBox } | { failedRow: number | null }> => {
    if (!shipment) return { failedRow: null };
    try {
      const res = await apiFetch("/api/packages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: shipment.customer_id, shipment: shipment.id, packageType,
          routeNumber: routeNumber === "" ? null : Number(routeNumber),
          makat, model, manufacturer,
          items: box.map((r) => ({
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
          rowIndex = box.findIndex((r) => r.typeDesc === desc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc === desc);
          if (rowIndex < 0) rowIndex = null;
        }
        if (data?.code === "ITEM_ROUTE_SHAPE" || rowIndex != null) setStep("items");
        setError({ rowIndex, text: rowIndex != null ? `שורה ${rowIndex + 1} · ${text.includes(":") ? text.split(":").slice(1).join(":").trim() : text}` : text, route: data?.code === "ITEM_ROUTE_SHAPE" });
        playCue("error");
        return { failedRow: rowIndex };
      }
      const packageId: number = data.packageId;
      const itemIds: number[] = data.itemIds ?? [];
      onCreated(packageId);
      return {
        saved: {
          packageId, packageType: packageTypeDesc, customerLine, sourceId: shipment.source_id ?? null,
          items: box.map((r, i) => ({ item_id: itemIds[i] ?? "", package_seq: i + 1, item_type_desc: typeNameOf(r), serial_no: r.serial.trim() })),
          rows: box,
        },
      };
    } catch {
      setError({ rowIndex: null, text: "שגיאה בתקשורת" });
      playCue("error");
      return { failedRow: null };
    }
  };

  // "נקלט / נותר" after boxes were saved.
  const reloadDeclared = () => {
    if (!shipment) return;
    apiFetch(`/api/shipments/${shipment.id}/items`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d)) setDeclared(d); }).catch(() => {});
  };

  const save = async (after: "close" | "next" | "labels") => {
    if (!shipment || packageType === "") { setStep("shipment"); setError({ rowIndex: null, text: "יש לבחור משלוח וסוג מארז" }); return; }
    const problem = checkBox(rows, run);
    if (problem) {
      setStep("items"); setRows(withProblem(rows, problem)); setError({ rowIndex: problem.rowIndex, text: problem.text });
      playCue("error");
      // Selected, so the next scan replaces the bad serial.
      if (problem.focus && problem.rowIndex != null) { serialRefs.current[problem.rowIndex]?.focus(); serialRefs.current[problem.rowIndex]?.select(); }
      return;
    }
    setSaving(true); setError(null);
    try {
      const result = await postBox(rows);
      if (!("saved" in result)) return;
      const { saved } = result;
      playCue("ok");
      if (after === "next") {
        const next = fillFromQueue(nextBoxRows(rows), queue);
        setRun((rs) => rs.concat([saved])); setQueue(next.queue);
        focusSerial.current = firstEmpty(next.box);
        setRows(next.box); setStep("items"); setError(null);
        reloadDeclared();
        return;
      }
      if (run.length > 0) { setBatchLabels(run.concat([saved])); return; }
      if (after === "labels") { setLabelsFor(saved); return; }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // "שמור את כולם": the open box, then every full box the queue holds. A
  // partial last box stays open for the worker; the first refusal stops the
  // run on the box it is about.
  const saveAll = async () => {
    if (!shipment) return;
    const size = Math.max(1, rows.length);
    const total = 1 + Math.floor(queue.length / size);
    const added: RunBox[] = [];
    let box = rows;
    let q = queue;
    let stopRow: number | null = null;
    let stopped = false;
    setSaving(true); setError(null);
    try {
      for (;;) {
        setProgress({ done: added.length, total });
        const problem = checkBox(box, run.concat(added));
        if (problem) {
          box = withProblem(box, problem);
          setError({ rowIndex: problem.rowIndex, text: problem.text });
          playCue("error");
          stopRow = problem.rowIndex; stopped = true;
          break;
        }
        const result = await postBox(box);
        if (!("saved" in result)) { stopRow = result.failedRow; stopped = true; break; }
        added.push(result.saved);
        const next = fillFromQueue(nextBoxRows(box), q);
        box = next.box; q = next.queue;
        if (!next.full) break;
      }
    } finally {
      // One chime for the lot; a stop has already buzzed.
      if (!stopped && added.length > 0) playCue("ok");
      setRun((rs) => rs.concat(added)); setQueue(q);
      setSaving(false); setProgress(null);
      const at = stopRow ?? firstEmpty(box);
      // Unchanged rows never re-run the focus effect, so focus them here.
      if (box === rows) serialRefs.current[at]?.focus();
      else { focusSerial.current = at; setRows(box); }
      if (added.length > 0) reloadDeclared();
    }
  };

  // "בטל מארז אחרון": the run's last box goes (the server refuses once anyone
  // has worked on it) and its rows come back into the open box with their
  // serials, to fix the wrong one and save again. Serials already typed into
  // the open box move to the front of the queue, so nothing typed is lost.
  const undoLast = async () => {
    const last = run[run.length - 1];
    if (!last) return;
    setSaving(true); setError(null);
    try {
      const res = await apiFetch(`/api/packages/${last.packageId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cascade: true, onlyUntouched: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError({ rowIndex: null, text: data?.error || "ביטול המארז נכשל" });
        playCue("error");
        return;
      }
      const typed = rows.map((r) => r.serial.trim()).filter(Boolean);
      setRun((rs) => rs.slice(0, -1));
      setQueue((q) => typed.concat(q));
      // Its serials are free again: forget what the lookup said about them.
      setKnown((k) => {
        const out = { ...k };
        for (const r of last.rows) delete out[serialKey(r.serial)];
        return out;
      });
      focusSerial.current = 0;
      setRows(last.rows.map((r) => ({ ...r, key: rowKey++, open: false })));
      setStep("items");
      onDeleted?.(Number(last.packageId));
      reloadDeclared();
    } catch {
      setError({ rowIndex: null, text: "שגיאה בתקשורת" });
      playCue("error");
    } finally {
      setSaving(false);
    }
  };

  const sidebarSummary = shipment
    ? `${shipment.shipment_code} · ${rows.length} פריטים · ${filled} סריאליים הוזנו`
    : "בחר משלוח וסוג מארז";

  const declaredLine = declared.find((d) => d.item_type_id === packageType);
  const left = declaredLine ? Math.max(0, Number(declaredLine.total_quantity) - Number(declaredLine.sample_count)) : null;
  // Ending a run saves the open box with it if serials were typed into it;
  // an untouched box is just dropped.
  const finishRun = () => { if (filled > 0) save("labels"); else setBatchLabels(run); };
  // The paste queue in boxes of this box's size.
  const fullBoxes = rows.length ? Math.floor(queue.length / rows.length) : 0;
  const partial = rows.length ? queue.length % rows.length : queue.length;
  const queueKnown = queue.filter((s) => (known[serialKey(s)] ?? []).length > 0).length;
  const stepHeading: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" };

  return (
    <>
      <PackageDialog open onClose={requestClose} busy={saving} width="min(1200px, calc(100vw - 48px))" height="min(760px, 92vh)" fullScreenBelow760>
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
                      <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5 }}>השורות נפרשו מתכולת המארז. הקלד או סרוק סריאלי — Enter עובר לשורה הבאה, ובשורה האחרונה שומר ופותח את המארז הבא. אפשר גם להדביק רשימת סריאליים מאקסל.</div>
                    </div>
                    <div style={{ textAlign: "center", background: "var(--color-canvas-parchment)", borderRadius: 12, padding: "10px 18px", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{rows.length}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3 }}>פריטים במארז</div>
                    </div>
                  </div>
                  {run.length > 0 && (
                    // The run so far, and how much of the declaration is left.
                    // Past the declared count it turns amber: the next box is extra.
                    <div role="status" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: left === 0 ? AMBER_INK : INK, background: left === 0 ? AMBER_BG : "var(--color-primary-tint)", border: `1px solid ${left === 0 ? AMBER_BORDER : HAIR}`, borderRadius: 10, paddingBlock: 7, paddingInline: "13px 7px" }}>
                      <span style={{ color: left === 0 ? AMBER_INK : BLUE, display: "inline-flex" }}>{left === 0 ? <CircleAlert size={16} strokeWidth={2} aria-hidden /> : <Check size={16} strokeWidth={2.25} aria-hidden />}</span>
                      <span style={{ flex: 1, minWidth: 200, fontVariantNumeric: "tabular-nums" }}>
                        <span style={{ fontWeight: 600 }}>{run.length === 1 ? "נקלט מארז אחד ברצף" : `נקלטו ${run.length} מארזים ברצף`}</span>
                        {declaredLine && (left === 0
                          ? ` · כל ${declaredLine.total_quantity} המארזים שהוצהרו מסוג זה כבר נקלטו`
                          : ` · נותרו ${left} מתוך ${declaredLine.total_quantity} שהוצהרו`)}
                      </span>
                      <button type="button" onClick={undoLast} disabled={saving} className="pkg-link pkg-link--hit" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5 }}
                        title={`מוחק את מארז ${run.length} ומחזיר את הסריאליים שלו לתיקון: ${run[run.length - 1].items.map((it) => it.serial_no).join(", ")}`}>
                        <Undo2 size={14} strokeWidth={2} aria-hidden />בטל מארז אחרון
                      </button>
                      <button type="button" onClick={finishRun} disabled={saving} className="pkg-pill pkg-pill--ghost pkg-pill--sm" style={{ paddingInline: 16 }}>סיום והדפסת מדבקות</button>
                    </div>
                  )}
                  {queue.length > 0 && (
                    // Pasted serials still waiting for their boxes.
                    <div role="status" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: INK, background: "var(--color-primary-tint)", border: `1px solid ${HAIR}`, borderRadius: 10, paddingBlock: 7, paddingInline: "13px 7px" }}>
                      <span style={{ color: BLUE, display: "inline-flex" }}><ClipboardList size={16} strokeWidth={2} aria-hidden /></span>
                      <span style={{ flex: 1, minWidth: 220, fontVariantNumeric: "tabular-nums" }}>
                        <span style={{ fontWeight: 600 }}>ממתינים עוד {queue.length} סריאליים למארזים הבאים</span>
                        {fullBoxes === 1 ? " · מארז מלא אחד" : fullBoxes > 1 ? ` · ${fullBoxes} מארזים מלאים` : ""}
                        {partial > 0 && (fullBoxes > 0 ? ` ועוד ${partial} למארז חלקי` : ` · ${partial} למארז חלקי`)}
                        {queueKnown > 0 && <span style={{ color: AMBER_INK }}> · {queueKnown} מהם כבר קיימים במערכת</span>}
                      </span>
                      <button type="button" onClick={() => setQueue([])} disabled={saving} className="pkg-link pkg-link--hit" style={{ fontSize: 13 }}>בטל</button>
                      <button type="button" onClick={saveAll} disabled={saving} aria-busy={saving || undefined} className="pkg-pill pkg-pill--primary pkg-pill--sm" style={{ paddingInline: 16 }}>
                        {progress ? `שומר מארז ${progress.done + 1} מתוך ${progress.total}…` : fullBoxes === 0 ? "שמור והמשך למארז הבא" : `שמור ${1 + fullBoxes} מארזים`}
                      </button>
                    </div>
                  )}
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
                          const flag = serialFlag(rows, i, run);
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
                                  aria-label={`מספר סריאלי · שורה ${i + 1} · ${typeName}`} aria-invalid={error?.rowIndex === i || flag?.tone === "error" || undefined}
                                  aria-describedby={flag ? `${detailsId}-sn` : undefined}
                                  onChange={(e) => patchRow(i, { serial: e.target.value })}
                                  onPaste={(e) => onSerialPaste(i, e)}
                                  onKeyDown={(e) => {
                                    // Scanned on a Hebrew layout, "ab12" would arrive as "שנ12".
                                    if (e.key !== "Enter") { typeAsUsKeyboard(e); return; }
                                    e.preventDefault();
                                    // A repeated serial stays put, selected, so the next scan replaces it.
                                    if (flag?.tone === "error") { e.currentTarget.select(); playCue("error"); return; }
                                    // The last row ends the box: save it and open the next one.
                                    if (i < rows.length - 1) serialRefs.current[i + 1]?.focus();
                                    else if (!saving) save("next");
                                  }}
                                  className="pkg-field pkg-field--sm pkg-field--code"
                                  style={flag?.tone === "error" ? { borderColor: RED } : undefined} />
                                {flag && (
                                  <div id={`${detailsId}-sn`} style={{ fontSize: 11.5, lineHeight: 1.35, marginTop: 4, color: flag.tone === "error" ? RED : AMBER_INK }}>{flag.text}</div>
                                )}
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
                        {error.route && <div style={{ fontSize: 12.5, color: INK_2, marginTop: 3 }}>בחר מסלול אחר לשורה, או תקן את המסלול במסך מסלולי הבדיקה.</div>}
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
              {/* Saves chime, stops buzz — for scanning without watching the screen. */}
              <button type="button" onClick={() => setSoundOn(!sound)} aria-pressed={sound} aria-label="צלילי שמירה ושגיאה"
                title={sound ? "צלילים פועלים — לחץ להשתקה" : "צלילים מושתקים — לחץ להפעלה"} className="pkg-iconbtn pkg-iconbtn--ink">
                {sound ? <Volume2 size={16} strokeWidth={1.75} aria-hidden /> : <VolumeX size={16} strokeWidth={1.75} aria-hidden />}
              </button>
              <div style={{ fontSize: 12.5, color: MUTED }}>{step === "items" ? "Enter בשורה האחרונה שומר וממשיך למארז הבא" : "המזהים נוצרים בשרת בשמירה"}</div>
              <div className="pkg-dlg-foot-actions">
                <button type="button" onClick={requestClose} disabled={saving} className="pkg-pill pkg-pill--ghost">ביטול</button>
                <button type="button" onClick={goBack} disabled={saving || stepIdx === 0} className="pkg-pill pkg-pill--ghost">הקודם</button>
                {step === "labels" ? (
                  <>
                    <button type="button" onClick={() => save("next")} disabled={saving} className="pkg-pill pkg-pill--ghost">שמור והמשך למארז הבא</button>
                    <button type="button" onClick={() => save("close")} disabled={saving} className="pkg-pill pkg-pill--ghost">שמור</button>
                    <button type="button" onClick={() => save("labels")} disabled={saving} aria-busy={saving || undefined} className="pkg-pill pkg-pill--primary" style={{ paddingInline: 22 }}>
                      {saving ? "שומר…" : run.length > 0 ? `שמור והדפס מדבקות (${run.length + 1} מארזים)` : "שמור והדפס מדבקות"}
                    </button>
                  </>
                ) : (
                  <>
                    {step === "items" && (
                      <button type="button" onClick={() => save("next")} disabled={saving || rows.length === 0} aria-busy={saving || undefined} className="pkg-pill pkg-pill--ghost">
                        {saving ? "שומר…" : "שמור והמשך למארז הבא"}
                      </button>
                    )}
                    <button type="button" onClick={goNext} disabled={!canNext || saving} className="pkg-pill pkg-pill--primary" style={{ paddingInline: 22 }}>הבא</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </PackageDialog>

      {labelsFor && (
        // Mounted after the intake dialog, so it stacks above it.
        <PackageLabelsDialog open onClose={() => { setLabelsFor(null); onClose(); }} {...labelsFor} />
      )}
      {batchLabels && (
        <PackageBatchLabelsDialog
          open
          onClose={() => { setBatchLabels(null); setRun([]); onClose(); }}
          packages={batchLabels}
          subtitle={`${[...new Set(batchLabels.map((p) => p.customerLine))].join(" / ")} · נקלטו ברצף`}
        />
      )}
    </>
  );
}
