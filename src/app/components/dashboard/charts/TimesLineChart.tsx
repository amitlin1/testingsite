"use client";

// §8.6 / §10 — waiting against processing, ON BOTH CLOCKS.
//
// FOUR SERIES, TWO FAMILIES, TWO CLOCKS, AND THE ENCODING IS CONSISTENT:
// colour is the family (blue = המתנה, grey = ביצוע) and dash is the clock
// (solid = ברוטו, dashed = נטו). That is the same encoding the station
// dialog's duration chart uses, so a reader learns it once.
//
// It is also why `ביצוע · ברוטו` is now SOLID where the original spec drew a
// single processing line dashed: once a net twin exists, a dash has to mean the
// clock and nothing else, or the chart says two things with one mark. The gap
// between a solid line and its dashed twin is the calendar (§16.1) — nights,
// weekends and holidays — and it is the whole reason both are drawn.
//
// NO BUCKET IS INVENTED: a bucket exists because something closed in it,
// so a missing day is a gap in the path and never a zero or last week's value
// carried forward (§16.3). `connectNulls={false}` is what enforces that.
//
// The live marker uses the server's `isToday`, stamped on the real
// Asia/Jerusalem business day — never `new Date()` on the client, which names
// yesterday east of Greenwich for part of every day.

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AverageTimesWire } from "@/app/lib/dashboard/api-types";
import { formatMinutes } from "@/app/lib/dashboard/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip, bucketTick } from "./chartConfig";

export interface TimesLineChartProps {
  data: AverageTimesWire[];
  granularity: string;
}

/** The legend for this chart, so the card header and the plot cannot drift. */
export const TIMES_LEGEND = [
  { color: "var(--dash-ramp-1)", label: "המתנה · ברוטו", line: true },
  { color: "var(--dash-ramp-1)", label: "המתנה · נטו", line: true, dashed: true },
  { color: "var(--color-ink-muted-48)", label: "ביצוע · ברוטו", line: true },
  { color: "var(--color-ink-muted-48)", label: "ביצוע · נטו", line: true, dashed: true },
];

export default function TimesLineChart({ data, granularity }: TimesLineChartProps) {
  const rows = React.useMemo(
    () =>
      data.map((point) => ({
        date: point.date,
        isToday: point.isToday === true,
        waitWall: point.avgWaitingMinutes,
        waitWork: point._new_avgWaitingWorkMinutes,
        processingWall: point.avgProcessingMinutes,
        processingWork: point._new_avgProcessingWorkMinutes,
      })),
    [data],
  );

  const todayBucket = rows.find((row) => row.isToday)?.date;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis
          dataKey="date"
          {...AXIS_PROPS}
          tickFormatter={(value: string) => bucketTick(value, granularity)}
          minTickGap={18}
        />
        <YAxis {...AXIS_PROPS} width={34} />
        <Tooltip
          content={({ active, label, payload }) => (
            <RtlTooltip
              active={active}
              title={bucketTick(String(label ?? ""), granularity)}
              rows={(payload ?? []).map((entry) => ({
                label: String(entry.name),
                value: formatMinutes(entry.value as number | null),
                color: String(entry.color ?? ""),
              }))}
            />
          )}
        />
        {/* ONE element for the waiting series, not an Area for the fill plus a
            Line for the stroke. Two series on the same `dataKey` render
            identically but land in the tooltip TWICE, under the same name and
            with the same value — which is what a reader sees as `המתנה · ברוטו`
            printed on two rows. An Area carries its own stroke, so the design's
            2px line over a 7% fill is one series. */}
        <Area
          type="linear"
          dataKey="waitWall"
          name="המתנה · ברוטו"
          stroke="var(--dash-ramp-1)"
          strokeWidth={2}
          fill="var(--dash-ramp-1)"
          fillOpacity={0.07}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="waitWork"
          name="המתנה · נטו"
          stroke="var(--dash-ramp-1)"
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="processingWall"
          name="ביצוע · ברוטו"
          stroke="var(--color-ink-muted-48)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="processingWork"
          name="ביצוע · נטו"
          stroke="var(--color-ink-muted-48)"
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        {todayBucket && (
          <ReferenceLine x={todayBucket} stroke="var(--color-hairline)" strokeDasharray="2 3" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
