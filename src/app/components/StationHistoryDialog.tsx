"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
} from "@/components/ui";
import DataTable, { type Column } from "@/components/DataTable";
import { formatDateTime } from "@/app/lib/datetime";

type StationHistoryEntry = {
  logId: number;
  itemId: number;
  currentRouteStep: number;
  testStationId: number;
  queueStartTime: string | null;
  processingStartTime: string | null;
  processingEndTime: string | null;
  workerId: number | null;
  serialNo: number;
  makat: number;
  model: string;
  manufacturerName: string;
  manufacturerNo: number;
  itemTypeDesc: string | null;
};

type StationHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  stationId: number | null;
  stationName: string | null;
};

/**
 * Calculate duration between two timestamps in HH:MM:SS format
 */
function calculateDuration(
  startTime: string | null,
  endTime: string | null
): string {
  if (!startTime || !endTime) {
    return "—";
  }

  try {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    if (isNaN(start) || isNaN(end) || end < start) {
      return "—";
    }

    const diffSeconds = Math.floor((end - start) / 1000);
    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } catch (error) {
    return "—";
  }
}

// formatDateTime prints "-" for a missing time; the app's blank is "—".
const when = (t: string | null) => (t ? formatDateTime(t) : "—");

// A muted secondary line under a cell's main value.
const META: React.CSSProperties = { fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", marginTop: 2 };

const COLUMNS: Column<StationHistoryEntry>[] = [
  {
    key: "item",
    header: "פריט",
    cell: (e) => (
      <>
        <div style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>#{e.itemId}</div>
        <div style={META}>מס׳ סידורי {e.serialNo} · מק״ט {e.makat}</div>
        {e.itemTypeDesc && <div style={META}>{e.itemTypeDesc}</div>}
      </>
    ),
  },
  { key: "step", header: "שלב", nums: true, nowrap: true, cell: (e) => e.currentRouteStep },
  { key: "queue", header: "התחלת תור", nums: true, nowrap: true, cell: (e) => when(e.queueStartTime) },
  { key: "start", header: "התחלת עיבוד", nums: true, nowrap: true, cell: (e) => when(e.processingStartTime) },
  { key: "end", header: "סיום עיבוד", nums: true, nowrap: true, cell: (e) => when(e.processingEndTime) },
  { key: "duration", header: "משך זמן", nums: true, nowrap: true, cell: (e) => calculateDuration(e.processingStartTime, e.processingEndTime) },
  { key: "worker", header: "עובד", nowrap: true, cell: (e) => (e.workerId ? `עובד #${e.workerId}` : "—") },
];

export default function StationHistoryDialog({
  open,
  onClose,
  stationId,
  stationName,
}: StationHistoryDialogProps) {
  const [history, setHistory] = React.useState<StationHistoryEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Bumped by "נסה שוב" to run the same load again.
  const [attempt, setAttempt] = React.useState(0);

  // Fetch history when dialog opens and stationId is available
  React.useEffect(() => {
    if (!open || !stationId) {
      setHistory([]);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/testing/station-history?stationId=${stationId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setHistory(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        // Whatever failed (server, network, a non-JSON reply), the worker
        // gets one Hebrew line that says what happened and what to do.
        if (!cancelled) {
          setError("לא ניתן לטעון את היסטוריית העמדה. בדוק את החיבור ונסה שוב.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, stationId, attempt]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle onClose={onClose}>
        {stationName ? `היסטוריית בדיקות — ${stationName}` : "היסטוריית בדיקות"}
      </DialogTitle>
      <DialogContent sx={{ padding: 0 }}>
        {error ? (
          <Alert
            severity="error"
            sx={{ margin: "0 24px 24px" }}
            action={<Button size="small" variant="text" onClick={() => setAttempt((n) => n + 1)}>נסה שוב</Button>}
          >
            {error}
          </Alert>
        ) : (
          <DataTable
            plain
            rows={history}
            columns={COLUMNS}
            getRowKey={(e) => e.logId}
            loading={loading}
            loadingRows={6}
            maxHeight="60vh"
            minWidth={800}
            empty={<div style={{ fontSize: "var(--text-body)" }}>לא נמצאו בדיקות קודמות לעמדה זו.</div>}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined" color="inherit">
          סגור
        </Button>
      </DialogActions>
    </Dialog>
  );
}
