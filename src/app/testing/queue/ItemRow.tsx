"use client";
import * as React from "react";
import { Typography, Box, Button, Stack, MenuItem, Menu, IconButton } from "@/components/ui";
import {
  ArrowBack as ArrowBackIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Inventory as InventoryIcon,
  PlayArrowRounded as PlayArrowRoundedIcon,
} from "@/components/ui/icons";
import IdText from "@/app/components/IdText";
import { ITEM_STATES } from "@/app/components/packages/packageUi";
import { seq2 } from "@/app/lib/packages/ids";
import type { QueueRow } from "@/app/lib/testing/contract";
import { ItemStatus, TONE_DOT, isInTestStatus, isWaitingStatus, toneOfStatus } from "@/lib/item-status";
import { useNetSeconds } from "../clock";
import { customerLabel, shipmentLabel, waitLabel } from "./treeModel";
import "@/app/testing/station-popups.css";

/** The row's columns, shared with the list's header (testing.css .tst-cols). */
export const ROW_COLUMNS = ["פריט", "סוג · דגם · סריאלי", "שלב", "זמן · נטו", "", ""] as const;

/** The button a row (and the scanned item's card) offers: start, continue, or start research. */
export function ctaLabel(item: QueueRow): string | null {
  if (isInTestStatus(item.current_status)) return "המשך";
  if (!isWaitingStatus(item.current_status)) return null;
  return item.current_status === ItemStatus.AwaitResearch ? "התחל מחקר" : "התחל";
}

/** The status line: the state in words beside its tone dot, and who is on it while in test. */
export function statusText(item: QueueRow): string {
  const status = item.item_status_desc?.trim() || "סטטוס לא ידוע";
  return isInTestStatus(item.current_status) && item.in_test_worker_name ? `${status} · ${item.in_test_worker_name}` : status;
}

/**
 * One row of the open node's list (design: מסך בדיקה — עיצוב מחדש כעץ, artboard Main): the id with
 * its state, type, model and serial, the route step, the net wait (or time in test), the box's
 * other items, and the one button. A row of "כל התור" also says where it sits (customer ›
 * shipment). "חזרה לבדיקה הקודמת" stays under the state for whoever may send it back.
 */
export default function ItemRow({ item, onBegin, starting = false, showPlace = false, onStepBack }: {
  item: QueueRow;
  onBegin: (item: QueueRow) => void;
  /** Its start-test is on its way. */
  starting?: boolean;
  /** "כל התור": the row says its customer and shipment. */
  showPlace?: boolean;
  /** Given only when the item can go back a step (queueModel queueItemStepBack). */
  onStepBack?: () => void;
}) {
  const isInTest = isInTestStatus(item.current_status);
  const isWaiting = isWaitingStatus(item.current_status);
  const elapsed = useNetSeconds(isInTest ? item.processing_start_time : isWaiting ? item.queue_start_time : null);
  const totalSteps = Math.max(item.route_steps?.length || 1, 1);
  const currentStep = item.current_route_step ?? 1;
  const cta = ctaLabel(item);

  return (
    <div className="tst-cols tst-row">
      <div style={{ minWidth: 0 }}>
        <IdText id={item.item_id} size={18} headColor="var(--color-ink)" weight={600} letterSpacing="var(--ls-caption)" />
        <div className="tst-row-status">
          <span aria-hidden className="tst-dot" style={{ background: TONE_DOT[toneOfStatus(item.current_status)] }} />
          <span>{statusText(item)}</span>
        </div>
        {showPlace && <div className="tst-row-place">{customerLabel(item.customer_code)} › {shipmentLabel(item.shipment_code)}</div>}
        {onStepBack && (
          <button type="button" className="tst-step-back" style={{ marginTop: 6 }} onClick={onStepBack}>
            <ArrowBackIcon sx={{ fontSize: 12 }} aria-hidden />
            חזרה לבדיקה הקודמת
          </button>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div className="tst-row-type">{item.item_type_desc || "—"}</div>
        <div className="tst-row-sub" title={item.makat ? `מק״ט ${item.makat}` : undefined}>
          {item.model || "—"} · <bdi dir="ltr">{item.serial_no || "—"}</bdi>
        </div>
      </div>

      <div>
        {/* "a / b" isolated LTR — in RTL it would read "b / a". */}
        <div className="tst-row-sub" style={{ color: "var(--color-ink-muted-70)" }}>שלב <bdi dir="ltr">{currentStep} / {totalSteps}</bdi></div>
        <div aria-hidden style={{ display: "flex", gap: 3, marginTop: 5 }}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <span key={i} style={{ flex: 1, height: 5, borderRadius: "var(--r-pill)", background: i < currentStep ? "var(--color-ink-muted-48)" : "var(--color-hairline)" }} />
          ))}
        </div>
      </div>

      <div className="tst-row-time tst-num">{elapsed != null ? waitLabel(elapsed) : "—"}</div>

      <BoxMates item={item} />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {cta ? (
          <Button
            className="tst-row-cta"
            variant={isInTest ? "outlined" : "contained"}
            disabled={starting}
            onClick={() => onBegin(item)}
            startIcon={isInTest ? undefined : <PlayArrowRoundedIcon sx={{ fontSize: 18 }} aria-hidden />}
          >
            {cta}
          </Button>
        ) : (
          <span className="tst-cta-done">
            <CheckCircleOutlineIcon sx={{ fontSize: 18 }} aria-hidden />
            הושלם
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * An item inside a box: the box icon, and its menu lists the box's other items and where each one
 * is (docs/features/packages/PLAN.md §9.14). A loose item keeps the column empty, so the columns
 * stay aligned.
 */
function BoxMates({ item }: { item: QueueRow }) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const pkg = item.package_id != null ? item.package ?? null : null;
  if (!pkg) return <span aria-hidden />;
  const siblings = pkg.items.filter((s) => String(s.item_id) !== String(item.item_id));
  return (
    <>
      <IconButton
        onClick={(e) => setAnchorEl(e.currentTarget)}
        title={`פריט ${seq2(item.package_seq)} מתוך ${seq2(pkg.items.length)} · פריטים באותו מארז`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        className="tst-pkg-btn"
      >
        <InventoryIcon sx={{ fontSize: 18 }} aria-hidden />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        marginThreshold={0}
        PaperProps={{ sx: { minWidth: 260 } }}
      >
        <MenuItem disabled dense sx={{ opacity: "1 !important" }}>
          <Box>
            <Typography sx={{ fontSize: "var(--text-fine)", fontWeight: 700, color: "var(--color-ink-muted-48)" }}>פריטים באותו מארז</Typography>
            <Box sx={{ mt: "2px" }}><IdText id={pkg.item_id} size={13} headColor="var(--color-ink)" /></Box>
          </Box>
        </MenuItem>
        {siblings.length === 0 ? (
          <MenuItem disabled dense><Typography variant="caption">אין פריטים נוספים במארז</Typography></MenuItem>
        ) : (
          siblings.map((s) => (
            <MenuItem key={s.item_id} onClick={() => setAnchorEl(null)} dense>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ gap: 1 }}>
                <Box sx={{ width: 26, height: 26, borderRadius: "7px", bgcolor: "var(--color-canvas-parchment)", color: "var(--color-ink-muted-48)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-fine)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{seq2(s.package_seq)}</Box>
                <Box>
                  <Typography variant="subtitle2">{s.item_type_desc}</Typography>
                  {/* State in words, its colour on a dot (amber text would fail contrast). */}
                  <Typography variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: "var(--r-pill)", bgcolor: ITEM_STATES[s.state].color }} />
                    {s.state_label}{s.station_name ? ` · ${s.station_name}` : ""}
                  </Typography>
                </Box>
              </Stack>
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
}
