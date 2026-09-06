"use client";

// §8.2 — the six cards and the throughput chart.
//
// THE SECOND LINE OF A CARD IS NOT ALWAYS A DELTA. On the two duration cards it
// carries the WORK twin and the calendar gap, because a wall-clock average
// without its work twin is a number a manager will read as lab performance when
// it is mostly weekends (§16.1).
//
// `מסלולים שנסגרו` replaces `פריטים שהסתיימו`: "finished" is a route_run
// closure and nothing else. `העמדה העמוסה` reads work hours and steps
// processed; `busiestStationWorkloadScore` was `busy + 0.3*wait` rendered as a
// count of items, it is DELETED upstream, and nothing here reads it.
//
// Two of the live counters already INCLUDE their research half —
// `itemsCurrentlyInQueue` counts `queued` + `queued_research`, and
// `itemsCurrentlyInTest` counts `testing` + `in_research`. So their second line
// says `מזה`, not `ועוד`: the research figure is a breakdown of the number
// above it, not an addition to it.

import * as React from "react";

import DataCard, { Legend } from "@/app/components/dashboard/DataCard";
import Sparkline from "@/app/components/dashboard/charts/Sparkline";
import ThroughputBarChart, {
  THROUGHPUT_LEGEND,
  type ThroughputPoint,
} from "@/app/components/dashboard/charts/ThroughputBarChart";
import { ChartBody } from "@/app/components/dashboard/charts/chartConfig";
import { Skeleton } from "@/components/ui";
import type {
  AverageTimesWire,
  KpisWire,
  StationWire,
  StatusHistoryWire,
} from "@/app/lib/dashboard/api-types";
import {
  DASH_COLORS,
  EM_DASH,
  changePct,
  deltaTone,
  formatCount,
  formatDelta,
  formatHours,
  formatMinutes,
  isNil,
} from "@/app/lib/dashboard/format";
import { EmptyChart } from "./TimesTab";
import type { TabProps } from "./tabTypes";

const WAITING_STATES = ["queued", "queued_research"];
const ACTIVE_STATES = ["testing", "in_research"];

function seriesFromHistory(rows: StatusHistoryWire[], stateKeys: string[]): Array<number | null> {
  return rows.map((day) =>
    day.statuses
      .filter((s) => s._new_series === "point_in_time" && stateKeys.includes(s._new_stateKey))
      .reduce((sum, s) => sum + s.count, 0),
  );
}

interface KpiCard {
  label: string;
  value: string;
  unit?: string;
  note: string;
  tone: string;
  spark: Array<number | null>;
}

export default function KpisTab({ data }: TabProps) {
  const kpis = data.get<KpisWire>("kpis");
  const prev = data.get<KpisWire>("kpisPrev");
  const times = data.get<AverageTimesWire[]>("times");
  const history = data.get<StatusHistoryWire[]>("statusHistory");
  const stations = data.get<StationWire[]>("stationsLive");

  const k = kpis.data;
  const p = prev.data;
  const timeRows = React.useMemo(() => times.data ?? [], [times.data]);
  const historyRows = React.useMemo(() => history.data ?? [], [history.data]);
  const stationRows = stations.data ?? [];

  // Station-less and identical on every board row, so it is read once.
  const researchPool = stationRows.length > 0 ? stationRows[0]._new_researchPoolQueue : null;
  const inResearch = stationRows.reduce((sum, row) => sum + row._new_itemsInResearch, 0);
  const activeStations = stationRows.filter(
    (row) => row.itemsInTest > 0 || row._new_itemsInResearch > 0,
  ).length;

  const queueGap =
    isNil(k?.averageQueueTimeMinutes) || isNil(k?._new_averageQueueWorkMinutes)
      ? null
      : (k!.averageQueueTimeMinutes as number) - (k!._new_averageQueueWorkMinutes as number);

  const closedDelta = changePct(k?.totalItemsProcessed, p?.totalItemsProcessed);

  const cards: KpiCard[] = [
    {
      label: "זמן המתנה ממוצע · ברוטו",
      value: formatMinutes(k?.averageQueueTimeMinutes),
      note: isNil(k?._new_averageQueueWorkMinutes)
        ? "אין מדידה בתקופה"
        : `נטו ${formatMinutes(k?._new_averageQueueWorkMinutes)}${
            isNil(queueGap) ? "" : ` · פער ${formatMinutes(queueGap)} מחוץ לשעות`
          }`,
      tone: DASH_COLORS.muted,
      spark: timeRows.map((row) => row.avgWaitingMinutes),
    },
    {
      label: "זמן ביצוע ממוצע · ברוטו",
      value: formatMinutes(k?.averageProcessingTimeMinutes),
      note: isNil(k?._new_averageProcessingWorkMinutes)
        ? "אין מדידה בתקופה"
        : `נטו ${formatMinutes(k?._new_averageProcessingWorkMinutes)}`,
      tone: DASH_COLORS.muted,
      spark: timeRows.map((row) => row.avgProcessingMinutes),
    },
    {
      label: "מסלולים שנסגרו",
      value: formatCount(k?.totalItemsProcessed),
      note: prev.loading
        ? "משווה מול התקופה הקודמת"
        : closedDelta === null
          ? "אין תקופה קודמת להשוואה"
          : `${formatDelta(closedDelta)} מהתקופה הקודמת`,
      tone: deltaTone(closedDelta, false),
      spark: historyRows.map((day) => day._new_finishedToday),
    },
    {
      label: "ממתינים כרגע",
      value: formatCount(k?.itemsCurrentlyInQueue),
      note: isNil(researchPool)
        ? "כולל את בריכת המחקר"
        : `מזה ${formatCount(researchPool)} בבריכת המחקר`,
      tone: DASH_COLORS.amber,
      spark: seriesFromHistory(historyRows, WAITING_STATES),
    },
    {
      label: "בבדיקה כרגע",
      value: formatCount(k?.itemsCurrentlyInTest),
      note: `מזה ${formatCount(inResearch)} במחקר · ${formatCount(activeStations)} עמדות פעילות`,
      tone: DASH_COLORS.muted,
      spark: seriesFromHistory(historyRows, ACTIVE_STATES),
    },
    {
      label: "העמדה העמוסה",
      value: k?.busiestStationName ?? EM_DASH,
      note: isNil(k?._new_busiestStationWorkHours)
        ? "אין שעות עבודה בתקופה"
        : `${formatHours(k?._new_busiestStationWorkHours)} עבודה · ${formatCount(k?.busiestStationCount)} צעדים`,
      tone: DASH_COLORS.red,
      // No daily series exists for "which station was busiest", and a flat
      // placeholder line would read as "steady", which is a claim.
      spark: [],
    },
  ];

  // Both series come from Q2ג on one endpoint, over one population, so the
  // pair needs no joining and no reconciliation — see ThroughputBarChart.
  const throughput: ThroughputPoint[] = React.useMemo(
    () =>
      historyRows.slice(-20).map((day) => ({
        date: day.date,
        started: day._new_workStartedToday,
        finished: day._new_workFinishedToday,
      })),
    [historyRows],
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {cards.map((card) => (
          <div
            key={card.label}
            className="dash-card"
            style={{
              padding: "13px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--color-ink-muted-48)", fontWeight: 600 }}>
                {card.label}
              </div>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: "-0.8px",
                  lineHeight: 1.1,
                  marginTop: 2,
                }}
              >
                {kpis.loading ? <Skeleton variant="text" width="70%" height={30} /> : card.value}
              </div>
              <div style={{ fontSize: 11.5, color: card.tone, fontWeight: 600, marginTop: 2 }}>
                {card.note}
              </div>
            </div>
            <Sparkline points={card.spark} color={card.tone} />
          </div>
        ))}
      </div>

      <DataCard
        chart
        title="תפוקה יומית · 20 ימים"
        subtitle="התחילו = הפעם הראשונה שנגעו בפריט · סיימו = סגירת המסלול · ללא אביזרים"
        right={<Legend items={THROUGHPUT_LEGEND} />}
        error={kpis.error ?? times.error ?? history.error}
        onRetry={data.refresh}
        style={{ flex: 1, minHeight: 0 }}
      >
        <ChartBody style={{ marginTop: 12 }}>
          {throughput.length > 0 ? (
            <ThroughputBarChart data={throughput} />
          ) : (
            <EmptyChart loading={times.loading || history.loading} />
          )}
        </ChartBody>
      </DataCard>
    </div>
  );
}
