"use client";
import React from "react";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { newActionId } from "@/lib/action-id";
import { failureText } from "@/app/components/failureText";
import { fillVariables, skuScanOf } from "@/app/lib/popup-templates/schema";
import type { PopupTemplateJson, SkuScanComponent, TemplateStep } from "@/app/lib/popup-templates/schema";
import { seq2 } from "@/app/lib/packages/ids";
import type { Field } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import type { RefImg } from "@/app/testing/fields/PhotoUploader";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE, draftsFieldsState, kitItemFieldGroups, type DraftsFieldsState } from "@/app/testing/fields/fieldsBlockModel";
import { buildFieldsBlock, inputFieldCount } from "@/app/testing/fields/drafts";
import { findKitItem } from "@/app/testing/fields/useStationFields";
import PackageWizardShell, { type ItemStepperRow, type WizardStep } from "../PackageWizardShell";
import { CHECKING, PACKAGE_POPUP_TEXT, fieldShots, itemResultBody, postItemResults, type SentItems } from "../boxWizard";
import { nextStopOf, type NextStopRow } from "../nextStation";
import { NO_REF, resolveItemReference, type RefMember } from "../reference";
import { ScanField, useReferenceLookup, useReferenceSkus } from "../referenceScan";
import { useKitFields } from "../stepFields";
import type { BoxPopupProps } from "../props";
import { emptyRunState, routeFieldsSlot, stepBlocker, type TemplateRunState } from "../templateModel";
import {
  bandOf, boxPasses, buildOpeningBoxDetails, buildOpeningItemDetails, freshItemWork, itemOutcome, itemsLine, openingStepKind,
  type OpeningItemWork,
} from "../packageTemplateModel";
import { PlainScan, StepComponents, WizardError, stepShots, useTemplatePhotos, type RunPatch, type Target } from "../packageTemplateParts";
import { ExpectedContents, ExpectedReference } from "./PackageReferenceViews";
import { OpeningBoxScan, OpeningContentsStep, OpeningDone, OpeningItemsList, OpeningLabelCards, OpeningLabelsDialog } from "./OpeningParts";
import {
  OPENING_TEXT, boxTypesOf, contentsStepText, leftOpening, openingDoneRows, openingFinishHold, templateCountOf,
} from "./openingModel";
import { useOpeningContents } from "./useOpeningContents";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/**
 * The box's opening run from its station type's template (docs/features/popup-templates/PLAN.md §5, step
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
 *
 * Mounted per opening (StationPopupProps), so the first state IS the fresh one.
 */

/** The wizard's own words for the parts the template does not word. */
const OPEN_TEXT = {
  itemScanLabel: "מק״ט יצרן של הפריט",
  itemScanPlaceholder: "סרוק את מק״ט היצרן של הפריט",
  itemScanBand: "סרוק את מק״ט היצרן של הפריט — לפיו נטענים תמונות ומשקל הייחוס.",
  itemScanBandPlain: "סרוק את מק״ט היצרן של הפריט.",
  itemNoReference: (sku: string) => `לא נמצא פריט ייחוס למק״ט שנסרק (${sku}) — צלם לפי שיקול דעת והמשך.`,
} as const;

const NO_FLOW: TemplateStep[] = [];

export default function TemplatePackageOpening({
  onClose, item, station, stationTypeName, workerId, workerName, onSubmit, template, pkg,
}: BoxPopupProps & { template: PopupTemplateJson }) {
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
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [labelsPrinted, setLabelsPrinted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  // What the finish already sent, kept across a retry of it, and the done step's rows once the
  // box's answer is in.
  const sentRef = React.useRef<SentItems>({ committed: new Set(pkg.items.filter(leftOpening).map((it) => it.item_id)), nextStops: new Map() });
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  const uid = React.useId();

  // ---- station fields (route-fields spec §4.11.3) ---------------------------
  const kit = useKitFields(item.item_id, station.test_station_id);
  const { sf, cfg: fieldsCfg, boxFx } = kit;
  const reloadFields = sf.reload;
  // Where the template places them: the box's among its steps, each item's in its flow. A
  // template with no place for them draws, gates and sends none.
  const boxSlot = routeFieldsSlot(cfg);
  const flowSlot = routeFieldsSlot({ steps: flow });
  const contents = useOpeningContents(item.item_id, pkg, setItems, reloadFields);

  // ---- reference lookups, driven by what is scanned -------------------------
  // The box: its label among the package type's reference items. The answer also supplies the
  // box photos' reference sets, so it stays live past the scan.
  const boxLookup = useReferenceLookup(box.sku, item.item_type_id, boxSkuC?.lookup_reference ?? false, station.test_station_type_id);
  const boxHasRU = boxLookup.ref ? boxLookup.ref.hasRU : null;
  // The package type's reference SKUs, offered under the box scan to tap instead of scanning.
  const boxSkus = useReferenceSkus(item.item_type_id, boxSkuC != null);
  // The item being worked on: its label among its own type's reference items, only while its scan
  // is up. Moving on copies the answer into its work.
  const curItem = itemIdx != null ? items[itemIdx] ?? null : null;
  const onItemScan = curItem != null && phase === 0 && itemSkuC != null;
  const itemLookup = useReferenceLookup(curItem && onItemScan ? (work[curItem.item_id]?.run.sku ?? "") : "", curItem?.item_type_id, onItemScan && itemSkuC.lookup_reference, station.test_station_type_id);

  const workOf = (id: string): OpeningItemWork => work[id] ?? freshItemWork();
  const patchWork = (id: string, fn: (w: OpeningItemWork) => OpeningItemWork) => setWork((all) => ({ ...all, [id]: fn(all[id] ?? freshItemWork()) }));
  const patchBox: RunPatch = (fn) => setBox(fn);
  const patchItemRun = (id: string): RunPatch => (fn) => patchWork(id, (w) => ({ ...w, run: fn(w.run) }));

  // ---- uploads (browser → MinIO, tagged by the photo component's group) --------
  const { uploadTo, photosFor } = useTemplatePhotos(workerId, station.test_station_type_id);

  // ---- the package reference ------------------------------------------------
  // Found by the box label: its members are what each item is expected to be. null = no package
  // reference (not scanned yet, the label found none, or what it found holds no members yet).
  const kitMembers = boxLookup.ref?.hasRU && boxLookup.ref.members.length > 0 ? boxLookup.ref.members : null;
  const expectedOf = (it: { item_type_id: number }): RefMember | null =>
    kitMembers?.find((m) => m.itemTypeId === it.item_type_id) ?? null;
  const boxRefImages: RefImg[] = boxLookup.ref?.images ?? [];

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
          ...freshItemWork(), sku: expected?.sku ?? null, refImages: ref.images, refSource: ref.source, expectedSku: ref.expectedSku,
          run: { ...emptyRunState(), hasRU: ref.hasRU, refWeight: ref.refWeight },
        }));
      }
    }
    setItemIdx(idx); setPhase(0); setError(null);
  };

  const lastBoxStep = cfg.steps.length - 1;
  const doneStep = step > lastBoxStep;
  const stepDef: TemplateStep | null = doneStep ? null : cfg.steps[step];
  const stepKind = stepDef ? openingStepKind(stepDef) : null;
  const curWork = curItem ? workOf(curItem.item_id) : null;
  const inItemFlow = curItem != null && curWork != null && flow.length > 0;
  const doneCount = items.filter((it) => workOf(it.item_id).done).length;
  const templateCount = templateCountOf(pkg, items);
  const fillBox = (text: string) => fillVariables(text, { station: kind, sku: box.sku, model: item.model, serial: item.serial_no });
  const fillItem = (it: PackageItemView, w: OpeningItemWork) => (text: string) =>
    fillVariables(text, { station: kind, sku: w.run.sku, model: it.model, serial: it.serial_no });

  // Station fields. A step that holds them waits until they have answered (loading, or a failed
  // load), then for their gate: required fields and notes, a note over its maximum, a field's shot
  // still uploading or failed. Without a config nothing here draws or gates.
  const boxHasFields = boxFx.defsCount > 0;
  const boxFieldsBlocking = kit.waiting || boxFx.blocking(kit.gate);
  /** A kit item's fields ("לכל פריט", then its type's), and its drafts as a block's state. */
  const itemFieldsOf = (it: PackageItemView): { defs: Field[]; fx: DraftsFieldsState } => {
    const defs = kit.defsOf(it.item_id);
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
      case "contents": return contents.saved ? null : contents.gap ?? "יש לשמור את התכולה";
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
    const fieldsHere = flowSlot?.stepIndex === phase && (kit.waiting || (curItemFields?.fx.blocking(kit.gate) ?? false));
    return stepBlocker(flow[phase], curWork.run, kind, fieldsHere);
  };

  // ---- the shell's texts and its next button -----------------------------------
  const finishLabel = fillBox(cfg.finish_label);
  let stepTitle = stepDef ? fillBox(stepDef.title) : PACKAGE_POPUP_TEXT.doneStep;
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
    if (stepShots(ph, curWork.run).some((s) => s.failed)) nextLabel = PACKAGE_POPUP_TEXT.removeFailedShot;
  } else if (stepDef && stepKind) {
    const isLast = step === lastBoxStep;
    const nextKind = isLast ? null : openingStepKind(cfg.steps[step + 1]);
    if (stepKind === "contents") {
      const t = contentsStepText(contents);
      stepSubtitle = t.subtitle;
      systemMsg = t.band;
      nextEnabled = contents.gap == null;
      nextLabel = t.nextLabel;
    } else if (stepKind === "items") {
      stepSubtitle = itemsLine(flow, fillBox);
      nextEnabled = items.length > 0 && doneCount === items.length;
      nextLabel = !nextEnabled ? `נותרו ${items.length - doneCount} פריטים` : isLast ? finishLabel : nextKind === "labels" ? "המשך למדבקות" : "המשך";
    } else if (stepKind === "labels") {
      stepSubtitle = OPENING_TEXT.labelsSubtitle;
      // Finishing waits while the station fields load (spec §4.2) — e.g. reloading after a 409.
      nextLabel = isLast ? finishLabel : "הדפס והמשך";
      nextEnabled = sf.status !== "loading";
    } else {
      const isScan = boxSkuC != null && stepDef.components.length === 1 && stepDef.components[0] === boxSkuC;
      if (isScan) { stepSubtitle = PACKAGE_POPUP_TEXT.boxScanSubtitle; systemMsg = PACKAGE_POPUP_TEXT.boxScanBand; }
      else systemMsg = bandOf(stepDef, fillBox);
      nextEnabled = boxStepBlocker(step) == null;
      nextLabel = isLast ? finishLabel : "המשך";
      if (stepShots(stepDef, box).some((s) => s.failed)) nextLabel = PACKAGE_POPUP_TEXT.removeFailedShot;
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
        ...(flowSlot ? items.filter((it) => !sentRef.current.committed.has(it.item_id)).map(itemFieldsOf) : []),
      ]
      : [];
    // Belt and braces for the per-step gate: nothing is submitted while a shot is still uploading
    // or failed, whichever way the worker reached this step.
    const shots = [box, ...items.map((it) => workOf(it.item_id).run)].flatMap((run) => Object.values(run.photos).flat())
      .concat(fieldsToSend.flatMap((f) => fieldShots(f.defs, f.fx.drafts)));
    const hold = openingFinishHold(shots, fieldsToSend, boxSlot || flowSlot ? sf.status : null, kit.gate);
    if (hold === "wait") return;
    if (hold) { setError(hold); return; }
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    const ctx = { version: template.version, station: kind };
    try {
      await postItemResults(items, sentRef.current, (it) => {
        const w = workOf(it.item_id);
        const passed = itemOutcome(flow, w.run).pass;
        return itemResultBody({ stationId: station.test_station_id, workerId, workerName, submitId }, it, {
          // The step this result is for: an item that already moved on is refused, never moved twice.
          CurrentRouteStep: it.current_route_step ?? undefined,
          Result: passed ? 1 : 0, Passed: passed, Comments: w.run.verdict.note || undefined,
          Details: {
            ...buildOpeningItemDetails(flow, { ...ctx, packageId: String(item.item_id) }, w),
            // Station fields: each item answers as "kit_item", on the kit's route, version and step.
            ...(fieldsCfg && flowSlot ? buildFieldsBlock(kit.defsOf(it.item_id), w.fields, { ...fieldsCfg.schema, target: "kit_item" }, { ok: w.run.verdict.ok }) : {}),
          },
        });
      }, reloadFields);
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
      setDoneRows(openingDoneRows(pkg, items, nextStopOf(boxResult), sentRef.current.nextStops));
      setStep(lastBoxStep + 1);
    } catch (e) {
      // The box's 409 arrives as the ApiError the page's onSubmit throws, carrying the body's code.
      if (shouldReloadFields(e)) reloadFields();
      setError(failureText(e, "שגיאה בשמירת פתיחת המארז"));
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
            ...w, sku, refImages: ref.images, refSource: ref.source, expectedSku: ref.expectedSku,
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
      void contents.save().then((ok) => { if (ok) advance(); });
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
    { key: "done", label: PACKAGE_POPUP_TEXT.doneStep, note: "" },
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
  const boxTarget = (i: number): Target => ({
    run: box, patch: patchBox, photos: photosFor(item.item_id, box, patchBox), fill: fillBox, refImages: boxRefImages,
    noReference: boxHasRU === false ? PACKAGE_POPUP_TEXT.boxNoReference : null,
    fieldsHere: boxSlot?.stepIndex === i
      ? {
        atComponent: boxSlot.atComponent, componentId: boxSlot.componentId, title: fieldsCfg && boxHasFields ? BLOCK_TITLE.box : null,
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
    run: w.run, patch: patchItemRun(it.item_id), photos: photosFor(it.item_id, w.run, patchItemRun(it.item_id)), fill: fillItem(it, w),
    refImages: w.refImages,
    noReference: w.run.hasRU === false ? OPEN_TEXT.itemNoReference(w.sku ?? "") : null,
    fieldsHere: flowSlot?.stepIndex === phase
      ? {
        atComponent: flowSlot.atComponent, componentId: flowSlot.componentId, title: fieldsCfg && curFx ? BLOCK_TITLE.kitItem : null,
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
    ) : <StepComponents step={ph} t={itemTarget(curItem, curWork)} />;
  } else if (stepDef && stepKind === "components") {
    const isScan = boxSkuC != null && stepDef.components.length === 1 && stepDef.components[0] === boxSkuC;
    body = isScan ? (
      <>
        {boxSkuC.lookup_reference ? (
          <OpeningBoxScan pkg={pkg} itemCount={items.length} value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} lookup={boxLookup} onSubmit={onNext}
            prev={boxSkuC.carry_last ? item.last_sku : undefined} suggestions={boxSkus} />
        ) : (
          <PlainScan label={PACKAGE_POPUP_TEXT.boxScanLabel} placeholder={PACKAGE_POPUP_TEXT.boxScanPlaceholder}
            value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} onSubmit={onNext}
            suggestions={boxSkus} suggestionsLabel={`מק״טים מיוחסים ל־${pkg.item_type_desc}`} />
        )}
        {/* The package reference the label found: what should be in the box. */}
        {kitMembers && !boxLookup.checking && box.sku.trim() !== "" && (
          <ExpectedContents types={boxTypesOf(items)} expectedOf={(id) => expectedOf({ item_type_id: id })}
            boxPhotos={cfg.steps.some((s) => s.components.some((c) => c.kind === "photo" && c.show_reference)) ? boxRefImages.length : 0} />
        )}
      </>
    ) : <StepComponents step={stepDef} t={boxTarget(step)} />;
  } else if (stepKind === "contents") {
    body = (
      <OpeningContentsStep contents={contents} pkg={pkg} boxId={item.item_id} templateCount={templateCount}
        expectedOf={kitMembers ? (id) => expectedOf({ item_type_id: id }) : undefined} onDone={onNext} />
    );
  } else if (stepKind === "items") {
    body = <OpeningItemsList items={items} workOf={(it) => { const w = workOf(it.item_id); return { done: w.done, refWeight: w.run.refWeight }; }}
      doneLabel="הושלם" onStart={startItem} busy={contents.busy} canStart={flow.length > 0} />;
  } else if (stepKind === "labels") {
    body = <OpeningLabelCards items={items} />;
  } else {
    body = <OpeningDone items={items} passOf={(it) => itemOutcome(flow, workOf(it.item_id).run).pass} pkg={pkg} doneRows={doneRows} />;
  }

  return (
    <>
      <PackageWizardShell
        onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title={OPENING_TEXT.title} pkg={pkg} workerName={workerName}
        steps={steps} stepIndex={step} onStep={onStep}
        itemStepper={itemStepper} itemProgress={`${doneCount}/${items.length}`}
        stepTitle={stepTitle} stepSubtitle={stepSubtitle}
        stepCounter={inItemFlow ? `פריט ${itemIdx! + 1} מתוך ${items.length}` : `שלב ${step + 1} מתוך ${steps.length}`}
        systemMsg={systemMsg}
        footNote={inItemFlow ? "יציאה מהפריט שומרת את מה שהוזן" : "הכל נשמר בזמן אמת"}
        backDisabled={(step === 0 && !inItemFlow) || doneStep}
        onBack={onBack} nextLabel={nextLabel} nextEnabled={nextEnabled && !contents.busy} onNext={onNext} busy={submitting}
      >
        <WizardError error={error} />
        {body}
      </PackageWizardShell>

      <OpeningLabelsDialog
        open={labelsOpen} pkg={pkg} items={items}
        // Closing goes on only once the labels went to print — the finish when the labels are
        // the last step. Before that, "ביטול" / × / the scrim just back out to the labels step.
        onClose={() => { setLabelsOpen(false); if (labelsPrinted) advance(); }}
        onPrinted={() => setLabelsPrinted(true)}
      />
    </>
  );
}
