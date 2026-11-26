"use client";
import React from "react";
import type SignatureCanvas from "react-signature-canvas";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { newActionId } from "@/lib/action-id";
import { failureText } from "@/app/components/failureText";
import { fillVariables, reportSignStepOf, skuScanOf } from "@/app/lib/popup-templates/schema";
import type { PopupTemplateJson } from "@/app/lib/popup-templates/schema";
import type { FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE } from "@/app/testing/fields/fieldsBlockModel";
import { seq2 } from "@/app/lib/packages/ids";
import { AMBER_BG, AMBER_BORDER, AMBER_INK, MUTED } from "@/components/ui/colors";
import PackageWizardShell, { type WizardStep } from "../PackageWizardShell";
import { CHECKING, PACKAGE_POPUP_TEXT, itemResultBody, postItemResults, type SentItems } from "../boxWizard";
import { nextStopOf, type NextStopRow } from "../nextStation";
import { closingSkuSuggestions, useReferenceLookup, useReferenceSkus } from "../referenceScan";
import { useKitFields } from "../stepFields";
import type { BoxPopupProps } from "../props";
import { emptyRunState, routeFieldsSlot, stepBlocker, type TemplateRunState } from "../templateModel";
import { bandOf, buildClosingBoxDetails, closingNote, closingPasses, closingStepKind } from "../packageTemplateModel";
import { PlainScan, StepComponents, WizardError, stepShots, useTemplatePhotos, type RunPatch, type Target } from "../packageTemplateParts";
import { ArrivalList, ClosingBoxScan, ClosingDecisionDialog, ClosingDone } from "./ClosingParts";
import {
  CLOSING_TEXT, closingDoneRows, closingFinishHold, closingItemDetails, closingSkusLabel, countMissing, decisionsOf, missText, packedIds,
  type Decision,
} from "./closingModel";
import { REPORT_SIGN_TEXT, ReportSignStep, reportsToSign, type SignItem } from "./ReportSignStep";
import { useClosingItemFields } from "./useClosingItemFields";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/**
 * The box's closing run from its station type's template (docs/features/popup-templates/PLAN.md §5, step
 * 2.3): PackageCloseWizard's shell and parts — the label scan (starting from the one scanned at
 * the opening), the items and packing ("נארז", or a decision for an item that did not arrive), the
 * next stations — with the steps and the box's components taken from the template. A template made
 * "מהחלון של היום" (closingTemplate) runs exactly as the wizard.
 *
 * The arrival step is the wizard's own, kit items' station fields under their rows (artboard 17).
 * The box's fields appear where the template places them (artboard 18), and the step that holds
 * them waits for them. "סגור מארז" records one result per arrived item, then the box's, whose
 * details keep the wizard's keys (packageTemplateModel.ts) — all under one submit id.
 *
 * A template that ends with "חתימה על הדוחות" (report_sign) has its finish button on that step: it
 * shows the reports of the items finishing here that ask for the closing signature, and the finish
 * waits for one signature, which every such item's result carries (ReportSignature) — the server
 * records it in the same request. Nothing is saved before the signature; a refresh before
 * "סגור מארז" only starts the closing over. The reports then wait for the approver's final
 * signature on the item page, when their template asks for one.
 *
 * Mounted per closing (the page renders a popup only while it is open), so the first state IS the
 * fresh one.
 */
export default function TemplatePackageClosing({
  onClose, item, station, stationTypeName, workerId, workerName, onSubmit, template, pkg,
}: BoxPopupProps & { template: PopupTemplateJson }) {
  const cfg = template.config;
  const kind = stationTypeName?.trim() || "";
  const boxSkuC = skuScanOf(cfg);

  const [step, setStep] = React.useState(0);
  // The scan starts from the label scanned when the box was opened, when the template says so.
  const [box, setBox] = React.useState<TemplateRunState>(() => emptyRunState(boxSkuC?.carry_last ? pkg.opening_sku ?? "" : ""));
  const [packed, setPacked] = React.useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [decideFor, setDecideFor] = React.useState<PackageItemView | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  // What the finish already sent, kept across a retry of it, and the done step's rows once the
  // box's answer is in.
  const sentRef = React.useRef<SentItems>({ committed: new Set(), nextStops: new Map() });
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  // The report signing (report_sign): the reports this user signs with the closing (null while
  // they load), how many wait for someone else who may sign, the pad, and — kept across a retry of
  // the finish — what each signed item's result answered.
  const signStepDef = reportSignStepOf(cfg);
  const signIdx = signStepDef ? cfg.steps.length - 1 : -1;
  const [toSign, setToSign] = React.useState<SignItem[] | null>(null);
  const [othersSign, setOthersSign] = React.useState(0);
  // Of the reports signed here, those that still wait for the approver's final signature after it.
  const awaitFinalRef = React.useRef<Set<string>>(new Set());
  const [signLoadError, setSignLoadError] = React.useState(false);
  const [padSigned, setPadSigned] = React.useState(false);
  const padRef = React.useRef<SignatureCanvas | null>(null);
  const signOutcomeRef = React.useRef<Map<string, boolean>>(new Map());
  const [signDone, setSignDone] = React.useState<{ signed: number; awaitFinal: number; failed: string[] }>({ signed: 0, awaitFinal: 0, failed: [] });
  const uid = React.useId();

  // Station fields: the kit's answer (the popup opens on the box row → mode "package"), the box's
  // drafts, and each kit item's by item_id. The box's appear where the template places them.
  const kit = useKitFields(item.item_id, station.test_station_id);
  const { sf, cfg: kitFields, boxFx } = kit;
  const items = pkg.items;
  const itemFields = useClosingItemFields(items, kit.defsOf, decisions);
  const boxSlot = routeFieldsSlot(cfg);

  const boxLookup = useReferenceLookup(box.sku, item.item_type_id, boxSkuC?.lookup_reference ?? false, station.test_station_type_id);
  const boxHasRU = boxLookup.ref ? boxLookup.ref.hasRU : null;
  // Offered under the box scan: the SKU it was opened with (closingSkuSuggestions).
  const typeSkus = useReferenceSkus(item.item_type_id, boxSkuC != null);
  const boxSkus = closingSkuSuggestions(pkg.opening_sku, typeSkus);
  const { uploadTo, photosFor } = useTemplatePhotos(workerId, station.test_station_type_id);
  const patchBox: RunPatch = (fn) => setBox(fn);

  const allResolved = items.length > 0 && items.every((it) => (it.arrived_at_closing ? packed[it.item_id] === true : decisions[it.item_id] != null));
  const anyMissing = items.some((it) => decisions[it.item_id]?.decision === "missing");

  // ---- station fields (artboards 17/18) ----------------------------------------
  const gate = kit.gate;
  /** The box's fields (artboard 18), when it has any and the template has a place for them. */
  const boxFields = kitFields && boxSlot && boxFx.defsCount > 0 ? kitFields.box : null;
  const itemsHold = kit.waiting || itemFields.shown.some((f) => f.fx.blocking(gate));
  const boxHold = kit.waiting || (boxFields != null && boxFx.blocking(gate));
  const itemsMissText = gate ? missText(countMissing(itemFields.shown.map((f) => f.fx))) : null;
  const boxMissText = gate && boxFields ? missText(countMissing([boxFx])) : null;

  /** What keeps a step from going on: its own blocker, then the fields it holds (their missing
   *  count names the button); CHECKING while something answers. */
  const stepHold = (i: number): string | null => {
    const st = cfg.steps[i];
    if (i === signIdx) {
      if (signLoadError) return REPORT_SIGN_TEXT.loadFailed;
      if (toSign == null) return CHECKING;
      // A report that waits for a signature this user may not give: the box does not close.
      if (othersSign > 0) return REPORT_SIGN_TEXT.cannotSign;
      return toSign.length > 0 && !padSigned ? REPORT_SIGN_TEXT.needsSignature : null;
    }
    if (closingStepKind(st) === "arrival") {
      if (!allResolved) return CLOSING_TEXT.needsDecision;
      return itemsHold ? itemsMissText ?? CHECKING : null;
    }
    if (boxSkuC && st.components.includes(boxSkuC) && boxSkuC.lookup_reference && boxLookup.checking) return CHECKING;
    const own = stepBlocker(st, box, kind);
    if (own) return own;
    return boxSlot?.stepIndex === i && boxHold ? boxMissText ?? CHECKING : null;
  };

  // ---- the shell's texts and its next button -----------------------------------
  const lastStep = cfg.steps.length - 1;
  const doneStep = step > lastStep;
  const stepDef = doneStep ? null : cfg.steps[step];
  const fill = (text: string) => fillVariables(text, { station: kind, sku: box.sku, model: item.model, serial: item.serial_no });
  const finishLabel = fill(cfg.finish_label);
  const isScan = stepDef != null && boxSkuC != null && stepDef.components.length === 1 && stepDef.components[0] === boxSkuC;
  const isSign = stepDef != null && step === signIdx;
  let stepSubtitle = "";
  let systemMsg: string | null = null;
  let nextLabel = CLOSING_TEXT.doneNext as string;
  let nextEnabled = true;
  if (stepDef) {
    const hold = stepHold(step);
    nextEnabled = hold == null;
    nextLabel = step === lastStep ? finishLabel : "המשך";
    if (closingStepKind(stepDef) === "arrival") {
      stepSubtitle = CLOSING_TEXT.arrivalSubtitle;
      if (hold && hold !== CHECKING) nextLabel = hold;
    } else if (isSign) {
      stepSubtitle = REPORT_SIGN_TEXT.subtitle;
      if (hold && hold !== CHECKING) nextLabel = hold;
    } else {
      if (isScan) { stepSubtitle = PACKAGE_POPUP_TEXT.boxScanSubtitle; systemMsg = PACKAGE_POPUP_TEXT.boxScanBand; }
      else systemMsg = bandOf(stepDef, fill);
      // The box's fields name what is missing once the step's own parts are done (artboard 18).
      if (hold && hold === boxMissText) nextLabel = hold;
      if (stepShots(stepDef, box).some((s) => s.failed)) nextLabel = PACKAGE_POPUP_TEXT.removeFailedShot;
    }
  }

  const finish = async () => {
    for (let i = 0; i <= lastStep; i++) {
      const b = stepHold(i);
      if (b) { if (b !== CHECKING) setError(b); setStep(i); return; }
    }
    // Belt and braces for the steps' holds: nothing is sent while a shown field is missing, or a
    // shot — a field's or a photo component's — is not stored yet.
    const held = closingFinishHold(
      kitFields ? [...itemFields.shown.map((f) => f.fx), ...(boxFields ? [boxFx] : [])] : [],
      Object.values(box.photos).flat().filter((s) => s.uploading || s.failed),
      gate,
    );
    if (held) { setError(held); return; }
    // One signature for every report that waits for it: it travels with each of those items'
    // results, and the server signs in the same request.
    const signIds = new Set(signStepDef ? (toSign ?? []).map((x) => x.item_id) : []);
    const pad = padRef.current;
    const signature = signIds.size > 0 && pad && !pad.isEmpty() ? pad.getCanvas().toDataURL("image/png") : null;
    if (signIds.size > 0 && !signature) { setError(REPORT_SIGN_TEXT.needsSignature); setStep(signIdx); return; }
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    // With a config every row answers it (D5): each arrived item as "kit_item" and the box as "box",
    // on the kit's route, version and step.
    const kitItemRef: FieldsSchemaRef | null = kitFields ? { ...kitFields.schema, target: "kit_item" } : null;
    try {
      await postItemResults(items.filter((it) => it.arrived_at_closing), sentRef.current, (it) => itemResultBody(
        { stationId: station.test_station_id, workerId, workerName, submitId }, it,
        {
          Result: 1, Passed: true,
          Details: closingItemDetails(String(item.item_id), template.version, kitItemRef ? itemFields.blockOf(it, kitItemRef) : null),
          ...(signature && signIds.has(it.item_id) ? { ReportSignature: signature } : {}),
        },
      ), sf.reload, (it, answer) => {
        if (signIds.has(it.item_id)) signOutcomeRef.current.set(it.item_id, answer.reportSign === "signed");
      });
      const passed = closingPasses(cfg, box, anyMissing);
      const note = closingNote(cfg, box);
      const boxResult = await onSubmit({
        Result: passed ? 1 : 0, Passed: passed, Comments: note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          ...buildClosingBoxDetails(cfg, { version: template.version, station: kind }, { ...box, hasRU: boxHasRU }, {
            packed: packedIds(items, packed),
            decisions: decisionsOf(items, decisions, kitItemRef ? itemFields.decisionFieldsOf(kitItemRef) : null),
          }),
          ...(kitFields && boxSlot ? boxFx.toBlock({ ...kitFields.schema, target: "box" }, {}) : {}),
        },
      });
      setDoneRows(closingDoneRows(pkg, items, nextStopOf(boxResult), sentRef.current.nextStops));
      const outcome = [...signOutcomeRef.current.entries()];
      setSignDone({
        signed: outcome.filter(([, ok]) => ok).length,
        awaitFinal: outcome.filter(([id, ok]) => ok && awaitFinalRef.current.has(id)).length,
        failed: outcome.filter(([, ok]) => !ok).map(([id]) => { const it = items.find((x) => x.item_id === id); return it ? `${seq2(it.package_seq)} · ${it.item_type_desc}` : id; }),
      });
      setStep(lastStep + 1);
    } catch (e) {
      setError(failureText(e, "שגיאה בשמירת סגירת המארז"));
      if (shouldReloadFields(e)) sf.reload();
    } finally {
      setSubmitting(false);
    }
  };

  /** The reports of the items that finish at this closing and wait for a signature. Loaded on
   *  every entry to the signing step: the packing may have changed since. */
  const loadToSign = async () => {
    setSignLoadError(false); setToSign(null);
    const finishing = items.filter((it) => it.arrived_at_closing);
    try {
      const { mine, othersOnly, awaitFinal } = await reportsToSign(finishing.map((it) => it.item_id));
      setOthersSign(othersOnly);
      awaitFinalRef.current = new Set(awaitFinal);
      setToSign(finishing.filter((it) => mine.includes(it.item_id)).map((it) => ({
        item_id: it.item_id, badge: seq2(it.package_seq), label: it.item_type_desc, serial: it.serial_no,
      })));
    } catch (e) {
      console.error("reports to sign failed to load", e);
      setSignLoadError(true);
    }
  };
  const goTo = (i: number) => {
    setStep(i);
    if (i === signIdx && i !== step) void loadToSign();
  };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (doneStep) { onClose(); return; }
    if (step >= lastStep) { void finish(); return; }
    goTo(step + 1);
  };
  // The rail: back always; forward only over steps that are done.
  const onStep = (i: number) => {
    if (doneStep || submitting || i > lastStep) return;
    if (i <= step || Array.from({ length: i }, (_, k) => stepHold(k)).every((b) => b == null)) goTo(i);
  };

  const steps: WizardStep[] = [
    ...cfg.steps.map((st) => ({ key: st.id, label: fill(st.title), note: fill(st.desc) })),
    { key: "done", label: PACKAGE_POPUP_TEXT.doneStep, note: "" },
  ];

  const boxTarget = (i: number): Target => ({
    run: box, patch: patchBox, photos: photosFor(item.item_id, box, patchBox), fill,
    refImages: boxLookup.ref?.images ?? [],
    noReference: boxHasRU === false ? PACKAGE_POPUP_TEXT.boxNoReference : null,
    fieldsHere: boxSlot?.stepIndex === i
      ? {
        atComponent: boxSlot.atComponent, componentId: boxSlot.componentId, title: boxFields ? BLOCK_TITLE.packing : null,
        // Artboard 18: the box's fields, before the packing checks in today's closing.
        block: (
          <React.Fragment key="route-fields">
            {kit.waiting && <FieldsBlockFallback sf={sf} />}
            {boxFields && <FieldsBlock variant="pack" title={BLOCK_TITLE.packing} groups={[{ fields: boxFields }]} fx={boxFx} idPrefix={`${uid}-fxbox`}
              uploadPhoto={(file, photoType) => uploadTo(item.item_id, file, photoType)} />}
          </React.Fragment>
        ),
      }
      : null,
    suggest: boxFields ? { fails: boxFx.ev.fails, defs: boxFields } : null,
    look: "pack", notesTitle: "הערות · הקופסה",
  });

  let body: React.ReactNode = null;
  if (stepDef && isScan && boxSkuC) {
    body = boxSkuC.lookup_reference ? (
      <ClosingBoxScan pkg={pkg} value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} lookup={boxLookup} onSubmit={onNext}
        prev={boxSkuC.carry_last ? pkg.opening_sku : undefined} suggestions={boxSkus} />
    ) : (
      <PlainScan label={PACKAGE_POPUP_TEXT.boxScanLabel} placeholder={PACKAGE_POPUP_TEXT.boxScanPlaceholder}
        value={box.sku} onChange={(v) => setBox((s) => ({ ...s, sku: v }))} onSubmit={onNext}
        suggestions={boxSkus.skus} suggestionsLabel={closingSkusLabel(pkg, boxSkus.fromOpening)} />
    );
  } else if (stepDef && closingStepKind(stepDef) === "arrival") {
    body = (
      <ArrivalList items={items} packed={packed} decisions={decisions}
        onPacked={(it, v) => setPacked((p) => ({ ...p, [it.item_id]: v }))}
        onDecide={setDecideFor} fields={itemFields} fieldsWaiting={kit.waiting} sf={sf}
        uploadPhotoFor={(itemId) => (file, photoType) => uploadTo(itemId, file, photoType)} submitting={submitting} />
    );
  } else if (stepDef && isSign) {
    body = (
      <ReportSignStep items={toSign} loadError={signLoadError} onRetry={() => void loadToSign()} cannotSign={othersSign > 0}
        canvasRef={padRef} signed={padSigned} onSignedChange={setPadSigned} />
    );
  } else if (stepDef) {
    body = <StepComponents step={stepDef} t={boxTarget(step)} />;
  } else {
    body = (
      <ClosingDone items={items} decisions={decisions} pkg={pkg} doneRows={doneRows}>
        {(signDone.signed > 0 || othersSign > 0) && (
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
            {[
              signDone.signed > 0 ? REPORT_SIGN_TEXT.doneSigned(signDone.signed) : null,
              signDone.awaitFinal > 0 ? REPORT_SIGN_TEXT.doneAwaitingFinal(signDone.awaitFinal) : null,
              othersSign > 0 ? REPORT_SIGN_TEXT.doneWaiting(othersSign) : null,
            ].filter(Boolean).join(" · ")}
          </div>
        )}
        {signDone.failed.length > 0 && (
          <div role="status" style={{ fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 11, padding: "9px 12px", marginTop: 10, maxWidth: 460 }}>
            {REPORT_SIGN_TEXT.doneFailed(signDone.failed.join(", "))}
          </div>
        )}
      </ClosingDone>
    );
  }

  return (
    <>
      <PackageWizardShell
        // Wider than the other wizards: its report signing step shows the reports at A4 width.
        width="min(1180px, 96vw)"
        onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title={CLOSING_TEXT.title} pkg={pkg} workerName={workerName}
        steps={steps} stepIndex={step} onStep={onStep}
        stepTitle={stepDef ? fill(stepDef.title) : PACKAGE_POPUP_TEXT.doneStep} stepSubtitle={stepSubtitle} stepCounter={`שלב ${step + 1} מתוך ${steps.length}`}
        systemMsg={systemMsg} footNote="הכל נשמר בזמן אמת"
        backDisabled={step === 0 || doneStep} onBack={() => { setError(null); if (step > 0 && !doneStep) setStep(step - 1); }}
        nextLabel={nextLabel} nextEnabled={nextEnabled} onNext={onNext} busy={submitting}
      >
        <WizardError error={error} />
        {body}
      </PackageWizardShell>

      <ClosingDecisionDialog decideFor={decideFor} onClose={() => setDecideFor(null)}
        onDecided={(it, d) => setDecisions((all) => ({ ...all, [it.item_id]: d }))} />
    </>
  );
}
