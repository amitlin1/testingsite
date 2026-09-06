"use client";

// §16.5, the top chart of the history overlay: what was in flight, day by day.
//
// Three stacked bands — the queue, the tests, the research — plus ONE ink line
// on its own axis. The line is a different quantity for a station than for the
// other three entities, and the legend says which:
//
//   station                    steps processed THAT DAY. `route_run` has no
//                              station dimension, so a cumulative "finished
//                              here" line would be either wrong or silently
//                              unfiltered.
//   shipment / customer / type closed `route_run`s, cumulative.
//
// A station's queue band is the station TYPE's queue, shared with every other
// station of that type. The legend label carries that, because a band the
// reader takes for "this station's backlog" is a wrong number with a right
// shape.

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HistoryPoint } from "@/app/lib/dashboard/api-types";
import { formatCount, formatDayTick } from "@/app/lib/dashboard/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip } from "./chartConfig";

export interface HistoryStateChartProps {
  points: HistoryPoint[];
  queueLabel: string;
  lineLabel: string;
}

export default function HistoryStateChart({
  points,
  queueLabel,
  lineLabel,
}: HistoryStateChartProps) {
  const hasUnmapped = points.some((p) => p.unmapped > 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayTick} minTickGap={24} />
        <YAxis yAxisId="state" {...AXIS_PROPS} width={34} />
        {/* The line's own scale. On a station it is steps per day against a
            standing population — two quantities that share no unit. */}
        <YAxis yAxisId="line" orientation="right" {...AXIS_PROPS} width={34} />
        <Tooltip
          content={({ active, label, payload }) => (
            <RtlTooltip
              active={active}
              title={formatDayTick(String(label ?? ""))}
              rows={(payload ?? []).map((entry) => ({
                label: String(entry.name),
                value: formatCount(entry.value as number),
                color: String(entry.color ?? ""),
              }))}
            />
          )}
        />
        <Area
          yAxisId="state"
          type="linear"
          dataKey="queue"
          name={queueLabel}
          stackId="s"
          stroke="none"
          fill="var(--dash-ramp-4)"
          isAnimationActive={false}
          connectNulls={false}
        />
        <Area
          yAxisId="state"
          type="linear"
          dataKey="test"
          name="בבדיקה"
          stackId="s"
          stroke="none"
          fill="var(--dash-ramp-1)"
          fillOpacity={0.85}
          isAnimationActive={false}
          connectNulls={false}
        />
        <Area
          yAxisId="state"
          type="linear"
          dataKey="research"
          name="במחקר"
          stackId="s"
          stroke="none"
          fill="var(--dash-ramp-5)"
          isAnimationActive={false}
          connectNulls={false}
        />
        {hasUnmapped && (
          <Area
            yAxisId="state"
            type="linear"
            dataKey="unmapped"
            name="סטטוס לא ממופה"
            stackId="s"
            stroke="none"
            fill="var(--dash-amber-on-dark)"
            isAnimationActive={false}
            connectNulls={false}
          />
        )}
        <Line
          yAxisId="line"
          type="linear"
          dataKey="line"
          name={lineLabel}
          stroke="var(--color-ink)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
