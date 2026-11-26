"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import NextLink from "next/link";
import { History as HistoryIcon, Refresh as RefreshIcon } from "@/components/ui/icons";
import {
  Box, Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, Button, Typography, Stepper, Step, StepLabel, Chip, Stack, Divider, Skeleton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@/components/ui";
import { formatDuration } from "@/app/lib/datetime";
import { CLOCK_TEXT } from "@/app/lib/dashboard/work-clock";
import { ItemStatus, toneOfStatus } from "@/lib/item-status";
import { formatMoment } from "@/app/lib/datetime";
import { StatusPill } from "@/components/DataTable";
import ItemFilesPanel from "@/app/components/ItemFilesPanel";
import MyPackageCard from "@/app/components/packages/MyPackageCard";
import type { ItemDetailResponse, ItemHistoryRow } from "@/app/lib/items/contract";
import { READ_PER_VISIT } from "@/app/components/screenQuery";
import { getJson } from "@/lib/api/client";
import { itemHistoryHref } from "@/app/lib/links";

const NO_HISTORY: ItemHistoryRow[] = [];

const EM_DASH = "—";

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
  itemId: string;
  statusLabel: string;
  onClose: () => void;
}) {
  const itemQ = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => getJson<ItemDetailResponse>(`/api/items/${itemId}`),
    ...READ_PER_VISIT,
  });
  const item = itemQ.data?.item ?? null;
  const history = itemQ.data?.history ?? NO_HISTORY;
  // The item's box (design/Items.dc.html "המארז שלי"); null for a loose item.
  const pkg = itemQ.data?.package ?? null;
  // A failed load must not read as "still loading" forever.
  const loadError = itemQ.isError && !itemQ.isFetching;
  const retry = () => void itemQ.refetch();

  const stepsCount = item?.route_steps?.length ?? 0;
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
              <StatusPill label={statusLabel || item.item_status_desc || EM_DASH} tone={toneOfStatus(item.current_status)} />
              {item.test_station_id && item.current_status === ItemStatus.InTest ? (
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
                        {/* Inside a Dialog the side panel cannot open, so the clock is named in words.
                            0 is a real answer (the whole step fell outside working hours). */}
                        {h.processing_start_time && h.processing_end_time &&
                          ` • משך עבודה נטו (רק שעות עבודה): ${duration === null ? CLOCK_TEXT.missingWork : formatDuration(duration, "long")}`}
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
          href={itemHistoryHref(itemId)}
          variant="contained"
          startIcon={<HistoryIcon fontSize={18} />}
        >
          היסטוריה מלאה
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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
