"use client";
import React from "react";
import { Undo2 } from "lucide-react";
import { Typography, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, ConfirmDialog } from "@/components/ui";
import { ArrowBack as ArrowBackIcon, CheckCircleOutline as CheckCircleOutlineIcon } from "@/components/ui/icons";
import type { PackageItemView } from "@/app/lib/packages/contract";
import { NO_SERVER_TEXT, failureText } from "@/app/components/failureText";
import { ApiError } from "@/lib/api/client";
import { stepBackTo, type StepBackRequest } from "./queue/queueModel";
import { stepBack, type Actor } from "./api";
import "./station-popups.css";

/**
 * "חזרה לבדיקה הקודמת" (api/testing/step-back) on the testing screen: the question, and where the
 * item went. Which rows offer it, and for whom: queueModel's step-back rules.
 */

const STEP_BACK_FAILED = "שגיאה בהחזרת הפריט לעמדה הקודמת";

/** The closing wizard's "החזר" for an item of its box: the page answers the click for each item
 *  that may go back (managers only; the closing stops, the wizard closes). */
const BoxItemStepBack = React.createContext<((it: PackageItemView) => (() => void) | null) | undefined>(undefined);
export const BoxItemStepBackProvider = BoxItemStepBack.Provider;
export const useBoxItemStepBack = () => React.useContext(BoxItemStepBack);

/** "החזר" beside a box item's name (the closing queue card, the closing wizard's items step):
 *  drawn where the item may go back. */
export function StepBackButton({ it, onClick }: { it: PackageItemView; onClick?: (() => void) | null }) {
  if (!onClick) return null;
  return (
    <button type="button" className="tst-step-back" onClick={onClick}
      title={`החזרה ל${it.prev_step_desc}`} aria-label={`החזרת ${it.item_type_desc} ל${it.prev_step_desc}`}>
      <Undo2 size={12} strokeWidth={2} aria-hidden />
      החזר
    </button>
  );
}

export type StepBackOutcome =
  | { ok: true; stationName: string; routeStep: number; closingStopped: boolean }
  | { ok: false; error: string };

/** POST api/testing/step-back: the answer, or the refusal in words. Any answer refreshes the queue. */
export async function postStepBack(req: StepBackRequest, actor: Actor, onAnswered: () => void): Promise<StepBackOutcome> {
  try {
    const data = await stepBack(req.itemId, req.routeStep, actor);
    onAnswered();
    return { ok: true, stationName: data.stationDesc || data.stationTypeDesc || req.toName, routeStep: data.routeStep, closingStopped: data.closingStopped };
  } catch (e) {
    if (e instanceof ApiError) onAnswered();
    else console.error("Error stepping item back:", e);
    return { ok: false, error: failureText(e, STEP_BACK_FAILED, NO_SERVER_TEXT) };
  }
}

/** The queue card's and the box's "חזרה לבדיקה הקודמת": a question, then where the item went. */
export function useStepBack({ actor, onRefresh, onError, onClosingStopped }: {
  actor: Actor;
  onRefresh: () => void;
  onError: (message: string) => void;
  /** The server stopped the box's closing (asked from its wizard) and put the box and its items
   *  back to waiting. */
  onClosingStopped: () => void;
}) {
  const [req, setReq] = React.useState<StepBackRequest | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [steppedBack, setSteppedBack] = React.useState<{ stationName: string; routeStep: number } | null>(null);

  const confirm = async () => {
    if (!req || busy) return;
    setBusy(true);
    const out = await postStepBack(req, actor, onRefresh);
    setBusy(false);
    setReq(null);
    if (!out.ok) { onError(out.error); return; }
    if (out.closingStopped) onClosingStopped();
    setSteppedBack({ stationName: out.stationName, routeStep: out.routeStep });
  };

  return {
    /** Ask about a request one of queueModel's step-back rules gave. */
    ask: (r: StepBackRequest) => setReq(r),
    open: req != null || steppedBack != null,
    dialogs: { req, setReq, busy, confirm, steppedBack, setSteppedBack },
  };
}

/** The answer's title (its icon and words) — here and in the next-station dialog. */
export function SteppedBackTitle() {
  return (
    <>
      <CheckCircleOutlineIcon fontSize={24} color="success" aria-hidden />
      הפריט הוחזר לבדיקה הקודמת
    </>
  );
}

/** Where the item went back to — here and in the next-station dialog. */
export function SteppedBackPlace({ stationName, routeStep }: { stationName?: string; routeStep?: number }) {
  return (
    <>
      <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>העמדה שהפריט חזר אליה:</Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px", mt: "10px" }}>
          <ArrowBackIcon fontSize={22} htmlColor="var(--color-ink-muted-48)" aria-hidden />
          <Box>
              <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600 }}>{stationName || "לא ידוע"}</Typography>
              <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>שלב {routeStep}</Typography>
          </Box>
      </Box>
    </>
  );
}

/** The question and the answer. */
export function StepBackDialogs({ dialogs }: { dialogs: ReturnType<typeof useStepBack>["dialogs"] }) {
  const { req, setReq, busy, confirm, steppedBack, setSteppedBack } = dialogs;
  return (
    <>
    <ConfirmDialog
        open={req != null}
        title={`להחזיר את הפריט ל${req?.toName || "עמדה הקודמת"}?`}
        message={req
          ? `הפריט יחזור לשלב ${stepBackTo(req)} וימתין שם לבדיקה חוזרת.${req.fromWizard ? " סגירת המארז תיעצר, ומה שסומן באשף לא יישמר." : ""}${req.inBox ? " המארז יצא מתור הסגירה ויחכה לו, וכשהפריט יגיע שוב לסגירה המארז יחזור לתור." : ""} התוצאה הקודמת נשמרת בהיסטוריה, והבדיקה החדשה תחליף אותה בדוח.`
          : undefined}
        confirmText="החזר"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setReq(null)}
    />
    <Dialog open={steppedBack != null} onClose={() => setSteppedBack(null)} maxWidth="xs" fullWidth>
        <DialogTitle onClose={() => setSteppedBack(null)}>
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                <SteppedBackTitle />
            </Box>
        </DialogTitle>
        <DialogContent>
            <SteppedBackPlace stationName={steppedBack?.stationName} routeStep={steppedBack?.routeStep} />
        </DialogContent>
        <DialogActions>
            <Button onClick={() => setSteppedBack(null)}>אישור</Button>
        </DialogActions>
    </Dialog>
    </>
  );
}
