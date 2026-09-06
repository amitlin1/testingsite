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

import DataCard, { Legend } from "@/app/components/dashboard/DataCard";
import DenseTable, { type Column } from "@/app/components/dashboard/DenseTable";
import Segmented from "@/app/components/dashboard/Segmented";
import { ChartBody } from "@/app/components/dashboard/charts/chartConfig";
import TimesLineChart, { TIMES_LEGEND } from "@/app/components/dashboard/charts/TimesLineChart";
import type { AverageTimesWire, StationWire } from "@/app/lib/dashboard/api-types";
import { formatCount, formatMinutes, isNil, waitAverageTone } from "@/app/lib/dashboard/format";
import type { AverageTimesPeriod } from "@/types/dashboard";
import type { TabProps } from "./tabTypes";

const PERIODS: Array<{ value: AverageTimesPeriod; label: string }> = [
  { value: "daily", label: "יומי" },
  { value: "monthly", label: "חודשי" },
  { value: "quarterly", label: "רבעוני" },
];

export const CLOCK_NOTE = "שעון ברוטו = מה שהלקוח חווה · שעון נטו = הזמן בשעות העבודה";

/**
 * The waiting population's size per station type. by-station reports the type's
 * total wait hours and its average, and both come from the SAME filtered rows
 * (one FILTER clause governs count, avg and sum in Q4), so `n = total / average`
 * is exact arithmetic rather than an estimate. It is derived here only because
 * the route does not serialise the count itself — a `_new_typeWaitRecordCount`
 * field would make this a read instead of a division.
 */
export function waitRecordCount(row: StationWire): number | null {
  const hours = row._new_typeWaitWallHours;
  const avg = row._new_typeWaitAvgWallMinutes;
  if (isNil(hours) || isNil(avg) || avg <= 0) return null;
  return Math.round((hours * 60) / avg);
}

export default function TimesTab({ api, data }: TabProps) {
  const times = data.get<AverageTimesWire[]>("times");
  const stations = data.get<StationWire[]>("stationsLive");

  const columns: Array<Column<StationWire>> = [
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
      sortValue: (r) => r._new_typeWaitAvgWallMinutes,
      render: (r) => (
        <span style={{ fontWeight: 600, color: waitAverageTone(r._new_typeWaitAvgWallMinutes) }}>
          {formatMinutes(r._new_typeWaitAvgWallMinutes)}
        </span>
      ),
    },
    {
      key: "waitWork",
      header: "המתנה · נטו",
      numeric: true,
      sortValue: (r) => r._new_typeWaitAvgWorkMinutes,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatMinutes(r._new_typeWaitAvgWorkMinutes)}
        </span>
      ),
    },
    {
      key: "busyWall",
      header: "ביצוע · ברוטו",
      numeric: true,
      sortValue: (r) => r._new_avgBusyWallMinutes,
      render: (r) => formatMinutes(r._new_avgBusyWallMinutes),
    },
    {
      key: "busyWork",
      header: "ביצוע · נטו",
      numeric: true,
      sortValue: (r) => r._new_avgBusyWorkMinutes,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatMinutes(r._new_avgBusyWorkMinutes)}
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
        isNil(r._new_avgBusyWallMinutes) || isNil(r._new_avgBusyWorkMinutes)
          ? null
          : r._new_avgBusyWallMinutes - r._new_avgBusyWorkMinutes,
      render: (r) =>
        isNil(r._new_avgBusyWallMinutes) || isNil(r._new_avgBusyWorkMinutes)
          ? formatMinutes(null)
          : formatMinutes(r._new_avgBusyWallMinutes - r._new_avgBusyWorkMinutes),
    },
    {
      key: "n",
      header: "רשומות · ביצוע",
      numeric: true,
      sortValue: (r) => r._new_durationRecordCount,
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>
          {formatCount(r._new_durationRecordCount)}
        </span>
      ),
    },
    {
      key: "nWait",
      header: "רשומות · המתנה",
      numeric: true,
      sortValue: (r) => waitRecordCount(r),
      render: (r) => (
        <span style={{ color: "var(--color-ink-muted-48)" }}>{formatCount(waitRecordCount(r))}</span>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <DataCard
        chart
        title="זמן המתנה מול זמן ביצוע"
        right={
          <>
            <Legend items={TIMES_LEGEND} />
            <Segmented
              options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
              value={api.state.period}
              onChange={(value) => api.setPeriod(value as AverageTimesPeriod)}
              padding="4px 14px"
            />
          </>
        }
        error={times.error}
        onRetry={data.refresh}
        style={{ flex: 1, minHeight: 0 }}
      >
        <ChartBody style={{ marginTop: 10 }}>
          {times.data && times.data.length > 0 ? (
            <TimesLineChart data={times.data} granularity={api.state.period} />
          ) : (
            <EmptyChart loading={times.loading} />
          )}
        </ChartBody>
      </DataCard>

      <DataCard
        panel
        title="פירוט לפי עמדה · ממוצע בתקופה"
        right={
          <span style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>
            {CLOCK_NOTE} · דלי נוצר רק אם נסגר בו משהו
          </span>
        }
        note="עמודות ההמתנה שייכות לסוג העמדה — הן חוזרות בכל שורות אותו סוג ואין לסכם אותן. ״רשומות · ביצוע״ אינו כולל אביזרים, ״רשומות · המתנה״ כן."
        error={stations.error}
        style={{ height: 190, flexShrink: 0 }}
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

export function EmptyChart({ loading }: { loading: boolean }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12.5,
        color: "var(--color-ink-muted-48)",
        direction: "rtl",
      }}
    >
      {loading ? "טוען נתונים" : "לא נסגר דבר בטווח שנבחר, ולכן אין דליים להציג."}
    </div>
  );
}
