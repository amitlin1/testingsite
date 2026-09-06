"use client";

// §8.4 — the items the lab actually spent time on.
//
// THE SERVER ORDERS BY THE WORK CLOCK, and the client does not re-sort by wall
// time. "What sat through a weekend" and "what the lab spent time on" are
// different questions, and this screen answers the second one; the row set is
// deliberately different from the old screen's.
//
// `עמדה בשלב` is the station of the step that was SLOW, taken from the
// interval — not the item's current station, which is what the old query
// reported and what made this list look random. `שלב` is that step's number.
//
// `ניסיון` is why the tab stops being a list of random stuck items: it tells a
// first pass apart from a retest and from a restart after the reaper abandoned
// the step.
//
// `לקוח` is the owner AT THE TIME OF THE STEP, read off the interval's frozen
// dimension rather than off `items` — the item's CURRENT owner can differ (a
// retype restarts the route), and a row that contradicted the customer filter
// which selected it would be worse than no column at all.
//
// `serialNo` / `makat` are STRINGS (they were mistyped as numbers upstream and
// the column is not parsed here). Accessories never appear at all — their
// testing interval is a synthetic ~0-length pair and can never be a slow step.

import * as React from "react";

import DataCard from "@/app/components/dashboard/DataCard";
import DenseTable, { type Column } from "@/app/components/dashboard/DenseTable";
import Segmented from "@/app/components/dashboard/Segmented";
import type { SlowItemWire } from "@/app/lib/dashboard/api-types";
import {
  DASH_COLORS,
  EM_DASH,
  formatAttempt,
  formatMinutes,
  stuckTone,
} from "@/app/lib/dashboard/format";
import type { StuckHours } from "@/app/lib/hooks/useDashboardState";
import type { TabProps } from "./tabTypes";

const THRESHOLDS: Array<{ value: string; label: string; hours: StuckHours }> = [
  { value: "24", label: "24 ש׳+", hours: 24 },
  { value: "48", label: "48 ש׳+", hours: 48 },
  { value: "72", label: "72 ש׳+", hours: 72 },
  { value: "all", label: "הכל", hours: null },
];

/** The threshold is a client-side cut of the page the server returned. */
export function passesThreshold(row: SlowItemWire, stuckHours: StuckHours): boolean {
  if (stuckHours === null) return true;
  const wall = row.queueTimeMinutes ?? row.totalTimeMinutes;
  return wall !== null && wall >= stuckHours * 60;
}

export default function SlowItemsTab({ api, data }: TabProps) {
  const slow = data.get<SlowItemWire[]>("slow");
  const { stuckHours } = api.state;

  const rows = React.useMemo(
    () => (slow.data ?? []).filter((row) => passesThreshold(row, stuckHours)),
    [slow.data, stuckHours],
  );

  const columns: Array<Column<SlowItemWire>> = [
    {
      key: "serial",
      header: "סריאלי",
      render: (r) => (
        <a
          href={`/items/${r.itemId}`}
          onClick={(e) => e.stopPropagation()}
          style={{ fontWeight: 600, color: "var(--color-primary)" }}
        >
          {r.serialNo ?? EM_DASH}
        </a>
      ),
    },
    {
      key: "makat",
      header: "מק״ט",
      secondary: true,
      render: (r) => (
        <span style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {r.makat ?? EM_DASH}
        </span>
      ),
    },
    {
      key: "model",
      header: "דגם",
      render: (r) => <span style={{ fontSize: 12.5 }}>{r.model || EM_DASH}</span>,
    },
    {
      key: "customer",
      header: "לקוח",
      sortValue: (r) => r._new_customerName ?? "",
      render: (r) => (
        <span style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)" }}>
          {r._new_customerName ?? EM_DASH}
        </span>
      ),
    },
    {
      key: "station",
      header: "עמדה בשלב",
      render: (r) => <span style={{ fontSize: 12.5 }}>{r.stationName ?? EM_DASH}</span>,
    },
    {
      key: "step",
      header: "שלב",
      numeric: true,
      render: (r) => (
        <span style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)" }}>{r.routeStep}</span>
      ),
    },
    {
      key: "attempt",
      header: "ניסיון",
      numeric: true,
      secondary: true,
      render: (r) => {
        const attempt = formatAttempt(r._new_attemptNo, r._new_entryReason);
        return <span style={{ fontSize: 12, color: attempt.tone }}>{attempt.text}</span>;
      },
    },
    {
      key: "wait",
      header: "בהמתנה · ברוטו",
      numeric: true,
      sortValue: (r) => r.queueTimeMinutes,
      render: (r) => (
        <span
          style={{ fontWeight: 600, color: stuckTone(r.queueTimeMinutes) }}
          title={
            r._new_queueWorkMinutes === null
              ? undefined
              : `נטו ${formatMinutes(r._new_queueWorkMinutes)}`
          }
        >
          {formatMinutes(r.queueTimeMinutes)}
        </span>
      ),
    },
    {
      key: "processing",
      header: "בביצוע · נטו",
      numeric: true,
      sortValue: (r) => r._new_processingWorkMinutes,
      render: (r) => (
        <span
          style={{ color: DASH_COLORS.muted }}
          title={
            r.processingTimeMinutes === null
              ? undefined
              : `ברוטו ${formatMinutes(r.processingTimeMinutes)}`
          }
        >
          {formatMinutes(r._new_processingWorkMinutes)}
        </span>
      ),
    },
    {
      key: "total",
      header: "סה״כ · ברוטו",
      numeric: true,
      sortValue: (r) => r.totalTimeMinutes,
      render: (r) => formatMinutes(r.totalTimeMinutes),
    },
    {
      key: "worker",
      header: "עובד אחרון",
      numeric: true,
      render: (r) => (
        <span style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)" }}>
          {r._new_workerName ?? EM_DASH}
        </span>
      ),
    },
  ];

  return (
    <DataCard
      panel
      title="פריטים שנתקעו"
      subtitle="מסודר לפי שעון העבודה — מה המעבדה באמת בילתה בו"
      right={
        <>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>סף השהיה</span>
          <Segmented
            options={THRESHOLDS.map((t) => ({ value: t.value, label: t.label }))}
            value={stuckHours === null ? "all" : String(stuckHours)}
            onChange={(value) =>
              api.setStuckHours(THRESHOLDS.find((t) => t.value === value)?.hours ?? null)
            }
          />
        </>
      }
      error={slow.error}
      onRetry={data.refresh}
      style={{ flex: 1, minHeight: 0 }}
    >
      <DenseTable
        columns={columns}
        rows={slow.data === null ? null : rows}
        rowKey={(row) => `${row.itemId}-${row.routeStep}-${row._new_attemptNo}`}
        loading={slow.loading}
        empty={{
          text: "אין פריטים תקועים בסף הזה.",
          action:
            stuckHours === 24
              ? { label: "הצג הכל", onClick: () => api.setStuckHours(null) }
              : { label: "הורד את הסף ל-24 שעות", onClick: () => api.setStuckHours(24) },
        }}
      />
    </DataCard>
  );
}
