"use client";
import * as React from "react";
import {
  Box, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Stepper, Step, StepLabel, Chip, Stack, Divider,
} from "@/components/ui";
import { formatDateTime, calculateWorkDuration, formatDuration } from "@/app/lib/datetime";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@/components/ui";
import ItemFilesPanel from "./ItemFilesPanel";

type ItemData = {
  item_id: number;
  makat: number | null;
  serial_no: string | null;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_id: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  route_steps: number[] | null;
  route_stations: { id: number, desc: string }[] | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  connected_items?: {
    item_id: number;
    serial_no: string | null;
    item_type_desc: string | null;
    current_status: number | null;
    item_status_desc: string | null;
    relation_type?: string;
  }[];
};

type HistoryRow = {
  log_id: number;
  item_id: number;
  current_route_step: number;
  test_station_id: number | null;
  queue_start_time: string | null;
  processing_start_time: string | null;
  processing_end_time: string | null;
  worker_id: number | null;
  worker_name: string | null;
};

export default function ItemDialog({
  itemId,
  statusLabel,
  onClose,
}: {
  itemId: number;
  statusLabel: string;
  onClose: () => void;
}) {
  const [item, setItem] = React.useState<ItemData | null>(null);
  const [history, setHistory] = React.useState<HistoryRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/items/${itemId}`);
        if (!r.ok) {
          throw new Error(`HTTP error! status: ${r.status}`);
        }
        const j = await r.json();
        if (!cancelled) {
          setItem(j.item);
          setHistory(Array.isArray(j.history) ? j.history : []);
        }
      } catch (error) {
        console.error("Error loading item:", error);
        if (!cancelled) {
          setItem(null);
          setHistory([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [itemId]);

  const stepsCount = Math.max(item?.route_steps?.length ?? 0);
  const activeStep = item?.is_finished
    ? stepsCount
    : Math.max((item?.current_route_step ?? 1) - 1, 0);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      {/* Compact header (density pass — round 2). The real item record exposes
          fewer fields than the mock's airy grid, so we keep the chip summary but
          tighten type, spacing and section gaps. */}
      <DialogTitle sx={{ pb: 1, fontWeight: 700, fontSize: 18, letterSpacing: "-0.2px" }}>
        פריט #{itemId} — {item?.serial_no ?? ""}
      </DialogTitle>
      <DialogContent dividers>
        {!item ? (
          <Typography>טוען…</Typography>
        ) : (
          <>
            <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: "wrap", gap: 0.75 }}>
              <Chip size="small" label={`מקט: ${item.makat}`} />
              <Chip size="small" label={`סוג: ${item.item_type_desc ?? "-"}`} />
              <Chip size="small" label={`סטטוס: ${statusLabel || item.item_status_desc || "-"}`} color="primary" />
              {item.test_station_id && item.item_status_id === 1 ? (
                <Chip size="small" label={`עמדה נוכחית: ${item.test_station_desc}`} />
              ) : (
                <Chip size="small" label={`עמדה רצויה: ${item.test_station_desc}`} />
              )}
            </Stack>

            {/* Connected Items Section */}
            {item.connected_items && item.connected_items.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                  פריטים מחוברים:
                </Typography>
                <TableContainer sx={{ border: "1px solid var(--color-hairline)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>מזהה פריט</TableCell>
                        <TableCell>סוג</TableCell>
                        <TableCell>מס' סידורי</TableCell>
                        <TableCell>סטטוס</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {item.connected_items.map((sub) => (
                        <TableRow key={sub.item_id}>
                          <TableCell>{sub.item_id}</TableCell>
                          <TableCell>{sub.item_type_desc}</TableCell>
                          <TableCell>{sub.serial_no}</TableCell>
                          <TableCell>{sub.item_status_desc}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            <Box sx={{ my: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                מסלול בדיקה
              </Typography>
              <Stepper activeStep={activeStep} alternativeLabel>
                {Array.from({ length: stepsCount })
                  .map((_, i) => i)
                  .map((i) => (
                    <Step key={i}>
                      <StepLabel>{item.route_stations?.[i]?.desc}</StepLabel>
                    </Step>
                  ))}
              </Stepper>
            </Box>

            <Divider sx={{ my: 2 }} />
            {/* File attachments — uses the panel's own WorkerPicker since this
                page has no global worker context (management view). */}
            <ItemFilesPanel itemId={itemId} maxHeight={320} />

            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              היסטוריית תחנות
            </Typography>
            <Stack spacing={1}>
              {history.length === 0 ? (
                <Typography color="text.secondary">אין היסטוריה עדיין</Typography>
              ) : (
                history.map((h) => {
                  const duration = (h.processing_start_time && h.processing_end_time)
                    ? calculateWorkDuration(h.processing_start_time, h.processing_end_time)
                    : null;
                  return (
                    <Box key={h.log_id} sx={{ p: 1.2, borderRadius: 1, bgcolor: "action.hover" }}>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                        שלב {h.current_route_step}
                        {h.worker_name && ` • עובד: ${h.worker_name}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        התחלה: {h.processing_start_time ? new Date(h.processing_start_time).toLocaleString("he-IL") : "-"}
                        {" • "}
                        סיום: {h.processing_end_time ? new Date(h.processing_end_time).toLocaleString("he-IL") : "-"}
                        {duration !== null && duration > 0 && ` • משך עבודה נטו: ${formatDuration(duration, "long")}`}
                      </Typography>
                    </Box>
                  );
                })
              )}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">סגור</Button>
      </DialogActions>
    </Dialog>
  );
}
