"use client";
import * as React from "react";
import { Stack } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import {
  type Photos, emptyPhotos, SkuScreen, SystemNote, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
} from "./stationKit";

/**
 * Generic two-screen test station: manufacturer-SKU scan → instruction message +
 * verdict. No photo capture: the worker scans the SKU, the system shows the
 * instruction (with that SKU spliced in), and records a pass/fail verdict +
 * notes. Its titles come from the station type's name in the DB
 * (`stationTypeName`), so no station name lives in the code. Shares the intake
 * wizard's chrome via StationShell.
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

  React.useEffect(() => {
    if (!open) return;
    setPhaseIdx(0); setError(null); setSkuScan(""); setVerdict(emptyPhotos());
  }, [open, item]);

  const phases: ShellPhase[] = [
    { key: "sku", title: SKU_TITLE, desc: SKU_DESC },
    { key: "verdict", title: kind ? `בדיקת ${kind}` : "בדיקת הפריט", desc: "בצע את הבדיקה לפי ההנחיה ואשר את תקינות הפריט." },
  ];

  const onNext = () => { setError(null); setPhaseIdx(1); };
  const onBack = () => { setError(null); if (phaseIdx > 0) setPhaseIdx(phaseIdx - 1); };
  const onStep = (i: number) => { setError(null); setPhaseIdx(i); };

  const pass = verdict.ok === "pass";
  const canFinish = skuScan.trim().length > 0 && verdict.ok !== "";

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
        },
      };
      await onSubmit(data);
      onClose();
    } catch { setError("שגיאה בשמירת הבדיקה"); } finally { setSubmitting(false); }
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
          <VerdictCard ok={verdict.ok} note={verdict.note}
            onOk={(v) => setVerdict((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setVerdict((pk) => ({ ...pk, note: v }))} />
        </Stack>
      )}
    </StationShell>
  );
}
