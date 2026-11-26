"use client";

// §8.5.1 — the shipment completion curve, WITH ITS DENOMINATOR.
//
// The ratio comes from `/api/dashboard/stats/completion-history` and is never
// recomputed here: the denominator is the routed population as of each day, and
// `shipments.amount` — an inventory number — is never a denominator for tested
// work. Days before the shipment had anything routed carry no point at all
// rather than a fabricated 0%, so the line simply starts late.
//
// ONE LINE, ONE AXIS (2026-11-26). The denominator MOVES with the day: a run
// opened on the 20th is not part of the 19th's population, so the ratio can
// FALL — not because work was undone, but because new work arrived and has not
// been closed yet. Until 2026-11-26 a grey step line of the runs opened to date
// said that on its own right-hand axis; it was removed on request, so only the
// percentage axis is left. The denominator is still on screen: the tooltip
// prints "closed / opened" for every day, and the section's subtitle and ⓘ say
// in words that a later run lowers the percentage.

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CompletionPoint } from "@/app/lib/dashboard/contract";
import { formatCount, formatDayTick, formatPercent } from "../../_lib/format";
import { AXIS_PROPS, GRID_STROKE, RtlTooltip } from "./chartConfig";

export default function ShipmentCompletionChart({ points }: { points: CompletionPoint[] }) {
  if (points.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--text-small)",
          color: "var(--color-ink-muted-48)",
          direction: "rtl",
        }}
      >
        לא נפתחו מסלולים למשלוח הזה בטווח שנבחר.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDayTick} minTickGap={24} />
        <YAxis {...AXIS_PROPS} width={40} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip
          content={({ active, label, payload }) => {
            const row = payload?.[0]?.payload as CompletionPoint | undefined;
            return (
              <RtlTooltip
                active={active}
                title={formatDayTick(String(label ?? ""))}
                rows={[
                  {
                    label: "השלמה",
                    value: formatPercent(row?.pct ?? null, 1),
                    color: "var(--dash-ramp-1)",
                  },
                  {
                    // Numerator and denominator on one line, so the ratio above
                    // them is checkable rather than taken on faith.
                    label: "נסגרו מתוך שנפתחו",
                    // LRI…PDI isolate the ratio: a spaced "a / b" in the RTL
                    // tooltip is otherwise shown reversed (build guide §3.1).
                    value: `\u2066${formatCount(row?.finished ?? null)} / ${formatCount(row?.routed ?? null)}\u2069`,
                    color: "var(--color-ink-muted-48)",
                  },
                ]}
              />
            );
          }}
        />
        <Line
          type="linear"
          dataKey="pct"
          name="השלמה"
          stroke="var(--dash-ramp-1)"
          strokeWidth={2}
          // A point per measured day: a shipment with one day of history would
          // otherwise draw nothing until hovered.
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--dash-ramp-1)" }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
