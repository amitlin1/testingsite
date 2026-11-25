"use client";

// §8.2 — the six cards and the throughput chart.
//
// THE SECOND LINE OF A CARD IS NOT ALWAYS A DELTA. On the two duration cards it
// carries the WORK twin and the calendar gap, because a wall-clock average
// without its work twin is a number a manager will read as lab performance when
// it is mostly weekends (§16.1).
//
// `מסלולים שנסגרו`: "finished" is a route_run closure and nothing else.
// `העמדה העמוסה` reads work hours and steps processed.
//
// Two of the live counters already INCLUDE their research half —
// `itemsCurrentlyInQueue` counts `queued` + `queued_research`, and
// `itemsCurrentlyInTest` counts `testing` + `in_research`. So their second line
// says `מזה`, not `ועוד`: the research figure is a breakdown of the number
// above it, not an addition to it.
//
// A NOTE IS COLOURED ONLY WHEN A THRESHOLD SAYS SO. The closed-routes delta has
// one (deltaTone); "waiting now" and "the busiest station" do not, so they read
// in muted ink whatever their value — the busiest station is not an alarm just
// for being the busiest.

import * as React from "react";

import DataCard, { Legend } from "../_components/DataCard";
import Sparkline from "../_components/charts/Sparkline";
import ThroughputBarChart, {
  THROUGHPUT_LEGEND,
  type ThroughputPoint,
} from "../_components/charts/ThroughputBarChart";
import { ChartBody } from "../_components/charts/chartConfig";
import { Skeleton } from "@/components/ui";
import { boardSummary, type StatusHistoryView } from "@/app/lib/dashboard/contract";
import { ACTIVE_STATES, WAITING_STATES, type StateKey } from "@/app/lib/metrics/vocabulary";
import EmptyChart from "../_components/EmptyChart";
import {
  EM_DASH,
  changePct,
  deltaTone,
  formatCount,
  formatDelta,
  formatHours,
  formatMinutes,
  isNil,
  toneMark,
  toneText,
  type DashTone,
} from "../_lib/format";
import type { TabProps } from "./tabTypes";

function seriesFromHistory(rows: StatusHistoryView[], stateKeys: readonly StateKey[]): Array<number | null> {
  const keys: readonly string[] = stateKeys;
  return rows.map((day) =>
    day.statuses
      .filter((s) => s.series === "point_in_time" && keys.includes(s.stateKey))
      .reduce((sum, s) => sum + s.count, 0),
  );
}

interface KpiCard {
  label: string;
  value: string;
  unit?: string;
  note: string;
  tone: DashTone;
  spark: Array<number | null>;
}

export default function KpisTab({ data }: TabProps) {
  const kpis = data.get("kpis");
  const prev = data.get("kpisPrev");
  const times = data.get("times");
  const history = data.get("statusHistory");
  const stations = data.get("stationsLive");

  const k = kpis.data;
  // Until the KPI endpoint answers, a card says nothing — not "אין מדידה בתקופה".
  const kpiPending = kpis.loading || (kpis.data === null && !kpis.error);
  const p = prev.data;
  const timeRows = React.useMemo(() => times.data ?? [], [times.data]);
  const historyRows = React.useMemo(() => history.data ?? [], [history.data]);
  const { researchPool, inResearch, activeStations } = boardSummary(stations.data ?? []);

  const queueGap =
    isNil(k?.averageQueueTimeMinutes) || isNil(k?.averageQueueWorkMinutes)
      ? null
      : (k!.averageQueueTimeMinutes as number) - (k!.averageQueueWorkMinutes as number);

  const closedDelta = changePct(k?.totalItemsProcessed, p?.totalItemsProcessed);

  const cards: KpiCard[] = [
    {
      label: "זמן המתנה ממוצע · ברוטו",
      value: formatMinutes(k?.averageQueueTimeMinutes),
      note: isNil(k?.averageQueueWorkMinutes)
        ? "אין מדידה בתקופה"
        : `נטו ${formatMinutes(k?.averageQueueWorkMinutes)}${
            isNil(queueGap) ? "" : ` · פער ${formatMinutes(queueGap)} מחוץ לשעות`
          }`,
      tone: "muted",
      spark: timeRows.map((row) => row.avgWaitingMinutes),
    },
    {
      label: "זמן ביצוע ממוצע · ברוטו",
      value: formatMinutes(k?.averageProcessingTimeMinutes),
      note: isNil(k?.averageProcessingWorkMinutes)
        ? "אין מדידה בתקופה"
        : `נטו ${formatMinutes(k?.averageProcessingWorkMinutes)}`,
      tone: "muted",
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
      spark: historyRows.map((day) => day.finishedToday),
    },
    {
      label: "ממתינים כרגע",
      value: formatCount(k?.itemsCurrentlyInQueue),
      note: isNil(researchPool)
        ? "כולל את בריכת המחקר"
        : `מזה ${formatCount(researchPool)} בבריכת המחקר`,
      tone: "muted",
      spark: seriesFromHistory(historyRows, WAITING_STATES),
    },
    {
      label: "בבדיקה כרגע",
      value: formatCount(k?.itemsCurrentlyInTest),
      note: `מזה ${formatCount(inResearch)} במחקר · ${formatCount(activeStations)} עמדות פעילות`,
      tone: "muted",
      spark: seriesFromHistory(historyRows, ACTIVE_STATES),
    },
    {
      label: "העמדה העמוסה",
      value: k?.busiestStationName ?? EM_DASH,
      note: isNil(k?.busiestStationWorkHours)
        ? "אין שעות עבודה בתקופה"
        : `${formatHours(k?.busiestStationWorkHours)} עבודה · ${formatCount(k?.busiestStationCount)} צעדים`,
      tone: "muted",
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
        started: day.workStartedToday,
        finished: day.workFinishedToday,
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
              <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", fontWeight: 600 }}>
                {card.label}
              </div>
              <div
                style={{
                  fontSize: "var(--text-kpi)",
                  fontWeight: 700,
                  letterSpacing: "var(--ls-display)",
                  lineHeight: 1.1,
                  marginTop: 2,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {kpiPending ? <Skeleton variant="text" width="70%" height={26} /> : card.value}
              </div>
              <div style={{ fontSize: "var(--text-fine)", color: toneText(card.tone), fontWeight: 600, marginTop: 2 }}>
                {kpiPending ? <Skeleton variant="text" width="80%" height={12} /> : card.note}
              </div>
            </div>
            <Sparkline points={card.spark} color={toneMark(card.tone)} />
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
            <EmptyChart
              loading={times.loading || history.loading || (history.data === null && !history.error)}
              failed={history.data === null && !!history.error}
            />
          )}
        </ChartBody>
      </DataCard>
    </div>
  );
}
