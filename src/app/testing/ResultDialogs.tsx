"use client";
import * as React from "react";
import { Typography, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions } from "@/components/ui";
import {
  CheckCircleOutline as CheckCircleOutlineIcon,
  ErrorOutline as ErrorOutlineIcon,
  Science as ScienceIcon,
  TrendingUp as TrendingUpIcon,
  Undo as UndoIcon,
} from "@/components/ui/icons";
import type { ResearchStation } from "@/app/lib/testing/contract";
import { stepBackTo, type StepBackRequest } from "./queue/queueModel";
import { StepBackReasonField, SteppedBackPlace, SteppedBackTitle, type StepBackOutcome } from "./stepBack";
import type { NextStationInfo } from "./useTestWindow";

type NextStepBack =
  | { phase: "idle" | "confirm" | "busy" }
  | { phase: "done"; stationName: string; routeStep: number }
  | { phase: "error"; error: string };

/**
 * Where the item goes after its result — with its own "חזרה לבדיקה הקודמת": the item just left this
 * station, so it goes back to the test it just finished; asked and answered inside the same dialog
 * (the question and the answer replace the content). Offered by info.stepBack (queueModel
 * afterResultStepBack). Keyed per result by the page, so every result starts over.
 */
export function NextStationDialog({ open, onClose, info, postStepBack }: {
  open: boolean;
  onClose: () => void;
  info: NextStationInfo | null;
  postStepBack: (req: StepBackRequest, reason: string) => Promise<StepBackOutcome>;
}) {
  const [phase, setPhase] = React.useState<NextStepBack>({ phase: "idle" });
  const [reason, setReason] = React.useState("");
  const req = info?.stepBack ?? null;
  const confirm = async () => {
    if (!req || phase.phase === "busy" || !reason.trim()) return;
    setPhase({ phase: "busy" });
    const out = await postStepBack(req, reason);
    setPhase(out.ok ? { phase: "done", stationName: out.stationName, routeStep: out.routeStep } : { phase: "error", error: out.error });
  };
  return (
    <Dialog
        open={open}
        onClose={phase.phase === "busy" ? undefined : onClose}
        maxWidth="xs"
        fullWidth
    >
        <DialogTitle onClose={phase.phase === "busy" ? undefined : onClose}>
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                {phase.phase === "confirm" || phase.phase === "busy" ? (
                    <>
                        <UndoIcon fontSize={24} htmlColor="var(--color-primary)" aria-hidden />
                        {`להחזיר את הפריט ל${req?.toName ?? "עמדה הקודמת"}?`}
                    </>
                ) : phase.phase === "done" ? (
                    <SteppedBackTitle />
                ) : phase.phase === "error" ? (
                    <>
                        <ErrorOutlineIcon fontSize={24} color="warning" aria-hidden />
                        אי אפשר להחזיר את הפריט
                    </>
                ) : (
                    <>
                        <CheckCircleOutlineIcon fontSize={24} color="success" aria-hidden />
                        {info?.finishedFromResearch ? "המסלול הסתיים" : "הבדיקה הושלמה בהצלחה!"}
                    </>
                )}
            </Box>
        </DialogTitle>
        <DialogContent>
            {phase.phase === "confirm" || phase.phase === "busy" ? (
                <>
                    <Typography sx={{ fontSize: "var(--text-body)" }}>
                        הפריט יחזור ל{req?.toName} (שלב {req && stepBackTo(req)}) וימתין שם לבדיקה חוזרת, במקום להמשיך ל{info?.nextStation?.testStationDesc || "תחנה הבאה"}.
                    </Typography>
                    <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", mt: "8px" }}>
                        התוצאה שנשמרה עכשיו נשארת בהיסטוריה, והבדיקה החדשה תחליף אותה בדוח.
                    </Typography>
                    <Box sx={{ mt: "14px" }}>
                        <StepBackReasonField value={reason} onChange={setReason} disabled={phase.phase === "busy"} onSubmit={confirm} />
                    </Box>
                </>
            ) : phase.phase === "done" ? (
                <SteppedBackPlace stationName={phase.stationName} routeStep={phase.routeStep} />
            ) : phase.phase === "error" ? (
                <Typography role="alert" sx={{ fontSize: "var(--text-body)" }}>{phase.error}</Typography>
            ) : info?.finishedFromResearch ? (
                <Typography sx={{ fontSize: "var(--text-body)" }}>
                    העובד סיים את המסלול בשלב {info?.finishedAtStep}
                </Typography>
            ) : info?.isLastStation ? (
                <Typography sx={{ fontSize: "var(--text-body)" }}>
                    זהו השלב האחרון בתהליך. הפריט סיים את כל הבדיקות.
                </Typography>
            ) : (
                <>
                    <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>התחנה הבאה בתהליך:</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: "12px", mt: "10px" }}>
                        <TrendingUpIcon fontSize={22} htmlColor="var(--color-ink-muted-48)" aria-hidden />
                        <Box>
                            <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600 }}>
                                {info?.nextStation?.testStationDesc || "לא ידוע"}
                            </Typography>
                            <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
                                שלב {info?.nextStation?.routeStep}
                            </Typography>
                        </Box>
                    </Box>
                </>
            )}
        </DialogContent>
        <DialogActions>
            {phase.phase === "confirm" || phase.phase === "busy" ? (
                <>
                    <Button variant="outlined" onClick={() => setPhase({ phase: "idle" })} disabled={phase.phase === "busy"}>ביטול</Button>
                    <Button onClick={confirm} loading={phase.phase === "busy"} disabled={!reason.trim()}>החזר</Button>
                </>
            ) : (
                <>
                    {phase.phase === "idle" && req && (
                        <Button variant="outlined" startIcon={<UndoIcon sx={{ fontSize: 18 }} aria-hidden />} onClick={() => { setReason(""); setPhase({ phase: "confirm" }); }}>
                            חזרה לבדיקה הקודמת
                        </Button>
                    )}
                    <Button onClick={onClose}>{phase.phase === "error" ? "סגור" : "אישור"}</Button>
                </>
            )}
        </DialogActions>
    </Dialog>
  );
}

/** The item went to research: at which station. */
export function ResearchDialog({ open, onClose, station }: { open: boolean; onClose: () => void; station: ResearchStation | null }) {
  return (
    <Dialog
        open={open}
        onClose={onClose}
        maxWidth="xs"
        fullWidth
    >
        <DialogTitle onClose={onClose}>
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                <ScienceIcon fontSize={24} color="warning" aria-hidden />
                הועבר לחקר
            </Box>
        </DialogTitle>
        <DialogContent>
            <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>
                הפריט הועבר להמשך טיפול בעמדת חקר:
            </Typography>
            <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600, mt: "10px" }}>
                {station?.stationDesc}
            </Typography>
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose} color="warning">
                אישור
            </Button>
        </DialogActions>
    </Dialog>
  );
}
