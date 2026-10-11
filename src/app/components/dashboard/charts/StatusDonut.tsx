"use client";

// §8.7 — the ACTIVE population at one instant.
//
// `הסתיים` IS NOT A SLICE. A terminal interval never closes, so counting it
// makes the chart a grey 99% "completed" circle after a year and a half. The
// cumulative finished count is a different metric — closed route_runs — and it
// is served by a different endpoint. The card says so on screen, because a
// reader who expects the missing slice must be told where it went.
//
// Colours key off the state (palette.ts, shared with every other state chart),
// and `סטטוס לא ממופה` (§3.1's `unmapped`) always gets its own amber slice: an
// unknown status folded into a neighbour is an unknown nobody ever notices.
// Slices are split by a 1px canvas line so neighbouring ramp steps stay apart.
//
// THE CENTRE NEVER LIES: while the status endpoint has not answered the ring is
// a skeleton, and when it failed the centre reads "—" — never "0 פעילים".

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Skeleton } from "@/components/ui";
import type { StatusWire } from "@/app/lib/dashboard/api-types";
import { formatCount, formatPercent } from "@/app/lib/dashboard/format";
import { RtlTooltip } from "./chartConfig";
import { SEGMENT_SEPARATOR, stateColor } from "./palette";

export { STATE_COLOR, stateColor } from "./palette";

export interface StatusDonutProps {
  data: StatusWire[];
  size: number;
  /** The active total, rendered as absolutely-positioned centre text (§10).
   *  `null` = unknown (the endpoint failed) and prints as an em dash. */
  total: number | null;
  centreLabel: string;
  /** The small donut (overview card): body-size figure, micro label. */
  compact?: boolean;
  /** First load: a skeleton ring instead of an empty circle and a fake 0. */
  loading?: boolean;
}

export default function StatusDonut({
  data,
  size,
  total,
  centreLabel,
  compact = false,
  loading = false,
}: StatusDonutProps) {
  if (loading) {
    return <Skeleton variant="circular" width={size} height={size} style={{ flexShrink: 0 }} />;
  }
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, direction: "ltr" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="statusName"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={data.length > 1 ? 1 : 0}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              stroke={SEGMENT_SEPARATOR}
              strokeWidth={1}
            >
              {data.map((slice, index) => (
                <Cell key={slice._new_stateKey} fill={stateColor(slice._new_stateKey, index)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => (
                <RtlTooltip
                  active={active}
                  rows={(payload ?? []).map((entry) => {
                    const slice = entry.payload as unknown as StatusWire;
                    return {
                      label: slice.statusName,
                      value: `${formatCount(slice.count)} · ${formatPercent(slice.percentage, 1)}`,
                    };
                  })}
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: compact ? "var(--text-body)" : "var(--text-page)",
            fontWeight: 700,
            letterSpacing: "var(--ls-display)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatCount(total)}
        </div>
        <div style={{ fontSize: compact ? "var(--text-micro)" : "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
          {centreLabel}
        </div>
      </div>
    </div>
  );
}
