"use client";

// §8.4 — the items the lab actually spent time on.
//
// THE SERVER ORDERS BY THE WORK CLOCK, and the client does not re-sort by wall
// time. "What sat through a weekend" and "what the lab spent time on" are
// different questions, and this screen answers the second one.
//
// `עמדה בשלב` is the station of the step that was SLOW, taken from the
// interval — not the item's current station. `שלב` is that step's number.
//
// `ניסיון` is meant to tell a first pass apart from a retest and from a restart
// after the reaper abandoned the step (see formatAttempt for what it can tell
// today).
//
// `לקוח` is the owner AT THE TIME OF THE STEP, read off the interval's frozen
// dimension rather than off `items` — the item's CURRENT owner can differ (a
// retype restarts the route), and a row that contradicted the customer filter
// which selected it would be worse than no column at all.
//
// `serialNo` / `makat` are strings and are shown as they are. Accessories never
// appear at all — their testing interval is a synthetic ~0-length pair and can
// never be a slow step.

import * as React from "react";

import DataCard from "../_components/DataCard";
import DenseTable, { type Column } from "../_components/DenseTable";
import Segmented from "../_components/Segmented";
import TwinDuration from "../_components/TwinDuration";
import type { SlowItemView } from "@/app/lib/dashboard/contract";
import {
  EM_DASH,
  formatAttempt,
  formatMinutes,
  stuckTone,
  toneText,
  workTwin,
} from "../_lib/format";
import { STUCK_HOURS_OPTIONS, type StuckHours } from "../_lib/state";
import type { TabProps } from "./tabTypes";
import CardInfo from "../_components/CardInfo";
import { EXPLAIN } from "../_lib/explain";
import { CLOCK_TEXT } from "@/app/lib/dashboard/work-clock";

const THRESHOLDS: Array<{ value: string; label: string; hours: StuckHours }> = [
  ...STUCK_HOURS_OPTIONS.map((hours) => ({ value: String(hours), label: `${hours} ש׳+`, hours })),
  { value: "all", label: "הכל", hours: null },
];

/** The threshold is a client-side cut of the page the server returned. */
export function passesThreshold(row: SlowItemView, stuckHours: StuckHours): boolean {
  if (stuckHours === null) return true;
  const wall = row.queueTimeMinutes ?? row.totalTimeMinutes;
  return wall !== null && wall >= stuckHours * 60;
}

export default function SlowItemsTab({ api, data }: TabProps) {
  const slow = data.get("slow");
  const { stuckHours } = api.state;

  const rows = React.useMemo(
    () => (slow.data ?? []).filter((row) => passesThreshold(row, stuckHours)),
    [slow.data, stuckHours],
  );

  const columns: Array<Column<SlowItemView>> = [
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
        <span style={{ fontSize: "var(--text-small)", fontVariantNumeric: "tabular-nums" }}>
          {r.makat ?? EM_DASH}
        </span>
      ),
    },
    {
      key: "model",
      header: "דגם",
      render: (r) => <span style={{ fontSize: "var(--text-small)" }}>{r.model || EM_DASH}</span>,
    },
    {
      key: "customer",
      header: "קוד לקוח",
      sortValue: (r) => r.customerCode ?? "",
      render: (r) => (
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
          {r.customerCode || EM_DASH}
        </span>
      ),
    },
    {
      key: "station",
      header: "עמדה בשלב",
      render: (r) => <span style={{ fontSize: "var(--text-small)" }}>{r.stationName ?? EM_DASH}</span>,
    },
    {
      key: "step",
      header: "שלב",
      numeric: true,
      render: (r) => (
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>{r.routeStep}</span>
      ),
    },
    {
      key: "attempt",
      header: "ניסיון",
      numeric: true,
      secondary: true,
      render: (r) => {
        const attempt = formatAttempt(r.attemptNo, r.entryReason);
        return <span style={{ fontSize: "var(--text-fine)", color: toneText(attempt.tone) }}>{attempt.text}</span>;
      },
    },
    {
      key: "wait",
      header: "בהמתנה · ברוטו",
      numeric: true,
      sortValue: (r) => r.queueTimeMinutes,
      // The work twin is printed under the wall figure (§16.1).
      render: (r) => (
        <TwinDuration
          value={formatMinutes(r.queueTimeMinutes)}
          tone={stuckTone(r.queueTimeMinutes)}
          bold
          twin={workTwin(r.queueTimeMinutes, r.queueWorkMinutes)}
        />
      ),
    },
    {
      key: "processing",
      header: "בביצוע · נטו",
      numeric: true,
      sortValue: (r) => r.processingWorkMinutes,
      render: (r) => (
        <TwinDuration
          value={
            r.processingWorkMinutes === null && r.processingTimeMinutes !== null
              ? CLOCK_TEXT.missingWork
              : formatMinutes(r.processingWorkMinutes)
          }
          tone="muted"
          twin={
            r.processingWorkMinutes === null && r.processingTimeMinutes === null
              ? null
              : `ברוטו ${formatMinutes(r.processingTimeMinutes)}`
          }
        />
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
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
          {r.workerName ?? EM_DASH}
        </span>
      ),
    },
  ];

  return (
    <DataCard
      panel
      title={<>פריטים שנתקעו<CardInfo explain={EXPLAIN.slow} /></>}
      subtitle="מסודר לפי שעון העבודה — מה המעבדה באמת בילתה בו"
      right={
        <>
          <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>סף השהיה</span>
          <Segmented
            options={THRESHOLDS.map((t) => ({ value: t.value, label: t.label }))}
            value={stuckHours === null ? "all" : String(stuckHours)}
            ariaLabel="סף השהיה"
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
        rowKey={(row) => `${row.itemId}-${row.routeStep}-${row.attemptNo}`}
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
