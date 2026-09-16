"use client";
import React from "react";
import { Check, Plus, CircleAlert } from "lucide-react";
import type { StationTestDialogProps } from "@/types";
import type { PackageItemView, PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { newActionId } from "@/app/lib/metrics/action-id";
import PackageWizardShell, { type ItemStepperRow, type WizardStep } from "./PackageWizardShell";
import { PhotoUploader, PassFail, emptyPhotos, type Photos, type RefImg } from "./stationKit";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, FOCUS, GREEN, GREEN_BG, GREY, HAIR, INK, INK_2, MUTED, MUTED_LT, RED, RED_BG, fieldInput, seq2,
} from "@/app/components/packages/packageUi";

/**
 * אשף פתיחת מארז — design/Package Stations.dc.html (open). Runs on a
 * package-level opening station for a PACKAGE row (item.package is its view).
 * Six steps: scan → box photos → items (photo → weigh each) → count →
 * labels → done. On "הדפס וסיים" every item gets its own result at this
 * station and then the box does, all under one submit id
 * (docs/packages/PLAN.md §4). Reference images / weights come from the
 * reference-item lookup: the box by its own makat + package type, each item
 * by the template's manufacturer SKU (DESIGN_REVIEW.md, decision 1).
 */

const PT_PACKAGE = "package";
const PT_PRODUCT = "product";
const TOLERANCE_PCT = 5;

const STEPS: WizardStep[] = [
  { key: "scan", label: "סריקת מק״ט המארז", note: "מדבקת הקופסה" },
  { key: "boxPhoto", label: "צילום הקופסה", note: "3 זוויות + תקינות" },
  { key: "items", label: "פריטים במארז", note: "צילום ושקילה לכל פריט" },
  { key: "count", label: "ספירה", note: "הוזן מול רשום" },
  { key: "labels", label: "מדבקות", note: "קופסה + פריטים" },
  { key: "done", label: "סיום", note: "" },
];

type ItemWork = {
  photos: Photos;
  refImages: RefImg[];
  refWeight: number | null;
  hasRU: boolean | null;
  meas: string;
  done: boolean;
};

const freshWork = (): ItemWork => ({ photos: emptyPhotos(), refImages: [], refWeight: null, hasRU: null, meas: "", done: false });

async function lookupReference(sku: string, itemTypeId: number | null) {
  const qs = new URLSearchParams({ sku });
  if (itemTypeId != null) qs.set("itemTypeId", String(itemTypeId));
  const res = await apiFetch(`/api/testing/reference-lookup?${qs.toString()}`);
  const d = await res.json().catch(() => ({}));
  return {
    hasRU: !!d.hasRU,
    refWeight: d.referenceWeight != null && d.referenceWeight !== "" ? Number(d.referenceWeight) : null,
    imagesByType: (d.imagesByType ?? {}) as Record<string, RefImg[]>,
  };
}

function weightResult(ref: number | null, meas: string) {
  if (ref == null || meas.trim() === "") return null;
  const m = Number(meas);
  if (!Number.isFinite(m)) return null;
  const diff = m - ref;
  const diffPct = ref !== 0 ? (Math.abs(diff) / ref) * 100 : 0;
  return { diff, diffPct, pass: diffPct <= TOLERANCE_PCT };
}

const templateSkuOf = (pkg: PackageView, it: PackageItemView): string | null => {
  const lines = Array.isArray(pkg.template_snapshot) ? (pkg.template_snapshot as { item_type_id?: number; manufacturer_sku?: string | null }[]) : [];
  return lines.find((l) => l.item_type_id === it.item_type_id)?.manufacturer_sku ?? null;
};

type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };

export default function PackageOpenWizard({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  const pkg = item.package as PackageView | null;
  const [step, setStep] = React.useState(0);
  const [scan, setScan] = React.useState("");
  const [boxPhotos, setBoxPhotos] = React.useState<Photos>(emptyPhotos());
  const [boxRef, setBoxRef] = React.useState<RefImg[]>([]);
  const [boxHasRU, setBoxHasRU] = React.useState<boolean | null>(null);
  const [items, setItems] = React.useState<PackageItemView[]>(pkg?.items ?? []);
  const [work, setWork] = React.useState<Record<string, ItemWork>>({});
  const [itemIdx, setItemIdx] = React.useState<number | null>(null);
  const [itemPhase, setItemPhase] = React.useState<"photo" | "weigh">("photo");
  const [countInput, setCountInput] = React.useState("");
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [labelsPrinted, setLabelsPrinted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [add, setAdd] = React.useState({ itemType: "", serialNumber: "", makat: "", model: "", manufacturer: "" });
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const submitIdRef = React.useRef<string | null>(null);
  const committedRef = React.useRef<Set<string>>(new Set());

  // ---- open: reset + box reference ---------------------------------------
  React.useEffect(() => {
    if (!open || !pkg) return;
    setStep(0); setScan(""); setBoxPhotos(emptyPhotos()); setBoxRef([]); setBoxHasRU(null);
    setItems(pkg.items); setWork({}); setItemIdx(null); setItemPhase("photo"); setCountInput("");
    setLabelsOpen(false); setLabelsPrinted(false); setSubmitting(false); setError(null); setAddOpen(false);
    submitIdRef.current = null; committedRef.current = new Set();
    const sku = (item.makat ?? "").trim();
    if (sku && item.item_type_id != null) {
      lookupReference(sku, item.item_type_id).then((r) => { setBoxHasRU(r.hasRU); setBoxRef(r.imagesByType[PT_PACKAGE] ?? []); }).catch(() => setBoxHasRU(false));
    } else {
      setBoxHasRU(false);
    }
    apiFetch("/api/itemTypes").then((r) => (r.ok ? r.json() : [])).then((d) => setItemTypes(Array.isArray(d) ? d : [])).catch(() => setItemTypes([]));
  }, [open, pkg, item.makat, item.item_type_id]);

  const workOf = (id: string): ItemWork => work[id] ?? freshWork();
  const patchWork = (id: string, patch: Partial<ItemWork>) => setWork((w) => ({ ...w, [id]: { ...(w[id] ?? freshWork()), ...patch } }));

  // ---- uploads (browser → MinIO, tagged by photo type) -------------------
  const uploadTo = React.useCallback(async (targetId: string | number, file: File, photoType: string): Promise<string | null> => {
    try {
      const [result] = await uploadItemFiles(targetId, [file], { workerId, stationTypeId: station.test_station_type_id, photoType });
      return result?.objectKey ?? null;
    } catch { return null; }
  }, [workerId, station.test_station_type_id]);

  const pickBoxPhoto = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setBoxPhotos((p) => ({ ...p, photos: [...p.photos, { previewUrl, uploading: true }] }));
    uploadTo(item.item_id, file, PT_PACKAGE).then((key) =>
      setBoxPhotos((p) => ({ ...p, photos: p.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false, failed: key == null } : s)) })));
  };
  const pickItemPhoto = (it: PackageItemView, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const w = workOf(it.item_id);
    patchWork(it.item_id, { photos: { ...w.photos, photos: [...w.photos.photos, { previewUrl, uploading: true }] } });
    uploadTo(it.item_id, file, PT_PRODUCT).then((key) =>
      setWork((all) => {
        const cur = all[it.item_id] ?? freshWork();
        return { ...all, [it.item_id]: { ...cur, photos: { ...cur.photos, photos: cur.photos.photos.map((s) => (s.previewUrl === previewUrl ? { ...s, objectKey: key ?? undefined, uploading: false, failed: key == null } : s)) } } };
      }));
  };

  const startItem = async (idx: number) => {
    const it = items[idx];
    setItemIdx(idx); setItemPhase("photo"); setError(null);
    const w = workOf(it.item_id);
    if (w.hasRU == null) {
      setBusy(true);
      try {
        const sku = (templateSkuOf(pkg!, it) ?? it.manufacturer_no ?? it.makat ?? "").trim();
        const r = sku ? await lookupReference(sku, it.item_type_id) : { hasRU: false, refWeight: null, imagesByType: {} as Record<string, RefImg[]> };
        patchWork(it.item_id, { hasRU: r.hasRU, refWeight: r.refWeight, refImages: r.imagesByType[PT_PRODUCT] ?? [] });
      } catch {
        patchWork(it.item_id, { hasRU: false });
      } finally {
        setBusy(false);
      }
    }
  };

  const reloadItems = async () => {
    const res = await apiFetch(`/api/packages/${item.item_id}`);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data?.package?.items)) setItems(data.package.items);
  };

  const addMissing = async () => {
    if (!add.itemType || !add.serialNumber.trim() || !add.makat.trim() || !add.model.trim() || !add.manufacturer.trim()) {
      setError("להוספת פריט יש למלא סוג, סריאלי, מק״ט, דגם ויצרן"); return;
    }
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/api/packages/${item.item_id}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: Number(add.itemType), serialNumber: add.serialNumber, makat: add.makat, model: add.model, manufacturer: add.manufacturer }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error || "הוספת הפריט נכשלה"); return; }
      setAdd({ itemType: "", serialNumber: "", makat: "", model: "", manufacturer: "" }); setAddOpen(false);
      await reloadItems();
    } catch {
      setError("שגיאה בתקשורת");
    } finally {
      setBusy(false);
    }
  };

  if (!open || !pkg) return null;

  // ---- derived -------------------------------------------------------------
  const inItemFlow = itemIdx != null;
  const cur = inItemFlow ? items[itemIdx!] : null;
  const curWork = cur ? workOf(cur.item_id) : null;
  const doneCount = items.filter((it) => workOf(it.item_id).done).length;
  const templateCount = Array.isArray(pkg.template_snapshot)
    ? (pkg.template_snapshot as { quantity?: number }[]).reduce((n, l) => n + Math.max(1, Number(l.quantity ?? 1)), 0)
    : items.length;
  const counted = countInput.trim() === "" ? null : Number(countInput);
  const countMismatch = (counted != null && counted !== items.length) || items.length !== templateCount;
  const stepKey = STEPS[step].key;
  const wr = curWork ? weightResult(curWork.refWeight, curWork.meas) : null;
  const boxPass = boxPhotos.ok === "pass";
  const itemPass = (it: PackageItemView) => { const w = workOf(it.item_id); const r = weightResult(w.refWeight, w.meas); return w.photos.ok !== "fail" && (r == null || r.pass); };

  let stepTitle = STEPS[step].label;
  let stepSubtitle = "";
  let systemMsg: string | null = null;
  if (inItemFlow && cur) {
    if (itemPhase === "photo") { stepTitle = `${cur.item_type_desc} · צילום`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · ${cur.makat ?? ""}`; systemMsg = "נא לצלם את הפריט בדיוק לפי תמונות הייחוס."; }
    else { stepTitle = `${cur.item_type_desc} · שקילה`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · משקל ייחוס מהקטלוג`; systemMsg = "נא לשקול את הפריט ולהזין את המשקל שנמדד."; }
  } else if (stepKey === "scan") { stepSubtitle = "סרוק את מדבקת הקופסה כדי לפתוח את המארז בעמדה."; systemMsg = "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה."; }
  else if (stepKey === "boxPhoto") { stepSubtitle = "שלוש זוויות של הקופסה, ואז קביעת תקינות."; systemMsg = "נא לצלם את הקופסה בדיוק לפי תמונות הייחוס."; }
  else if (stepKey === "items") { stepSubtitle = "כל פריט עובר צילום ושקילה. אפשר לעבוד בכל סדר."; }
  else if (stepKey === "count") { stepSubtitle = "מה שנספר בעמדה מול מה שנרשם בקליטה ומול התבנית."; }
  else if (stepKey === "labels") { stepSubtitle = "בחר מה להדפיס. מדבקת הקופסה נדרשת תמיד."; }

  let nextLabel = "המשך";
  let nextEnabled = true;
  if (inItemFlow && curWork) {
    nextLabel = itemPhase === "weigh" ? "סיום פריט" : "המשך";
    nextEnabled = itemPhase === "photo" ? curWork.photos.ok !== "" && !curWork.photos.photos.some((s) => s.uploading) : curWork.meas.trim() !== "";
  } else if (stepKey === "scan") nextEnabled = scan.trim() !== "";
  else if (stepKey === "boxPhoto") nextEnabled = boxPhotos.ok !== "" && !boxPhotos.photos.some((s) => s.uploading);
  else if (stepKey === "items") { nextEnabled = items.length > 0 && doneCount === items.length; nextLabel = nextEnabled ? "המשך לספירה" : `נותרו ${items.length - doneCount} פריטים`; }
  else if (stepKey === "count") nextEnabled = counted != null;
  else if (stepKey === "labels") nextLabel = "הדפס וסיים";
  else if (stepKey === "done") nextLabel = "חזרה לתור";

  const scanMatches = scan.trim() !== "" && (scan.trim() === (item.makat ?? "").trim() || scan.trim().split("-")[0] === String(item.item_id));

  // ---- finish: one result per item, then the box ---------------------------
  const finish = async () => {
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    const keysOf = (ph: Photos) => ph.photos.map((s) => s.objectKey).filter(Boolean);
    try {
      for (const it of items) {
        if (committedRef.current.has(it.item_id)) continue;
        const w = workOf(it.item_id);
        const r = weightResult(w.refWeight, w.meas);
        const passed = itemPass(it);
        const res = await apiFetch("/api/testing/results", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ItemID: Number(it.item_id), StationID: station.test_station_id, WorkerID: workerId ?? undefined, WorkerName: workerName || undefined, SubmitID: submitId,
            Result: passed ? 1 : 0, Passed: passed, Comments: w.photos.note || undefined,
            Details: {
              sku: templateSkuOf(pkg, it) ?? it.manufacturer_no ?? null, hasRU: w.hasRU,
              weight: r ? { reference: w.refWeight, measured: Number(w.meas), diffPct: Number(r.diffPct.toFixed(1)), pass: r.pass } : null,
              product: { ok: w.photos.ok, note: w.photos.note, photos: keysOf(w.photos) },
              package_id: String(item.item_id), opening: true,
            },
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(`שמירת הפריט ${it.serial_no ?? seq2(it.package_seq)} נכשלה${d?.error ? ` — ${d.error}` : ` (${res.status})`}`);
        }
        committedRef.current.add(it.item_id);
      }
      await onSubmit({
        Result: boxPass ? 1 : 0, Passed: boxPass, Comments: boxPhotos.note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          sku: scan.trim(), hasRU: boxHasRU,
          pkg: { ok: boxPhotos.ok, note: boxPhotos.note, photos: keysOf(boxPhotos) },
          itemCount: counted ?? items.length, registeredCount: items.length, templateCount, labelsPrinted,
          packageItemIds: items.map((it) => it.item_id), opening: true,
        },
      });
      setStep(STEPS.length - 1);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "שגיאה בשמירת פתיחת המארז");
    } finally {
      setSubmitting(false);
    }
  };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (inItemFlow && cur) {
      if (itemPhase === "photo") { setItemPhase("weigh"); return; }
      patchWork(cur.item_id, { done: true }); setItemIdx(null); return;
    }
    if (stepKey === "labels") { setLabelsOpen(true); return; }
    if (stepKey === "done") { onClose(); return; }
    setStep((s) => Math.min(STEPS.length - 2, s + 1));
  };
  const onBack = () => {
    setError(null);
    if (inItemFlow) { if (itemPhase === "weigh") setItemPhase("photo"); else setItemIdx(null); return; }
    if (step > 0 && stepKey !== "done") setStep((s) => s - 1);
  };

  const itemStepper: ItemStepperRow[] | null = stepKey === "items" || inItemFlow
    ? items.map((it, i) => {
        const w = workOf(it.item_id);
        const active = itemIdx === i;
        return { key: it.item_id, type: it.item_type_desc, badge: seq2(it.package_seq), stateLabel: w.done ? "הושלם" : active ? (itemPhase === "photo" ? "צילום" : "שקילה") : "ממתין", active, done: w.done, onClick: () => startItem(i) };
      })
    : null;

  const choiceBox = (value: Photos["ok"], onPick: (v: "pass" | "fail") => void) => <PassFail value={value} onChange={onPick} />;
  const doneStep = stepKey === "done";

  return (
    <>
      <PackageWizardShell
        open={open} onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title="פתיחת מארז" pkg={pkg} workerName={workerName}
        steps={STEPS} stepIndex={step} onStep={(i) => { if (!doneStep && !submitting && i < STEPS.length - 1) { setItemIdx(null); setStep(i); } }}
        itemStepper={itemStepper} itemProgress={`${doneCount}/${items.length}`}
        stepTitle={stepTitle} stepSubtitle={stepSubtitle}
        stepCounter={inItemFlow ? `פריט ${itemIdx! + 1} מתוך ${items.length}` : `שלב ${step + 1} מתוך ${STEPS.length}`}
        systemMsg={systemMsg}
        footNote={inItemFlow ? "יציאה מהפריט שומרת את מה שהוזן" : "הכל נשמר בזמן אמת"}
        backDisabled={(step === 0 && !inItemFlow) || doneStep}
        onBack={onBack} nextLabel={nextLabel} nextEnabled={nextEnabled && !busy} onNext={onNext} busy={submitting}
      >
        {error && (
          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid rgba(191,53,53,0.25)", borderRadius: 10, padding: "11px 14px" }}>
            <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} /></span>
            <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error}</div>
          </div>
        )}

        {inItemFlow && cur && curWork ? (
          itemPhase === "photo" ? (
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
              {curWork.hasRU === false && <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>לסוג הפריט אין פריט ייחוס — צלם לפי שיקול דעת והמשך.</div>}
              <PhotoUploader photos={curWork.photos.photos} refImages={curWork.refImages} onPick={(f) => pickItemPhoto(cur, f)}
                onRemove={(i) => patchWork(cur.item_id, { photos: { ...curWork.photos, photos: curWork.photos.photos.filter((_, j) => j !== i) } })} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>הפריט תקין?</div>
                <div style={{ marginTop: 10 }}>{choiceBox(curWork.photos.ok, (v) => patchWork(cur.item_id, { photos: { ...curWork.photos, ok: v } }))}</div>
                <div style={{ fontSize: 12.5, color: MUTED, margin: "16px 0 7px" }}>הערות</div>
                <textarea value={curWork.photos.note} onChange={(e) => patchWork(cur.item_id, { photos: { ...curWork.photos, note: e.target.value } })} placeholder="אופציונלי" style={{ width: "100%", maxWidth: 560, minHeight: 76, border: `1px solid ${HAIR}`, borderRadius: 11, padding: "11px 13px", fontSize: 14, resize: "vertical", outline: "none", fontFamily: "inherit" }} />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 620 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט ייחוס</div>
                  <div style={{ height: 52, border: `1px solid ${HAIR}`, borderRadius: 11, background: "#f5f5f7", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 17, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{curWork.refWeight != null ? `${curWork.refWeight} גר׳` : "לא מוגדר"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט נבדק</div>
                  <input value={curWork.meas} onChange={(e) => patchWork(cur.item_id, { meas: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="גר׳" inputMode="decimal"
                    style={{ ...fieldInput, height: 52, borderRadius: 11, fontSize: 17, fontVariantNumeric: "tabular-nums", borderColor: curWork.meas !== "" ? FOCUS : HAIR }} />
                </div>
              </div>
              {wr && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 11, background: wr.pass ? GREEN_BG : RED_BG, border: `1px solid ${wr.pass ? "rgba(31,138,91,0.22)" : "rgba(191,53,53,0.25)"}`, borderRadius: 11, padding: "13px 15px", marginTop: 16, maxWidth: 620 }}>
                  <span style={{ color: wr.pass ? GREEN : RED, marginTop: 1, display: "inline-flex" }}><Check size={18} strokeWidth={2} /></span>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: wr.pass ? GREEN : RED }}>{wr.pass ? "משקל תקין" : "משקל לא תקין"}</div>
                    <div style={{ fontSize: 13, color: INK_2, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>סטייה {wr.diff >= 0 ? "+" : "−"}{Math.abs(wr.diff).toFixed(0)} גר׳ ({wr.diffPct.toFixed(1)}% · סטייה תקנית ±{TOLERANCE_PCT}%)</div>
                  </div>
                </div>
              )}
              {curWork.refWeight == null && curWork.meas !== "" && <div style={{ marginTop: 16, fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px", maxWidth: 620 }}>אין משקל ייחוס לסוג פריט זה — המשקל נרשם ללא השוואה.</div>}
            </div>
          )
        ) : stepKey === "scan" ? (
          <div style={{ maxWidth: 420, marginTop: 20 }}>
            <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>מק״ט המארז</div>
            <input value={scan} onChange={(e) => setScan(e.target.value)} autoFocus placeholder="סרוק את מדבקת הקופסה"
              onKeyDown={(e) => { if (e.key === "Enter") onNext(); }}
              style={{ ...fieldInput, height: 52, borderRadius: 11, fontSize: 17, fontVariantNumeric: "tabular-nums", letterSpacing: 1, borderColor: scan.trim() === "" ? HAIR : FOCUS }} />
            {scan.trim() !== "" && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, background: scanMatches ? GREEN_BG : AMBER_BG, border: `1px solid ${scanMatches ? "rgba(31,138,91,0.22)" : AMBER_BORDER}`, borderRadius: 11, padding: "12px 14px", marginTop: 12 }}>
                <span style={{ color: scanMatches ? GREEN : AMBER_INK, display: "inline-flex" }}>{scanMatches ? <Check size={18} strokeWidth={2} /> : <CircleAlert size={18} strokeWidth={2} />}</span>
                <div style={{ fontSize: 14, fontWeight: 600, color: scanMatches ? GREEN : AMBER_INK }}>
                  {scanMatches ? `זוהה ${pkg.item_type_desc} · ${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}` : "הסריקה לא תואמת למק״ט או למזהה של המארז — בדוק שזו הקופסה הנכונה"}
                </div>
              </div>
            )}
          </div>
        ) : stepKey === "boxPhoto" ? (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            {boxHasRU === false && <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>לסוג המארז אין פריט ייחוס — צלם את הקופסה משלוש זוויות והמשך.</div>}
            <PhotoUploader photos={boxPhotos.photos} refImages={boxRef} onPick={pickBoxPhoto} onRemove={(i) => setBoxPhotos((p) => ({ ...p, photos: p.photos.filter((_, j) => j !== i) }))} />
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>האריזה תקינה?</div>
              <div style={{ marginTop: 10 }}>{choiceBox(boxPhotos.ok, (v) => setBoxPhotos((p) => ({ ...p, ok: v })))}</div>
              <div style={{ fontSize: 12.5, color: MUTED, margin: "16px 0 7px" }}>הערות</div>
              <textarea value={boxPhotos.note} onChange={(e) => setBoxPhotos((p) => ({ ...p, note: e.target.value }))} placeholder="אופציונלי" style={{ width: "100%", maxWidth: 560, minHeight: 76, border: `1px solid ${HAIR}`, borderRadius: 11, padding: "11px 13px", fontSize: 14, resize: "vertical", outline: "none", fontFamily: "inherit" }} />
            </div>
          </div>
        ) : stepKey === "items" ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it, i) => {
                const w = workOf(it.item_id);
                return (
                  <div key={it.item_id} style={{ border: `1px solid ${w.done ? "rgba(31,138,91,0.3)" : HAIR}`, borderRadius: 14, padding: "14px 16px", background: w.done ? "rgba(31,138,91,0.04)" : "#fff", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: w.done ? "rgba(31,138,91,0.1)" : "#f5f5f7", color: w.done ? GREEN : MUTED, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}{w.refWeight != null ? ` · ייחוס ${w.refWeight} גר׳` : ""}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: w.done ? GREEN : MUTED, fontWeight: 600, whiteSpace: "nowrap" }}>{w.done ? "צולם ונשקל" : "ממתין"}</div>
                    <button type="button" onClick={() => startItem(i)} disabled={busy} style={{ minHeight: 44, background: w.done ? "#fff" : BLUE, color: w.done ? INK : "#fff", border: w.done ? `1px solid ${HAIR}` : 0, borderRadius: 9999, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>{w.done ? "פתח שוב" : "התחל"}</button>
                  </div>
                );
              })}
            </div>
            {addOpen ? (
              <div style={{ marginTop: 16, border: `1px solid ${HAIR}`, borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, maxWidth: 620 }}>
                <select value={add.itemType} onChange={(e) => setAdd({ ...add, itemType: e.target.value })} style={{ ...fieldInput, height: 40, cursor: "pointer" }}>
                  <option value="">סוג פריט…</option>
                  {itemTypes.filter((t) => !t.is_package).map((t) => <option key={t.item_type_id} value={t.item_type_id}>{t.item_type_desc}</option>)}
                </select>
                <input placeholder="מספר סריאלי" value={add.serialNumber} onChange={(e) => setAdd({ ...add, serialNumber: e.target.value })} style={{ ...fieldInput, height: 40 }} />
                <input placeholder="מק״ט" value={add.makat} onChange={(e) => setAdd({ ...add, makat: e.target.value })} style={{ ...fieldInput, height: 40 }} />
                <input placeholder="דגם" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} style={{ ...fieldInput, height: 40 }} />
                <input placeholder="יצרן" value={add.manufacturer} onChange={(e) => setAdd({ ...add, manufacturer: e.target.value })} style={{ ...fieldInput, height: 40 }} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setAddOpen(false)} style={{ minHeight: 40, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: INK }}>ביטול</button>
                  <button type="button" onClick={addMissing} disabled={busy} style={{ minHeight: 40, background: BLUE, color: "#fff", border: 0, borderRadius: 9999, padding: "9px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>הוסף</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAddOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 16, fontSize: 14, fontWeight: 600, color: BLUE, background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                <Plus size={16} strokeWidth={2} />הוסף פריט שלא נרשם בקליטה
              </button>
            )}
          </div>
        ) : stepKey === "count" ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, maxWidth: 620 }}>
              <div style={{ border: `1px solid ${counted != null && counted !== items.length ? AMBER_BORDER : HAIR}`, borderRadius: 14, padding: "16px 18px", background: counted != null && counted !== items.length ? AMBER_BG : "#fff" }}>
                <input value={countInput} onChange={(e) => setCountInput(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" autoFocus placeholder="—"
                  style={{ width: "100%", border: 0, outline: "none", background: "transparent", fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1, color: INK, fontVariantNumeric: "tabular-nums", fontFamily: "inherit", padding: 0 }} />
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 7 }}>נספר בעמדה</div>
              </div>
              <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, padding: "16px 18px", background: "#fff" }}>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1, color: INK, fontVariantNumeric: "tabular-nums" }}>{items.length}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 7 }}>נרשם בקליטה</div>
              </div>
              <div style={{ border: `1px solid ${items.length !== templateCount ? AMBER_BORDER : HAIR}`, borderRadius: 14, padding: "16px 18px", background: items.length !== templateCount ? AMBER_BG : "#fff" }}>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1, color: items.length !== templateCount ? AMBER_INK : INK, fontVariantNumeric: "tabular-nums" }}>{templateCount}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 7 }}>תכולת המארז (תבנית)</div>
              </div>
            </div>
            {countMismatch && counted != null && (
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start", background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 12, padding: "13px 15px", marginTop: 16, maxWidth: 620 }}>
                <span style={{ color: AMBER_INK, marginTop: 1, display: "inline-flex" }}><CircleAlert size={18} strokeWidth={2} /></span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: AMBER_INK }}>{counted !== items.length ? `נרשמו ${items.length} פריטים, בעמדה נספרו ${counted}` : `התבנית מצפה ל-${templateCount} פריטים, נרשמו ${items.length}`}</div>
                  <div style={{ fontSize: 13, color: INK_2, marginTop: 3, lineHeight: 1.5 }}>הוסף את הפריט החסר, או המשך והפער יירשם על המארז ויופיע בעמוד המארז.</div>
                </div>
              </div>
            )}
          </div>
        ) : stepKey === "labels" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 20 }}>
            {[{ kind: "מדבקת קופסה", title: pkg.item_type_desc, note: `${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}`, id: item.item_id }]
              .concat(items.map((it) => ({ kind: "מדבקת פריט", title: it.item_type_desc, note: `פריט ${seq2(it.package_seq)} מתוך ${seq2(items.length)}`, id: Number(it.item_id) })))
              .map((l, i) => (
                <div key={`${l.id}-${i}`} style={{ width: 214, border: `1px solid ${BLUE}`, background: "#f7fbff", borderRadius: 14, padding: "15px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{l.kind}</div>
                    <span style={{ width: 20, height: 20, borderRadius: 6, border: `1px solid ${BLUE}`, background: BLUE, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={11} strokeWidth={2.5} /></span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 44, marginTop: 12 }}>
                    {Array.from({ length: 22 }, (_, b) => <div key={b} style={{ width: ((b + i) % 3) + 1, height: "100%", background: INK }} />)}
                  </div>
                  <div style={{ fontFamily: "'Inter', monospace", fontSize: 12.5, letterSpacing: 1.5, marginTop: 9, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right", color: MUTED_LT }}>…{String(l.id).slice(-6)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 7 }}>{l.title}</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{l.note}</div>
                </div>
              ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(31,138,91,0.09)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} /></span>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>פתיחת המארז הושלמה</div>
            <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>כל פריט קיבל תוצאה וממשיך לעמדה הראשונה במסלול שלו. המארז ממתין לסגירה עד שכל פריטיו יחזרו.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
              {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: itemPass(it) ? BLUE : GREY }} />)}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.length} פריטים נפתחו · {pkg.item_type_desc}</div>
          </div>
        )}
      </PackageWizardShell>

      {labelsOpen && (
        <PackageLabelsDialog
          open
          onClose={() => { setLabelsOpen(false); finish(); }}
          onPrinted={() => setLabelsPrinted(true)}
          packageId={item.item_id}
          packageType={pkg.item_type_desc}
          customerLine={`${pkg.customer_name ?? pkg.customer_code ?? ""} · משלוח ${pkg.shipment_code ?? ""}`}
          sourceId={item.source_id ?? null}
          items={items.map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, serial_no: it.serial_no }))}
        />
      )}
    </>
  );
}
