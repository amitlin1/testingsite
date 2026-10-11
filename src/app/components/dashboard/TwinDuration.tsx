"use client";

// A duration and its other clock, both on screen (§16.1: every duration ships
// twice — the real elapsed time and the working-hours time). The column names
// the clock of the main figure; the twin sits under it in muted fine print,
// labelled with its own clock. It used to live in a native `title`, which only
// a mouse could reach.
//
// `more` is for figures that are not the twin (p95, the mean): they stay one
// step away, in a tooltip on a focusable trigger, so the keyboard reaches them
// as well as the mouse.

import * as React from "react";

import { Tooltip } from "@/components/ui";

export interface TwinDurationProps {
  /** The formatted main figure, e.g. `26.3 שע׳`. */
  value: string;
  /** The other clock, already labelled (`נטו 8.1 שע׳`); null when unmeasured. */
  twin?: string | null;
  tone?: string;
  bold?: boolean;
  /** Extra figures for the tooltip, e.g. `p95 20 שע׳ · ממוצע 6 שע׳`. */
  more?: string;
}

export default function TwinDuration({ value, twin, tone, bold = false, more }: TwinDurationProps) {
  const style: React.CSSProperties = { fontWeight: bold ? 600 : undefined, color: tone };
  return (
    <span className="dash-twin">
      {more ? (
        <Tooltip title={more} placement="top">
          <span className="dash-more" tabIndex={0} style={style}>
            {value}
          </span>
        </Tooltip>
      ) : (
        <span style={style}>{value}</span>
      )}
      {twin && <span className="dash-twin__alt">{twin}</span>}
    </span>
  );
}
