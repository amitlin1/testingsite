"use client";
import React from "react";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { newActionId } from "@/lib/action-id";
import { failureText } from "@/app/components/failureText";
import { seq2 } from "@/app/lib/packages/ids";
import type { Field } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { PhotoUploader } from "@/app/testing/fields/PhotoUploader";
import { BLOCK_TITLE, draftsFieldsState, kitItemFieldGroups, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { buildFieldsBlock, inputFieldCount } from "@/app/testing/fields/drafts";
import { findKitItem } from "@/app/testing/fields/useStationFields";
import { OPENING_PHOTO_CODES } from "@/app/lib/popup-templates/codePopups";
import PackageWizardShell, { type ItemStepperRow, type WizardStep } from "../PackageWizardShell";
import { AmberNote, VerdictBlock, WeighBlock, WizardError } from "../packageTemplateParts";
import { fieldShots, itemResultBody, postItemResults, type SentItems } from "../boxWizard";
import { nextStopOf, type NextStopRow } from "../nextStation";
import { NO_REF, resolveItemReference, type RefMember } from "../reference";
import { ScanField, useReferenceLookup, useReferenceSkus } from "../referenceScan";
import { emptyPhotos, useShotUpload, type Photos } from "../shots";
import { useKitFields } from "../stepFields";
import type { BoxPopupProps } from "../props";
import { ExpectedContents, ExpectedReference } from "./PackageReferenceViews";
import { OpeningBoxScan, OpeningContentsStep, OpeningDone, OpeningItemsList, OpeningLabelCards, OpeningLabelsDialog } from "./OpeningParts";
import {
  OPENING_TEXT, TOLERANCE_PCT, boxTypesOf, contentsStepText, freshWork, leftOpening, openingDoneRows, openingFinishHold,
  templateCountOf, weightResult, wizardBoxDetails, wizardItemDetails, wizardItemPasses, type ItemWork,
} from "./openingModel";
import { useOpeningContents } from "./useOpeningContents";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/**
 * אשף פתיחת מארז — design/Package Stations.dc.html (open). Runs on a
 * package-level opening station for a PACKAGE row (item.package is its view).
 * Six steps: scan → box photos → contents (OpeningContents: what is really in
 * the box, a serial for every item — saved before going on) → items (scan →
 * photo → weigh each) → labels (one per item; the box wears its label since
 * the shipment) → done. On "הדפס וסיים" every item gets its own result at this
 * station and then the box does, all under one submit id
 * (docs/packages/PLAN.md §4). Reference images / weights come from what the
 * worker scans: the box label is looked up among the package type's
 * reference items, each item's label among its own type's. A scan that finds
 * nothing warns and lets the worker go on without a reference. When the box
 * label finds a package reference, its members say what should be in the box
 * and what each item compares against (reference.ts: the expected SKU,
 * or another reference item, or the expected one when the scan finds none —
 * the source is saved on the item's result).
 *
 * Station fields (route-fields spec §4.11.3): when the kit's route publishes
 * fields for this step, the box photo step holds the box's block (artboard 15)
 * and each item's photo screen its own (artboard 16, "לכל פריט" + the item
 * type's group), each right before its verdict question, with the suggestion
 * under the question and the notes as a NotesField. Each item's drafts live in
 * its work, so leaving an item or "פתח שוב" keeps them. Without a config the
 * wizard is exactly as before.
 */

const PT_PACKAGE = OPENING_PHOTO_CODES.box;
const PT_PRODUCT = OPENING_PHOTO_CODES.item;

const STEPS: WizardStep[] = [
  { key: "scan", label: "סריקת מק״ט המארז", note: "מדבקת המארז" },
  { key: "boxPhoto", label: "צילום הקופסה", note: "3 זוויות + תקינות" },
  { key: "contents", label: "תכולה וסריאליים", note: "מה בקופסה, סריאלי לכל פריט" },
  { key: "items", label: "פריטים במארז", note: "סריקה, צילום ושקילה לכל פריט" },
  { key: "labels", label: "מדבקות", note: "מדבקה לכל פריט" },
  { key: "done", label: "סיום", note: "" },
];

export default function PackageOpenWizard({ onClose, item, station, workerId, workerName, onSubmit, pkg }: BoxPopupProps) {
  const [step, setStep] = React.useState(0);
  const [scan, setScan] = React.useState("");
  const [boxPhotos, setBoxPhotos] = React.useState<Photos>(emptyPhotos());
  const [items, setItems] = React.useState<PackageItemView[]>(pkg.items);
  // Items an earlier opening already submitted — it broke off before the box's own result — have
  // left the opening step: they count as done and are not sent again, or each would move one more
  // step and skip a station.
  const [work, setWork] = React.useState<Record<string, ItemWork>>(
    () => Object.fromEntries(pkg.items.filter(leftOpening).map((it) => [it.item_id, { ...freshWork(), done: true }])),
  );
  const [itemIdx, setItemIdx] = React.useState<number | null>(null);
  const [itemPhase, setItemPhase] = React.useState<"scan" | "photo" | "weigh">("scan");
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [labelsPrinted, setLabelsPrinted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  // What "הדפס וסיים" already sent, kept across a retry of it, and the done step's rows once the
  // box's answer is in.
  const sentRef = React.useRef<SentItems>({ committed: new Set(pkg.items.filter(leftOpening).map((it) => it.item_id)), nextStops: new Map() });
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  const uid = React.useId();

  // Asked again whatever the answer was (the drafts stay, by FieldId): after a 409
  // FIELDS_SCHEMA_MISMATCH, and after an item is added — it is not in the answer the wizard
  // opened with, and it can give a kit that answered "legacy" (no fields for what was
  // registered) fields of its own.
  const kit = useKitFields(item.item_id, station.test_station_id);
  const { sf, cfg: fieldsCfg, boxFx } = kit;
  const reloadFields = sf.reload;
  const contents = useOpeningContents(item.item_id, pkg, setItems, reloadFields);

  // ---- reference lookups, driven by what is scanned -------------------------
  // The box: its label among the package type's reference items. The answer
  // also supplies the box-photo reference set, so it stays live past step 1.
  const boxLookup = useReferenceLookup(scan, item.item_type_id, true, station.test_station_type_id);
  const boxHasRU = boxLookup.ref ? boxLookup.ref.hasRU : null;
  const boxRef = boxLookup.ref?.images ?? [];
  // The package type's reference SKUs, offered under the box scan to tap instead of scanning.
  const boxSkus = useReferenceSkus(item.item_type_id, true);
  // The item being worked on: its label among its own type's reference items,
  // only while its scan screen is up. Moving on copies the answer into its work.
  const scanItem = itemIdx != null ? items[itemIdx] : null;
  const itemLookup = useReferenceLookup(scanItem ? (work[scanItem.item_id]?.scan ?? "") : "", scanItem?.item_type_id, itemPhase === "scan", station.test_station_type_id);

  const workOf = (id: string): ItemWork => work[id] ?? freshWork();
  const patchWork = (id: string, patch: Partial<ItemWork>) => setWork((w) => ({ ...w, [id]: { ...(w[id] ?? freshWork()), ...patch } }));

  // ---- shots (shots.ts: uploaded as taken, taken back when removed) ----------
  const shots = useShotUpload(workerId, station.test_station_type_id);
  const pickBoxPhoto = (file: File) =>
    shots.pick(item.item_id, file, PT_PACKAGE, (fn) => setBoxPhotos((p) => ({ ...p, photos: fn(p.photos) })));
  const pickItemPhoto = (it: PackageItemView, file: File) =>
    shots.pick(it.item_id, file, PT_PRODUCT, (fn) => setWork((all) => {
      const cur = all[it.item_id] ?? freshWork();
      return { ...all, [it.item_id]: { ...cur, photos: { ...cur.photos, photos: fn(cur.photos.photos) } } };
    }));

  // Every item starts at its scan screen with its reference item's SKU already
  // in it — the member the package reference expects for its type — as its
  // serial is. A reopened one shows its last scan, and moving on with it
  // unchanged keeps the photos already taken.
  const startItem = (idx: number) => {
    const it = items[idx];
    if (!it || leftOpening(it)) return;
    if (work[it.item_id] == null) patchWork(it.item_id, { scan: expectedOf(it)?.sku.trim() ?? "" });
    setItemIdx(idx); setItemPhase("scan"); setError(null);
  };

  // ---- the package reference ------------------------------------------------
  // Found by the box label: its members are what each item is expected to be.
  // null = no package reference (not scanned yet, the label found none, or
  // what it found holds no members yet — the opening then runs as before).
  const kitMembers = boxLookup.ref?.hasRU && boxLookup.ref.members.length > 0 ? boxLookup.ref.members : null;
  const expectedOf = (it: { item_type_id: number }): RefMember | null =>
    kitMembers?.find((m) => m.itemTypeId === it.item_type_id) ?? null;

  const inItemFlow = itemIdx != null;
  const cur = inItemFlow ? items[itemIdx!] : null;
  const curWork = cur ? workOf(cur.item_id) : null;
  const doneCount = items.filter((it) => workOf(it.item_id).done).length;
  const templateCount = templateCountOf(pkg, items);
  const contentsIdx = STEPS.findIndex((s) => s.key === "contents");
  const stepKey = STEPS[step].key;
  const wr = curWork ? weightResult(curWork.refWeight, curWork.meas) : null;
  const boxPass = boxPhotos.ok === "pass";
  const itemPass = (it: PackageItemView) => wizardItemPasses(workOf(it.item_id));

  // Station fields. A step that holds them waits until they have answered
  // (loading, or a failed load), then for their gate: required fields and
  // notes, a note over its maximum, a field's shot still uploading or failed.
  // Without a config nothing here draws or gates.
  const boxHasFields = boxFx.defsCount > 0;
  const boxGate = kit.waiting || boxFx.blocking(kit.gate);
  /** A kit item's fields ("לכל פריט", then its type's), and its drafts as a block's state. */
  const itemFieldsOf = (it: PackageItemView): { defs: Field[]; fx: DraftsFieldsState } => {
    const defs = kit.defsOf(it.item_id);
    const fx = draftsFieldsState(defs, workOf(it.item_id).fields, (next) => setWork((all) => {
      const w = all[it.item_id] ?? freshWork();
      return { ...all, [it.item_id]: { ...w, fields: next(w.fields) } };
    }));
    return { defs, fx };
  };
  // The item on screen: its block's state while it has fields, and its gate.
  const curItemFields = cur ? itemFieldsOf(cur) : null;
  const curFx = curItemFields && inputFieldCount(curItemFields.defs) > 0 ? curItemFields.fx : null;
  const itemGate = kit.waiting || (curItemFields?.fx.blocking(kit.gate) ?? false);

  const contentsText = contentsStepText(contents);
  let stepTitle = STEPS[step].label;
  let stepSubtitle = "";
  let systemMsg: string | null = null;
  if (inItemFlow && cur) {
    if (itemPhase === "scan") { stepTitle = `${cur.item_type_desc} · סריקה`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · ${cur.makat ?? ""}`; systemMsg = "סרוק את מק״ט היצרן של הפריט — לפיו נטענים תמונות ומשקל הייחוס."; }
    else if (itemPhase === "photo") { stepTitle = `${cur.item_type_desc} · צילום`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · ${cur.makat ?? ""}`; systemMsg = "נא לצלם את הפריט בדיוק לפי תמונות הייחוס."; }
    else { stepTitle = `${cur.item_type_desc} · שקילה`; stepSubtitle = `פריט ${seq2(cur.package_seq)} · משקל ייחוס מהקטלוג`; systemMsg = "נא לשקול את הפריט ולהזין את המשקל שנמדד."; }
  } else if (stepKey === "scan") { stepSubtitle = "סרוק את מדבקת המארז כדי לפתוח את המארז בעמדה."; systemMsg = "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה."; }
  else if (stepKey === "boxPhoto") { stepSubtitle = "שלוש זוויות של הקופסה, ואז קביעת תקינות."; systemMsg = "נא לצלם את הקופסה בדיוק לפי תמונות הייחוס."; }
  else if (stepKey === "contents") { stepSubtitle = contentsText.subtitle; systemMsg = contentsText.band; }
  else if (stepKey === "items") { stepSubtitle = "כל פריט עובר סריקה, צילום ושקילה. אפשר לעבוד בכל סדר."; }
  else if (stepKey === "labels") { stepSubtitle = OPENING_TEXT.labelsSubtitle; }

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
  else if (stepKey === "items") { nextEnabled = items.length > 0 && doneCount === items.length; nextLabel = nextEnabled ? "המשך למדבקות" : `נותרו ${items.length - doneCount} פריטים`; }
  else if (stepKey === "contents") { nextEnabled = contents.gap == null; nextLabel = contentsText.nextLabel; }
  // Finishing waits while the station fields load (spec §4.2) — e.g. reloading after a 409.
  else if (stepKey === "labels") { nextLabel = "הדפס וסיים"; nextEnabled = sf.status !== "loading"; }
  else if (stepKey === "done") nextLabel = "חזרה לתור";

  // ---- finish: one result per item, then the box ---------------------------
  const finish = async () => {
    // The station fields still to be sent: the box's, and those of every item not saved yet.
    const fieldsToSend = fieldsCfg
      ? [{ defs: fieldsCfg.box, fx: boxFx }, ...items.filter((it) => !sentRef.current.committed.has(it.item_id)).map(itemFieldsOf)]
      : [];
    // Belt and braces for the per-step gate: nothing is submitted while a shot
    // is still uploading or failed, whichever way the worker reached this step.
    const shotsNow = [boxPhotos, ...items.map((it) => workOf(it.item_id).photos)].flatMap((ph) => ph.photos)
      .concat(fieldsToSend.flatMap((f) => fieldShots(f.defs, f.fx.drafts)));
    const hold = openingFinishHold(shotsNow, fieldsToSend, sf.status, kit.gate);
    if (hold === "wait") return;
    if (hold) { setError(hold); return; }
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    const ctx = { stationId: station.test_station_id, workerId, workerName, submitId };
    try {
      await postItemResults(items, sentRef.current, (it) => {
        const w = workOf(it.item_id);
        const passed = itemPass(it);
        return itemResultBody(ctx, it, {
          // The step this result is for: an item that already moved on is refused, never moved twice.
          CurrentRouteStep: it.current_route_step ?? undefined,
          Result: passed ? 1 : 0, Passed: passed, Comments: w.photos.note || undefined,
          Details: {
            ...wizardItemDetails(w, String(item.item_id)),
            // Station fields: each item answers as "kit_item", on the kit's route, version and step.
            ...(fieldsCfg ? buildFieldsBlock(kit.defsOf(it.item_id), w.fields, { ...fieldsCfg.schema, target: "kit_item" }, { ok: w.photos.ok }) : {}),
          },
        });
      }, reloadFields);
      const boxResult = await onSubmit({
        Result: boxPass ? 1 : 0, Passed: boxPass, Comments: boxPhotos.note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          ...wizardBoxDetails({ sku: scan, hasRU: boxHasRU, photos: boxPhotos }, {
            packageReference: kitMembers ? { referenceItemId: boxLookup.ref?.referenceItemId ?? null, members: kitMembers.length } : null,
            itemCount: items.length, registeredCount: pkg.items.length, templateCount, labelsPrinted,
            packageItemIds: items.map((it) => it.item_id),
          }),
          ...(fieldsCfg ? boxFx.toBlock({ ...fieldsCfg.schema, target: "box" }, { ok: boxPhotos.ok }) : {}),
        },
      });
      setDoneRows(openingDoneRows(pkg, items, nextStopOf(boxResult), sentRef.current.nextStops));
      setStep(STEPS.length - 1);
    } catch (e) {
      // The box's 409 arrives as the ApiError the page's onSubmit throws, carrying the body's code.
      if (shouldReloadFields(e)) reloadFields();
      setError(failureText(e, "שגיאה בשמירת פתיחת המארז"));
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
          const ref = resolveItemReference(sku, expectedOf(cur), itemLookup.ref ?? NO_REF, cur.item_type_desc);
          patchWork(cur.item_id, {
            sku, hasRU: ref.hasRU, refWeight: ref.refWeight, refImages: ref.images,
            refSource: ref.source, expectedSku: ref.expectedSku,
          });
        }
        setItemPhase("photo"); return;
      }
      if (itemPhase === "photo") { setItemPhase("weigh"); return; }
      patchWork(cur.item_id, { done: true }); setItemIdx(null); return;
    }
    if (stepKey === "labels") { setLabelsOpen(true); return; }
    if (stepKey === "done") { onClose(); return; }
    if (stepKey === "contents") {
      void contents.save().then((ok) => { if (ok) setStep((s) => Math.min(STEPS.length - 2, s + 1)); });
      return;
    }
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

  const doneStep = stepKey === "done";
  const busy = contents.busy;

  return (
    <>
      <PackageWizardShell
        onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title={OPENING_TEXT.title} pkg={pkg} workerName={workerName}
        // Past the contents only once they are saved: the items behind it are the server's.
        steps={STEPS} stepIndex={step} onStep={(i) => { if (!doneStep && !submitting && i < STEPS.length - 1 && (i <= step || nextEnabled) && (i <= contentsIdx || contents.saved)) { setItemIdx(null); setStep(i); } }}
        itemStepper={itemStepper} itemProgress={`${doneCount}/${items.length}`}
        stepTitle={stepTitle} stepSubtitle={stepSubtitle}
        stepCounter={inItemFlow ? `פריט ${itemIdx! + 1} מתוך ${items.length}` : `שלב ${step + 1} מתוך ${STEPS.length}`}
        systemMsg={systemMsg}
        footNote={inItemFlow ? "יציאה מהפריט שומרת את מה שהוזן" : "הכל נשמר בזמן אמת"}
        backDisabled={(step === 0 && !inItemFlow) || doneStep}
        onBack={onBack} nextLabel={nextLabel} nextEnabled={nextEnabled && !busy} onNext={onNext} busy={submitting}
      >
        <WizardError error={error} />

        {inItemFlow && cur && curWork ? (
          itemPhase === "scan" ? (
            <>
              <ExpectedReference member={expectedOf(cur)} kitFound={kitMembers != null} />
              <ScanField key={cur.item_id}
                label="מק״ט יצרן של הפריט" placeholder="סרוק את מק״ט היצרן של הפריט"
                value={curWork.scan} onChange={(v) => patchWork(cur.item_id, { scan: v })} lookup={itemLookup} onSubmit={onNext}
                found={(ref) => `נמצא פריט ייחוס${ref.name ? ` · ${ref.name}` : ""} · ${ref.images.length} תמונות ייחוס${ref.refWeight != null ? ` · ${ref.refWeight} גר׳` : ""}`}
                missing={`לא נמצא פריט ייחוס של ${cur.item_type_desc} עם המק״ט הזה — אפשר להמשיך, הצילום והשקילה יהיו ללא ייחוס`}
                verdict={(ref) => resolveItemReference(curWork.scan, expectedOf(cur), ref, cur.item_type_desc)}
                // A changed SKU is already said by the verdict (resolveItemReference).
                serial={cur.serial_no} prev={expectedOf(cur)?.sku} filledNote="הושלם ממק״ט פריט הייחוס של המארז" flagChange={false} />
            </>
          ) : itemPhase === "photo" ? (
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
              {curWork.hasRU === false && <AmberNote>לא נמצא פריט ייחוס למק״ט שנסרק ({curWork.sku}) — צלם לפי שיקול דעת והמשך.</AmberNote>}
              <PhotoUploader photos={curWork.photos.photos} refImages={curWork.refImages} onPick={(f) => pickItemPhoto(cur, f)}
                onRemove={(i) => { shots.remove(cur.item_id, curWork.photos.photos[i]); patchWork(cur.item_id, { photos: { ...curWork.photos, photos: curWork.photos.photos.filter((_, j) => j !== i) } }); }} />
              {/* Artboard 16: the item's fields before "הפריט תקין?" — a group label even for a lone group. */}
              {fieldsCfg ? curFx && (
                <FieldsBlock key={cur.item_id} variant="kit-item" title={BLOCK_TITLE.kitItem}
                  groups={kitItemFieldGroups(findKitItem(sf, cur.item_id))} fx={curFx} idPrefix={`${uid}-fx${cur.item_id}`}
                  uploadPhoto={(file, photoType) => shots.upload(cur.item_id, file, photoType)} />
              ) : <FieldsBlockFallback sf={sf} />}
              <VerdictBlock question="הפריט תקין?" verdict={curWork.photos} look="kit-item" notesTitle={`הערות · ${cur.item_type_desc}`} id={`${uid}-item-note`}
                suggest={curFx ? { fails: curFx.ev.fails, defs: curItemFields?.defs ?? [] } : null}
                onVerdict={(patch) => patchWork(cur.item_id, { photos: { ...curWork.photos, ...patch } })} />
            </div>
          ) : (
            <WeighBlock style={{ marginTop: 20 }} refWeight={curWork.refWeight} value={curWork.meas} id={`${uid}-meas`}
              onChange={(meas) => patchWork(cur.item_id, { meas })} result={wr} tolerancePct={TOLERANCE_PCT} />
          )
        ) : stepKey === "scan" ? (
          <>
            <OpeningBoxScan pkg={pkg} itemCount={items.length} value={scan} onChange={setScan} lookup={boxLookup} onSubmit={onNext} suggestions={boxSkus} />
            {/* The package reference the label found: what should be in the box. */}
            {kitMembers && !boxLookup.checking && scan.trim() !== "" && (
              <ExpectedContents types={boxTypesOf(items)} expectedOf={(id) => expectedOf({ item_type_id: id })} boxPhotos={boxRef.length} />
            )}
          </>
        ) : stepKey === "boxPhoto" ? (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            {boxHasRU === false && <AmberNote>לא נמצא פריט ייחוס למק״ט המארז שנסרק — צלם את הקופסה משלוש זוויות והמשך.</AmberNote>}
            <PhotoUploader photos={boxPhotos.photos} refImages={boxRef} onPick={pickBoxPhoto}
              onRemove={(i) => { shots.remove(item.item_id, boxPhotos.photos[i]); setBoxPhotos((p) => ({ ...p, photos: p.photos.filter((_, j) => j !== i) })); }} />
            {/* Artboard 15: the box's fields before "האריזה תקינה?". */}
            {fieldsCfg ? boxHasFields && (
              <FieldsBlock variant="wizard" title={BLOCK_TITLE.box} groups={[{ fields: fieldsCfg.box }]} fx={boxFx} idPrefix={`${uid}-fxbox`}
                uploadPhoto={(file, photoType) => shots.upload(item.item_id, file, photoType)} />
            ) : <FieldsBlockFallback sf={sf} />}
            <VerdictBlock question="האריזה תקינה?" verdict={boxPhotos} look="wizard" notesTitle="הערות · הקופסה" id={`${uid}-box-note`}
              suggest={boxHasFields ? { fails: boxFx.ev.fails, defs: fieldsCfg?.box ?? [] } : null}
              onVerdict={(patch) => setBoxPhotos((p) => ({ ...p, ...patch }))} />
          </div>
        ) : stepKey === "items" ? (
          <OpeningItemsList items={items} workOf={(it) => workOf(it.item_id)} doneLabel="צולם ונשקל" onStart={startItem} busy={busy} />
        ) : stepKey === "contents" ? (
          <OpeningContentsStep contents={contents} pkg={pkg} boxId={item.item_id} templateCount={templateCount}
            expectedOf={kitMembers ? (id) => expectedOf({ item_type_id: id }) : undefined} onDone={onNext} />
        ) : stepKey === "labels" ? (
          <OpeningLabelCards items={items} />
        ) : (
          <OpeningDone items={items} passOf={itemPass} pkg={pkg} doneRows={doneRows} />
        )}
      </PackageWizardShell>

      <OpeningLabelsDialog
        open={labelsOpen} pkg={pkg} items={items}
        // Closing commits the opening only once the labels went to print. Before
        // that, "ביטול" / × / the scrim just back out to the labels step.
        onClose={() => { setLabelsOpen(false); if (labelsPrinted) finish(); }}
        onPrinted={() => setLabelsPrinted(true)}
      />
    </>
  );
}
