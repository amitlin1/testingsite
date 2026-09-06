"use client";

// Shared recharts configuration (§10). recharts ^3 is already a dependency —
// no second charting library, and no MUI charts.
//
// Two rules that are easy to lose and expensive to lose:
//
//  - `connectNulls={false}` EVERYWHERE. A day on which nothing closed carries
//    null in every duration field (§16.3); the line has to break there. Joining
//    across it draws a measurement that was never taken.
//  - `isAnimationActive={false}`. The 60s refresh replaces the data in place,
//    and an animation would replay the whole series every minute (§12.5).
//
// Charts are LTR islands: the container is `direction: ltr` so the time axis
// runs left to right, matching the design reference, while the labels stay
// Hebrew. The page around them stays RTL.

import * as React from "react";

import { formatDayTick } from "@/app/lib/dashboard/format";

export const GRID_STROKE = "var(--color-divider-soft)";

export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: "#7a7a7a" },
} as const;

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/**
 * The RTL tooltip (§10): white, one hairline, 8px radius, no shadow. Content is
 * built by the caller so each chart can label its own clock — an unlabelled
 * duration is the ambiguity §16.1 forbids.
 */
export function RtlTooltip({
  active,
  title,
  rows,
}: {
  active?: boolean;
  title?: string;
  rows?: TooltipRow[];
}) {
  if (!active || !rows || rows.length === 0) return null;
  // Two rows under one label is never information — it means a chart bound two
  // series to the same `dataKey` (an Area for the fill and a Line for the
  // stroke is the way that happens). Collapse them here so the mistake is
  // invisible to the reader even if it is reintroduced upstream.
  const unique = rows.filter(
    (row, i) => rows.findIndex((other) => other.label === row.label) === i,
  );
  return (
    <div
      dir="rtl"
      style={{
        background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12.5,
        fontFamily: "var(--font-text)",
        color: "var(--color-ink)",
        boxShadow: "none",
      }}
    >
      {title && (
        <div style={{ fontWeight: 600, marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
          {title}
        </div>
      )}
      {unique.map((row) => (
        <div
          key={row.label}
          style={{ display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}
        >
          {row.color && (
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: row.color, flexShrink: 0 }}
            />
          )}
          <span style={{ color: "var(--color-ink-muted-48)" }}>{row.label}</span>
          <span style={{ marginInlineStart: "auto", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** `2026-08-23` on a daily grid, `2026-08` on a monthly one. */
export function bucketTick(value: string, granularity: string): string {
  if (granularity === "daily") return formatDayTick(value);
  if (value.length >= 7) return value.slice(0, 7).split("-").reverse().join("/");
  return value;
}

/** Every chart body: `flex:1; min-height:0` plus the LTR island. */
export function ChartBody({
  children,
  height,
  style,
}: {
  children: React.ReactNode;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="dash-chart"
      style={height ? { flex: "none", height, minHeight: height, ...style } : style}
    >
      {children}
    </div>
  );
}
