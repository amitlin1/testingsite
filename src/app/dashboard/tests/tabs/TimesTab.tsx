"use client";

// §8.6 — waiting against processing, and the per-station detail underneath.
//
// TWO DENOMINATORS, TWO COLUMNS. The processing average excludes accessories
// (their testing interval is a synthetic ~0-length pair); the waiting average
// keeps them, because an accessory really does wait. One `רשומות` column would
// be a lie for one of the two averages.
//
// NO BUCKET IS INVENTED. A bucket exists because something closed in it: no
// gap-filling, no carry-forward, and `connectNulls={false}` on every series.
// `isToday` comes from the server, stamped on the real Asia/Jerusalem business
// day — `new Date()` on the client names yesterday east of Greenwich.
//
// THE WAITING ROWS ARE GROUPED BY STATION TYPE. A waiting item carries no
// station at all, only the type it is queued for, so those four columns repeat
// across the stations of a type exactly as `בתור (סוג)` does on the board.

import * as React from "react";

import DataCard, { Legend } from "../_components/DataCard";
import DenseTable, { type Column } from "../_components/DenseTable";
import EmptyChart from "../_components/EmptyChart";
import Segmented from "../_components/Segmented";
import { ChartBody, bucketTick } from "../_components/charts/chartConfig";
import DurationChart, {
  DURATION_CHART_MODES,
  averageTimesRows,
  durationLegend,
  type DurationChartMode,
} from "../_components/charts/DurationChart";
import type { StationView } from "@/app/lib/dashboard/contract";
import { formatCount, formatMinutes, isNil, toneText, waitAverageTone } from "../_lib/format";
import { AVERAGE_TIMES_PERIODS, type AverageTimesPeriod } from "../_lib/state";
import type { TabProps } from "./tabTypes";
import CardInfo from "../_components/CardInfo";
import { EXPLAIN } from "../_lib/explain";

const PERIOD_LABEL: Record<AverageTimesPeriod, string> = {
  daily: "יומי",
  monthly: "חודשי",
  quarterly: "רבעוני",
};

const CLOCK_NOTE = "שעון ברוטו = מה שהלקוח חווה · שעון נטו = הזמן בשעות העבודה";

export default function TimesTab({ api, data }: TabProps) {
  const times = data.get("times");
  const stations = data.get("stationsLive");
  // Bars by default (2026-11-26); the switch beside the legend draws lines.
  const [mode, setMode] = React.useState<DurationChartMode>("bar");
  const timeRows = React.useMemo(() => averageTimesRows(times.data ?? []), [times.data]);

  const columns: Array<Column<StationView>> = [
    {
      key: "name",
      header: "עמדה",
      sortValue: (r) => r.stationName,
      render: (r) => <span style={{ fontWeight: 600 }}>{r.stationName}</span>,
    },
    {
      key: "waitWall",
      header: "המתנה · ברוטו",
      numeric: true,
      sortValue: (r) => r.typeWaitAvgWallMinutes,
      render: (r) => (
        <span style={{ fontWeight: 600, color: toneText(waitAverageTone(r.typeWaitAvgWallMinutes)) }}>
          {formatMinutes(r.typeWaitAvgWallMinutes)}
        </span>
      ),
    },
    {
      key: "waitWork",
      header: "המתנה · נטו",
      numeric: true,
      sortValue: (r) => r.typeWaitAvgWorkMinutes,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatMinutes(r.typeWaitAvgWorkMinutes)}
        </span>
      ),
    },
    {
      key: "busyWall",
      header: "ביצוע · ברוטו",
      numeric: true,
      sortValue: (r) => r.avgBusyWallMinutes,
      render: (r) => formatMinutes(r.avgBusyWallMinutes),
    },
    {
      key: "busyWork",
      header: "ביצוע · נטו",
      numeric: true,
      sortValue: (r) => r.avgBusyWorkMinutes,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatMinutes(r.avgBusyWorkMinutes)}
        </span>
      ),
    },
    {
      key: "offhours",
      header: "מחוץ לשעות",
      numeric: true,
      secondary: true,
      // Wall minus work — "how much of the delay was the calendar" (§16.1).
      sortValue: (r) =>
        isNil(r.avgBusyWallMinutes) || isNil(r.avgBusyWorkMinutes)
          ? null
          : r.avgBusyWallMinutes - r.avgBusyWorkMinutes,
      render: (r) =>
        isNil(r.avgBusyWallMinutes) || isNil(r.avgBusyWorkMinutes)
          ? formatMinutes(null)
          : formatMinutes(r.avgBusyWallMinutes - r.avgBusyWorkMinutes),
    },
    {
      key: "n",
      header: "רשומות · ביצוע",
      numeric: true,
      sortValue: (r) => r.durationRecordCount,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatCount(r.durationRecordCount)}
        </span>
      ),
    },
    {
      key: "nWait",
      header: "רשומות · המתנה",
      numeric: true,
      sortValue: (r) => r.typeWaitRecordCount,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>{formatCount(r.typeWaitRecordCount)}</span>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <DataCard
        chart
        title={<>זמן המתנה מול זמן ביצוע<CardInfo explain={EXPLAIN.timesChart} /></>}
        subtitle="ממוצע בשעות"
        right={
          <>
            <Legend items={durationLegend(mode)} />
            <Segmented
              options={DURATION_CHART_MODES}
              value={mode}
              onChange={(value) => setMode(value === "line" ? "line" : "bar")}
              padding="4px 12px"
              ariaLabel="סוג הגרף"
            />
            <Segmented
              options={AVERAGE_TIMES_PERIODS.map((period) => ({ value: period, label: PERIOD_LABEL[period] }))}
              value={api.state.period}
              onChange={(value) => {
                const period = AVERAGE_TIMES_PERIODS.find((p) => p === value);
                if (period) api.setPeriod(period);
              }}
              padding="4px 14px"
              ariaLabel="רזולוציית הגרף"
            />
          </>
        }
        error={times.error}
        onRetry={data.refresh}
        style={{ flex: 3, minHeight: 0 }}
      >
        <ChartBody style={{ marginTop: 10 }}>
          {times.data && times.data.length > 0 ? (
            <DurationChart
              rows={timeRows}
              mode={mode}
              tick={(bucket) => bucketTick(bucket, api.state.period)}
            />
          ) : (
            <EmptyChart
              loading={times.loading || (times.data === null && !times.error)}
              failed={times.data === null && !!times.error}
            />
          )}
        </ChartBody>
      </DataCard>

      <DataCard
        panel
        title={<>פירוט לפי עמדה · ממוצע בתקופה<CardInfo explain={EXPLAIN.timesTable} /></>}
        right={
          <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
            {CLOCK_NOTE} · דלי נוצר רק אם נסגר בו משהו
          </span>
        }
        note="עמודות ההמתנה שייכות לסוג העמדה — הן חוזרות בכל שורות אותו סוג ואין לסכם אותן. ״רשומות · ביצוע״ אינו כולל אביזרים, ״רשומות · המתנה״ כן."
        error={stations.error}
        onRetry={data.refresh}
        // A share of the column rather than a fixed 190px (about two rows on a
        // tall screen); 190 stays as the floor.
        style={{ flex: 2, minHeight: 190 }}
      >
        <DenseTable
          columns={columns}
          rows={stations.data}
          rowKey={(row) => row.stationId}
          loading={stations.loading}
          defaultSort={{ key: "waitWall", dir: "desc" }}
          skeletonRows={4}
          empty={{ text: "אין עמדות שמתאימות למסננים האלה." }}
        />
      </DataCard>
    </div>
  );
}
