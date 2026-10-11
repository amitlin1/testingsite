"use client";

// The two-segment station bar (§8.3) and the single-fill progress cell (§8.5).
//
// Both fill from the reading edge — the RIGHT, because the page is RTL — and
// they do it with a plain `flex-direction: row`: in an RTL box a row already
// starts at the right, and in an LTR island it starts at the left, so the track
// never needs to know the direction. (These used `row-reverse`, which in RTL
// starts at the LEFT — the opposite of what this comment always promised.)
//
// The two numbers of a load bar are never printed as `"44 / 12"`: in RTL the
// browser reorders the run and the reader sees `12 / 44`. They live in their own
// columns instead (build guide §3.1).

import * as React from "react";

import { DASH_COLORS, EM_DASH, formatPercent, isNil } from "@/app/lib/dashboard/format";
import { SEGMENT_SEPARATOR, STATE_COLOR } from "./charts/palette";
import { textTone } from "./tone";

export interface LoadBarProps {
  /** Items being tested at this station — the strong segment. */
  test: number;
  /** The station TYPE's shared queue — the pale segment. Never summed. */
  queue: number;
  /** Fixed ceiling across the table, so the bars are comparable row to row. */
  ceiling: number;
  height?: number;
}

export function LoadBar({ test, queue, ceiling, height = 16 }: LoadBarProps) {
  const max = Math.max(ceiling, 1);
  const testPct = Math.min(100, (test / max) * 100);
  const queuePct = Math.min(100 - testPct, (queue / max) * 100);
  return (
    <div
      aria-hidden
      style={{
        height,
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

export interface ProgressCellProps {
  /** `null` is a real answer — no denominator — and prints as an em dash. */
  value: number | null | undefined;
  tone?: string;
  height?: number;
  /** Utilisation reads muted; completion reads in its tone. */
  mutedLabel?: boolean;
}

export function ProgressCell({ value, tone, height = 6, mutedLabel = false }: ProgressCellProps) {
  const colour = tone ?? DASH_COLORS.primary;
  const width = isNil(value) ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        aria-hidden
        style={{
          flex: 1,
          height,
          background: "var(--color-canvas-parchment)",
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
          flexDirection: "row",
        }}
      >
        <div style={{ width: `${width}%`, background: colour }} />
      </div>
      <span
        style={{
          fontSize: "var(--text-fine)",
          fontWeight: mutedLabel ? 400 : 600,
          // Text in a status colour uses its ink (the bar keeps the fill).
          color: mutedLabel ? "var(--color-ink-muted-48)" : textTone(colour),
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
