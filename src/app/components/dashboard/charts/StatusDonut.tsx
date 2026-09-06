"use client";

// §8.7 — the ACTIVE population at one instant.
//
// `הסתיים` IS NOT A SLICE. A terminal interval never closes, so counting it
// makes the chart a grey 99% "completed" circle after a year and a half. The
// cumulative finished count is a different metric — closed route_runs — and it
// is served by a different endpoint. The card says so on screen, because a
// reader who expects the missing slice must be told where it went.
//
// Colours key off the state, and `סטטוס לא ממופה` (§3.1's `unmapped`) always
// gets its own amber slice: an unknown status folded into a neighbour is an
// unknown nobody ever notices.

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { StatusWire } from "@/app/lib/dashboard/api-types";
import { formatCount, formatPercent } from "@/app/lib/dashboard/format";
import { RtlTooltip } from "./chartConfig";

/** state_key → slice colour. The ramp, plus amber for the unmapped state. */
export const STATE_COLOR: Record<string, string> = {
  queued: "var(--dash-ramp-2)",
  testing: "var(--dash-ramp-1)",
  queued_research: "var(--dash-ramp-3)",
  in_research: "var(--dash-ramp-5)",
  unmapped: "var(--dash-amber-on-dark)",
};

export function stateColor(stateKey: string, index: number): string {
  return STATE_COLOR[stateKey] ?? `var(--dash-ramp-${Math.min(5, index + 1)})`;
}

export interface StatusDonutProps {
  data: StatusWire[];
  size: number;
  /** The active total, rendered as absolutely-positioned centre text (§10). */
  total: number;
  centreLabel: string;
  centreSize?: number;
}

export default function StatusDonut({
  data,
  size,
  total,
  centreLabel,
  centreSize = 32,
}: StatusDonutProps) {
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
              paddingAngle={0}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              stroke="none"
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
        <div style={{ fontSize: centreSize, fontWeight: 700, letterSpacing: "-0.8px" }}>
          {formatCount(total)}
        </div>
        <div style={{ fontSize: centreSize < 20 ? 9.5 : 12, color: "var(--color-ink-muted-48)" }}>
          {centreLabel}
        </div>
      </div>
    </div>
  );
}
