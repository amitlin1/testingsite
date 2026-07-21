"use client";
import * as React from "react";
import { Stack } from "@/components/ui";
import type { StationTestDialogProps, TestResultData } from "../../../types";
import {
  type Photos, emptyPhotos, SkuScreen, SystemNote, VerdictCard,
  StationShell, type ShellPhase, SKU_TITLE, SKU_DESC,
} from "./stationKit";

/**
 * Config that turns this generic verdict-only station into a concrete one
 * (X-ray / black-mirror / …). No photo capture: the worker scans the SKU, the
 * system shows the instruction message (with that SKU spliced in), and records a
 * pass/fail verdict + notes.
 */
export type VerdictStationConfig = {
  /** Stable station key echoed into the result Details payload. */
  stationKey: string;
  /** Eyebrow label on the rail/header (e.g. "שיקוף" / "מראה שחורה"). */
  contextLabel: string;
  /** Title of the verdict phase (e.g. "שיקוף הפריט"). */
  phaseTitle: string;
  /** One-line description under the verdict-phase title. */
  phaseDesc: string;
  /** The system instruction message — receives the scanned SKU (replaces "XXX"). */
  buildMessage: (sku: string) => string;
  /** Green finish button label. */
  finishLabel: string;
};

/**
 * Generic two-screen test station: manufacturer-SKU scan → instruction message +
 * verdict. Configured (via `config`) into the X-ray / black-mirror stations.
 * Shares the intake wizard's chrome via StationShell.
 */
export default function VerdictStation({
  open, onClose, item, station, workerId, workerName, onSubmit, config,
}: StationTestDialogProps & { config: VerdictStationConfig }) {
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
    { key: "verdict", title: config.phaseTitle, desc: config.phaseDesc },
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
          station: config.stationKey,
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
      contextLabel={config.contextLabel} phases={phases} currentIndex={phaseIdx}
      onStep={onStep} onBack={onBack} error={error} onClearError={() => setError(null)}
      busy={false} submitting={submitting}
      canNext={skuScan.trim().length > 0} onNext={onNext}
      canFinish={canFinish} onFinish={onFinish} finishLabel={config.finishLabel}
    >
      {phaseIdx === 0 ? (
        <SkuScreen value={skuScan} onChange={setSkuScan} />
      ) : (
        <Stack spacing={3}>
          {/* System instruction with the scanned SKU spliced in place of "XXX". */}
          <SystemNote>{config.buildMessage(skuScan.trim())}</SystemNote>
          <VerdictCard ok={verdict.ok} note={verdict.note}
            onOk={(v) => setVerdict((pk) => ({ ...pk, ok: v }))}
            onNote={(v) => setVerdict((pk) => ({ ...pk, note: v }))} />
        </Stack>
      )}
    </StationShell>
  );
}
