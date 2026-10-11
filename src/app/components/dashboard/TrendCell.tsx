"use client";

// `▲ 18%` / `▼ 7%` / `— 2%`, coloured by whether the movement is good news.
//
// There is no trend field on any endpoint, and none is invented: the number
// here is this window's value against the SAME endpoint over the window of
// equal length immediately before it (useDashboardData's `*Prev` resources).
// When the earlier window has no answer the cell reads as an em dash — a
// missing comparison is not a flat one.

import * as React from "react";

import { DASH_COLORS, EM_DASH, deltaTone, formatDelta, isNil } from "@/app/lib/dashboard/format";
import { textTone } from "./tone";

export interface TrendCellProps {
  current: number | null | undefined;
  previous: number | null | undefined;
  /** True where a smaller number is the better one — queues, durations. */
  lowerIsBetter?: boolean;
  /** Shown while the comparison window has not answered yet. */
  pending?: boolean;
}

export default function TrendCell({
  current,
  previous,
  lowerIsBetter = false,
  pending = false,
}: TrendCellProps) {
  if (pending) {
    return <span style={{ fontSize: "var(--text-small)", color: DASH_COLORS.muted }}>{EM_DASH}</span>;
  }
  const pct =
    isNil(current) || isNil(previous) || previous === 0
      ? null
      : ((current - previous) / previous) * 100;
  return (
    <span style={{ fontSize: "var(--text-small)", fontWeight: 600, color: textTone(deltaTone(pct, lowerIsBetter)) }}>
      {formatDelta(pct)}
    </span>
  );
}
