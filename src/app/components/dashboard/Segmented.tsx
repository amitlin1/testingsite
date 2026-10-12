"use client";

// The segmented control (§9). The SAME control every time — date range, average
// period, stuck threshold and the history presets — so a manager learns it once
// and never has to ask what a differently-shaped switch does.
//
// Parchment track, 2px inset, the pressed option on white with weight 600,
// the rest muted. No shadow, no border on the active child: the surface change
// is the elevation. Each option is a toggle button (`aria-pressed`), so the
// choice is announced, not only painted; hover and focus live in dashboard.css.

import * as React from "react";

export interface SegmentedProps {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  padding?: string;
  /** Names the group for assistive tech, e.g. "טווח תאריכים". */
  ariaLabel?: string;
}

export default function Segmented({ options, value, onChange, padding = "4px 12px", ariaLabel }: SegmentedProps) {
  return (
    <div className="dash-seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="dash-seg__btn dash-tap"
            style={{ padding }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
