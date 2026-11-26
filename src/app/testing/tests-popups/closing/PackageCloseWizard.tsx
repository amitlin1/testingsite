"use client";
import React from "react";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { newActionId } from "@/lib/action-id";
import { failureText } from "@/app/components/failureText";
import { SUGGEST_PREFIX } from "@/app/lib/station-fields/labels";
import type { FieldsSchemaRef } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import { NotesField } from "@/app/testing/fields/NotesField";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE, VARIANT_SPEC, noteEditorTitle } from "@/app/testing/fields/fieldsBlockModel";
import PackageWizardShell, { type WizardStep } from "../PackageWizardShell";
import { CheckRows, WizardError } from "../packageTemplateParts";
import { itemResultBody, postItemResults, type SentItems } from "../boxWizard";
import { nextStopOf, type NextStopRow } from "../nextStation";
import { closingSkuSuggestions, useReferenceLookup, useReferenceSkus } from "../referenceScan";
import { useShotUpload } from "../shots";
import { useKitFields } from "../stepFields";
import type { BoxPopupProps } from "../props";
import { ArrivalList, ClosingBoxScan, ClosingDecisionDialog, ClosingDone } from "./ClosingParts";
import {
  CLOSING_TEXT, closingDoneRows, closingFinishHold, closingItemDetails, countMissing, decisionsOf, missText, packedIds, type Decision,
} from "./closingModel";
import { useClosingItemFields } from "./useClosingItemFields";
import { MUTED } from "@/components/ui/colors";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/**
 * אשף סגירת מארז — design/Package Stations.dc.html (close). Runs on a
 * package-level closing station for a PACKAGE row. Four steps: scan → items
 * and packing (arrived → "נארז"; not arrived → an explicit decision with a
 * note) → packing checks → done. "סגור מארז" records one result per arrived
 * item and then the box's, whose details carry the decisions
 * (docs/features/packages/PLAN.md §4, decision 5; DESIGN_REVIEW.md).
 *
 * The scan starts from the label scanned when the box was opened
 * (pkg.opening_sku) and, like the opening, is looked up among the package
 * type's reference items; the worker may rescan it.
 *
 * Station fields (route-fields spec §4.11.4–§4.11.5, D5): when the kit's
 * route has a published config for this step, each kit item's fields nest
 * under its row in the kit card (artboard 17) and the box's sit before the
 * packing checks (artboard 18); they hold those steps' next button, and the
 * results carry them. Without a config the wizard is exactly as before.
 */

const STEPS: WizardStep[] = [
  { key: "scan", label: "סריקת מק״ט המארז", note: "מדבקת המארז" },
  { key: "arrival", label: "פריטים ואריזה", note: "מצב הגעה + נארז" },
  { key: "packOk", label: "תקינות האריזה", note: "אישור סופי" },
  { key: "done", label: "סיום", note: "" },
];

const CHECKS = ["כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת המארז קריאה"];
const CHECK_ROWS = CHECKS.map((label, i) => ({ id: String(i), label }));
/** The packing note's label; with station fields, also its editor's title (artboard 18 `pk`). */
const PACK_NOTE_LABEL = "הערות אריזה";

export default function PackageCloseWizard({ onClose, item, station, workerId, workerName, onSubmit, pkg }: BoxPopupProps) {
  const [step, setStep] = React.useState(0);
  const [scan, setScan] = React.useState(pkg.opening_sku ?? "");
  const [packed, setPacked] = React.useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [decideFor, setDecideFor] = React.useState<PackageItemView | null>(null);
  const [checks, setChecks] = React.useState<boolean[]>(CHECKS.map(() => false));
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitIdRef = React.useRef<string | null>(null);
  // What "סגור מארז" already sent, kept across a retry of it, and the done step's rows once the
  // box's answer is in.
  const sentRef = React.useRef<SentItems>({ committed: new Set(), nextStops: new Map() });
  const [doneRows, setDoneRows] = React.useState<NextStopRow[]>([]);
  const noteId = React.useId();

  // Station fields: the kit's answer (the popup opens on the box row → mode "package"), the box's
  // drafts, and each kit item's by item_id.
  const kit = useKitFields(item.item_id, station.test_station_id);
  const { sf, cfg: kitFields, boxFx } = kit;
  const items = pkg.items;
  const itemFields = useClosingItemFields(items, kit.defsOf, decisions);

  const boxLookup = useReferenceLookup(scan, item.item_type_id, true, station.test_station_type_id);
  const typeSkus = useReferenceSkus(item.item_type_id, true);
  const { upload } = useShotUpload(workerId, station.test_station_type_id);

  // Offered under the box scan: the SKU it was opened with (closingSkuSuggestions).
  const scanSuggestions = closingSkuSuggestions(pkg.opening_sku, typeSkus);

  const resolved = (it: PackageItemView) => (it.arrived_at_closing ? packed[it.item_id] === true : decisions[it.item_id] != null);
  const allResolved = items.length > 0 && items.every(resolved);
  const checksAll = checks.every(Boolean);
  const stepKey = STEPS[step].key;
  const anyMissing = items.some((it) => decisions[it.item_id]?.decision === "missing");

  // ---- station fields (artboards 17/18) ----------------------------------------
  const gate = kit.gate;
  /** The box's fields (artboard 18), when it has any. */
  const boxFields = kitFields && boxFx.defsCount > 0 ? kitFields.box : null;
  // Each step that shows fields holds its next button while they block (evaluate.ts
  // fieldsBlocking); the button then names what is missing.
  const itemsHold = kit.waiting || itemFields.shown.some((f) => f.fx.blocking(gate));
  const boxHold = kit.waiting || (boxFields != null && boxFx.blocking(gate));
  const itemsMissText = gate ? missText(countMissing(itemFields.shown.map((f) => f.fx))) : null;
  const boxMissText = gate && boxFields ? missText(countMissing([boxFx])) : null;
  /** A photo field's shot, stored on `targetId` (a kit item, or the box) as the opening wizard does. */
  const uploadPhotoFor = (targetId: string | number) => (file: File, photoType: string) => upload(targetId, file, photoType);

  let stepSubtitle = "";
  let systemMsg: string | null = null;
  if (stepKey === "scan") { stepSubtitle = "סרוק את מדבקת המארז כדי לפתוח את המארז בעמדה."; systemMsg = "סריקת המארז פותחת את הבדיקה ורושמת את זמן ההתחלה."; }
  else if (stepKey === "arrival") stepSubtitle = CLOSING_TEXT.arrivalSubtitle;
  else if (stepKey === "packOk") stepSubtitle = "אישור סופי לפני סגירת המארז.";

  let nextLabel = "המשך";
  let nextEnabled = true;
  if (stepKey === "scan") nextEnabled = scan.trim() !== "" && !boxLookup.checking;
  else if (stepKey === "arrival") {
    nextEnabled = allResolved; nextLabel = allResolved ? "המשך" : CLOSING_TEXT.needsDecision;
    // Then the fields of the items that show them (artboard 17).
    if (allResolved && itemsHold) { nextEnabled = false; nextLabel = itemsMissText ?? nextLabel; }
  }
  else if (stepKey === "packOk") {
    nextEnabled = checksAll; nextLabel = "סגור מארז";
    // Then the box's fields (artboard 18).
    if (checksAll && boxHold) { nextEnabled = false; nextLabel = boxMissText ?? nextLabel; }
  }
  else if (stepKey === "done") nextLabel = CLOSING_TEXT.doneNext;

  const finish = async () => {
    const held = closingFinishHold([...itemFields.shown.map((f) => f.fx), ...(boxFields ? [boxFx] : [])], [], gate);
    if (held) { setError(held); return; }
    setSubmitting(true); setError(null);
    const submitId = (submitIdRef.current ??= newActionId());
    // With a config every row answers it (D5): each arrived item as "kit_item" and the box as "box",
    // on the kit's route, version and step.
    const kitItemRef: FieldsSchemaRef | null = kitFields ? { ...kitFields.schema, target: "kit_item" } : null;
    try {
      await postItemResults(items.filter((it) => it.arrived_at_closing), sentRef.current, (it) => itemResultBody(
        { stationId: station.test_station_id, workerId, workerName, submitId }, it,
        { Result: 1, Passed: true, Details: closingItemDetails(String(item.item_id), null, kitItemRef ? itemFields.blockOf(it, kitItemRef) : null) },
      ), sf.reload);
      const boxResult = await onSubmit({
        Result: anyMissing ? 0 : 1, Passed: !anyMissing, Comments: note || undefined, WorkerID: workerId ?? undefined, SubmitID: submitId,
        Details: {
          sku: scan.trim(), hasRU: boxLookup.ref?.hasRU ?? null, closing: true, checks: CHECKS.map((label, i) => ({ label, ok: checks[i] })), note,
          packed: packedIds(items, packed),
          decisions: decisionsOf(items, decisions, kitItemRef ? itemFields.decisionFieldsOf(kitItemRef) : null),
          ...(kitFields ? boxFx.toBlock({ ...kitFields.schema, target: "box" }, {}) : {}),
        },
      });
      setDoneRows(closingDoneRows(pkg, items, nextStopOf(boxResult), sentRef.current.nextStops));
      setStep(STEPS.length - 1);
    } catch (e) {
      setError(failureText(e, "שגיאה בשמירת סגירת המארז"));
      if (shouldReloadFields(e)) sf.reload();
    } finally {
      setSubmitting(false);
    }
  };

  const onNext = () => {
    if (!nextEnabled || submitting) return;
    setError(null);
    if (stepKey === "packOk") { finish(); return; }
    if (stepKey === "done") { onClose(); return; }
    setStep((s) => s + 1);
  };
  const doneStep = stepKey === "done";

  return (
    <>
      <PackageWizardShell
        onClose={onClose}
        stationName={station.test_station_desc} stationCode={String(station.test_station_id)}
        title={CLOSING_TEXT.title} pkg={pkg} workerName={workerName}
        steps={STEPS} stepIndex={step} onStep={(i) => { if (!doneStep && !submitting && i < STEPS.length - 1) setStep(i); }}
        stepTitle={STEPS[step].label} stepSubtitle={stepSubtitle} stepCounter={`שלב ${step + 1} מתוך ${STEPS.length}`}
        systemMsg={systemMsg} footNote="הכל נשמר בזמן אמת"
        backDisabled={step === 0 || doneStep} onBack={() => { setError(null); if (step > 0 && !doneStep) setStep((s) => s - 1); }}
        nextLabel={nextLabel} nextEnabled={nextEnabled} onNext={onNext} busy={submitting}
      >
        <WizardError error={error} />

        {stepKey === "scan" && (
          <ClosingBoxScan pkg={pkg} value={scan} onChange={setScan} lookup={boxLookup} onSubmit={onNext}
            prev={pkg.opening_sku} suggestions={scanSuggestions} />
        )}

        {stepKey === "arrival" && (
          <ArrivalList items={items} packed={packed} decisions={decisions}
            onPacked={(it, v) => setPacked((p) => ({ ...p, [it.item_id]: v }))}
            onDecide={setDecideFor} fields={itemFields} fieldsWaiting={kit.waiting} sf={sf} uploadPhotoFor={uploadPhotoFor} submitting={submitting} />
        )}

        {stepKey === "packOk" && (
          <div style={{ maxWidth: 620, marginTop: 20 }}>
            {kit.waiting && <div style={{ marginBottom: 26 }}><FieldsBlockFallback sf={sf} /></div>}
            {/* Artboard 18: the box's fields before the packing checks. */}
            {boxFields && (
              <FieldsBlock variant="pack" title={BLOCK_TITLE.packing} groups={[{ fields: boxFields }]} fx={boxFx} uploadPhoto={uploadPhotoFor(item.item_id)} />
            )}
            <CheckRows label="תקינות האריזה" rows={CHECK_ROWS} isOn={(id) => checks[Number(id)]}
              onToggle={(id) => setChecks((c) => c.map((v, j) => (j === Number(id) ? !v : v)))} />
            {boxFields && <SuggestionLine fails={boxFx.ev.fails} defs={boxFields} prefix={SUGGEST_PREFIX} size="12.5" style={{ marginTop: 9 }} />}
            <label htmlFor={noteId} style={{ display: "block", fontSize: 12.5, color: MUTED, margin: "18px 0 7px" }}>{PACK_NOTE_LABEL}</label>
            {boxFields ? (
              // Artboard 18 `pk`: the column's full width, three lines growing to six.
              <NotesField size="pack" id={noteId} value={note} onChange={setNote} placeholder="אופציונלי" editorTitle={noteEditorTitle(PACK_NOTE_LABEL)}
                look={VARIANT_SPEC.pack.noteLook} />
            ) : (
              <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} placeholder="אופציונלי" className="pkg-field pkg-field--area" />
            )}
          </div>
        )}

        {stepKey === "done" && <ClosingDone items={items} decisions={decisions} pkg={pkg} doneRows={doneRows} />}
      </PackageWizardShell>

      <ClosingDecisionDialog decideFor={decideFor} onClose={() => setDecideFor(null)}
        onDecided={(it, d) => setDecisions((all) => ({ ...all, [it.item_id]: d }))} />
    </>
  );
}
