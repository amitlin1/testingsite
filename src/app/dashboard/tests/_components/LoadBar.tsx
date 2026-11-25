"use client";

// The two-segment station bar (§8.3), the single-fill bar and the progress cell
// (§8.5).
//
// All fill from the reading edge — the RIGHT, because the page is RTL — and
// they do it with a plain `flex-direction: row`: in an RTL box a row already
// starts at the right, and in an LTR island it starts at the left, so the track
// never needs to know the direction. (`row-reverse` would start at the LEFT in
// RTL.)
//
// The two numbers of a load bar are never printed as `"44 / 12"`: in RTL the
// browser reorders the run and the reader sees `12 / 44`. They live in their own
// columns instead (build guide §3.1).

import * as React from "react";

import { EM_DASH, formatPercent, isNil, toneMark, toneText, type DashTone } from "../_lib/format";
import { SEGMENT_SEPARATOR, STATE_COLOR } from "./charts/palette";

export interface LoadBarProps {
  /** Items being tested at this station — the strong segment. */
  test: number;
  /** The station TYPE's shared queue — the pale segment. Never summed. */
  queue: number;
  /** Fixed ceiling across the table, so the bars are comparable row to row. */
  ceiling: number;
}

export function LoadBar({ test, queue, ceiling }: LoadBarProps) {
  const max = Math.max(ceiling, 1);
  const testPct = Math.min(100, (test / max) * 100);
  const queuePct = Math.min(100 - testPct, (queue / max) * 100);
  return (
    <div
      aria-hidden
      style={{
        height: 16,
        background: "var(--color-canvas-parchment)",
        borderRadius: 4,
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
      }}
    >
      {/* The same two colours as the legend and every state chart (palette). */}
      <div style={{ width: `${testPct}%`, background: STATE_COLOR.testing }} />
      <div
        style={{
          boxSizing: "border-box",
          width: `${queuePct}%`,
          background: STATE_COLOR.queued,
          // A 1px canvas line where the two segments touch, so the pale queue
          // never reads as part of the test segment.
          borderInlineStart: testPct > 0 && queuePct > 0 ? `1px solid ${SEGMENT_SEPARATOR}` : undefined,
        }}
      />
    </div>
  );
}

/** A parchment track with one fill, `pct` percent of it. */
export function FillBar({
  pct,
  color,
  height,
  style,
}: {
  pct: number;
  color: string;
  height: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={{
        height,
        background: "var(--color-canvas-parchment)",
        borderRadius: 3,
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
        ...style,
      }}
    >
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export interface ProgressCellProps {
  /** `null` is a real answer — no denominator — and prints as an em dash. */
  value: number | null | undefined;
  tone?: DashTone;
}

export function ProgressCell({ value, tone = "primary" }: ProgressCellProps) {
  const width = isNil(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <FillBar pct={width} color={toneMark(tone)} height={6} style={{ flex: 1 }} />
      <span
        style={{
          fontSize: "var(--text-fine)",
          fontWeight: 600,
          // Text in a status colour uses its ink (the bar keeps the fill).
          color: toneText(tone),
          fontVariantNumeric: "tabular-nums",
          minWidth: 34,
          textAlign: "start",
        }}
      >
        {isNil(value) ? EM_DASH : formatPercent(value)}
      </span>
    </div>
  );
}
