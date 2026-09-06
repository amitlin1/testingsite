"use client";

// The station table, shared by the overview and the stations tab (§8.1, §8.3).
//
// THREE COLUMN NAMES ARE THE CONTRACT (§16.4), and they are all here:
//
//   בתור (סוג)      `itemsInQueue` is the station TYPE's shared queue. A
//                   `queued` interval carries no station_id at all, only a
//                   station_type_id, so the number repeats on every row of a
//                   type. It is NEVER summed — the table renders no total for
//                   it and the card carries the sentence that says why.
//   במחקר           `_new_itemsInResearch`. Research is no longer folded into
//                   queue/test; the research POOL is station-less and is read
//                   once, for the row tooltip and the dark strip.
//   גיל התור כרגע   the age of the items waiting RIGHT NOW — a state metric,
//                   not the average of completed waits and not the age of the
//                   running tests. The cell shows the OLDEST of them, because a
//                   mean is diluted by whoever just joined the queue and hides
//                   the one item that has been rotting there since Thursday; the
//                   p95 and the mean are one hover away, which is what answers
//                   "is that one stale row or a real backlog".

import * as React from "react";

import type { Column } from "@/app/components/dashboard/DenseTable";
import { LoadBar } from "@/app/components/dashboard/LoadBar";
import TrendCell from "@/app/components/dashboard/TrendCell";
import type { StationWire } from "@/app/lib/dashboard/api-types";
import { EM_DASH, formatCount, formatHours, formatQueueAge, queueAgeTone } from "@/app/lib/dashboard/format";

export const SHARED_QUEUE_NOTE =
  "התור שייך לסוג העמדה ולא לעמדה — הוא חוזר בכל שורות אותו סוג ואין לסכם את העמודה. בריכת המחקר נספרת בנפרד.";

export interface StationColumnOptions {
  rows: StationWire[];
  /** The same window, one period earlier — the only source of a trend here. */
  previous?: StationWire[] | null;
  previousPending?: boolean;
  /** The overview shows the compact set; the stations tab shows all of it. */
  full: boolean;
}

export function stationColumns({
  rows,
  previous,
  previousPending = false,
  full,
}: StationColumnOptions): Array<Column<StationWire>> {
  // One ceiling for the whole table so the bars are comparable row to row.
  const ceiling = Math.max(
    1,
    ...rows.map((r) => r.itemsInQueue + r.itemsInTest + r._new_itemsInResearch),
  );
  // Utilisation cannot be computed (see the header note below), so the bar is
  // scaled against the busiest station's work hours and the CELL prints the
  // real figure rather than a share of an unknown whole.
  const maxWorkHours = Math.max(0.0001, ...rows.map((r) => r._new_busyWorkHours ?? 0));
  const prevById = new Map((previous ?? []).map((r) => [r.stationId, r]));

  const columns: Array<Column<StationWire>> = [
    {
      key: "name",
      header: "עמדה",
      sortValue: (r) => r.stationName,
      render: (r) => <span style={{ fontWeight: 600 }}>{r.stationName}</span>,
    },
    {
      key: "type",
      header: "סוג",
      secondary: true,
      sortValue: (r) => r.stationTypeName ?? "",
      render: (r) => (
        <span style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)" }}>
          {r.stationTypeName ?? EM_DASH}
        </span>
      ),
    },
    {
      key: "load",
      header: "עומס נוכחי",
      width: full ? "22%" : "30%",
      render: (r) => <LoadBar test={r.itemsInTest} queue={r.itemsInQueue} ceiling={ceiling} />,
    },
    {
      key: "queue",
      header: (
        <>
          בתור <span style={{ fontWeight: 400, color: "var(--color-ink-muted-48)" }}>(סוג)</span>
        </>
      ),
      numeric: true,
      sortValue: (r) => r.itemsInQueue,
      render: (r) => (
        <span
          style={{ color: "var(--color-ink-muted-48)" }}
          title={`בריכת המחקר: ${formatCount(r._new_researchPoolQueue)} · התור משותף לכל עמדות הסוג`}
        >
          {formatCount(r.itemsInQueue)}
        </span>
      ),
    },
    {
      key: "test",
      header: "בבדיקה",
      numeric: true,
      sortValue: (r) => r.itemsInTest,
      render: (r) => formatCount(r.itemsInTest),
    },
  ];

  if (full) {
    columns.push({
      key: "research",
      header: "במחקר",
      numeric: true,
      secondary: true,
      sortValue: (r) => r._new_itemsInResearch,
      render: (r) => formatCount(r._new_itemsInResearch),
    });
  }

  columns.push(
    {
      key: "queueAge",
      header: "הוותיק בתור",
      numeric: true,
      sortValue: (r) => r._new_oldestQueueAgeWallMinutes,
      render: (r) => (
        <span
          style={{ fontWeight: 600, color: queueAgeTone(r._new_oldestQueueAgeWallMinutes) }}
          title={[
            `נטו ${formatQueueAge(r._new_oldestQueueAgeWorkMinutes)}`,
            `p95 ${formatQueueAge(r._new_p95QueueAgeWallMinutes)}`,
            `ממוצע ${formatQueueAge(r.averageCurrentQueueTimeMinutes)}`,
          ].join(" · ")}
        >
          {formatQueueAge(r._new_oldestQueueAgeWallMinutes)}
        </span>
      ),
    },
    {
      key: "processed",
      header: "טופל בתקופה",
      numeric: true,
      sortValue: (r) => r.totalProcessedInPeriod,
      render: (r) => formatCount(r.totalProcessedInPeriod),
    },
  );

  if (full) {
    columns.push({
      key: "workHours",
      // NOT "ניצולת": utilisation needs the window's ACTIVITY hours as a
      // denominator and no endpoint exposes the work calendar. What the ledger
      // does report is the numerator, so the numerator is what the column says.
      header: "שעות עבודה",
      width: "14%",
      sortValue: (r) => r._new_busyWorkHours,
      // The bar is scaled to the busiest station in the same window, so the
      // column still reads as a ranking at a glance; the figure beside it is
      // the absolute number, not a share of anything.
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              flex: 1,
              height: 5,
              background: "var(--color-canvas-parchment)",
              borderRadius: 3,
              overflow: "hidden",
              display: "flex",
              flexDirection: "row-reverse",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, ((r._new_busyWorkHours ?? 0) / maxWorkHours) * 100)}%`,
                background: "var(--dash-ramp-1)",
              }}
            />
          </div>
          <WorkHoursCell hours={r._new_busyWorkHours} />
        </div>
      ),
    });
  }

  columns.push({
    key: "trend",
    header: "מגמה",
    numeric: true,
    render: (r) => (
      <TrendCell
        current={r.totalProcessedInPeriod}
        previous={prevById.get(r.stationId)?.totalProcessedInPeriod}
        pending={previousPending || previous == null}
      />
    ),
  });

  return columns;
}

/** The work-hours cell prints the real figure beside its relative bar. */
export function WorkHoursCell({ hours }: { hours: number | null }) {
  return (
    <span style={{ fontSize: 12, color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums" }}>
      {formatHours(hours)}
    </span>
  );
}
