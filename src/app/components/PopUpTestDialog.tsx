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
import { uploadItemFiles } from "@/lib/api/direct-upload";
import { SUGGEST_PREFIX_DIALOG, fieldsGateText } from "@/app/lib/station-fields/labels";
import { NOTE_MAX_DEFAULT } from "@/app/lib/station-fields/schema";
import { FieldsBlock, FieldsBlockFallback } from "@/app/testing/fields/FieldsBlock";
import type { UploadFieldPhoto } from "@/app/testing/fields/FieldRow";
import { NotesField } from "@/app/testing/fields/NotesField";
import { SuggestionLine } from "@/app/testing/fields/SuggestionLine";
import { shouldReloadFields } from "@/app/testing/fields/errors";
import { BLOCK_TITLE } from "@/app/testing/fields/fieldsBlockModel";
import { useFieldsState } from "@/app/testing/fields/useFieldsState";
import { useStationFields } from "@/app/testing/fields/useStationFields";
import type { StationTestDialogProps } from "@/types";

type SubmitAction = 'save' | 'sendToResearch' | 'returnToRoute' | 'finishRoute';

/**
 * The plain report dialog — opened for any station type without a dedicated
 * wizard (tests-popups/mainPopUp.ts). A flat ui/Dialog: title + one close
 * button, labelled fields, the item's files, and the actions in the footer
 * (the primary one last).
 *
 * Station fields (route-fields spec §4.11.6, artboard 14): when the item's
 * route publishes fields for this step, one block of them sits after the
 * worker and before the files, with the suggestion line at its bottom; the
 * dialog widens to md (open decision 3), "הערות נוספות" becomes a NotesField
 * and the block rides in Details. The decision stays the numeric "תוצאת
 * בדיקה". Without a published config the dialog is exactly today's.
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
  const isResearchStatus = currentStatus === 5;
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

  // ---- station fields of this step (route-fields spec §4.2–§4.3) ----
  const sf = useStationFields(itemId, open, stationId);
  const itemFields = sf.status === "ready" && sf.mode === "item" ? sf : null;
  const fx = useFieldsState(itemFields ? itemFields.fields : []);
  const hasFields = itemFields != null && fx.defsCount > 0;
  // In research (status 5) nothing waits for the fields: the server resolves
  // none for an item in research and releases the gate (spec §3.3, §4.11.6).
  // Elsewhere "שמור וסיים" waits for the answer (spec §4.2) — and, like
  // PhotoStation, for a field photo still uploading or failed, or a note over
  // its maximum (evaluate.ts fieldsBlocking). A missing required field or note
  // does not disable it: it stays clickable and the gate below says what is
  // missing (artboard 14).
  const fieldsWait = !isResearchStatus && (sf.status === "loading" || sf.status === "error");
  const finishHeld = fieldsWait
    || (!isResearchStatus && hasFields && (fx.photosPending.length > 0 || fx.ev.noteTooLong.length > 0));
  // "העבר לחקר" is never held by the fields' gate (the server releases it),
  // but it too waits for their answer (spec §4.2): sent before it, a step with
  // a config would get the hand-off back as 409 — no Details.schema yet.
  const researchHeld = !isResearchStatus && sf.status === "loading";
  // Artboard 14 `tried` / `alertOn`: a "שמור וסיים" with fields missing marks
  // the empty required rows and raises the gate alert in the Alert at the top
  // of the body. Its text follows the fields as they fill (`alertText`), it
  // goes once nothing is missing, and × hides it until the next attempt.
  // It is spoken once per attempt (spec §4.13): the alert itself is no live
  // region, and `gateNotice` — that attempt's text — speaks for it.
  const [tried, setTried] = React.useState(false);
  const [gateAlert, setGateAlert] = React.useState(false);
  const [gateNotice, setGateNotice] = React.useState({ attempt: 0, text: "" });
  const gateText = hasFields && gateAlert
    ? fieldsGateText(fx.ev.missingRequired.length, fx.ev.missingNotes.length)
    : null;
  const alertText = error ?? gateText;
  const alertRef = React.useRef<HTMLDivElement>(null);
  const commentsId = React.useId();

  // A photo field's shot goes straight to storage like any station photo,
  // tagged with the field's photo type; null = it never got there (the shot
  // reads failed).
  const uploadFieldPhoto = React.useCallback<UploadFieldPhoto>(
    (file, photoType) => uploadItemFiles(itemId, [file], { workerId, stationTypeId: station.test_station_type_id, photoType })
      .then(([r]) => r?.objectKey ?? null, () => null),
    [itemId, workerId, station.test_station_type_id],
  );

  const handleSubmit = async (action: SubmitAction = 'save') => {
    setError(null);
    setGateAlert(false);

    // Worker now comes from the page-level picker on the testing page.
    if (workerId == null) {
      setError("יש לבחור עובד בכותרת מסך הבדיקות לפני סיום בדיקה");
      return;
    }

    // "העבר לחקר" waits for the fields' answer (researchHeld) — the button is
    // disabled meanwhile.
    if (action === 'sendToResearch' && researchHeld) return;

    // The fields' finish gate (artboard 14 `onSave`): finishing only, never in
    // research — "העבר לחקר" and "החזר למסלול" are never gated (the server
    // releases the gate for them).
    if ((action === 'save' || action === 'finishRoute') && !isResearchStatus) {
      if (finishHeld) return; // the button is disabled meanwhile
      if (hasFields && fx.blocking(itemFields.gate)) {
        setTried(true);
        setGateAlert(true);
        setGateNotice((n) => ({
          attempt: n.attempt + 1,
          text: fieldsGateText(fx.ev.missingRequired.length, fx.ev.missingNotes.length) ?? "",
        }));
        // The alert opens the body, which may be scrolled down to the footer:
        // bring it into view once it is drawn.
        requestAnimationFrame(() => alertRef.current?.scrollIntoView({ block: "nearest" }));
        return;
      }
    }

    setLoading(true);
    setPending(action);
    try {
      submitIdRef.current ??= newActionId();
      // Today this dialog sends no Details. With fields: their block alone —
      // verdict carries only `suggested`, the decision is "תוצאת בדיקה".
      const fieldsBlock = hasFields ? fx.toBlock(itemFields.schema, {}) : null;
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
        ...(fieldsBlock ? { Details: fieldsBlock } : {}),
      });
      // Reset form (a fresh submission gets a fresh action UUID)
      submitIdRef.current = null;
      setResult(0);
      setComments("");
      fx.reset();
      setTried(false);
      onClose();
    } catch (error: any) {
      console.error("Error submitting test result:", error);
      setError(error?.message || "שגיאה בשמירת תוצאת בדיקה");
      // 409 FIELDS_SCHEMA_MISMATCH: the route's fields changed while the dialog
      // was open. Load them again, whatever the last answer was; what the
      // worker entered stays, by FieldId.
      if (shouldReloadFields(error)) sf.reload();
    } finally {
      setLoading(false);
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={hasFields ? "md" : "sm"}>
      <DialogTitle onClose={onClose}>סיום בדיקה</DialogTitle>

      <DialogContent>
        <Stack spacing={3}>
          {/* What is being reported, and where */}
          <Typography sx={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
            {itemName || `פריט #${itemId}`} · עמדה #{stationId}
          </Typography>

          {alertText && (
            // A save error is an alert, as today. The gate's text changes as
            // the fields fill, so it is no live region: the notice below
            // speaks for it, once per attempt.
            <Alert ref={alertRef} severity="error" role={error ? "alert" : undefined} onClose={() => { setError(null); setGateAlert(false); }}>
              {alertText}
            </Alert>
          )}
          {hasFields && (
            <span className="sh-visually-hidden" role="alert">
              {gateText && <span key={gateNotice.attempt}>{gateNotice.text}</span>}
            </span>
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

          {/* The step's station fields, the suggestion closing the block — or,
              until they arrive, their stand-in (nothing without a config). */}
          {hasFields ? (
            <FieldsBlock
              variant="dialog"
              title={BLOCK_TITLE.dialog}
              groups={[{ fields: itemFields.fields }]}
              fx={fx}
              showRequiredErrors={tried}
              uploadPhoto={uploadFieldPhoto}
              footer={<SuggestionLine fails={fx.ev.fails} defs={itemFields.fields} prefix={SUGGEST_PREFIX_DIALOG} icon="bulb" size="12.5" style={{ marginTop: 8 }} />}
            />
          ) : fieldsWait ? (
            <FieldsBlockFallback sf={sf} />
          ) : null}

          {/* Files attached to this item — uploads/edits use the active worker */}
          <ItemFilesPanel itemId={itemId} workerId={workerId ?? null} stationTypeId={station.test_station_type_id} compact maxHeight={300} />

          {hasFields ? (
            // With fields the notes grow as needed and stop at 1000 characters
            // (artboard 14, spec §6); without, today's field.
            <div>
              <label htmlFor={commentsId} className="sh-field-label">הערות נוספות</label>
              <NotesField
                size="verdict"
                id={commentsId}
                value={comments}
                onChange={setComments}
                max={NOTE_MAX_DEFAULT}
                placeholder="הוסף הערות כאן…"
                editorTitle="הערה · הערות נוספות"
              />
            </div>
          ) : (
            <TextField
              label="הערות נוספות"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              multiline
              rows={3}
              fullWidth
              placeholder="הוסף הערות כאן…"
            />
          )}
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
              disabled={!workerId || loading || researchHeld}
              loading={pending === 'sendToResearch'}
              startIcon={<ScienceIcon fontSize={18} aria-hidden />}
            >
              העבר לחקר
            </Button>
            <Button
              onClick={() => handleSubmit('save')}
              disabled={!workerId || loading || finishHeld}
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
