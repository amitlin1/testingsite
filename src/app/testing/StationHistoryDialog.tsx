"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert } from "@/components/ui";
import DataTable, { type Column } from "@/components/DataTable";
import { formatDateTime, formatDuration } from "@/app/lib/datetime";
import type { StationHistoryRow } from "@/app/lib/testing/contract";
import { READ_PER_VISIT } from "@/app/components/screenQuery";
import { loadStationHistory } from "./api";
import { CLOCK_TEXT } from "@/app/lib/dashboard/work-clock";

const NO_ROWS: StationHistoryRow[] = [];

type StationHistoryDialogProps = {
  open: boolean;
  onClose: () => void;
  stationId: number | null;
  stationName: string | null;
};

/** Net "HH:MM:SS" (working hours only, computed by the server); "—" while the step runs. */
function durationText(e: StationHistoryRow): string {
  if (!e.processingStartTime || !e.processingEndTime) return "—";
  return e.netWorkSeconds == null ? CLOCK_TEXT.missingWork : formatDuration(e.netWorkSeconds * 1000);
}

// A muted secondary line under a cell's main value.
const META: React.CSSProperties = { fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", marginTop: 2 };

const COLUMNS: Column<StationHistoryRow>[] = [
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
  { key: "queue", header: "התחלת תור", nums: true, nowrap: true, cell: (e) => formatDateTime(e.queueStartTime) },
  { key: "start", header: "התחלת עיבוד", nums: true, nowrap: true, cell: (e) => formatDateTime(e.processingStartTime) },
  { key: "end", header: "סיום עיבוד", nums: true, nowrap: true, cell: (e) => formatDateTime(e.processingEndTime) },
  { key: "duration", header: "משך זמן (נטו)", nums: true, nowrap: true, cell: durationText },
  { key: "worker", header: "עובד", nowrap: true, cell: (e) => (e.workerId ? `עובד #${e.workerId}` : "—") },
];

export default function StationHistoryDialog({
  open,
  onClose,
  stationId,
  stationName,
}: StationHistoryDialogProps) {
  // Read on every opening; "נסה שוב" reads again.
  const historyQ = useQuery({
    queryKey: ["testing", "station-history", stationId],
    enabled: open && stationId != null,
    queryFn: () => loadStationHistory(stationId!),
    ...READ_PER_VISIT,
  });
  // Whatever failed (server, network, a non-JSON reply), the worker gets one Hebrew line that says
  // what happened and what to do — not while "נסה שוב" is on its way.
  const failed = historyQ.isError && !historyQ.isFetching;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle onClose={onClose}>
        {stationName ? `היסטוריית בדיקות — ${stationName}` : "היסטוריית בדיקות"}
      </DialogTitle>
      <DialogContent sx={{ padding: 0 }}>
        {failed ? (
          <Alert
            severity="error"
            sx={{ margin: "0 24px 24px" }}
            action={<Button size="small" variant="text" onClick={() => void historyQ.refetch()}>נסה שוב</Button>}
          >
            לא ניתן לטעון את היסטוריית העמדה. בדוק את החיבור ונסה שוב.
          </Alert>
        ) : (
          <DataTable
            plain
            rows={historyQ.data ?? NO_ROWS}
            columns={COLUMNS}
            getRowKey={(e) => e.logId}
            loading={historyQ.isFetching}
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
