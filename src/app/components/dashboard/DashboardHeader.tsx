"use client";

// §7 — the header row: what you are looking at, what it is scoped to, and how
// old the numbers are.
//
// The chips are the point. From any tab a manager can see the whole filter
// scope in one line and drop any of it with one click — on the eight old pages
// the scope was invisible unless you scrolled back to the filter bar of the
// page you happened to be standing on. They are the app's one filter chip
// (ui Chip with its named × button), the same as on the shipments screen.
//
// `עודכן לפני X שניות` ticks off `lastUpdatedAt` every 5 seconds; it is not a
// second timer against the 60s refresh, just a readout of the same clock.

import * as React from "react";

import { Chip } from "@/components/ui";
import { Download, Refresh } from "@/components/ui/icons";
import type { DashboardFilters } from "@/types/dashboard";

export interface DashboardHeaderProps {
  title: string;
  subtitle: string;
  chips: Array<{ key: keyof DashboardFilters; text: string }>;
  onRemoveChip: (key: keyof DashboardFilters) => void;
  lastUpdatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function useAgeSeconds(at: number | null): number | null {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);
  if (at === null) return null;
  return Math.max(0, Math.round((now - at) / 1000));
}

export default function DashboardHeader({
  title,
  subtitle,
  chips,
  onRemoveChip,
  lastUpdatedAt,
  refreshing,
  onRefresh,
}: DashboardHeaderProps) {
  const age = useAgeSeconds(lastUpdatedAt);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-heading)",
            fontWeight: 700,
            letterSpacing: "var(--ls-display)",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </h1>
        <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", whiteSpace: "nowrap" }}>
          {subtitle}
        </div>
        {chips.map((chip) => (
          <Chip
            key={String(chip.key)}
            size="small"
            color="primary"
            label={chip.text}
            onDelete={() => onRemoveChip(chip.key)}
            style={{ alignSelf: "center" }}
          />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--text-fine)",
            color: "var(--color-ink-muted-48)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "var(--r-pill)",
              background: "var(--color-status-approved)",
            }}
          />
          {age === null ? "טוען נתונים" : `עודכן לפני ${age} שניות`}
        </div>

        {/* §17 — no table export util exists in the repo yet, so the button
            states that rather than pretending to be wired. Same shape as
            רענן beside it: one button vocabulary per row. */}
        <button type="button" disabled title="ייצוא — בקרוב" className="dash-btn">
          <span className="dash-icon">
            <Download fontSize={14} aria-hidden />
          </span>
          ייצוא
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing || undefined}
          className="dash-btn dash-btn--primary"
        >
          <span className="dash-icon">
            <Refresh fontSize={14} aria-hidden />
          </span>
          רענן
        </button>
      </div>
    </div>
  );
}
