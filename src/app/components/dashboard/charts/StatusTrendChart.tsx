"use client";

// §8.7 — `מגמת סטטוסים · 14 ימים`.
//
// One stacked column per business day, ACTIVE states only. `הסתיים` is absent
// here for the same reason it is absent from the donut: it is a cumulative
// count of closed route_runs, a different metric on a different scale, and
// stacking it would bury every active state under it.

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { StatusHistoryWire } from "@/app/lib/dashboard/api-types";
import { formatCount, formatDayTick } from "@/app/lib/dashboard/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip } from "./chartConfig";
import { stateColor } from "./StatusDonut";

/** Stack order, strongest at the bottom — the design's reading order. */
const STACK: Array<{ key: string; label: string }> = [
  { key: "testing", label: "בבדיקה" },
  { key: "queued", label: "בתור" },
  { key: "queued_research", label: "ממתין למחקר" },
  { key: "in_research", label: "במחקר" },
  { key: "unmapped", label: "סטטוס לא ממופה" },
];

export default function StatusTrendChart({ data }: { data: StatusHistoryWire[] }) {
  const rows = React.useMemo(
    () =>
      data.map((day) => {
        const row: Record<string, number | string> = { date: day.date };
        for (const state of STACK) row[state.key] = 0;
        for (const status of day.statuses) {
          // The cumulative entry rides the same array under its own name; it is
          // a running total and must never be stacked with a snapshot.
          if (status._new_series !== "point_in_time") continue;
          row[status._new_stateKey] = status.count;
        }
        return row;
      }),
    [data],
  );

  // A state that is zero across the whole window adds a legend entry and a
  // colour for nothing; drop it from the stack rather than from the data.
  const present = STACK.filter((state) => rows.some((row) => Number(row[state.key]) > 0));
  const stack = present.length > 0 ? present : STACK.slice(0, 2);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayTick} minTickGap={10} />
        <YAxis {...AXIS_PROPS} width={34} />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,.03)" }}
          content={({ active, label, payload }) => (
            <RtlTooltip
              active={active}
              title={formatDayTick(String(label ?? ""))}
              rows={(payload ?? [])
                .slice()
                .reverse()
                .map((entry) => ({
                  label: String(entry.name),
                  value: formatCount(entry.value as number),
                  color: String(entry.color ?? ""),
                }))}
            />
          )}
        />
        {stack.map((state, index) => (
          <Bar
            key={state.key}
            dataKey={state.key}
            name={state.label}
            stackId="s"
            fill={stateColor(state.key, index)}
            isAnimationActive={false}
            radius={index === stack.length - 1 ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
