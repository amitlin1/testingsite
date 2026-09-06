"use client";

// §16.5, the lower chart of the history overlay: the durations that CLOSED on
// each day, on both clocks.
//
// Colour is the family, dash is the clock — the same encoding as the averages
// chart on the זמנים ממוצעים tab:
//
//   המתנה · ברוטו   solid blue     what the customer experienced
//   המתנה · נטו     dashed blue    the part inside working hours
//   ביצוע · ברוטו   solid grey
//   ביצוע · נטו     dashed grey
//
// The gap between a line and its dashed twin is the calendar, not the lab.
//
// A day on which nothing closed BREAKS THE PATH. `connectNulls={false}` is the
// whole point of this chart: the ledger writes null, not zero, for a day with
// no measurement (§16.3), and a joined line would draw a wait that nobody had.
// The footnote under the dialog says this in words.
//
// Only the station dialog has this chart. The other three entity histories are
// counts, and §16.1 pairs DURATIONS — there is no clock pair to draw, so none
// is invented.

import * as React from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { HistoryPoint } from "@/app/lib/dashboard/api-types";
import { formatDayTick, formatMinutes } from "@/app/lib/dashboard/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip } from "./chartConfig";

export default function HistoryDurationChart({ points }: { points: HistoryPoint[] }) {
  const rows = React.useMemo(
    () =>
      points.map((point) => ({
        date: point.date,
        waitWall: point.wait.wall,
        waitWork: point.wait.work,
        handleWall: point.handle.wall,
        handleWork: point.handle.work,
      })),
    [points],
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayTick} minTickGap={24} />
        <YAxis {...AXIS_PROPS} width={34} />
        <Tooltip
          content={({ active, label, payload }) => (
            <RtlTooltip
              active={active}
              title={formatDayTick(String(label ?? ""))}
              rows={(payload ?? []).map((entry) => ({
                label: String(entry.name),
                value: formatMinutes(entry.value as number | null),
                color: String(entry.color ?? ""),
              }))}
            />
          )}
        />
        <Line
          type="linear"
          dataKey="waitWall"
          name="המתנה · ברוטו"
          stroke="var(--dash-ramp-1)"
          strokeWidth={2}
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
          dataKey="handleWall"
          name="ביצוע · ברוטו"
          stroke="var(--color-ink-muted-48)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="handleWork"
          name="ביצוע · נטו"
          stroke="var(--color-ink-muted-48)"
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
