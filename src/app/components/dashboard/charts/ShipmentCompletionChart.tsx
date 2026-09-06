"use client";

// §8.5.1 — the shipment completion curve, WITH ITS DENOMINATOR.
//
// The ratio comes from `/api/dashboard/stats/completion-history` and is never
// recomputed here: the denominator is the routed population as of each day, and
// `shipments.amount` — an inventory number — is never a denominator for tested
// work. Days before the shipment had anything routed carry no point at all
// rather than a fabricated 0%, so the line simply starts late.
//
// WHY THERE ARE TWO LINES. The denominator MOVES with the day: a run opened on
// the 20th is not part of the 19th's population. So the blue ratio can FALL —
// not because work was undone, but because new work arrived and has not been
// closed yet. Alone, that reads as a regression. Beside a grey step line of the
// runs opened to date, it reads as what it is: a step up in the denominator.
//
// The grey line is `stepAfter`, not a smoothed line, because it is a cumulative
// COUNT — it changes on the day a run opens and is flat in between, and drawing
// a slope across that gap would invent runs that opened on days nothing opened.
// It has its own right-hand axis: a count and a percentage share no unit.

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

import type { CompletionPoint } from "@/app/lib/dashboard/api-types";
import { formatCount, formatDayTick, formatPercent } from "@/app/lib/dashboard/format";
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
          fontSize: 12.5,
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
        <YAxis yAxisId="pct" {...AXIS_PROPS} width={34} domain={[0, 100]} />
        <YAxis
          yAxisId="runs"
          orientation="right"
          {...AXIS_PROPS}
          width={30}
          allowDecimals={false}
        />
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
                    value: `${formatCount(row?.finished ?? null)} / ${formatCount(row?.routed ?? null)}`,
                    color: "var(--color-ink-muted-48)",
                  },
                ]}
              />
            );
          }}
        />
        <Line
          yAxisId="pct"
          type="linear"
          dataKey="pct"
          name="השלמה"
          stroke="var(--dash-ramp-1)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="runs"
          type="stepAfter"
          dataKey="routed"
          name="מסלולים שנפתחו · מצטבר"
          stroke="var(--color-ink-muted-48)"
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
