"use client";
import * as React from "react";
import { Stack } from "@/components/ui";
import type { TestResultData } from "@/app/lib/testing/contract";
import { TEMPLATE_DEFAULTS } from "@/app/lib/popup-templates/labels";
import { SUGGEST_PREFIX } from "@/app/lib/station-fields/labels";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "../fields/FieldsBlock";
import { SuggestionLine } from "../fields/SuggestionLine";
import { VARIANT_SPEC, stationBlockTitle } from "../fields/fieldsBlockModel";
import { SkuScreen, SystemNote, VerdictCard, StationShell, type ShellPhase } from "./stationKit";
import { emptyVerdict, type Verdict } from "./shots";
import { NO_WORKER_TEXT, useStepFields } from "./stepFields";
import type { StationPopupProps } from "./props";
import { stationCheckTitle, stationFinishLabel } from "./stationTexts";

/**
 * Generic two-screen test station: manufacturer-SKU scan → instruction message +
 * verdict. No photo capture: the worker scans the SKU, the system shows the
 * instruction (with that SKU spliced in), and records a pass/fail verdict +
 * notes. Its titles come from the station type's name in the DB
 * (`stationTypeName`), so no station name lives in the code.
 *
 * Station fields (route-fields spec §4.11.1, artboard 12): when the item's route
 * publishes fields for this step, the verdict step gets one block of them between
 * the instruction and "בדיקה תקינה?", the suggestion line under the pass/fail
 * pair, and finishing waits for them. Without a published config the popup is
 * exactly today's.
 */
export default function VerdictStation({
  onClose, item, station, stationTypeName, workerId, workerName, onSubmit,
}: StationPopupProps) {
  const kind = stationTypeName?.trim() || null;
  const [phaseIdx, setPhaseIdx] = React.useState(0); // 0 = sku, 1 = verdict
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // The SKU carries on from the station before (QueueRow.last_sku).
  const [skuScan, setSkuScan] = React.useState(item.last_sku ?? "");
  const [verdict, setVerdict] = React.useState<Verdict>(emptyVerdict);

  const step = useStepFields({ itemId: item.item_id, stationId: station.test_station_id, stationTypeId: station.test_station_type_id, workerId });
  const { fx, cfg } = step;

  const phases: ShellPhase[] = [
    { key: "sku", title: TEMPLATE_DEFAULTS.skuStepTitle, desc: TEMPLATE_DEFAULTS.skuStepDesc },
    { key: "verdict", title: stationCheckTitle(kind), desc: "בצע את הבדיקה לפי ההנחיה ואשר את תקינות הפריט." },
  ];

  const onNext = () => { setError(null); setPhaseIdx(1); };
  const onBack = () => { setError(null); if (phaseIdx > 0) setPhaseIdx(phaseIdx - 1); };
  const onStep = (i: number) => { setError(null); setPhaseIdx(i); };

  const pass = verdict.ok === "pass";
  const canFinish = skuScan.trim().length > 0 && verdict.ok !== "" && !step.blocking;

  const onFinish = async () => {
    if (workerId == null) { setError(NO_WORKER_TEXT); return; }
    if (!canFinish) { setError("לא ניתן לסיים — יש להשלים את כל שלבי הבדיקה"); return; }
    setSubmitting(true); setError(null);
    try {
      const data: TestResultData = {
        Result: pass ? 1 : 0, Passed: pass, Comments: verdict.note || undefined, WorkerID: workerId ?? undefined,
        Details: {
          // The station type by number (the result also stores it as a column).
          station: `type-${station.test_station_type_id}`,
          sku: skuScan,
          verdict: { ok: verdict.ok, note: verdict.note },
          // Station fields: schema + fields, and this same verdict extended with
          // suggested / overridden — every key above stays (spec §4.0 rule 5).
          ...(cfg ? fx.toBlock(cfg.schema, { ok: verdict.ok, note: verdict.note }) : {}),
        },
      };
      await onSubmit(data);
      onClose();
    } catch (e) {
      setError(step.saveErrorText(e, "שגיאה בשמירת הבדיקה"));
    } finally { setSubmitting(false); }
  };

  return (
    <StationShell
      onClose={onClose} item={item} workerId={workerId} workerName={workerName}
      contextLabel={kind ?? station.test_station_desc} stationName={station.test_station_desc} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={false} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel={stationFinishLabel(kind)}
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} prev={item.last_sku} serial={item.serial_no} />
      ) : (
        <Stack spacing={3}>
          <SystemNote>{`נא לבצע את הבדיקה עפ״י מק״ט ${skuScan.trim() || "—"}`}</SystemNote>
          {/* The step's station fields — or, until they arrive, their stand-in (nothing without a config). */}
          {cfg ? (
            <FieldsBlock variant="station" title={stationBlockTitle(kind)} groups={[{ fields: cfg.fields }]} fx={fx}
              uploadPhoto={step.uploadFieldPhoto} />
          ) : (
            <FieldsBlockFallback sf={step.sf} />
          )}
          <VerdictCard ok={verdict.ok} note={verdict.note}
            onOk={(v) => setVerdict((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setVerdict((pk) => ({ ...pk, note: v }))}
            suggestion={cfg ? <SuggestionLine fails={fx.ev.fails} defs={cfg.fields} prefix={SUGGEST_PREFIX} decided={verdict.ok} /> : undefined}
            noteMax={cfg ? NOTE_MAX_DEFAULT : undefined} noteLook={VARIANT_SPEC.station.noteLook} />
        </Stack>
      )}
    </StationShell>
  );
}
