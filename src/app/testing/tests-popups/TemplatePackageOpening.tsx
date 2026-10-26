"use client";
import React from "react";
import { Check, CircleAlert } from "lucide-react";
import type { StationTestDialogProps } from "@/types";
import type { PackageItemView, PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { newActionId } from "@/app/lib/metrics/action-id";
import { fillVariables, skuScanOf } from "@/app/lib/popup-templates/schema";
import type {
  ChecklistComponent, PhotoComponent, PopupTemplateJson, SkuScanComponent, TemplateStep, WeightComponent,
} from "@/app/lib/popup-templates/schema";
import PackageWizardShell, { type ItemStepperRow, type WizardStep } from "./PackageWizardShell";
import { PhotoUploader, PassFail, useShotDiscard, type RefImg, type Shot } from "./stationKit";
import { NO_REF, ScanField, useReferenceLookup } from "./referenceScan";
import { resolveItemReference, type RefMember } from "./packageReference";
import { ExpectedContents, ExpectedReference } from "./PackageReferenceViews";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import { OpeningContents, boxDetailsOf, contentsProblem, rowsFromItems, saveContents, type ContentRow } from "./OpeningContents";
import { playCue } from "@/app/components/packages/scanSound";
import { NextStationList, nextStopOf, type NextStop, type NextStopRow } from "./nextStation";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, GREEN_BG, GREY, HAIR, INK, INK_2, MUTED, RED, RED_BG, seq2,
} from "@/app/components/packages/packageUi";
import { UNDRAWN_TEXT, SUGGEST_PREFIX, fieldsGateText } from "@/app/lib/station-fields/labels";
import type { DraftShot, Drafts } from "@/app/lib/station-fields/evaluate";
import type { Field } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import { NotesField } from "@/app/testing/fields/NotesField";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE, VARIANT_SPEC, draftsFieldsState, kitItemFieldGroups, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { WORKER_UNDRAWN_TEXT } from "@/app/testing/fields/labels";
import { buildFieldsBlock, inputFieldCount, useFieldsState } from "@/app/testing/fields/useFieldsState";
import { findKitItem, kitItemDefs, useStationFields } from "@/app/testing/fields/useStationFields";
import { emptyRunState, routeFieldsSlot, stepBlocker, weightOutcome, type TemplateRunState } from "./templateModel";
import {
  bandOf, boxPasses, buildOpeningBoxDetails, buildOpeningItemDetails, freshItemWork, itemOutcome, itemsLine, openingStepKind,
  type OpeningItemWork,
} from "./packageTemplateModel";
import "@/app/packages/packages.css";

/**
 * The box's opening run from its station type's template (docs/popup-templates/PLAN.md §5, step
 * 2.2): PackageOpenWizard's shell and parts — the label scan against the package reference, the
 * contents and serials (OpeningContents), every item one by one, the labels, the next stations —
 * with the steps, the box's components and each item's flow (`item_flow`) taken from the
 * template. A template made "מהחלון של היום" (openingTemplate) runs exactly as the wizard.
 *
 * The system parts keep the wizard's own words and rules; the admin's steps show their message
 * components in the wizard's instruction band. The route's station fields appear where the
 * template places them (routeFieldsSlot), the box's among the box steps and each item's in its
 * flow. The results keep the wizard's keys (packageTemplateModel.ts), all under one submit id:
 * every item at this station, then the box.
 */

/** The wizard's own words for the parts the template does not word. */
const OPEN_TEXT = {
  title: "פתיחת מארז",
  boxScanLabel: "מק״ט המארז",
  boxScanPlaceholder: "סרוק את מק״ט היצרן",
  boxScanSubtitle: "סרוק את מדבקת המארז כדי לפתוח את המארז בעמדה.",
  boxScanBand: "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה.",
  boxNoReference: "לא נמצא פריט ייחוס למק״ט המארז שנסרק — צלם לפי שיקול דעת והמשך.",
  itemScanLabel: "מק״ט יצרן של הפריט",
  itemScanPlaceholder: "סרוק את מק״ט היצרן של הפריט",
  itemScanBand: "סרוק את מק״ט היצרן של הפריט — לפיו נטענים תמונות ומשקל הייחוס.",
  itemScanBandPlain: "סרוק את מק״ט היצרן של הפריט.",
  itemNoReference: (sku: string) => `לא נמצא פריט ייחוס למק״ט שנסרק (${sku}) — צלם לפי שיקול דעת והמשך.`,
  contentsSubtitle: "פתח את הקופסה: סמן מה לא הגיע, הוסף מה שלא היה בתבנית, והזן סריאלי לכל פריט.",
  labelsSubtitle: "מדבקה לכל פריט — הדבק כל אחת על הפריט שלה. מדבקת המארז כבר עליו מהמשלוח (אפשר להדפיס שוב).",
  doneStep: "סיום",
  notes: "הערות",
  optional: "אופציונלי",
} as const;

type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };

/** Step 1 is the opening for the box and its items alike (packages/create-package.ts
 *  routeRow): an item past it already has its result here. */
const leftOpening = (it: PackageItemView) => it.is_finished || (it.current_route_step ?? 1) > 1;

/** The shots taken in the photo fields among `defs` (station fields). */
const fieldShots = (defs: readonly Field[], drafts: Readonly<Drafts>): DraftShot[] =>
  defs.flatMap((d) => (d.type === "photo" ? drafts[d.id]?.photos ?? [] : []));

/** The step's own shots (its photo components). */
const stepShots = (st: TemplateStep, run: TemplateRunState): Shot[] =>
  st.components.flatMap((c) => (c.kind === "photo" ? run.photos[c.id] ?? [] : []));

/** A step blocked only while a lookup answers: the next button waits, and no error is shown. */
const CHECKING = "checking";

const NO_FLOW: TemplateStep[] = [];

type RunPatch = (fn: (s: TemplateRunState) => TemplateRunState) => void;

/** The verdict's suggestion from the route's fields, while there are fields. */
type Suggest = { fails: DraftsFieldsState["ev"]["fails"]; defs: Field[] };

/** Who an admin's step works on: the box, or the item on screen in its flow. */
type Target = {
  /** Where its shots are stored: the box's id or the item's. */
  targetId: string | number;
  run: TemplateRunState;
  patch: RunPatch;
  fill: (text: string) => string;
  refImages: (code: string) => RefImg[];
  /** Heads a step that leans on the reference when the lookup found none; null = it found one. */
  noReference: string | null;
  /** The route's fields block, drawn where the slot puts it in this step (null = not here). */
  fieldsHere: { block: React.ReactNode; atComponent: boolean; componentId: string } | null;
  /** With fields, the verdict shows their suggestion and its note is a NotesField. */
  suggest: Suggest | null;
  look: "wizard" | "kit-item";
  notesTitle: string;
};

export default function TemplatePackageOpening(props: StationTestDialogProps & { template: PopupTemplateJson }) {
  const pkg = props.item.package as PackageView | null;
  if (!props.open || !pkg) return null;
  return <OpeningPopup {...props} pkg={pkg} />;
}

/** Mounted per opening (the page renders a popup only while it is open), so the first state IS
 *  the fresh one. */
function OpeningPopup({
  open, onClose, item, station, stationTypeName, workerId, workerName, onSubmit, template, pkg,
}: StationTestDialogProps & { template: PopupTemplateJson; pkg: PackageView }) {
  const cfg = template.config;
  const flow = cfg.item_flow ?? NO_FLOW;
  const kind = stationTypeName?.trim() || "";
  const boxSkuC = skuScanOf(cfg);
  const itemSkuC = (flow[0]?.components.find((c) => c.kind === "sku_scan") as SkuScanComponent | undefined) ?? null;

  const [step, setStep] = React.useState(0);
  const [box, setBox] = React.useState<TemplateRunState>(() => emptyRunState(boxSkuC?.carry_last ? item.last_sku ?? "" : ""));
  const [items, setItems] = React.useState<PackageItemView[]>(pkg.items);
  // Items an earlier opening already submitted — it broke off before the box's own result — have
  // left the opening step: they count as done and are not sent again, or each would move one more
  // step and skip a station.
  const [work, setWork] = React.useState<Record<string, OpeningItemWork>>(
    () => Object.fromEntries(pkg.items.filter(leftOpening).map((it) => [it.item_id, { ...freshItemWork(), done: true }])),
  );
  const [itemIdx, setItemIdx] = React.useState<number | null>(null);
  const [phase, setPhase] = React.useState(0);
  // The contents step: its rows, whether they are saved as they stand, and the save's refusal on its row.
  const [contentRows, setContentRowsRaw] = React.useState<ContentRow[]>(() => rowsFromItems(pkg.items, boxDetailsOf(pkg)));
  const [contentsSaved, setContentsSaved] = React.useState(false);
  const [contentsError, setContentsError] = React.useState<{ text: string; rowIndex: number | null } | null>(null);
  const setContentRows = React.useCallback((next: ContentRow[] | ((rs: ContentRow[]) => ContentRow[])) => {
    setContentRowsRaw(next); setContentsSaved(false); setContentsError(null);
  }, []);
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [labelsPrinted, setLabelsPrinted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const submitIdRef = React.useRef<string | null>(null);
  const committedRef = React.useRef<Set<string>>(new Set(pkg.items.filter(leftOpening).map((it) => it.item_id)));
  // Each item's next station, from its own result's answer (kept across a retry of the finish),
  // and the done step's rows once the box's answer is in.
  const nextStopsRef = React.useRef<Map<string, NextStop>>(new Map());
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  const uid = React.useId();

  React.useEffect(() => {
    let live = true;
    apiFetch("/api/itemTypes").then((r) => (r.ok ? r.json() : [])).then((d) => { if (live) setItemTypes(Array.isArray(d) ? d : []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // ---- station fields (route-fields spec §4.11.3) ---------------------------
  // Asked for on the box row, so a config answers "package": the box's fields and every kit
  // item's groups. `fieldsCfg` is that answer once it is in — null while it loads, after a failed
  // load, and with no config (legacy).
  const sf = useStationFields(item.item_id, open, station.test_station_id);
  const fieldsCfg = sf.status === "ready" && sf.mode === "package" ? sf : null;
  const boxFx = useFieldsState(fieldsCfg ? fieldsCfg.box : []);
  const reloadFields = sf.reload;
  // Where the template places them: the box's among its steps, each item's in its flow. A
  // template with no place for them draws, gates and sends none.
  const boxSlot = routeFieldsSlot(cfg);
  const flowSlot = routeFieldsSlot({ steps: flow });

  // ---- reference lookups, driven by what is scanned -------------------------
  // The box: its label among the package type's reference items. The answer also supplies the
  // box photos' reference sets, so it stays live past the scan.
  const boxLookup = useReferenceLookup(box.sku, item.item_type_id, open && (boxSkuC?.lookup_reference ?? false));
  const boxHasRU = boxLookup.ref ? boxLookup.ref.hasRU : null;
  // The item being worked on: its label among its own type's reference items, only while its scan
  // is up. Moving on copies the answer into its work.
  const curItem = itemIdx != null ? items[itemIdx] ?? null : null;
  const onItemScan = curItem != null && phase === 0 && itemSkuC != null;
  const itemLookup = useReferenceLookup(curItem && onItemScan ? (work[curItem.item_id]?.run.sku ?? "") : "", curItem?.item_type_id, onItemScan && itemSkuC.lookup_reference);

  const workOf = (id: string): OpeningItemWork => work[id] ?? freshItemWork();
  const patchWork = (id: string, fn: (w: OpeningItemWork) => OpeningItemWork) => setWork((all) => ({ ...all, [id]: fn(all[id] ?? freshItemWork()) }));
  const patchBox: RunPatch = (fn) => setBox(fn);
  const patchItemRun = (id: string): RunPatch => (fn) => patchWork(id, (w) => ({ ...w, run: fn(w.run) }));

  // ---- uploads (browser → MinIO, tagged by the photo component's group) --------
  const uploadTo = React.useCallback(async (targetId: string | number, file: File, photoType: string): Promise<string | null> => {
    try {
      const [result] = await uploadItemFiles(targetId, [file], { workerId, stationTypeId: station.test_station_type_id, photoType });
      return result?.objectKey ?? null;
    } catch { return null; }
  }, [workerId, station.test_station_type_id]);

  // A shot removed on screen is taken back from storage too (useShotDiscard).
  const { discard, landed } = useShotDiscard(workerId);
  const pickPhoto = (targetId: string | number, patch: RunPatch, c: PhotoComponent, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const setShots = (fn: (shots: Shot[]) => Shot[]) => patch((s) => ({ ...s, photos: { ...s.photos, [c.id]: fn(s.photos[c.id] ?? []) } }));
    setShots((shots) => [...shots, { previewUrl, uploading: true }]);
    uploadTo(targetId, file, c.photo_code).then((key) => {
      if (landed(targetId, previewUrl, key)) return;
      setShots((shots) => shots.map((x) => (x.previewUrl === previewUrl ? { ...x, objectKey: key ?? undefined, uploading: false, failed: key == null } : x)));
    });
  };
  const removePhoto = (targetId: string | number, run: TemplateRunState, patch: RunPatch, c: PhotoComponent, idx: number) => {
    discard(targetId, (run.photos[c.id] ?? [])[idx]);
    patch((s) => ({ ...s, photos: { ...s.photos, [c.id]: (s.photos[c.id] ?? []).filter((_, j) => j !== idx) } }));
  };

  // ---- the package reference ------------------------------------------------
  // Found by the box label: its members are what each item is expected to be. null = no package
  // reference (not scanned yet, the label found none, or what it found holds no members yet).
  const kitMembers = boxLookup.ref?.hasRU && boxLookup.ref.members.length > 0 ? boxLookup.ref.members : null;
  const expectedOf = (it: { item_type_id: number }): RefMember | null =>
    kitMembers?.find((m) => m.itemTypeId === it.item_type_id) ?? null;
  // The box's item types, in package order: what the package reference covers.
  const boxTypes = items.reduce<{ id: number; desc: string; count: number }[]>((acc, it) => {
    const row = acc.find((r) => r.id === it.item_type_id);
    if (row) row.count++;
    else acc.push({ id: it.item_type_id, desc: it.item_type_desc, count: 1 });
    return acc;
  }, []);
  const boxRefImages = (code: string): RefImg[] => boxLookup.ref?.imagesByType[code] ?? [];

  // Every item starts at its flow's first phase. With a scan there, its reference item's SKU —
  // the member the package reference expects for its type — is already in it, as its serial is;
  // without one, the item is compared against that member outright. A reopened item shows its
  // last scan, and moving on with it unchanged keeps the photos already taken.
  const startItem = (idx: number) => {
    const it = items[idx];
    if (!it || leftOpening(it)) return;
    if (work[it.item_id] == null) {
      const expected = expectedOf(it);
      if (itemSkuC) {
        patchWork(it.item_id, () => freshItemWork(expected?.sku.trim() ?? ""));
      } else {
        const ref = resolveItemReference(expected?.sku ?? "", expected, NO_REF, it.item_type_desc);
        patchWork(it.item_id, () => ({
          ...freshItemWork(), sku: expected?.sku ?? null, refImages: ref.imagesByType, refSource: ref.source, expectedSku: ref.expectedSku,
          run: { ...emptyRunState(), hasRU: ref.hasRU, refWeight: ref.refWeight },
        }));
      }
    }
    setItemIdx(idx); setPhase(0); setError(null);
  };

  // The contents step's "המשך": what is in the box, with its serials, is saved before anything
  // else happens to the items; the items step works on the box as the server now has it. Added
  // items can bring station fields of their own.
  const saveContentsStep = async (): Promise<boolean> => {
    if (contentsSaved) return true;
    setBusy(true); setContentsError(null);
    try {
      const result = await saveContents(item.item_id, contentRows);
      if ("error" in result) { setContentsError({ text: result.error, rowIndex: result.rowIndex }); playCue("error"); return false; }
      const added = contentRows.some((r) => !r.gone && r.itemId == null);
      setItems(result.items);
      setContentRowsRaw(rowsFromItems(result.items));
      setContentsSaved(true);
      playCue("ok");
      if (added) reloadFields();
      return true;
    } finally {
      setBusy(false);
    }
  };

  // ---- derived -------------------------------------------------------------
  const lastBoxStep = cfg.steps.length - 1;
  const doneStep = step > lastBoxStep;
  const stepDef: TemplateStep | null = doneStep ? null : cfg.steps[step];
  const stepKind = stepDef ? openingStepKind(stepDef) : null;
  const curWork = curItem ? workOf(curItem.item_id) : null;
  const inItemFlow = curItem != null && curWork != null && flow.length > 0;
  const doneCount = items.filter((it) => workOf(it.item_id).done).length;
  const memberTypes = itemTypes.filter((t) => !t.is_package);
  const templateCount = Array.isArray(pkg.template_snapshot)
    ? (pkg.template_snapshot as { quantity?: number }[]).reduce((n, l) => n + Math.max(1, Number(l.quantity ?? 1)), 0)
    : items.length;
  const contentsGap = contentsProblem(contentRows);
  const fillBox = (text: string) => fillVariables(text, { station: kind, sku: box.sku, model: item.model, serial: item.serial_no });
  const fillItem = (it: PackageItemView, w: OpeningItemWork) => (text: string) =>
    fillVariables(text, { station: kind, sku: w.run.sku, model: it.model, serial: it.serial_no });

  // Station fields. A step that holds them waits until they have answered (loading, or a failed
  // load), then for their gate: required fields and notes, a note over its maximum, a field's shot
  // still uploading or failed. Without a config nothing here draws or gates.
  const fieldsWaiting = sf.status === "loading" || sf.status === "error";
  const fieldsGateOn = fieldsCfg?.gate ?? false;
  const boxHasFields = boxFx.defsCount > 0;
  const boxFieldsBlocking = fieldsWaiting || boxFx.blocking(fieldsGateOn);
  /** A kit item's fields ("לכל פריט", then its type's), and its drafts as a block's state. */
  const itemFieldsOf = (it: PackageItemView): { defs: Field[]; fx: DraftsFieldsState } => {
    const defs = kitItemDefs(findKitItem(sf, it.item_id));
    const fx = draftsFieldsState(defs, workOf(it.item_id).fields, (next) => patchWork(it.item_id, (w) => ({ ...w, fields: next(w.fields) })));
    return { defs, fx };
  };
  // The item on screen: its block's state while it has fields, and its gate.
  const curItemFields = curItem ? itemFieldsOf(curItem) : null;
  const curFx = curItemFields && inputFieldCount(curItemFields.defs) > 0 ? curItemFields.fx : null;

  /** What keeps a box step from going on; CHECKING while its label is being looked up. */
  const boxStepBlocker = (i: number): string | null => {
    const st = cfg.steps[i];
    switch (openingStepKind(st)) {
      case "contents": return contentsSaved ? null : contentsGap ?? "יש לשמור את התכולה";
      case "items": return items.length > 0 && doneCount === items.length ? null : `נותרו ${items.length - doneCount} פריטים`;
      case "labels": return null;
      default:
        if (boxSkuC && st.components.includes(boxSkuC) && boxSkuC.lookup_reference && boxLookup.checking) return CHECKING;
        return stepBlocker(st, box, kind, boxSlot?.stepIndex === i && boxFieldsBlocking);
    }
  };
  /** What keeps the item on screen from leaving its phase. */
  const phaseBlocker = (): string | null => {
    if (!curItem || !curWork) return CHECKING;
    if (onItemScan && itemSkuC.lookup_reference && itemLookup.checking) return CHECKING;
    const fieldsHere = flowSlot?.stepIndex === phase && (fieldsWaiting || (curItemFields?.fx.blocking(fieldsGateOn) ?? false));
    return stepBlocker(flow[phase], curWork.run, kind, fieldsHere);
  };

  // ---- the shell's texts and its next button -----------------------------------
  const finishLabel = fillBox(cfg.finish_label);
  let stepTitle = stepDef ? fillBox(stepDef.title) : OPEN_TEXT.doneStep;
  let stepSubtitle = "";
  let systemMsg: string | null = null;
  let nextLabel = "המשך";
  let nextEnabled = true;
  if (inItemFlow && curItem && curWork) {
    const ph = flow[phase];
    stepTitle = `${curItem.item_type_desc} · ${fillItem(curItem, curWork)(ph.title)}`;
    stepSubtitle = `פריט ${seq2(curItem.package_seq)} · ${ph.components.some((c) => c.kind === "weight") ? "משקל ייחוס מהקטלוג" : curItem.makat ?? ""}`;
    systemMsg = onItemScan ? (itemSkuC.lookup_reference ? OPEN_TEXT.itemScanBand : OPEN_TEXT.itemScanBandPlain) : bandOf(ph, fillItem(curItem, curWork));
    nextLabel = phase === flow.length - 1 ? "סיום פריט" : "המשך";
    nextEnabled = phaseBlocker() == null;
    // A shot still uploading, or one whose upload failed, blocks the step: a failed upload leaves
    // nothing in storage, so continuing would silently lose the photo. The worker removes the red
    // shot and takes it again.
    if (stepShots(ph, curWork.run).some((s) => s.failed)) nextLabel = "הסר את הצילום שנכשל";
  } else if (stepDef && stepKind) {
    const isLast = step === lastBoxStep;
    const nextKind = isLast ? null : openingStepKind(cfg.steps[step + 1]);
    if (stepKind === "contents") {
      stepSubtitle = OPEN_TEXT.contentsSubtitle;
      systemMsg = contentsError ? `לא נשמר — ${contentsError.text}`
        : contentsGap ? `כדי להמשיך: ${contentsGap}` : contentsSaved ? "התכולה נשמרה." : "הכול מולא — שמור והמשך.";
      nextEnabled = contentsGap == null;
      nextLabel = contentsSaved ? "המשך" : "שמור והמשך";
    } else if (stepKind === "items") {
      stepSubtitle = itemsLine(flow, fillBox);
      nextEnabled = items.length > 0 && doneCount === items.length;
      nextLabel = !nextEnabled ? `נותרו ${items.length - doneCount} פריטים` : isLast ? finishLabel : nextKind === "labels" ? "המשך למדבקות" : "המשך";
    } else if (stepKind === "labels") {
      stepSubtitle = OPEN_TEXT.labelsSubtitle;
      // Finishing waits while the station fields load (spec §4.2) — e.g. reloading after a 409.
      nextLabel = isLast ? finishLabel : "הדפס והמשך";
      nextEnabled = sf.status !== "loading";
    } else {
      const isScan = boxSkuC != null && stepDef.components.length === 1 && stepDef.components[0] === boxSkuC;
      if (isScan) { stepSubtitle = OPEN_TEXT.boxScanSubtitle; systemMsg = OPEN_TEXT.boxScanBand; }
      else systemMsg = bandOf(stepDef, fillBox);
      nextEnabled = boxStepBlocker(step) == null;
      nextLabel = isLast ? finishLabel : "המשך";
      if (stepShots(stepDef, box).some((s) => s.failed)) nextLabel = "הסר את הצילום שנכשל";
    }
  } else nextLabel = "חזרה לתור";

  // ---- finish: one result per item, then the box ---------------------------
  const finish = async () => {
    // Every box step done — the rail never skips one; this holds the finish all the same.
    for (let i = 0; i <= lastBoxStep; i++) {
      const b = boxStepBlocker(i);
      if (b) { if (b !== CHECKING) setError(b); setStep(i); return; }
    }
    // The station fields still to be sent: the box's, and those of every item not saved yet.
    const fieldsToSend = fieldsCfg
      ? [
        ...(boxSlot ? [{ defs: fieldsCfg.box, fx: boxFx }] : []),
        ...(flowSlot ? items.filter((it) => !committedRef.current.has(it.item_id)).map(itemFieldsOf) : []),
      ]
      : [];
    // Belt and braces for the per-step gate: nothing is submitted while a shot is still uploading
    // or failed, whichever way the worker reached this step (a station field's shots included).
    const shots = [box, ...items.map((it) => workOf(it.item_id).run)].flatMap((run) => Object.values(run.photos).flat())
      .concat(fieldsToSend.flatMap((f) => fieldShots(f.defs, f.fx.drafts)));
    if (shots.some((sh) => sh.uploading || sh.failed)) {
      setError(shots.some((sh) => sh.failed) ? "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום." : "יש צילום שעדיין עולה — המתן לסיום ההעלאה.");
      return;
    }
    // Nor before the station fields have answered, nor with their gate shut (spec §4.11.3) —
    // artboard 14's message, for the box and the items together.
    if (boxSlot || flowSlot) {
      if (sf.status === "loading") return; // the finish waits for the answer; what is on screen stays
      if (sf.status === "error") { setError(WORKER_UNDRAWN_TEXT.loadFailed); return; }
    }
    const blocked = fieldsToSend.filter((f) => f.fx.blocking(fieldsGateOn));
    if (blocked.length > 0) {
      const missing = (k: "missingRequired" | "missingNotes") => (fieldsGateOn ? blocked.reduce((n, f) => n + f.fx.ev[k].length, 0) : 0);
      setError(fieldsGateText(missing("missingRequired"), missing("missingNotes")) ?? UNDRAWN_TEXT.noteTooLong);
      return;
    }
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    const ctx = { version: template.version, station: kind };
    try {
      for (const it of items) {
        if (committedRef.current.has(it.item_id)) continue;
        const w = workOf(it.item_id);
        const passed = itemOutcome(flow, w.run).pass;
        const res = await apiFetch("/api/testing/results", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ItemID: Number(it.item_id), StationID: station.test_station_id, WorkerID: workerId ?? undefined, WorkerName: workerName || undefined, SubmitID: submitId,
            // The step this result is for: an item that already moved on is refused, never moved twice.
            CurrentRouteStep: it.current_route_step ?? undefined,
            Result: passed ? 1 : 0, Passed: passed, Comments: w.run.verdict.note || undefined,
            Details: {
              ...buildOpeningItemDetails(flow, { ...ctx, packageId: String(item.item_id) }, w),
              // Station fields: each item answers as "kit_item", on the kit's route, version and step.
              ...(fieldsCfg && flowSlot ? buildFieldsBlock(kitItemDefs(findKitItem(sf, it.item_id)), w.fields, { ...fieldsCfg.schema, target: "kit_item" }, { ok: w.run.verdict.ok }) : {}),
            },
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          if (shouldReloadFields(d)) reloadFields();
          throw new Error(`שמירת הפריט ${it.serial_no ?? seq2(it.package_seq)} נכשלה${d?.error ? ` — ${d.error}` : ` (${res.status})`}`);
        }
        nextStopsRef.current.set(it.item_id, nextStopOf(await res.json().catch(() => null)));
        committedRef.current.add(it.item_id);
      }
      const boxPass = boxPasses(cfg, box);
      const boxResult = await onSubmit({
        Result: boxPass ? 1 : 0, Passed: boxPass, Comments: box.verdict.note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          ...buildOpeningBoxDetails(cfg, ctx, { ...box, hasRU: boxHasRU }, {
            packageReference: kitMembers ? { referenceItemId: boxLookup.ref?.referenceItemId ?? null, members: kitMembers.length } : null,
            itemCount: items.length, registeredCount: pkg.items.length, templateCount, labelsPrinted,
            packageItemIds: items.map((it) => it.item_id),
          }),
          ...(fieldsCfg && boxSlot ? boxFx.toBlock({ ...fieldsCfg.schema, target: "box" }, { ok: box.verdict.ok }) : {}),
        },
      });
      // The box waits at its next (closing) station until its items come back; each item goes on
      // to its own. An item an earlier opening sent on has no answer here: where it is now.
      const boxStop = nextStopOf(boxResult);
      setDoneRows([
        { key: "box", badge: "00", label: pkg.item_type_desc, stop: boxStop, note: boxStop.kind === "station" ? "ממתין לפריטי המארז" : undefined },
        ...items.map((it) => ({
          key: it.item_id,
          badge: seq2(it.package_seq),
          label: it.item_type_desc,
          stop: nextStopsRef.current.get(it.item_id)
            ?? (it.station_name && it.station_name !== "—" ? { kind: "station" as const, name: it.station_name } : { kind: "unknown" as const }),
        })),
      ]);
      setStep(lastBoxStep + 1);
    } catch (e) {
      // The box's 409 arrives as the Error page.tsx throws, carrying the body's code.
      if (shouldReloadFields(e)) reloadFields();
      setError(e instanceof Error && e.message ? e.message : "שגיאה בשמירת פתיחת המארז");
    } finally {
      setSubmitting(false);
    }
  };

  /** On from a box step: to the next one, or the finish after the last. */
  const advance = () => { if (step >= lastBoxStep) void finish(); else setStep(step + 1); };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (inItemFlow && curItem && curWork) {
      if (onItemScan) {
        const sku = curWork.run.sku.trim();
        // Same scan as last time: the reference is already in the work, keep it.
        if (sku !== curWork.sku) {
          const ref = resolveItemReference(sku, expectedOf(curItem), (itemSkuC.lookup_reference ? itemLookup.ref : null) ?? NO_REF, curItem.item_type_desc);
          patchWork(curItem.item_id, (w) => ({
            ...w, sku, refImages: ref.imagesByType, refSource: ref.source, expectedSku: ref.expectedSku,
            run: { ...w.run, hasRU: ref.hasRU, refWeight: ref.refWeight },
          }));
        }
      }
      if (phase < flow.length - 1) { setPhase(phase + 1); return; }
      patchWork(curItem.item_id, (w) => ({ ...w, done: true })); setItemIdx(null); return;
    }
    if (doneStep) { onClose(); return; }
    if (stepKind === "labels") { setLabelsOpen(true); return; }
    if (stepKind === "contents") {
      void saveContentsStep().then((ok) => { if (ok) advance(); });
      return;
    }
    advance();
  };
  const onBack = () => {
    setError(null);
    if (inItemFlow) { if (phase > 0) setPhase(phase - 1); else setItemIdx(null); return; }
    if (step > 0 && !doneStep) setStep(step - 1);
  };
  // The rail: back always; forward only over steps that are done — past the contents only once
  // they are saved, as the items behind them are the server's.
  const onStep = (i: number) => {
    if (doneStep || submitting || i > lastBoxStep) return;
    if (i <= step || Array.from({ length: i }, (_, k) => boxStepBlocker(k)).every((b) => b == null)) { setItemIdx(null); setStep(i); }
  };

  const steps: WizardStep[] = [
    ...cfg.steps.map((st) => ({ key: st.id, label: fillBox(st.title), note: fillBox(st.desc) })),
    { key: "done", label: OPEN_TEXT.doneStep, note: "" },
  ];
  const onItemsStep = stepKind === "items" || inItemFlow;
  const itemStepper: ItemStepperRow[] | null = onItemsStep
    ? items.map((it, i) => {
      const w = workOf(it.item_id);
      const active = itemIdx === i;
      const phaseTitle = active && flow[phase] ? fillItem(it, w)(flow[phase].title) : "";
      return { key: it.item_id, type: it.item_type_desc, badge: seq2(it.package_seq), stateLabel: w.done ? "הושלם" : active ? phaseTitle : "ממתין", active, done: w.done, onClick: () => startItem(i) };
    })
    : null;

  // ---- the components of an admin's step (the box's, or an item's phase) -------
  const renderComponents = (st: TemplateStep, t: Target) => {
    const photoCount = st.components.filter((c) => c.kind === "photo").length;
    // Photos over reference images lean on the lookup; the weighing says its own "no reference".
    const leans = st.components.some((c) => c.kind === "photo" && c.show_reference);
    return (
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        {leans && t.noReference && <div style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px" }}>{t.noReference}</div>}
        {st.components.map((c) => {
          switch (c.kind) {
            case "photo":
              return (
                <div key={c.id}>
                  {/* A lone photo component is the step's own subject; several are told apart by their titles. */}
                  {photoCount > 1 && <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{t.fill(c.title)}</div>}
                  <PhotoUploader photos={t.run.photos[c.id] ?? []} refImages={c.show_reference ? t.refImages(c.photo_code) : []}
                    onPick={(f) => pickPhoto(t.targetId, t.patch, c, f)} onRemove={(i) => removePhoto(t.targetId, t.run, t.patch, c, i)} />
                </div>
              );
            case "route_fields":
              return t.fieldsHere?.atComponent ? <React.Fragment key={c.id}>{t.fieldsHere.block}</React.Fragment> : null;
            case "verdict":
              return (
                <React.Fragment key={c.id}>
                  {t.fieldsHere && !t.fieldsHere.atComponent && t.fieldsHere.componentId === c.id && t.fieldsHere.block}
                  <VerdictBlock question={t.fill(c.question)} verdict={t.run.verdict} suggest={t.suggest} look={t.look} notesTitle={t.notesTitle}
                    id={`${uid}-${c.id}-note`} onVerdict={(patch) => t.patch((s) => ({ ...s, verdict: { ...s.verdict, ...patch } }))} />
                </React.Fragment>
              );
            case "weight":
              return <WeighBlock key={c.id} c={c} refWeight={t.run.refWeight} value={t.run.weights[c.id] ?? ""} id={`${uid}-${c.id}`}
                onChange={(v) => t.patch((s) => ({ ...s, weights: { ...s.weights, [c.id]: v } }))} />;
            case "checklist":
              return <ChecklistBlock key={c.id} c={c} title={t.fill(c.title)} ticked={t.run.checks[c.id] ?? []}
                onToggle={(rowId) => t.patch((s) => {
                  const cur = s.checks[c.id] ?? [];
                  return { ...s, checks: { ...s.checks, [c.id]: cur.includes(rowId) ? cur.filter((x) => x !== rowId) : [...cur, rowId] } };
                })} />;
            case "notes":
              return <NotesBlock key={c.id} label={t.fill(c.label)} id={`${uid}-${c.id}`} value={t.run.notes[c.id] ?? ""}
                onChange={(v) => t.patch((s) => ({ ...s, notes: { ...s.notes, [c.id]: v } }))} />;
            default:
              // sku_scan is a step of its own; message is the band; the system parts are steps of their own.
              return null;
          }
        })}
      </div>
    );
  };

  const boxTarget = (i: number): Target => ({
    targetId: item.item_id, run: box, patch: patchBox, fill: fillBox, refImages: boxRefImages,
    noReference: boxHasRU === false ? OPEN_TEXT.boxNoReference : null,
    fieldsHere: boxSlot?.stepIndex === i
      ? {
        atComponent: boxSlot.atComponent, componentId: boxSlot.componentId,
        block: fieldsCfg
          ? boxHasFields && <FieldsBlock key="route-fields" variant="wizard" title={BLOCK_TITLE.box} groups={[{ fields: fieldsCfg.box }]} fx={boxFx} idPrefix={`${uid}-fxbox`}
            uploadPhoto={(file, photoType) => uploadTo(item.item_id, file, photoType)} />
          : <FieldsBlockFallback key="route-fields" sf={sf} />,
      }
      : null,
    suggest: boxHasFields && fieldsCfg ? { fails: boxFx.ev.fails, defs: fieldsCfg.box } : null,
    look: "wizard", notesTitle: "הערות · הקופסה",
  });
  const itemTarget = (it: PackageItemView, w: OpeningItemWork): Target => ({
    targetId: it.item_id, run: w.run, patch: patchItemRun(it.item_id), fill: fillItem(it, w),
    refImages: (code) => w.refImages[code] ?? [],
    noReference: w.run.hasRU === false ? OPEN_TEXT.itemNoReference(w.sku ?? "") : null,
    fieldsHere: flowSlot?.stepIndex === phase
      ? {
        atComponent: flowSlot.atComponent, componentId: flowSlot.componentId,
        // Artboard 16: the item's fields — a group label even for a lone group.
        block: fieldsCfg
          ? curFx && <FieldsBlock key={`route-fields-${it.item_id}`} variant="kit-item" title={BLOCK_TITLE.kitItem}
            groups={kitItemFieldGroups(findKitItem(sf, it.item_id))} fx={curFx} idPrefix={`${uid}-fx${it.item_id}`}
            uploadPhoto={(file, photoType) => uploadTo(it.item_id, file, photoType)} />
          : <FieldsBlockFallback key="route-fields" sf={sf} />,
      }
      : null,
    suggest: curFx ? { fails: curFx.ev.fails, defs: curItemFields?.defs ?? [] } : null,
    look: "kit-item", notesTitle: `הערות · ${it.item_type_desc}`,
  });

  // ---- the body -----------------------------------------------------------------
  let body: React.ReactNode;
  if (inItemFlow && curItem && curWork) {
    const ph = flow[phase];
    body = onItemScan ? (
      <>
        <ExpectedReference member={expectedOf(curItem)} kitFound={kitMembers != null} />
        {itemSkuC.lookup_reference ? (
          <ScanField key={curItem.item_id}
            label={OPEN_TEXT.itemScanLabel} placeholder={OPEN_TEXT.itemScanPlaceholder}
            value={curWork.run.sku} onChange={(v) => patchItemRun(curItem.item_id)((s) => ({ ...s, sku: v }))} lookup={itemLookup} onSubmit={onNext}
            found={(ref) => `נמצא פריט ייחוס${ref.name ? ` · ${ref.name}` : ""}${ref.refWeight != null ? ` · ${ref.refWeight} גר׳` : ""}`}
            missing={`לא נמצא פריט ייחוס של ${curItem.item_type_desc} עם המק״ט הזה — אפשר להמשיך, הצילום והשקילה יהיו ללא ייחוס`}
            verdict={(ref) => resolveItemReference(curWork.run.sku, expectedOf(curItem), ref, curItem.item_type_desc)}
            // A changed SKU is already said by the verdict (resolveItemReference).
            serial={curItem.serial_no} prev={expectedOf(curItem)?.sku} filledNote="הושלם ממק״ט פריט הייחוס של המארז" flagChange={false} />
        ) : (
          <PlainScan key={curItem.item_id} label={OPEN_TEXT.itemScanLabel} placeholder={OPEN_TEXT.itemScanPlaceholder}
            value={curWork.run.sku} onChange={(v) => patchItemRun(curItem.item_id)((s) => ({ ...s, sku: v }))} onSubmit={onNext} />
        )}
      </>
    ) : renderComponents(ph, itemTarget(curItem, curWork));
  } else if (stepDef && stepKind === "components") {
    const isScan = boxSkuC != null && stepDef.components.length === 1 && stepDef.components[0] === boxSkuC;
    body = isScan ? (
      <>
        {boxSkuC.lookup_reference ? (
          <ScanField
            label={OPEN_TEXT.boxScanLabel} placeholder={OPEN_TEXT.boxScanPlaceholder}
            value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} lookup={boxLookup} onSubmit={onNext}
            found={(ref) => `זוהה ${pkg.item_type_desc}${ref.name ? ` · ${ref.name}` : ""} · ${items.length} פריטים · ${pkg.customer_name ?? pkg.customer_code ?? ""}`}
            missing={`לא נמצא פריט ייחוס של ${pkg.item_type_desc} עם המק״ט הזה — בדוק שזו הקופסה הנכונה. אפשר להמשיך, צילום הקופסה יהיה ללא ייחוס`}
            prev={boxSkuC.carry_last ? item.last_sku : undefined} />
        ) : (
          <PlainScan label={OPEN_TEXT.boxScanLabel} placeholder={OPEN_TEXT.boxScanPlaceholder}
            value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} onSubmit={onNext} />
        )}
        {/* The package reference the label found: what should be in the box. */}
        {kitMembers && !boxLookup.checking && box.sku.trim() !== "" && (
          <ExpectedContents types={boxTypes} expectedOf={(id) => expectedOf({ item_type_id: id })}
            boxPhotos={cfg.steps.flatMap((s) => s.components).reduce((n, c) => n + (c.kind === "photo" && c.show_reference ? boxRefImages(c.photo_code).length : 0), 0)} />
        )}
      </>
    ) : renderComponents(stepDef, boxTarget(step));
  } else if (stepKind === "contents") {
    body = (
      <OpeningContents
        rows={contentRows} onRows={setContentRows} memberTypes={memberTypes} templateCount={templateCount}
        shipmentId={pkg.shipment_id} packageId={String(item.item_id)} box={boxDetailsOf(pkg)} error={contentsError}
        cert={{ rowNo: pkg.cert_row_no ?? null, serial: pkg.cert_serial_no ?? null }}
        expectedOf={kitMembers ? (id) => expectedOf({ item_type_id: id }) : undefined}
        onDone={() => { if (contentsGap == null) onNext(); }}
      />
    );
  } else if (stepKind === "items") {
    body = (
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((it, i) => {
            const w = workOf(it.item_id);
            return (
              <div key={it.item_id} style={{ border: `1px solid ${w.done ? "color-mix(in srgb, var(--color-status-approved) 30%, transparent)" : HAIR}`, borderRadius: 14, padding: "14px 16px", background: w.done ? "color-mix(in srgb, var(--color-status-approved) 4%, transparent)" : "var(--color-canvas)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, background: w.done ? "color-mix(in srgb, var(--color-status-approved) 10%, transparent)" : "var(--color-canvas-parchment)", color: w.done ? GREEN : MUTED, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{seq2(it.package_seq)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{it.item_type_desc}</div>
                  <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}{w.run.refWeight != null ? ` · ייחוס ${w.run.refWeight} גר׳` : ""}</div>
                </div>
                <div style={{ fontSize: 12.5, color: w.done ? GREEN : MUTED, fontWeight: 600, whiteSpace: "nowrap" }}>{leftOpening(it) ? "נשמר בפתיחה קודמת" : w.done ? "הושלם" : "ממתין"}</div>
                <button type="button" onClick={() => startItem(i)} disabled={busy || leftOpening(it) || flow.length === 0} aria-label={`${w.done ? "פתח שוב" : "התחל"} · ${seq2(it.package_seq)} ${it.item_type_desc}`}
                  className={w.done ? "pkg-pill pkg-pill--ghost pkg-pill--station" : "pkg-pill pkg-pill--primary pkg-pill--station"} style={{ padding: "10px 20px" }}>{w.done ? "פתח שוב" : "התחל"}</button>
              </div>
            );
          })}
        </div>
      </div>
    );
  } else if (stepKind === "labels") {
    body = (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 20 }}>
        {items.map((it) => ({ kind: "מדבקת פריט", title: it.item_type_desc, note: `פריט ${seq2(it.package_seq)} מתוך ${seq2(items.length)}${it.serial_no ? ` · ${it.serial_no}` : ""}`, id: Number(it.item_id) }))
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
    );
  } else {
    const passOf = (it: PackageItemView) => itemOutcome(flow, workOf(it.item_id).run).pass;
    body = (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "36px 0 8px" }}>
        <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--color-success-bg)", color: GREEN, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Check size={30} strokeWidth={2} aria-hidden /></span>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 16 }}>פתיחת המארז הושלמה</div>
        <div style={{ fontSize: 14.5, color: INK_2, marginTop: 7, maxWidth: 440, lineHeight: 1.55 }}>כל פריט קיבל תוצאה וממשיך לעמדה הראשונה במסלול שלו. המארז ממתין לסגירה עד שכל פריטיו יחזרו.</div>
        <div role="img" aria-label={items.map((it) => `${seq2(it.package_seq)} · ${it.item_type_desc} · ${passOf(it) ? "תקין" : "לא תקין"}`).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 20 }}>
          {items.map((it) => <span key={it.item_id} title={`${seq2(it.package_seq)} · ${it.item_type_desc}`} style={{ width: 30, height: 10, borderRadius: 3, background: passOf(it) ? BLUE : GREY }} />)}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{items.length} פריטים נפתחו · {pkg.item_type_desc}</div>
        <NextStationList rows={doneRows} />
      </div>
    );
  }

  return (
    <>
      <PackageWizardShell
        open={open} onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title={OPEN_TEXT.title} pkg={pkg} workerName={workerName}
        steps={steps} stepIndex={step} onStep={onStep}
        itemStepper={itemStepper} itemProgress={`${doneCount}/${items.length}`}
        stepTitle={stepTitle} stepSubtitle={stepSubtitle}
        stepCounter={inItemFlow ? `פריט ${itemIdx! + 1} מתוך ${items.length}` : `שלב ${step + 1} מתוך ${steps.length}`}
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
        {body}
      </PackageWizardShell>

      {labelsOpen && (
        // Mounted after the wizard, so it stacks above it and owns Escape while open.
        <PackageLabelsDialog
          open
          // Closing goes on only once the labels went to print — the finish when the labels are
          // the last step. Before that, "ביטול" / × / the scrim just back out to the labels step.
          onClose={() => { setLabelsOpen(false); if (labelsPrinted) advance(); }}
          onPrinted={() => setLabelsPrinted(true)}
          packageId={item.item_id}
          packageType={pkg.item_type_desc}
          customerLine={`${pkg.customer_name ?? pkg.customer_code ?? ""} · משלוח ${pkg.shipment_code ?? ""}`}
          sourceId={item.source_id ?? null}
          items={items.map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, serial_no: it.serial_no }))}
          boxFirst={false}
        />
      )}
    </>
  );
}

/** "האריזה תקינה?" / "הפריט תקין?": the verdict, its suggestion, its note — the wizard's markup. */
function VerdictBlock({ question, verdict, onVerdict, suggest, look, notesTitle, id }: {
  question: string; verdict: TemplateRunState["verdict"]; onVerdict: (patch: Partial<TemplateRunState["verdict"]>) => void;
  suggest: Suggest | null; look: Target["look"]; notesTitle: string; id: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{question}</div>
      <div style={{ marginTop: 10 }}><PassFail value={verdict.ok} onChange={(v) => onVerdict({ ok: v })} /></div>
      {suggest && <SuggestionLine fails={suggest.fails} defs={suggest.defs} prefix={SUGGEST_PREFIX} decided={verdict.ok} style={{ marginTop: 10 }} />}
      <label htmlFor={id} style={{ display: "block", fontSize: 12.5, color: MUTED, margin: "16px 0 7px" }}>{OPEN_TEXT.notes}</label>
      {suggest ? (
        <NotesField size="area" id={id} value={verdict.note} onChange={(note) => onVerdict({ note })}
          placeholder={OPEN_TEXT.optional} editorTitle={notesTitle} look={VARIANT_SPEC[look].noteLook} />
      ) : (
        <textarea id={id} value={verdict.note} onChange={(e) => onVerdict({ note: e.target.value })} placeholder={OPEN_TEXT.optional} className="pkg-field pkg-field--area" style={{ maxWidth: 560 }} />
      )}
    </div>
  );
}

/** A scan with no reference lookup: the field alone. */
function PlainScan({ label, placeholder, value, onChange, onSubmit }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; onSubmit: () => void;
}) {
  const id = React.useId();
  return (
    <div style={{ maxWidth: 420, marginTop: 20 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: "var(--text-small)", color: MUTED, marginBottom: 7 }}>{label}</label>
      <input id={id} className="sh-input tst-ref-scan" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} autoFocus placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }} />
    </div>
  );
}

/** "שקילה מול ייחוס" in the wizard's markup: the reference weight, the measured one, the deviation. */
function WeighBlock({ c, refWeight, value, id, onChange }: {
  c: WeightComponent; refWeight: number | null; value: string; id: string; onChange: (v: string) => void;
}) {
  const w = weightOutcome(c, refWeight, value);
  const diff = w.measured != null && refWeight != null ? w.measured - refWeight : null;
  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", maxWidth: 620 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט ייחוס</div>
          <div className="pkg-field pkg-field--lg pkg-field--static" style={{ fontVariantNumeric: "tabular-nums" }}>{refWeight != null ? `${refWeight} גר׳` : "לא מוגדר"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor={id} style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 7 }}>משקל פריט נבדק</label>
          {/* The focus ring, not the value, marks the field (A11-2); a weight reads left-to-right. */}
          <input id={id} dir="ltr" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="גר׳" inputMode="decimal"
            className="pkg-field pkg-field--lg pkg-field--code" />
        </div>
      </div>
      {w.diffPct != null && w.pass != null && diff != null && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11, background: w.pass ? GREEN_BG : RED_BG, border: `1px solid ${w.pass ? "color-mix(in srgb, var(--color-status-approved) 22%, transparent)" : "color-mix(in srgb, var(--color-destructive) 25%, transparent)"}`, borderRadius: 11, padding: "13px 15px", marginTop: 16, maxWidth: 620 }}>
          {/* ✓ only when it passes; out of tolerance gets the alert mark. */}
          <span style={{ color: w.pass ? GREEN : RED, marginTop: 1, display: "inline-flex" }}>{w.pass ? <Check size={18} strokeWidth={2} aria-hidden /> : <CircleAlert size={18} strokeWidth={2} aria-hidden />}</span>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: w.pass ? GREEN : RED }}>{w.pass ? "משקל תקין" : "משקל לא תקין"}</div>
            <div style={{ fontSize: 13, color: INK_2, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>סטייה {diff >= 0 ? "+" : "−"}{Math.abs(diff).toFixed(0)} גר׳ ({w.diffPct.toFixed(1)}% · סטייה תקנית ±{c.tolerance_pct}%)</div>
          </div>
        </div>
      )}
      {refWeight == null && value !== "" && <div style={{ marginTop: 16, fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px", maxWidth: 620 }}>אין משקל ייחוס לסוג פריט זה — המשקל נרשם ללא השוואה.</div>}
    </div>
  );
}

/** "רשימת סימון" in the closing wizard's markup: every row a tick. */
function ChecklistBlock({ c, title, ticked, onToggle }: {
  c: ChecklistComponent; title: string; ticked: string[]; onToggle: (rowId: string) => void;
}) {
  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{title}</div>
      <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {c.items.map((row) => {
          const on = ticked.includes(row.id);
          return (
            <button key={row.id} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(row.id)}
              className="pkg-choice pkg-press" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, borderRadius: 12, padding: "13px 15px" }}>
              <span aria-hidden className={on ? "pkg-tick pkg-tick--on" : "pkg-tick"} style={{ width: 22, height: 22, borderRadius: 7, borderColor: on ? undefined : "var(--color-field-border)" }}>{on && <Check size={13} strokeWidth={2.5} />}</span>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: on ? BLUE : INK }}>{row.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "הערות": a free-text note under its label. */
function NotesBlock({ label, id, value, onChange }: {
  label: string; id: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ maxWidth: 620 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={OPEN_TEXT.optional} className="pkg-field pkg-field--area" />
    </div>
  );
}
