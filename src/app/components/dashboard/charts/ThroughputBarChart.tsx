"use client";

// §8.2 — the daily throughput bars: work BEGUN against work COMPLETED.
//
//   התחילו   `_new_workStartedToday` — runs whose FIRST active-work interval
//            opened that day. That is the moment somebody first put hands on the
//            item, at its first station.
//   סיימו    `_new_workFinishedToday` — runs that CLOSED that day, at their last
//            station. `route_run.closed_at` is the one definition of finished.
//
// Both come from Q2ג on tests/status-distribution/history, over ONE population
// with accessories excluded from both sides — an accessory is auto-passed and
// never worked on (18% of runs on this database). The two bars are therefore
// directly comparable to each other, which is the entire point of putting them
// on one axis, and deliberately not comparable to the KPI card's
// `מסלולים שנסגרו`, which counts every run.
//
// Reading it: bars that track each other mean the floor is keeping up. A run of
// days where `התחילו` outruns `סיימו` is work-in-progress piling up, and it will
// surface as queue age a few days later.

import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatCount, formatDayTick } from "@/app/lib/dashboard/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip } from "./chartConfig";
import { SERIES_COLOR } from "./palette";

export interface ThroughputPoint {
  date: string;
  /** Runs whose first work opened that day. */
  started: number | null;
  /** Runs that closed that day. */
  finished: number | null;
}

export const THROUGHPUT_LEGEND = [
  { color: SERIES_COLOR.started, label: "התחילו עבודה" },
  { color: SERIES_COLOR.finished, label: "סיימו מסלול" },
];

export default function ThroughputBarChart({ data }: { data: ThroughputPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayTick} minTickGap={12} />
        <YAxis {...AXIS_PROPS} width={34} />
        <Tooltip
          cursor={{ fill: "color-mix(in srgb, var(--color-ink) 3%, transparent)" }}
          content={({ active, label, payload }) => (
            <RtlTooltip
              active={active}
              title={formatDayTick(String(label ?? ""))}
              rows={(payload ?? []).map((entry) => ({
                label: String(entry.name),
                value: formatCount(entry.value as number | null),
                color: String(entry.color ?? ""),
              }))}
            />
          )}
        />
        <Bar
          dataKey="started"
          name="התחילו עבודה"
          fill={SERIES_COLOR.started}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="finished"
          name="סיימו מסלול"
          fill={SERIES_COLOR.finished}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
