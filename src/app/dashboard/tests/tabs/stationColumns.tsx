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
//   במחקר           `itemsInResearch`, its own column, not folded into
//                   queue/test; the research POOL is station-less and is read
//                   once, for the row tooltip and the dark strip.
//   הוותיק בתור     the age of the items waiting RIGHT NOW — a state metric,
//                   not the average of completed waits and not the age of the
//                   running tests. The cell shows the OLDEST of them, because a
//                   mean is diluted by whoever just joined the queue and hides
//                   the one item that has been rotting there since Thursday; the
//                   p95 and the mean are one hover or focus away, which answers
//                   "is that one stale row or a real backlog".

import * as React from "react";

import type { Column } from "../_components/DenseTable";
import { FillBar, LoadBar } from "../_components/LoadBar";
import TrendCell from "../_components/TrendCell";
import TwinDuration from "../_components/TwinDuration";
import type { StationView } from "@/app/lib/dashboard/contract";
import type { HistoryTarget } from "../_components/HistoryOverlay";
import {
  EM_DASH,
  formatCount,
  formatHours,
  formatQueueAge,
  queueAgeTone,
  workTwin,
} from "../_lib/format";

export const SHARED_QUEUE_NOTE =
  "התור שייך לסוג העמדה ולא לעמדה — הוא חוזר בכל שורות אותו סוג ואין לסכם את העמודה. בריכת המחקר נספרת בנפרד.";

/** A station row opens the station's history dialog. */
export function stationHistoryTarget(row: StationView): HistoryTarget {
  return {
    kind: "station",
    id: row.stationId,
    title: row.stationName,
    meta: row.stationTypeName ? `סוג ${row.stationTypeName}` : undefined,
    live: { oldestQueueAgeMinutes: row.oldestQueueAgeWallMinutes },
  };
}

/** The station board's empty state, with its way out. */
export function stationsEmpty(clearFilters: () => void) {
  return { text: "אין עמדות שמתאימות למסננים האלה.", action: { label: "נקה את המסננים", onClick: clearFilters } };
}

export interface StationColumnOptions {
  rows: StationView[];
  /** The same window, one period earlier — the only source of a trend here. */
  previous?: StationView[] | null;
  previousPending?: boolean;
  /** The overview shows the compact set; the stations tab shows all of it. */
  full: boolean;
}

export function stationColumns({
  rows,
  previous,
  previousPending = false,
  full,
}: StationColumnOptions): Array<Column<StationView>> {
  // One ceiling for the whole table so the bars are comparable row to row.
  const ceiling = Math.max(
    1,
    ...rows.map((r) => r.itemsInQueue + r.itemsInTest + r.itemsInResearch),
  );
  // Utilisation cannot be computed (see the header note below), so the bar is
  // scaled against the busiest station's work hours and the CELL prints the
  // real figure rather than a share of an unknown whole.
  const maxWorkHours = Math.max(0.0001, ...rows.map((r) => r.busyWorkHours ?? 0));
  const prevById = new Map((previous ?? []).map((r) => [r.stationId, r]));

  const columns: Array<Column<StationView>> = [
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
        <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
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
          title={`בריכת המחקר: ${formatCount(r.researchPoolQueue)} · התור משותף לכל עמדות הסוג`}
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
      sortValue: (r) => r.itemsInResearch,
      render: (r) => formatCount(r.itemsInResearch),
    });
  }

  columns.push(
    {
      key: "queueAge",
      header: "הוותיק בתור",
      numeric: true,
      sortValue: (r) => r.oldestQueueAgeWallMinutes,
      // The work twin is printed under the wall figure (§16.1); p95 and the
      // mean stay one focus away.
      render: (r) => (
        <TwinDuration
          value={formatQueueAge(r.oldestQueueAgeWallMinutes)}
          tone={queueAgeTone(r.oldestQueueAgeWallMinutes)}
          bold
          twin={workTwin(r.oldestQueueAgeWallMinutes, r.oldestQueueAgeWorkMinutes, formatQueueAge)}
          more={[
            `p95 ${formatQueueAge(r.p95QueueAgeWallMinutes)}`,
            `ממוצע ${formatQueueAge(r.averageCurrentQueueTimeMinutes)}`,
          ].join(" · ")}
        />
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
      sortValue: (r) => r.busyWorkHours,
      // The bar is scaled to the busiest station in the same window, so the
      // column still reads as a ranking at a glance; the figure beside it is
      // the absolute number, not a share of anything.
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FillBar
            pct={Math.min(100, ((r.busyWorkHours ?? 0) / maxWorkHours) * 100)}
            color="var(--dash-ramp-1)"
            height={5}
            style={{ flex: 1 }}
          />
          <WorkHoursCell hours={r.busyWorkHours} />
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
function WorkHoursCell({ hours }: { hours: number | null }) {
  return (
    <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums" }}>
      {formatHours(hours)}
    </span>
  );
}
