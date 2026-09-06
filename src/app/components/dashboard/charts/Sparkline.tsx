"use client";

// The 88x40 sparkline on a KPI card (§8.2 / §10). A plain inline SVG rather
// than a recharts instance — six of these mounting on one tab is the cheaper
// choice, and §10 allows either.
//
// It renders NOTHING when there is no series behind the card. Three of the six
// KPI cards are live counters with no daily history on this deployment, and a
// flat placeholder line would read as "steady", which is a claim.

import * as React from "react";

export interface SparklineProps {
  /** Chronological. `null` breaks the path — a day with no measurement. */
  points: Array<number | null>;
  color: string;
  width?: number;
  height?: number;
}

export default function Sparkline({ points, color, width = 88, height = 40 }: SparklineProps) {
  const path = React.useMemo(() => {
    const values = points.filter((v): v is number => v !== null && !Number.isNaN(v));
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = points.length > 1 ? width / (points.length - 1) : width;
    let d = "";
    let open = false;
    points.forEach((value, index) => {
      if (value === null || Number.isNaN(value)) {
        open = false;
        return;
      }
      const x = Math.round(index * step * 10) / 10;
      const y = Math.round((height - 4 - ((value - min) / span) * (height - 8)) * 10) / 10;
      d += `${open ? " L" : " M"}${x},${y}`;
      open = true;
    });
    return d.trim();
  }, [points, width, height]);

  if (!path) return null;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" style={{ flexShrink: 0, direction: "ltr" }}>
      <path d={path} stroke={color} strokeWidth={1.75} strokeLinejoin="round" fill="none" />
    </svg>
  );
}
