"use client";
import * as React from "react";
import {
  Typography, TextField, Box, Button, InputAdornment, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
} from "@/components/ui";
import { CheckCircleOutline as CheckCircleOutlineIcon, Clear as ClearIcon, QrCode as QrCodeIcon } from "@/components/ui/icons";
import type { LocateAnswer, TestStationType } from "@/app/lib/testing/contract";
import { useIdleScan } from "@/lib/hooks/useIdleScan";
import { NO_SERVER_TEXT, failureText } from "@/app/components/failureText";
import { ApiError } from "@/lib/api/client";
import { locate } from "./api";

/**
 * A scanned or typed label, located (api/testing/locate-by-barcode): the station whose queue holds
 * the item — or that it finished its route, or that its box still waits for items. From the scan
 * dialog, the search field's Enter, the global scanner and the ?item= deep link.
 */

/** Scanner fallback: auto-submit after this pause when the scan sends no Enter. */
const SCAN_IDLE_SUBMIT_MS = 700;

const LOCATE_FAILED = "שגיאה באיתור הפריט";

type Finished = { itemId: number; serialNo?: string | null; model?: string | null };

/** `filterTo`: also narrow the queue to the item (the ?item= deep link from the packages screen);
 *  a plain scan only hoists and highlights it. */
export type Located = { itemId: number; stationId: number; filterTo: boolean };

export function useScanLocate({ stationTypes, onLocated, onFinished }: {
  stationTypes: readonly TestStationType[];
  onLocated: (where: Located) => void;
  /** A finished item was scanned (its dialog opens). */
  onFinished: () => void;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  // Set when a scan came from a pre-upgrade label that the server resolved
  // through legacy_id_map; the worker is told to reprint.
  const [legacyNotice, setLegacyNotice] = React.useState<string | null>(null);
  const [finished, setFinished] = React.useState<Finished | null>(null);
  const [finishedOpen, setFinishedOpen] = React.useState(false);

  const run = async (raw: string, opts?: { filterTo?: boolean }) => {
    const barcode = raw.trim();
    if (!barcode) return;
    setLoading(true);
    setError(null);
    try {
      const data: LocateAnswer = await locate(barcode);
      setLegacyNotice(
        data.legacyId != null
          ? `נסרקה מדבקה ישנה (${data.legacyId}) — הפריט זוהה כ-${data.resolvedItemId}. יש להדפיס לקופסה מדבקה חדשה מעמוד המארזים ("מדבקות למארזים שהוסבו").`
          : null,
      );
      // Not an error: the friendly dialog.
      if ("finished" in data) {
        setFinished({ itemId: data.itemId, serialNo: data.serialNo, model: data.model });
        setFinishedOpen(true);
        setDialogOpen(false);
        setInput("");
        onFinished();
        return;
      }
      // A box held before its closing station until every item is back (PLAN §4).
      if ("waitingForPackageItems" in data) {
        const blocking = data.blockingItemIds.length;
        setError(
          blocking === 1
            ? `המארז ${data.itemId} ממתין לפריט אחד שטרם סיים את המסלול. הוא ייכנס לתור הסגירה כשהפריט יגיע.`
            : `המארז ${data.itemId} ממתין ל-${blocking} פריטים שטרם סיימו את המסלול. הוא ייכנס לתור הסגירה כשכולם יגיעו.`,
        );
        return;
      }
      if (!stationTypes.some((t) => t.id === data.stationTypeId)) {
        setError("סוג העמדה של הפריט לא נמצא");
        return;
      }
      onLocated({ itemId: data.itemId, stationId: data.stationId, filterTo: !!opts?.filterTo });
      setDialogOpen(false);
      setInput("");
    } catch (err) {
      if (!(err instanceof ApiError)) console.error("Error scanning barcode:", err);
      setError(failureText(err, LOCATE_FAILED, NO_SERVER_TEXT));
    } finally {
      setLoading(false);
    }
  };

  return {
    /** Locate a code. A fresh closure per render: the global scanner and the deep link read it
     *  through a ref / an effect event. */
    locate: run,
    loading,
    error,
    clearError: () => setError(null),
    dialogOpen,
    openDialog: () => { setError(null); setInput(""); setDialogOpen(true); },
    closeDialog: () => { setDialogOpen(false); setError(null); setInput(""); },
    input,
    setInput,
    legacyNotice,
    dismissLegacyNotice: () => setLegacyNotice(null),
    finished,
    finishedOpen,
    closeFinished: () => setFinishedOpen(false),
  };
}

/** The scan dialog ("סרוק ברקוד" in the dock). */
export function ScanDialog({ scan }: { scan: ReturnType<typeof useScanLocate> }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const idle = useIdleScan(SCAN_IDLE_SUBMIT_MS);
  const close = () => { idle.cancel(); scan.closeDialog(); };

  // After a failed scan the field keeps focus with its text selected, so the
  // next hardware scan replaces it instead of typing into nothing (ST-4).
  React.useEffect(() => {
    if (!scan.dialogOpen || scan.loading || !scan.error) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [scan.dialogOpen, scan.loading, scan.error]);

  return (
    <Dialog
        open={scan.dialogOpen}
        onClose={close}
        maxWidth="sm"
        fullWidth
    >
        <DialogTitle onClose={close}>
            סריקת ברקוד פריט
        </DialogTitle>
        <DialogContent>
            <Box sx={{ display: "flex", flexDirection: "column", gap: "16px", pt: "4px" }}>
                {scan.error && (
                    <Alert severity="error">
                        {scan.error}
                    </Alert>
                )}
                <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>
                    סרוק את הברקוד של הפריט או הזן את המזהה ידנית ולחץ Enter.
                </Typography>
                {/* Never disabled: a disabled field drops focus, and the next
                    hardware scan would type into nothing. While a lookup runs
                    it is read-only instead (ST-4). */}
                <TextField
                    autoFocus
                    fullWidth
                    aria-label="ברקוד פריט"
                    placeholder="ממתין לסריקה…"
                    value={scan.input}
                    inputRef={inputRef}
                    dir="ltr"
                    wrapClassName="tst-scan-field"
                    aria-busy={scan.loading || undefined}
                    InputProps={{
                        readOnly: scan.loading,
                        startAdornment: (
                            <InputAdornment position="start">
                                <QrCodeIcon fontSize={20} aria-hidden />
                            </InputAdornment>
                        ),
                    }}
                    onChange={(e) => {
                        const val = e.target.value;
                        scan.setInput(val);
                        // Enter submits. Fallback for a scanner set up without
                        // an Enter suffix: submit after a pause long enough
                        // that a person still typing isn't cut off.
                        if (val.trim().length >= 1) idle.schedule(() => scan.locate(val));
                        else idle.cancel();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && scan.input.trim() && !scan.loading) {
                            idle.cancel();
                            scan.locate(scan.input);
                        }
                    }}
                />
            </Box>
        </DialogContent>
        <DialogActions>
            <Button
                variant="text"
                color="inherit"
                onClick={close}
            >
                ביטול
            </Button>
            <Button
                onClick={() => scan.locate(scan.input)}
                disabled={!scan.input.trim()}
                loading={scan.loading}
            >
                {scan.loading ? "מאתר…" : "אישור"}
            </Button>
        </DialogActions>
    </Dialog>
  );
}

/** A scanned item that already finished its testing route. */
export function FinishedRouteDialog({ open, info, onClose }: { open: boolean; info: Finished | null; onClose: () => void }) {
  return (
    <Dialog
        open={open}
        onClose={onClose}
        maxWidth="xs"
        fullWidth
    >
        <DialogTitle onClose={onClose}>
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                <CheckCircleOutlineIcon fontSize={24} color="success" aria-hidden />
                המסלול הסתיים
            </Box>
        </DialogTitle>
        <DialogContent>
            <Typography sx={{ fontSize: "var(--text-body)" }}>
                פריט זה סיים את מסלול הבדיקות.
            </Typography>
            {info && (
                // The scanned item's identity, as plain lines (no card in the dialog).
                <Box sx={{ display: "flex", flexDirection: "column", gap: "4px", mt: "14px", pt: "14px", borderTop: "1px solid var(--color-hairline)" }}>
                    <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        #{info.itemId}
                    </Typography>
                    {info.model && (
                        <Typography sx={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                            מודל: {info.model}
                        </Typography>
                    )}
                    {info.serialNo && (
                        <Typography sx={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                            סריאלי: <bdi dir="ltr">{info.serialNo}</bdi>
                        </Typography>
                    )}
                </Box>
            )}
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose} color="success">
                אישור
            </Button>
        </DialogActions>
    </Dialog>
  );
}

/** A pre-upgrade label was scanned: reprint. */
export function LegacyNotice({ text, onDismiss }: { text: string | null; onDismiss: () => void }) {
  if (!text) return null;
  return (
    <div className="tst-frame" style={{ marginTop: 16 }}>
      {/* Dismiss as a 32px IconButton: the Alert's own × is 24px, small for a station touchscreen. */}
      <Alert
        severity="warning"
        action={<IconButton size="small" title="סגירת ההודעה" onClick={onDismiss} sx={{ marginBlock: "-6px", marginInlineEnd: "-6px" }}><ClearIcon fontSize={16} aria-hidden /></IconButton>}
      >
        {text}
      </Alert>
    </div>
  );
}
