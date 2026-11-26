"use client";

// The board's duration charts — the זמנים ממוצעים tab and the station dialog —
// waiting against processing, ON BOTH CLOCKS, IN HOURS.
//
// Since 2026-11-26 (on request):
//  - the vertical axis is HOURS on every duration chart of the board, and says
//    so — the minutes it used to plot carried no unit at all;
//  - the default is a BAR chart, with a switch to lines (`mode`), because a
//    window of one or two days drew no visible line;
//  - the families are two hues: waiting = the queue's amber, processing = the
//    testing blue (charts/palette.ts DURATION_COLOR) — the same colours those
//    states have everywhere else on the board.
//
// The clock is the shade (bars) or the dash (lines): ברוטו full / solid, נטו
// lighter / dashed. The gap between a series and its net twin is the calendar
// — nights, weekends and holidays — and it is the whole reason both are drawn.
//
// NO BUCKET IS INVENTED: a bucket exists because something closed in it, so a
// missing day is an empty slot (bars) or a gap in the path (lines,
// `connectNulls={false}`), never a zero or last week's value carried forward
// (§16.3). The live marker uses the server's `isToday`, stamped on the real
// Asia/Jerusalem business day.

import * as React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AverageTimesView, HistoryPoint } from "@/app/lib/dashboard/contract";
import { formatMinutes, isNil } from "../../_lib/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip } from "./chartConfig";
import { DURATION_COLOR } from "./palette";

export type DurationChartMode = "bar" | "line";

/** The bars / line switch, for a Segmented control. Bars first: the default. */
export const DURATION_CHART_MODES: Array<{ value: DurationChartMode; label: string }> = [
  { value: "bar", label: "עמודות" },
  { value: "line", label: "קו" },
];

/** One bucket, in MINUTES (the wire's unit); the chart draws hours. */
export interface DurationRow {
  date: string;
  isToday?: boolean;
  waitWall: number | null;
  waitWork: number | null;
  handleWall: number | null;
  handleWork: number | null;
}

const SERIES = [
  { key: "waitWall", name: "המתנה · ברוטו", stroke: DURATION_COLOR.wait, fill: DURATION_COLOR.wait, net: false },
  { key: "waitWork", name: "המתנה · נטו", stroke: DURATION_COLOR.wait, fill: DURATION_COLOR.waitNet, net: true },
  { key: "handleWall", name: "ביצוע · ברוטו", stroke: DURATION_COLOR.processing, fill: DURATION_COLOR.processing, net: false },
  { key: "handleWork", name: "ביצוע · נטו", stroke: DURATION_COLOR.processing, fill: DURATION_COLOR.processingNet, net: true },
] as const;

/** The legend for a mode, so the card header and the plot cannot drift. */
export function durationLegend(mode: DurationChartMode) {
  return SERIES.map((s) =>
    mode === "bar"
      ? { color: s.fill, label: s.name }
      : { color: s.stroke, label: s.name, line: true, dashed: s.net },
  );
}

/** The averages endpoint's buckets as chart rows. */
export function averageTimesRows(data: AverageTimesView[]): DurationRow[] {
  return data.map((point) => ({
    date: point.date,
    isToday: point.isToday === true,
    waitWall: point.avgWaitingMinutes,
    waitWork: point.avgWaitingWorkMinutes,
    handleWall: point.avgProcessingMinutes,
    handleWork: point.avgProcessingWorkMinutes,
  }));
}

/** The station history's days as chart rows. */
export function historyDurationRows(points: HistoryPoint[]): DurationRow[] {
  return points.map((point) => ({
    date: point.date,
    isToday: point.isToday,
    waitWall: point.wait.wall,
    waitWork: point.wait.work,
    handleWall: point.handle.wall,
    handleWork: point.handle.work,
  }));
}

const toHours = (minutes: number | null | undefined): number | null => (isNil(minutes) ? null : minutes / 60);

/** Axis ticks: whole hours as they are, a fraction to one decimal. */
function hoursTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function DurationChart({
  rows,
  mode,
  tick,
}: {
  rows: DurationRow[];
  mode: DurationChartMode;
  /** The X axis's label for a bucket. */
  tick: (bucket: string) => string;
}) {
  const data = React.useMemo(
    () =>
      rows.map((row) => ({
        date: row.date,
        isToday: row.isToday === true,
        waitWall: toHours(row.waitWall),
        waitWork: toHours(row.waitWork),
        handleWall: toHours(row.handleWall),
        handleWork: toHours(row.handleWork),
      })),
    [rows],
  );

  const todayBucket = data.find((row) => row.isToday)?.date;
  // A lone point between gaps draws no line at all; give it a dot.
  const lone = data.length === 1;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={1} barCategoryGap="20%">
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={tick} minTickGap={18} />
        <YAxis
          {...AXIS_PROPS}
          width={48}
          tickFormatter={hoursTick}
          label={{
            value: "שעות",
            angle: -90,
            position: "insideLeft",
            offset: 4,
            style: { textAnchor: "middle", fontSize: 11, fill: "var(--color-ink-muted-48)" },
          }}
        />
        <Tooltip
          cursor={mode === "bar" ? { fill: "var(--color-divider-soft)" } : undefined}
          content={({ active, label, payload }) => (
            <RtlTooltip
              active={active}
              title={tick(String(label ?? ""))}
              rows={(payload ?? []).map((entry) => {
                const series = SERIES.find((s) => s.key === entry.dataKey);
                const hours = entry.value as number | null;
                return {
                  label: String(entry.name),
                  value: formatMinutes(isNil(hours) ? null : hours * 60),
                  color: series ? (mode === "bar" ? series.fill : series.stroke) : String(entry.color ?? ""),
                };
              })}
            />
          )}
        />
        {mode === "bar"
          ? SERIES.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.fill}
                maxBarSize={22}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            ))
          : SERIES.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stroke={s.stroke}
                strokeWidth={2}
                strokeDasharray={s.net ? "4 3" : undefined}
                dot={lone ? { r: 3, strokeWidth: 0, fill: s.stroke } : false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
        {todayBucket && <ReferenceLine x={todayBucket} stroke="var(--color-hairline)" strokeDasharray="2 3" />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
