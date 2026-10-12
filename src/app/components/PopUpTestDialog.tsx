"use client";
import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Stack,
  Alert,
  Tag,
} from "@/components/ui";
import { Save as SaveIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { ArrowBack as ArrowBackIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import ItemFilesPanel from "./ItemFilesPanel";
import { newActionId } from "@/app/lib/metrics/action-id";
import type { StationTestDialogProps } from "@/types";

type SubmitAction = 'save' | 'sendToResearch' | 'returnToRoute' | 'finishRoute';

/**
 * The plain report dialog — opened for any station type without a dedicated
 * wizard (tests-popups/mainPopUp.ts). A flat ui/Dialog: title + one close
 * button, labelled fields, the item's files, and the actions in the footer
 * (the primary one last).
 */
export default function PopUpTestDialog({
  open,
  onClose,
  onSubmit,
  item,
  station,
  workerId,
  workerName,
}: StationTestDialogProps) {
  // The dialog renders primitives derived from the ItemRow / TestStation it receives.
  const itemId = item.item_id;
  const stationId = station.test_station_id;
  const itemName = item.model ?? undefined;
  const currentStatus = item.current_status ?? undefined;
  const [result, setResult] = React.useState<number>(0);
  const [comments, setComments] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  // Which action is in flight, so only that button shows the spinner.
  const [pending, setPending] = React.useState<SubmitAction | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Action UUID for the metrics ledger (§4.4): minted on the first submit and
  // kept across error retries, so clicking again after a failure replays the
  // same event_key instead of minting a duplicate event. Cleared on success.
  const submitIdRef = React.useRef<string | null>(null);

  const handleSubmit = async (action: SubmitAction = 'save') => {
    setError(null);

    // Worker now comes from the page-level picker on the testing page.
    if (workerId == null) {
      setError("יש לבחור עובד בכותרת מסך הבדיקות לפני סיום בדיקה");
      return;
    }

    setLoading(true);
    setPending(action);
    try {
      submitIdRef.current ??= newActionId();
      await onSubmit({
        Result: result,
        Comments: comments || undefined,
        WorkerID: workerId,
        sendToResearch: action === 'sendToResearch',
        returnToRoute: action === 'returnToRoute',
        finishRoute: action === 'finishRoute',
        // Sending undefined for SentAt/ReturnAt as they are hidden
        SentAt: undefined,
        ReturnAt: undefined,
        SubmitID: submitIdRef.current,
      });
      // Reset form (a fresh submission gets a fresh action UUID)
      submitIdRef.current = null;
      setResult(0);
      setComments("");
      onClose();
    } catch (error: any) {
      console.error("Error submitting test result:", error);
      setError(error?.message || "שגיאה בשמירת תוצאת בדיקה");
    } finally {
      setLoading(false);
      setPending(null);
    }
  };

  const isResearchStatus = currentStatus === 5;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle onClose={onClose}>סיום בדיקה</DialogTitle>

      <DialogContent>
        <Stack spacing={3}>
          {/* What is being reported, and where */}
          <Typography sx={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
            {itemName || `פריט #${itemId}`} · עמדה #{stationId}
          </Typography>

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <TextField
            label="תוצאת בדיקה"
            type="number"
            value={result}
            onChange={(e) => setResult(Number(e.target.value))}
            fullWidth
            placeholder="0"
            inputProps={{ min: 0, style: { fontVariantNumeric: "tabular-nums" } }}
          />

          {/* Active worker — surfaced from the page-level picker, read-only here. */}
          <Box>
            <div className="sh-field-label">עובד מבצע *</div>
            {workerId != null ? (
              <Tag tone="primary" size="md" icon={<PersonIcon fontSize={14} aria-hidden />}>
                {workerName ? `${workerName} (#${workerId})` : `עובד #${workerId}`}
              </Tag>
            ) : (
              <Alert severity="warning">
                בחר עובד בכותרת מסך הבדיקות לפני סיום בדיקה
              </Alert>
            )}
          </Box>

          {/* Files attached to this item — uploads/edits use the active worker */}
          <ItemFilesPanel itemId={itemId} workerId={workerId ?? null} stationTypeId={station.test_station_type_id} compact maxHeight={300} />

          <TextField
            label="הערות נוספות"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            multiline
            rows={3}
            fullWidth
            placeholder="הוסף הערות כאן…"
          />
        </Stack>
      </DialogContent>

      {/* Footer: cancel, the secondary route action, then the primary (ui.css
          puts the contained button last). */}
      <DialogActions>
        <Button onClick={onClose} disabled={loading} variant="text" color="inherit">
          ביטול
        </Button>
        {isResearchStatus ? (
          <>
            <Button
              onClick={() => handleSubmit('returnToRoute')}
              variant="outlined"
              disabled={!workerId || loading}
              loading={pending === 'returnToRoute'}
              startIcon={<ArrowBackIcon fontSize={18} aria-hidden />}
            >
              החזר למסלול
            </Button>
            <Button
              onClick={() => handleSubmit('finishRoute')}
              color="success"
              disabled={!workerId || loading}
              loading={pending === 'finishRoute'}
              startIcon={<CheckCircleIcon fontSize={18} aria-hidden />}
            >
              {pending === 'finishRoute' ? "שומר…" : "סיים מסלול"}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => handleSubmit('sendToResearch')}
              variant="outlined"
              color="inherit"
              disabled={!workerId || loading}
              loading={pending === 'sendToResearch'}
              startIcon={<ScienceIcon fontSize={18} aria-hidden />}
            >
              העבר לחקר
            </Button>
            <Button
              onClick={() => handleSubmit('save')}
              disabled={!workerId || loading}
              loading={pending === 'save'}
              startIcon={<SaveIcon fontSize={18} aria-hidden />}
            >
              {pending === 'save' ? "שומר…" : "שמור וסיים"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
