"use client";

// `▲ 18%` / `▼ 7%` / `— 2%`, coloured by whether the movement is good news.
//
// There is no trend field on any endpoint, and none is invented: the number
// here is this window's value against the SAME endpoint over the window of
// equal length immediately before it (useDashboardData's `*Prev` resources).
// When the earlier window has no answer the cell reads as an em dash — a
// missing comparison is not a flat one.

import * as React from "react";

import { EM_DASH, changePct, deltaTone, formatDelta, toneText } from "../_lib/format";

export interface TrendCellProps {
  current: number | null | undefined;
  previous: number | null | undefined;
  /** Shown while the comparison window has not answered yet. */
  pending?: boolean;
}

export default function TrendCell({ current, previous, pending = false }: TrendCellProps) {
  if (pending) {
    return <span style={{ fontSize: "var(--text-small)", color: toneText("muted") }}>{EM_DASH}</span>;
  }
  const pct = changePct(current, previous);
  return (
    <span style={{ fontSize: "var(--text-small)", fontWeight: 600, color: toneText(deltaTone(pct, false)) }}>
      {formatDelta(pct)}
    </span>
  );
}
