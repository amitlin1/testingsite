"use client";

// The segmented control (§9). The SAME control every time — date range, average
// period, stuck threshold and the history presets — so a manager learns it once
// and never has to ask what a differently-shaped switch does.
//
// Parchment track, 2px inset, active child on white with weight 600, inactive
// muted. No shadow, no border on the active child: the surface change is the
// elevation.

import * as React from "react";

export interface SegmentedProps {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  padding?: string;
}

export default function Segmented({ options, value, onChange, padding = "4px 12px" }: SegmentedProps) {
  return (
    <div
      style={{
        display: "flex",
        background: "var(--color-canvas-parchment)",
        borderRadius: 8,
        padding: 2,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className="dash-tap"
            style={{
              flex: 1,
              padding,
              fontSize: 11.5,
              fontWeight: active ? 600 : 400,
              color: active ? "var(--color-ink)" : "var(--color-ink-muted-48)",
              background: active ? "var(--color-canvas)" : "transparent",
              borderRadius: 6,
              border: "none",
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
