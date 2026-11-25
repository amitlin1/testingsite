"use client";

// The amber notice line, and the one it most often carries: the server narrowed
// the requested window (§16.3), so the window it actually served is shown —
// driven by the X-Metrics-Period-Capped header, never by comparing dates here.

import * as React from "react";

import { Info } from "@/components/ui/icons";
import { formatDayTick } from "../_lib/format";

/** A boxed amber line in the dashboard's main column. */
export function AmberNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flexShrink: 0,
        fontSize: "var(--text-fine)",
        color: "var(--dash-amber-ink)",
        background: "var(--dash-amber-tint)",
        border: "1px solid var(--dash-amber-hairline)",
        borderRadius: "var(--r-sm)",
        padding: "5px 12px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * `lead · הוצג dd/MM – dd/MM במקום הטווח שהתבקש`. `band` is the history
 * dialog's form: a full-width strip under its header, with an info glyph.
 */
export function CappedPeriodNotice({
  lead,
  from,
  to,
  band = false,
}: {
  lead: string;
  from: string | null;
  to: string | null;
  band?: boolean;
}) {
  const text = `${lead} · הוצג ${formatDayTick(from ?? "")} – ${formatDayTick(to ?? "")} במקום הטווח שהתבקש`;
  if (!band) return <AmberNotice>{text}</AmberNotice>;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 20px",
        background: "var(--dash-amber-tint)",
        borderBottom: "1px solid var(--dash-amber-hairline)",
        fontSize: "var(--text-fine)",
        color: "var(--dash-amber-ink)",
        flexShrink: 0,
      }}
    >
      <span className="dash-icon">
        <Info fontSize={13} strokeWidth={2} aria-hidden />
      </span>
      {text}
    </div>
  );
}
