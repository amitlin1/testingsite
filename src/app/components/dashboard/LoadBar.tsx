"use client";

// The two-segment station bar (§8.3) and the single-fill progress cell (§8.5).
//
// Both fill from the RIGHT, because the page is RTL — and they do it with
// `flex-direction: row-reverse`, not a float or a negative margin. That is the
// one construction that keeps the fill anchored to the reading edge without the
// track needing to know the direction.
//
// The two numbers of a load bar are never printed as `"44 / 12"`: in RTL the
// browser reorders the run and the reader sees `12 / 44`. They live in their own
// columns instead (build guide §3.1).

import * as React from "react";

import { DASH_COLORS, EM_DASH, formatPercent, isNil } from "@/app/lib/dashboard/format";

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
      style={{
        height,
        background: "var(--color-canvas-parchment)",
        borderRadius: 4,
        overflow: "hidden",
        display: "flex",
        flexDirection: "row-reverse",
      }}
    >
      <div style={{ width: `${testPct}%`, background: "var(--dash-ramp-1)" }} />
      <div style={{ width: `${queuePct}%`, background: "var(--dash-ramp-4)" }} />
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
        style={{
          flex: 1,
          height,
          background: "var(--color-canvas-parchment)",
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
          flexDirection: "row-reverse",
        }}
      >
        <div style={{ width: `${width}%`, background: colour }} />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: mutedLabel ? 400 : 600,
          color: mutedLabel ? "var(--color-ink-muted-48)" : colour,
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
