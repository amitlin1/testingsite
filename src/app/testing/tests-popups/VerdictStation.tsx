"use client";
import * as React from "react";
import { Stack } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { SUGGEST_PREFIX } from "@/app/lib/station-fields/labels";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import {
  type Photos, emptyPhotos, SkuScreen, SystemNote, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
} from "./stationKit";
import { FieldsBlock, FieldsBlockFallback } from "../fields/FieldsBlock";
import type { UploadFieldPhoto } from "../fields/FieldRow";
import { SuggestionLine } from "../fields/SuggestionLine";
import { fieldsErrorText, shouldReloadFields } from "../fields/errors";
import { VARIANT_SPEC, stationBlockTitle } from "../fields/fieldsBlockModel";
import { useFieldsState } from "../fields/useFieldsState";
import { useStationFields } from "../fields/useStationFields";

/**
 * Generic two-screen test station: manufacturer-SKU scan → instruction message +
 * verdict. No photo capture: the worker scans the SKU, the system shows the
 * instruction (with that SKU spliced in), and records a pass/fail verdict +
 * notes. Its titles come from the station type's name in the DB
 * (`stationTypeName`), so no station name lives in the code. Shares the intake
 * wizard's chrome via StationShell.
 *
 * Station fields (route-fields spec §4.11.1, artboard 12): when the item's route
 * publishes fields for this step, the verdict step gets one block of them between
 * the instruction and "בדיקה תקינה?", the suggestion line under the pass/fail
 * pair, and finishing waits for them. Without a published config the popup is
 * exactly today's.
 */
export default function VerdictStation({
  open, onClose, item, station, stationTypeName, workerId, workerName, onSubmit,
}: StationTestDialogProps) {
  const kind = stationTypeName?.trim() || null;
  const [phaseIdx, setPhaseIdx] = React.useState(0); // 0 = sku, 1 = verdict
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [skuScan, setSkuScan] = React.useState("");
  const [verdict, setVerdict] = React.useState<Photos>(emptyPhotos()); // reuse ok/note (photos unused)

  // ---- station fields of this step (spec §4.2–§4.3) ----
  const sf = useStationFields(item.item_id, open, station.test_station_id);
  const ready = sf.status === "ready" && sf.mode === "item" ? sf : null;
  const fx = useFieldsState(ready ? ready.fields : []);
  const hasFields = ready != null && fx.defsCount > 0;
  // Finishing waits for the answer (loading / error), then for the fields themselves.
  const fieldsGate = sf.status === "loading" || sf.status === "error" || (hasFields && fx.blocking(ready.gate));
  const { reset: resetFields } = fx;

  React.useEffect(() => {
    if (!open) return;
    setPhaseIdx(0); setError(null); setSkuScan(""); setVerdict(emptyPhotos()); resetFields();
  }, [open, item, resetFields]);

  // A photo field's shot goes straight to storage like any station photo, tagged
  // with the field's photo type; null = it never got there (the shot reads failed).
  const uploadFieldPhoto = React.useCallback<UploadFieldPhoto>(
    (file, photoType) => uploadItemFiles(item.item_id, [file], { workerId, stationTypeId: station.test_station_type_id, photoType })
      .then(([result]) => result?.objectKey ?? null, () => null),
    [item.item_id, workerId, station.test_station_type_id],
  );

  const phases: ShellPhase[] = [
    { key: "sku", title: SKU_TITLE, desc: SKU_DESC },
    { key: "verdict", title: kind ? `בדיקת ${kind}` : "בדיקת הפריט", desc: "בצע את הבדיקה לפי ההנחיה ואשר את תקינות הפריט." },
  ];

  const onNext = () => { setError(null); setPhaseIdx(1); };
  const onBack = () => { setError(null); if (phaseIdx > 0) setPhaseIdx(phaseIdx - 1); };
  const onStep = (i: number) => { setError(null); setPhaseIdx(i); };

  const pass = verdict.ok === "pass";
  const canFinish = skuScan.trim().length > 0 && verdict.ok !== "" && !fieldsGate;

  const onFinish = async () => {
    if (workerId == null) { setError("יש לבחור עובד בכותרת מסך הבדיקות"); return; }
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
          ...(hasFields ? fx.toBlock(ready.schema, { ok: verdict.ok, note: verdict.note }) : {}),
        },
      };
      await onSubmit(data);
      onClose();
    } catch (e) {
      setError(fieldsErrorText(e, "שגיאה בשמירת הבדיקה"));
      // 409: the route's fields changed while the popup was open. Load them
      // again, whatever the last answer was; the drafts stay, by FieldId.
      if (shouldReloadFields(e)) sf.reload();
    } finally { setSubmitting(false); }
  };

  return (
    <StationShell
      open={open} onClose={onClose} item={item} workerId={workerId} workerName={workerName}
      contextLabel={kind ?? station.test_station_desc} stationName={station.test_station_desc} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={false} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel={kind ? `סיום בדיקת ${kind}` : "סיום בדיקה"}
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} />
      ) : (
        <Stack spacing={3}>
          {/* System instruction with the scanned SKU spliced in. */}
          <SystemNote>{`נא לבצע את הבדיקה עפ״י מק״ט ${skuScan.trim() || "—"}`}</SystemNote>
          {/* The step's station fields — or, until they arrive, their stand-in (nothing without a config). */}
          {hasFields ? (
            <FieldsBlock variant="station" title={stationBlockTitle(kind)} groups={[{ fields: ready.fields }]} fx={fx}
              uploadPhoto={uploadFieldPhoto} />
          ) : (
            <FieldsBlockFallback sf={sf} />
          )}
          <VerdictCard ok={verdict.ok} note={verdict.note}
            onOk={(v) => setVerdict((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setVerdict((pk) => ({ ...pk, note: v }))}
            suggestion={hasFields ? <SuggestionLine fails={fx.ev.fails} defs={ready.fields} prefix={SUGGEST_PREFIX} decided={verdict.ok} /> : undefined}
            noteMax={hasFields ? NOTE_MAX_DEFAULT : undefined} noteLook={VARIANT_SPEC.station.noteLook} />
        </Stack>
      )}
    </StationShell>
  );
}
