"use client";
import * as React from "react";
import NextLink from "next/link";
import { History as HistoryIcon, Refresh as RefreshIcon } from "@/components/ui/icons";
import {
  Box, Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, Button, Typography, Stepper, Step, StepLabel, Chip, Stack, Divider, Skeleton,
} from "@/components/ui";
import { formatDuration } from "@/app/lib/datetime";
import { toneOfStatus } from "@/app/lib/status-tones";
import { formatMoment } from "@/app/items/format";
import { StatusPill } from "@/components/DataTable";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@/components/ui";
import ItemFilesPanel from "./ItemFilesPanel";
import MyPackageCard from "./packages/MyPackageCard";
import type { PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";

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
  /** Net work time of the step, from the DB's one work calendar. NULL while the
   *  step is open — "not finished" is not "took no time". */
  net_work_seconds: number | null;
  worker_id: number | null;
  worker_name: string | null;
};

const EM_DASH = "—";

/** One section heading role inside the dialog (15/600). */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
      {children}
    </Typography>
  );
}

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
  // The item's box (design/Items.dc.html "המארז שלי"); null for a loose item.
  const [pkg, setPkg] = React.useState<PackageView | null>(null);
  // A failed load must not read as "still loading" forever.
  const [loadError, setLoadError] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/items/${itemId}`);
        if (!r.ok) {
          throw new Error(`HTTP error! status: ${r.status}`);
        }
        const j = await r.json();
        if (!cancelled) {
          setItem(j.item);
          setHistory(Array.isArray(j.history) ? j.history : []);
          setPkg(j.package ?? null);
          setLoadError(false);
        }
      } catch (error) {
        console.error("Error loading item:", error);
        if (!cancelled) {
          setItem(null);
          setHistory([]);
          setPkg(null);
          setLoadError(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [itemId, reloadKey]);

  const retry = () => {
    setLoadError(false);
    setReloadKey((k) => k + 1);
  };

  const stepsCount = Math.max(item?.route_steps?.length ?? 0);
  const activeStep = item?.is_finished
    ? stepsCount
    : Math.max((item?.current_route_step ?? 1) - 1, 0);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle onClose={onClose}>
        <span style={{ minWidth: 0 }}>
          פריט #{itemId}
          {item?.serial_no ? <> — <bdi dir="ltr">{item.serial_no}</bdi></> : null}
        </span>
      </DialogTitle>
      {/* Top divider only — DialogActions draws the line above the footer. */}
      <DialogContent style={{ borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-md)" }}>
        {loadError ? (
          <Alert
            severity="error"
            action={
              <Button size="small" variant="outlined" color="inherit" onClick={retry} startIcon={<RefreshIcon fontSize={16} />}>
                נסה שוב
              </Button>
            }
          >
            טעינת פרטי הפריט נכשלה. נסה שוב בעוד רגע.
          </Alert>
        ) : !item ? (
          <ItemDialogSkeleton />
        ) : (
          <>
            <Stack direction="row" sx={{ mb: 2, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
              <Chip size="small" label={`מקט: ${item.makat ?? EM_DASH}`} />
              <Chip size="small" label={`סוג: ${item.item_type_desc ?? EM_DASH}`} />
              {/* The status in the one status palette, like the table row. */}
              <StatusPill label={statusLabel || item.item_status_desc || EM_DASH} tone={toneOfStatus(item.current_status)} />
              {item.test_station_id && item.item_status_id === 1 ? (
                <Chip size="small" label={`עמדה נוכחית: ${item.test_station_desc ?? EM_DASH}`} />
              ) : (
                <Chip size="small" label={`עמדה רצויה: ${item.test_station_desc ?? EM_DASH}`} />
              )}
            </Stack>

            {/* Package model: the box this item belongs to, first thing in the
                body (design/Items.dc.html). A loose legacy item falls back to
                the old connected-items table below. */}
            {pkg && (
              <Box sx={{ mb: 2 }}>
                <MyPackageCard pkg={pkg} currentItemId={itemId} />
              </Box>
            )}
            {!pkg && item.connected_items && item.connected_items.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <SectionTitle>פריטים מחוברים</SectionTitle>
                <TableContainer sx={{ border: "1px solid var(--color-hairline)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>מזהה פריט</TableCell>
                        <TableCell>סוג</TableCell>
                        <TableCell>מס׳ סידורי</TableCell>
                        <TableCell>סטטוס</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {item.connected_items.map((sub) => (
                        <TableRow key={sub.item_id}>
                          <TableCell>{sub.item_id}</TableCell>
                          <TableCell>{sub.item_type_desc ?? EM_DASH}</TableCell>
                          <TableCell>{sub.serial_no ?? EM_DASH}</TableCell>
                          <TableCell>{sub.item_status_desc ?? EM_DASH}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            <Box sx={{ my: 2 }}>
              <SectionTitle>מסלול בדיקה</SectionTitle>
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
            <SectionTitle>היסטוריית תחנות</SectionTitle>
            <Stack spacing={1}>
              {history.length === 0 ? (
                <Typography variant="body2" color="text.secondary">אין היסטוריה עדיין</Typography>
              ) : (
                history.map((h) => {
                  // The work clock lives in the database (work_seconds_between,
                  // the same one every dashboard number uses); the API hands the
                  // answer over so this screen cannot drift from it.
                  const duration =
                    h.net_work_seconds === null ? null : h.net_work_seconds * 1000;
                  return (
                    <div
                      key={h.log_id}
                      style={{ padding: "var(--space-xs) var(--space-sm)", borderRadius: "var(--r-sm)", background: "var(--color-canvas-parchment)" }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        שלב {h.current_route_step}
                        {h.worker_name && ` • עובד: ${h.worker_name}`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        התחלה: {formatMoment(h.processing_start_time)}
                        {" • "}
                        סיום: {formatMoment(h.processing_end_time)}
                        {duration !== null && duration > 0 && ` • משך עבודה נטו: ${formatDuration(duration, "long")}`}
                      </Typography>
                    </div>
                  );
                })
              )}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {/* Close is the quiet way out; the full-page reconstruction (the same
            data plus per-station timings, worker attribution and files
            grouped by station) is the action, so it is the filled one. */}
        <Button onClick={onClose} variant="outlined" color="inherit">סגור</Button>
        <Button
          component={NextLink}
          href={`/items/${itemId}/history`}
          variant="contained"
          startIcon={<HistoryIcon fontSize={18} />}
        >
          היסטוריה מלאה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The dialog body's shape while the item loads: facts row, route, history. */
function ItemDialogSkeleton() {
  return (
    <div aria-busy="true" aria-label="טוען את פרטי הפריט">
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", marginBottom: "var(--space-lg)" }}>
        {[88, 120, 96, 140].map((w) => (
          <Skeleton key={w} variant="rounded" width={w} height={24} />
        ))}
      </div>
      <Skeleton width={110} height={14} style={{ marginBottom: "var(--space-sm)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Skeleton height={2} style={{ flex: 1 }} />}
            <Skeleton variant="circular" width={28} height={28} />
          </React.Fragment>
        ))}
      </div>
      <Skeleton width={130} height={14} style={{ marginBottom: "var(--space-sm)" }} />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={52} style={{ marginBottom: "var(--space-xs)" }} />
      ))}
    </div>
  );
}
