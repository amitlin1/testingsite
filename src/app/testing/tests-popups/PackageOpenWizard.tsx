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
import { NO_REF, ScanField, useReferenceLookup } from "./referenceScan";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, GREEN_BG, GREY, HAIR, INK, INK_2, MUTED, RED, RED_BG, seq2,
} from "@/app/components/packages/packageUi";
import { COPY_PENDING, SUGGEST_PREFIX, fieldsGateText } from "@/app/lib/station-fields/labels";
import type { DraftShot } from "@/app/lib/station-fields/evaluate";
import type { Field } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import { NotesField } from "@/app/testing/fields/NotesField";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE, VARIANT_SPEC, draftsFieldsState, kitItemFieldGroups, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { WORKER_COPY_PENDING } from "@/app/testing/fields/labels";
import { buildFieldsBlock, inputFieldCount, useFieldsState, type Drafts } from "@/app/testing/fields/useFieldsState";
import { findKitItem, kitItemDefs, useStationFields } from "@/app/testing/fields/useStationFields";
import "@/app/packages/packages.css";

/**
 * אשף פתיחת מארז — design/Package Stations.dc.html (open). Runs on a
 * package-level opening station for a PACKAGE row (item.package is its view).
 * Six steps: scan → box photos → items (scan → photo → weigh each) →
 * count → labels → done. On "הדפס וסיים" every item gets its own result at this
 * station and then the box does, all under one submit id
 * (docs/packages/PLAN.md §4). Reference images / weights come from what the
 * worker scans: the box label is looked up among the package type's
 * reference items, each item's label among its own type's. A scan that finds
 * nothing warns and lets the worker go on without a reference.
 *
 * Station fields (route-fields spec §4.11.3): when the kit's route publishes
 * fields for this step, the box photo step holds the box's block (artboard 15)
 * and each item's photo screen its own (artboard 16, "לכל פריט" + the item
 * type's group), each right before its verdict question, with the suggestion
 * under the question and the notes as a NotesField. Each item's drafts live in
 * its work, so leaving an item or "פתח שוב" keeps them. Without a config the
 * wizard is exactly as before.
 */

const PT_PACKAGE = "package";
const PT_PRODUCT = "product";
const TOLERANCE_PCT = 5;

const STEPS: WizardStep[] = [
  { key: "scan", label: "סריקת מק״ט המארז", note: "מדבקת הקופסה" },
  { key: "boxPhoto", label: "צילום הקופסה", note: "3 זוויות + תקינות" },
  { key: "items", label: "פריטים במארז", note: "סריקה, צילום ושקילה לכל פריט" },
  { key: "count", label: "ספירה", note: "הוזן מול רשום" },
  { key: "labels", label: "מדבקות", note: "קופסה + פריטים" },
  { key: "done", label: "סיום", note: "" },
];

type ItemWork = {
  /** What is typed / scanned on the item's scan screen. */
  scan: string;
  /** The SKU the reference below was looked up by; null until scanned. */
  sku: string | null;
  photos: Photos;
  refImages: RefImg[];
  refWeight: number | null;
  hasRU: boolean | null;
  meas: string;
  done: boolean;
  /** The item's station-field drafts, by FieldId (route-fields; empty without a config). */
  fields: Drafts;
};

const freshWork = (): ItemWork => ({ scan: "", sku: null, photos: emptyPhotos(), refImages: [], refWeight: null, hasRU: null, meas: "", done: false, fields: {} });

/** The shots taken in the photo fields among `defs` (station fields). */
const fieldShots = (defs: readonly Field[], drafts: Readonly<Drafts>): DraftShot[] =>
  defs.flatMap((d) => (d.type === "photo" ? drafts[d.id]?.photos ?? [] : []));

function weightResult(ref: number | null, meas: string) {
  if (ref == null || meas.trim() === "") return null;
  const m = Number(meas);
  if (!Number.isFinite(m)) return null;
  const diff = m - ref;
  const diffPct = ref !== 0 ? (Math.abs(diff) / ref) * 100 : 0;
  return { diff, diffPct, pass: diffPct <= TOLERANCE_PCT };
}

type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };

export default function PackageOpenWizard({ open, onClose, item, station, workerId, workerName, onSubmit }: StationTestDialogProps) {
  const pkg = item.package as PackageView | null;
  const [step, setStep] = React.useState(0);
  const [scan, setScan] = React.useState("");
  const [boxPhotos, setBoxPhotos] = React.useState<Photos>(emptyPhotos());
  const [items, setItems] = React.useState<PackageItemView[]>(pkg?.items ?? []);
  const [work, setWork] = React.useState<Record<string, ItemWork>>({});
  const [itemIdx, setItemIdx] = React.useState<number | null>(null);
  const [itemPhase, setItemPhase] = React.useState<"scan" | "photo" | "weigh">("scan");
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
  const uid = React.useId();

  // ---- station fields (route-fields spec §4.11.3) ---------------------------
  // Asked for on the box row, so a config answers "package": the box's fields
  // and every kit item's groups. `fieldsCfg` is that answer once it is in —
  // null while it loads, after a failed load, and with no config (legacy).
  const sf = useStationFields(item.item_id, open && pkg != null, station.test_station_id);
  const fieldsCfg = sf.status === "ready" && sf.mode === "package" ? sf : null;
  const boxFx = useFieldsState(fieldsCfg ? fieldsCfg.box : []);
  const { reset: resetBoxFields } = boxFx;
  // Asks again whatever the answer was (the drafts stay, by FieldId): after a
  // 409 FIELDS_SCHEMA_MISMATCH, and after an item is added — it is not in the
  // answer the wizard opened with, and it can give a kit that answered "legacy"
  // (no fields for what was registered) fields of its own.
  const reloadFields = sf.reload;

  // ---- open: reset ----------------------------------------------------------
  React.useEffect(() => {
    if (!open || !pkg) return;
    setStep(0); setScan(""); setBoxPhotos(emptyPhotos());
    setItems(pkg.items); setWork({}); setItemIdx(null); setItemPhase("scan"); setCountInput("");
    setLabelsOpen(false); setLabelsPrinted(false); setSubmitting(false); setError(null); setAddOpen(false);
    submitIdRef.current = null; committedRef.current = new Set();
    resetBoxFields();
    apiFetch("/api/itemTypes").then((r) => (r.ok ? r.json() : [])).then((d) => setItemTypes(Array.isArray(d) ? d : [])).catch(() => setItemTypes([]));
  }, [open, pkg, resetBoxFields]);

  // ---- reference lookups, driven by what is scanned -------------------------
  // The box: its label among the package type's reference items. The answer
  // also supplies the box-photo reference set, so it stays live past step 1.
  const boxLookup = useReferenceLookup(scan, item.item_type_id, open);
  const boxHasRU = boxLookup.ref ? boxLookup.ref.hasRU : null;
  const boxRef = boxLookup.ref?.imagesByType[PT_PACKAGE] ?? [];
  // The item being worked on: its label among its own type's reference items,
  // only while its scan screen is up. Moving on copies the answer into its work.
  const scanItem = itemIdx != null ? items[itemIdx] : null;
  const itemLookup = useReferenceLookup(scanItem ? (work[scanItem.item_id]?.scan ?? "") : "", scanItem?.item_type_id, itemPhase === "scan");

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

  // Every item starts at its scan screen; a reopened one shows its last scan,
  // and moving on with it unchanged keeps the photos already taken.
  const startItem = (idx: number) => {
    setItemIdx(idx); setItemPhase("scan"); setError(null);
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
      reloadFields();
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
  const memberTypes = itemTypes.filter((t) => !t.is_package);
  const templateCount = Array.isArray(pkg.template_snapshot)
    ? (pkg.template_snapshot as { quantity?: number }[]).reduce((n, l) => n + Math.max(1, Number(l.quantity ?? 1)), 0)
    : items.length;
  const counted = countInput.trim() === "" ? null : Number(countInput);
  const countMismatch = (counted != null && counted !== items.length) || items.length !== templateCount;
  const stepKey = STEPS[step].key;
  const wr = curWork ? weightResult(curWork.refWeight, curWork.meas) : null;
  const boxPass = boxPhotos.ok === "pass";
  const itemPass = (it: PackageItemView) => { const w = workOf(it.item_id); const r = weightResult(w.refWeight, w.meas); return w.photos.ok !== "fail" && (r == null || r.pass); };

  // Station fields. A step that holds them waits until they have answered
  // (loading, or a failed load), then for their gate: required fields and
  // notes, a note over its maximum, a field's shot still uploading or failed.
  // Without a config nothing here draws or gates.
  const fieldsWaiting = sf.status === "loading" || sf.status === "error";
  const fieldsGateOn = fieldsCfg?.gate ?? false;
  const boxHasFields = boxFx.defsCount > 0;
  const boxGate = fieldsWaiting || boxFx.blocking(fieldsGateOn);
  /** A kit item's fields ("לכל פריט", then its type's), and its drafts as a block's state. */
  const itemFieldsOf = (it: PackageItemView): { defs: Field[]; fx: DraftsFieldsState } => {
    const defs = kitItemDefs(findKitItem(sf, it.item_id));
    const fx = draftsFieldsState(defs, workOf(it.item_id).fields, (next) => setWork((all) => {
      const w = all[it.item_id] ?? freshWork();
      return { ...all, [it.item_id]: { ...w, fields: next(w.fields) } };
    }));
    return { defs, fx };
  };
  // The item on screen: its block's state while it has fields, and its gate.
  const curItemFields = cur ? itemFieldsOf(cur) : null;
  const curFx = curItemFields && inputFieldCount(curItemFields.defs) > 0 ? curItemFields.fx : null;
  const itemGate = fieldsWaiting || (curItemFields?.fx.blocking(fieldsGateOn) ?? false);

  let stepTitle = STEPS[step].label;
  let stepSubtitle = "";
  let systemMsg: string | null = null;
  if (inItemFlow && cur) {
    if (itemPhase === "scan") { stepTitle = `${cur.item_type_desc} · סריקה`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · ${cur.makat ?? ""}`; systemMsg = "סרוק את מק״ט היצרן של הפריט — לפיו נטענים תמונות ומשקל הייחוס."; }
    else if (itemPhase === "photo") { stepTitle = `${cur.item_type_desc} · צילום`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · ${cur.makat ?? ""}`; systemMsg = "נא לצלם את הפריט בדיוק לפי תמונות הייחוס."; }
    else { stepTitle = `${cur.item_type_desc} · שקילה`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · משקל ייחוס מהקטלוג`; systemMsg = "נא לשקול את הפריט ולהזין את המשקל שנמדד."; }
  } else if (stepKey === "scan") { stepSubtitle = "סרוק את מדבקת הקופסה כדי לפתוח את המארז בעמדה."; systemMsg = "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה."; }
  else if (stepKey === "boxPhoto") { stepSubtitle = "שלוש זוויות של הקופסה, ואז קביעת תקינות."; systemMsg = "נא לצלם את הקופסה בדיוק לפי תמונות הייחוס."; }
  else if (stepKey === "items") { stepSubtitle = "כל פריט עובר סריקה, צילום ושקילה. אפשר לעבוד בכל סדר."; }
  else if (stepKey === "count") { stepSubtitle = "מה שנספר בעמדה מול מה שנרשם בקליטה ומול התבנית."; }
  else if (stepKey === "labels") { stepSubtitle = "בחר מה להדפיס. מדבקת הקופסה נדרשת תמיד."; }

  let nextLabel = "המשך";
  let nextEnabled = true;
  if (inItemFlow && curWork) {
    nextLabel = itemPhase === "weigh" ? "סיום פריט" : "המשך";
    // A shot still uploading, or one whose upload failed, blocks the step: a
    // failed upload leaves nothing in storage, so continuing would silently
    // lose the photo. The worker removes the red shot and takes it again.
    const itemShots = curWork.photos.photos;
    nextEnabled = itemPhase === "scan" ? curWork.scan.trim() !== "" && !itemLookup.checking
      : itemPhase === "photo" ? curWork.photos.ok !== "" && !itemShots.some((s) => s.uploading || s.failed) && !itemGate
      : curWork.meas.trim() !== "";
    if (itemPhase === "photo" && itemShots.some((s) => s.failed)) nextLabel = "הסר את הצילום שנכשל";
  } else if (stepKey === "scan") nextEnabled = scan.trim() !== "" && !boxLookup.checking;
  else if (stepKey === "boxPhoto") {
    // With fields the label stays: the block's status says what is missing (artboard 15).
    nextEnabled = boxPhotos.ok !== "" && !boxPhotos.photos.some((s) => s.uploading || s.failed) && !boxGate;
    if (boxPhotos.photos.some((s) => s.failed)) nextLabel = "הסר את הצילום שנכשל";
  }
  else if (stepKey === "items") { nextEnabled = items.length > 0 && doneCount === items.length; nextLabel = nextEnabled ? "המשך לספירה" : `נותרו ${items.length - doneCount} פריטים`; }
  else if (stepKey === "count") nextEnabled = counted != null;
  // Finishing waits while the station fields load (spec §4.2) — e.g. reloading after a 409.
  else if (stepKey === "labels") { nextLabel = "הדפס וסיים"; nextEnabled = sf.status !== "loading"; }
  else if (stepKey === "done") nextLabel = "חזרה לתור";

  // ---- finish: one result per item, then the box ---------------------------
  const finish = async () => {
    // The station fields still to be sent: the box's, and those of every item not saved yet.
    const fieldsToSend = fieldsCfg
      ? [{ defs: fieldsCfg.box, fx: boxFx }, ...items.filter((it) => !committedRef.current.has(it.item_id)).map(itemFieldsOf)]
      : [];
    // Belt and braces for the per-step gate: nothing is submitted while a shot
    // is still uploading or failed, whichever way the worker reached this step
    // (a station field's shots included).
    const shots = [boxPhotos, ...items.map((it) => workOf(it.item_id).photos)].flatMap((ph) => ph.photos)
      .concat(fieldsToSend.flatMap((f) => fieldShots(f.defs, f.fx.drafts)));
    if (shots.some((sh) => sh.uploading || sh.failed)) {
      setError(shots.some((sh) => sh.failed) ? "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום." : "יש צילום שעדיין עולה — המתן לסיום ההעלאה.");
      return;
    }
    // Nor before the station fields have answered, nor with their gate shut
    // (spec §4.11.3) — artboard 14's message, for the box and the items together.
    if (sf.status === "loading") return; // "הדפס וסיים" waits for the answer; what is on screen stays
    if (sf.status === "error") { setError(WORKER_COPY_PENDING.loadFailed); return; }
    const blocked = fieldsToSend.filter((f) => f.fx.blocking(fieldsGateOn));
    if (blocked.length > 0) {
      const missing = (k: "missingRequired" | "missingNotes") => (fieldsGateOn ? blocked.reduce((n, f) => n + f.fx.ev[k].length, 0) : 0);
      setError(fieldsGateText(missing("missingRequired"), missing("missingNotes")) ?? COPY_PENDING.noteTooLong);
      return;
    }
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
              sku: w.sku, hasRU: w.hasRU,
              weight: r ? { reference: w.refWeight, measured: Number(w.meas), diffPct: Number(r.diffPct.toFixed(1)), pass: r.pass } : null,
              product: { ok: w.photos.ok, note: w.photos.note, photos: keysOf(w.photos) },
              package_id: String(item.item_id), opening: true,
              // Station fields: each item answers as "kit_item", on the kit's route, version and step.
              ...(fieldsCfg ? buildFieldsBlock(kitItemDefs(findKitItem(sf, it.item_id)), w.fields, { ...fieldsCfg.schema, target: "kit_item" }, { ok: w.photos.ok }) : {}),
            },
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          if (shouldReloadFields(d)) reloadFields();
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
          ...(fieldsCfg ? boxFx.toBlock({ ...fieldsCfg.schema, target: "box" }, { ok: boxPhotos.ok }) : {}),
        },
      });
      setStep(STEPS.length - 1);
    } catch (e) {
      // The box's 409 arrives as the Error page.tsx throws, carrying the body's code.
      if (shouldReloadFields(e)) reloadFields();
      setError(e instanceof Error && e.message ? e.message : "שגיאה בשמירת פתיחת המארז");
    } finally {
      setSubmitting(false);
    }
  };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (inItemFlow && cur && curWork) {
      if (itemPhase === "scan") {
        const sku = curWork.scan.trim();
        // Same scan as last time: the reference is already in the work, keep it.
        if (sku !== curWork.sku) {
          const ref = itemLookup.ref ?? NO_REF;
          patchWork(cur.item_id, { sku, hasRU: ref.hasRU, refWeight: ref.refWeight, refImages: ref.imagesByType[PT_PRODUCT] ?? [] });
        }
        setItemPhase("photo"); return;
      }
      if (itemPhase === "photo") { setItemPhase("weigh"); return; }
      patchWork(cur.item_id, { done: true }); setItemIdx(null); return;
    }
    if (stepKey === "labels") { setLabelsOpen(true); return; }
    if (stepKey === "done") { onClose(); return; }
    setStep((s) => Math.min(STEPS.length - 2, s + 1));
  };
  const onBack = () => {
    setError(null);
    if (inItemFlow) { if (itemPhase === "weigh") setItemPhase("photo"); else if (itemPhase === "photo") setItemPhase("scan"); else setItemIdx(null); return; }
    if (step > 0 && stepKey !== "done") setStep((s) => s - 1);
  };

  const itemStepper: ItemStepperRow[] | null = stepKey === "items" || inItemFlow
    ? items.map((it, i) => {
        const w = workOf(it.item_id);
        const active = itemIdx === i;
        return { key: it.item_id, type: it.item_type_desc, badge: seq2(it.package_seq), stateLabel: w.done ? "הושלם" : active ? (itemPhase === "scan" ? "סריקה" : itemPhase === "photo" ? "צילום" : "שקילה") : "ממתין", active, done: w.done, onClick: () => startItem(i) };
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
        steps={STEPS} stepIndex={step} onStep={(i) => { if (!doneStep && !submitting && i < STEPS.length - 1 && (i <= step || nextEnabled)) { setItemIdx(null); setStep(i); } }}
        itemStepper={itemStepper} itemProgress={`${doneCount}/${items.length}`}
        stepTitle={stepTitle} stepSubtitle={stepSubtitle}
        stepCounter={inItemFlow ? `פריט ${itemIdx! + 1} מתוך ${items.length}` : `שלב ${step + 1} מתוך ${STEPS.length}`}
        systemMsg={systemMsg}
        footNote={inItemFlow ? "יציאה מהפריט שומרת את מה שהוזן" : "הכל נשמר בזמן אמת"}
        backDisabled={(step === 0 && !inItemFlow) || doneStep}
        onBack={onBack} nextLabel={nextLabel} nextEnabled={nextEnabled && !busy} onNext={onNext} busy={submitting}
      >
        {error && (
          <div role="alert" style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid color-mix(in srgb, var(--color-destructive) 25%, transparent)", borderRadius: 10, padding: "11px 14px" }}>
            <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} aria-hidden /></span>
            <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error}</div>
          </div>
        )}

        {inItemFlow && cur && curWork ? (
          itemPhase === "scan" ? (
            <ScanField key={cur.item_id}
              label="מק״ט יצרן של הפריט" placeholder="סרוק את מדבקת הפריט"
              value={curWork.scan} onChange={(v) => patchWork(cur.item_id, { scan: v })} lookup={itemLookup} onSubmit={onNext}
              found={(ref) => `נמצא פריט ייחוס${ref.name ? ` · ${ref.name}` : ""} · ${(ref.imagesByType[PT_PRODUCT] ?? []).length} תמונות ייחוס${ref.refWeight != null ? ` · ${ref.refWeight} גר׳` : ""}`}
              missing={`לא נמצא פריט ייחוס של ${cur.item_type_desc} עם המק״ט הזה — אפשר להמשיך, הצילום והשקילה יהיו ללא ייחוס`} />
          ) : itemPhase === "photo" ? (
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
              {curWork.hasRU === false && <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>לא נמצא פריט ייחוס למק״ט שנסרק ({curWork.sku}) — צלם לפי שיקול דעת והמשך.</div>}
              <PhotoUploader photos={curWork.photos.photos} refImages={curWork.refImages} onPick={(f) => pickItemPhoto(cur, f)}
                onRemove={(i) => patchWork(cur.item_id, { photos: { ...curWork.photos, photos: curWork.photos.photos.filter((_, j) => j !== i) } })} />
              {/* Artboard 16: the item's fields before "הפריט תקין?" — a group label even for a lone group. */}
              {fieldsCfg ? curFx && (
                <FieldsBlock key={cur.item_id} variant="kit-item" title={BLOCK_TITLE.kitItem}
                  groups={kitItemFieldGroups(findKitItem(sf, cur.item_id))} fx={curFx} idPrefix={`${uid}-fx${cur.item_id}`}
                  uploadPhoto={(file, photoType) => uploadTo(cur.item_id, file, photoType)} />
              ) : <FieldsBlockFallback sf={sf} />}
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>הפריט תקין?</div>
                <div style={{ marginTop: 10 }}>{choiceBox(curWork.photos.ok, (v) => patchWork(cur.item_id, { photos: { ...curWork.photos, ok: v } }))}</div>
                {curFx && <SuggestionLine fails={curFx.ev.fails} defs={curItemFields?.defs ?? []} prefix={SUGGEST_PREFIX} decided={curWork.photos.ok} style={{ marginTop: 10 }} />}
                <label htmlFor={`${uid}-item-note`} style={{ display: "block", fontSize: 12.5, color: MUTED, margin: "16px 0 7px" }}>הערות</label>
                {curFx ? (
                  <NotesField size="area" id={`${uid}-item-note`} value={curWork.photos.note} onChange={(note) => patchWork(cur.item_id, { photos: { ...curWork.photos, note } })}
                    placeholder="אופציונלי" editorTitle={`הערות · ${cur.item_type_desc}`} look={VARIANT_SPEC["kit-item"].noteLook} />
                ) : (
                  <textarea id={`${uid}-item-note`} value={curWork.photos.note} onChange={(e) => patchWork(cur.item_id, { photos: { ...curWork.photos, note: e.target.value } })} placeholder="אופציונלי" className="pkg-field pkg-field--area" style={{ maxWidth: 560 }} />
                )}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 620 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט ייחוס</div>
                  <div className="pkg-field pkg-field--lg pkg-field--static" style={{ fontVariantNumeric: "tabular-nums" }}>{curWork.refWeight != null ? `${curWork.refWeight} גר׳` : "לא מוגדר"}</div>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label htmlFor={`${uid}-meas`} style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט נבדק</label>
                  {/* The focus ring, not the value, marks the field (A11-2); a weight reads left-to-right. */}
                  <input id={`${uid}-meas`} dir="ltr" value={curWork.meas} onChange={(e) => patchWork(cur.item_id, { meas: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="גר׳" inputMode="decimal"
                    className="pkg-field pkg-field--lg pkg-field--code" />
                </div>
              </div>
              {wr && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 11, background: wr.pass ? GREEN_BG : RED_BG, border: `1px solid ${wr.pass ? "color-mix(in srgb, var(--color-status-approved) 22%, transparent)" : "color-mix(in srgb, var(--color-destructive) 25%, transparent)"}`, borderRadius: 11, padding: "13px 15px", marginTop: 16, maxWidth: 620 }}>
                  {/* ✓ only when it passes; out of tolerance gets the alert mark. */}
                  <span style={{ color: wr.pass ? GREEN : RED, marginTop: 1, display: "inline-flex" }}>{wr.pass ? <Check size={18} strokeWidth={2} aria-hidden /> : <CircleAlert size={18} strokeWidth={2} aria-hidden />}</span>
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
          <ScanField
            label="מק״ט המארז" placeholder="סרוק את מדבקת הקופסה"
            value={scan} onChange={setScan} lookup={boxLookup} onSubmit={onNext}
            found={(ref) => `זוהה ${pkg.item_type_desc}${ref.name ? ` · ${ref.name}` : ""} · ${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}`}
            missing={`לא נמצא פריט ייחוס של ${pkg.item_type_desc} עם המק״ט הזה — בדוק שזו הקופסה הנכונה. אפשר להמשיך, צילום הקופסה יהיה ללא ייחוס`} />
        ) : stepKey === "boxPhoto" ? (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            {boxHasRU === false && <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>לא נמצא פריט ייחוס למק״ט המארז שנסרק — צלם את הקופסה משלוש זוויות והמשך.</div>}
            <PhotoUploader photos={boxPhotos.photos} refImages={boxRef} onPick={pickBoxPhoto} onRemove={(i) => setBoxPhotos((p) => ({ ...p, photos: p.photos.filter((_, j) => j !== i) }))} />
            {/* Artboard 15: the box's fields before "האריזה תקינה?". */}
            {fieldsCfg ? boxHasFields && (
              <FieldsBlock variant="wizard" title={BLOCK_TITLE.box} groups={[{ fields: fieldsCfg.box }]} fx={boxFx} idPrefix={`${uid}-fxbox`}
                uploadPhoto={(file, photoType) => uploadTo(item.item_id, file, photoType)} />
            ) : <FieldsBlockFallback sf={sf} />}
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>האריזה תקינה?</div>
              <div style={{ marginTop: 10 }}>{choiceBox(boxPhotos.ok, (v) => setBoxPhotos((p) => ({ ...p, ok: v })))}</div>
              {boxHasFields && <SuggestionLine fails={boxFx.ev.fails} defs={fieldsCfg?.box ?? []} prefix={SUGGEST_PREFIX} decided={boxPhotos.ok} style={{ marginTop: 10 }} />}
              <label htmlFor={`${uid}-box-note`} style={{ display: "block", fontSize: 12.5, color: MUTED, margin: "16px 0 7px" }}>הערות</label>
              {boxHasFields ? (
                <NotesField size="area" id={`${uid}-box-note`} value={boxPhotos.note} onChange={(note) => setBoxPhotos((p) => ({ ...p, note }))}
                  placeholder="אופציונלי" editorTitle="הערות · הקופסה" look={VARIANT_SPEC.wizard.noteLook} />
              ) : (
                <textarea id={`${uid}-box-note`} value={boxPhotos.note} onChange={(e) => setBoxPhotos((p) => ({ ...p, note: e.target.value }))} placeholder="אופציונלי" className="pkg-field pkg-field--area" style={{ maxWidth: 560 }} />
              )}
            </div>
          </div>
        ) : stepKey === "items" ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((it, i) => {
                const w = workOf(it.item_id);
                return (
                  <div key={it.item_id} style={{ border: `1px solid ${w.done ? "color-mix(in srgb, var(--color-status-approved) 30%, transparent)" : HAIR}`, borderRadius: 14, padding: "14px 16px", background: w.done ? "color-mix(in srgb, var(--color-status-approved) 4%, transparent)" : "var(--color-canvas)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: w.done ? "color-mix(in srgb, var(--color-status-approved) 10%, transparent)" : "var(--color-canvas-parchment)", color: w.done ? GREEN : MUTED, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</div>
                      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}{w.refWeight != null ? ` · ייחוס ${w.refWeight} גר׳` : ""}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: w.done ? GREEN : MUTED, fontWeight: 600, whiteSpace: "nowrap" }}>{w.done ? "צולם ונשקל" : "ממתין"}</div>
                    <button type="button" onClick={() => startItem(i)} disabled={busy} aria-label={`${w.done ? "פתח שוב" : "התחל"} · ${seq2(it.package_seq)} ${it.item_type_desc}`}
                      className={w.done ? "pkg-pill pkg-pill--ghost pkg-pill--station" : "pkg-pill pkg-pill--primary pkg-pill--station"} style={{ padding: "10px 20px" }}>{w.done ? "פתח שוב" : "התחל"}</button>
                  </div>
                );
              })}
            </div>
            {addOpen ? (
              <div style={{ marginTop: 16, border: `1px solid ${HAIR}`, borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, maxWidth: 620 }}>
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
                <input placeholder="מספר סריאלי" aria-label="מספר סריאלי" dir="ltr" value={add.serialNumber} onChange={(e) => setAdd({ ...add, serialNumber: e.target.value })} className="pkg-field pkg-field--code" />
                <input placeholder="מק״ט" aria-label="מק״ט" dir="ltr" value={add.makat} onChange={(e) => setAdd({ ...add, makat: e.target.value })} className="pkg-field pkg-field--code" />
                <input placeholder="דגם" aria-label="דגם" value={add.model} onChange={(e) => setAdd({ ...add, model: e.target.value })} className="pkg-field" />
                <input placeholder="יצרן" aria-label="יצרן" value={add.manufacturer} onChange={(e) => setAdd({ ...add, manufacturer: e.target.value })} className="pkg-field" />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => setAddOpen(false)} className="pkg-pill pkg-pill--ghost" style={{ minHeight: 40, padding: "9px 16px" }}>ביטול</button>
                  <button type="button" onClick={addMissing} disabled={busy} aria-busy={busy || undefined} className="pkg-pill pkg-pill--primary" style={{ minHeight: 40, padding: "9px 18px" }}>הוסף</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAddOpen(true)} className="pkg-link pkg-link--hit" style={{ marginTop: 8, gap: 7, fontSize: 14 }}>
                <Plus size={16} strokeWidth={2} aria-hidden />הוסף פריט שלא נרשם בקליטה
              </button>
            )}
          </div>
        ) : stepKey === "count" ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, maxWidth: 620 }}>
              {/* The number is typed straight into the card, so the card carries the focus ring. */}
              <div className="pkg-focus-within" style={{ border: `1px solid ${counted != null && counted !== items.length ? AMBER_BORDER : HAIR}`, borderRadius: 14, padding: "16px 18px", background: counted != null && counted !== items.length ? AMBER_BG : "var(--color-canvas)" }}>
                <input id={`${uid}-count`} value={countInput} onChange={(e) => setCountInput(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" autoFocus placeholder="—"
                  className="pkg-bare-input" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1, fontVariantNumeric: "tabular-nums" }} />
                <label htmlFor={`${uid}-count`} style={{ display: "block", fontSize: 12.5, color: MUTED, marginTop: 7 }}>נספר בעמדה</label>
              </div>
              <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, padding: "16px 18px", background: "var(--color-canvas)" }}>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1, color: INK, fontVariantNumeric: "tabular-nums" }}>{items.length}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 7 }}>נרשם בקליטה</div>
              </div>
              <div style={{ border: `1px solid ${items.length !== templateCount ? AMBER_BORDER : HAIR}`, borderRadius: 14, padding: "16px 18px", background: items.length !== templateCount ? AMBER_BG : "var(--color-canvas)" }}>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1, color: items.length !== templateCount ? AMBER_INK : INK, fontVariantNumeric: "tabular-nums" }}>{templateCount}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 7 }}>תכולת המארז (תבנית)</div>
              </div>
            </div>
            {countMismatch && counted != null && (
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start", background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 12, padding: "13px 15px", marginTop: 16, maxWidth: 620 }}>
                <span style={{ color: AMBER_INK, marginTop: 1, display: "inline-flex" }}><CircleAlert size={18} strokeWidth={2} aria-hidden /></span>
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
                <div key={`${l.id}-${i}`} style={{ width: 214, border: `1px solid ${BLUE}`, background: "var(--color-primary-tint)", borderRadius: 14, padding: "15px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{l.kind}</div>
                    <span aria-hidden style={{ width: 20, height: 20, borderRadius: 6, border: `1px solid ${BLUE}`, background: BLUE, color: "var(--color-on-primary)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={11} strokeWidth={2.5} /></span>
                  </div>
                  <div aria-hidden style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 44, marginTop: 12 }}>
                    {Array.from({ length: 22 }, (_, b) => <div key={b} style={{ width: ((b + i) % 3) + 1, height: "100%", background: INK }} />)}
                  </div>
                  <div style={{ fontSize: 12.5, letterSpacing: 1.5, marginTop: 9, fontVariantNumeric: "tabular-nums", direction: "ltr", unicodeBidi: "isolate", textAlign: "right", color: MUTED }}>…{String(l.id).slice(-6)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 7 }}>{l.title}</div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{l.note}</div>
                </div>
              ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--color-success-bg)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} aria-hidden /></span>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>פתיחת המארז הושלמה</div>
            <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>כל פריט קיבל תוצאה וממשיך לעמדה הראשונה במסלול שלו. המארז ממתין לסגירה עד שכל פריטיו יחזרו.</div>
            <div role="img" aria-label={items.map((it) => `${seq2(it.package_seq)} · ${it.item_type_desc} · ${itemPass(it) ? "תקין" : "לא תקין"}`).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
              {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: itemPass(it) ? BLUE : GREY }} />)}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.length} פריטים נפתחו · {pkg.item_type_desc}</div>
          </div>
        )}
      </PackageWizardShell>

      {labelsOpen && (
        // Mounted after the wizard, so it stacks above it and owns Escape while open.
        <PackageLabelsDialog
          open
          // Closing commits the opening only once the labels went to print. Before
          // that, "ביטול" / × / the scrim just back out to the labels step.
          onClose={() => { setLabelsOpen(false); if (labelsPrinted) finish(); }}
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
