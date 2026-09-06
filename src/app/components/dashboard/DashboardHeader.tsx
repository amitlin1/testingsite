"use client";

// §7 — the header row: what you are looking at, what it is scoped to, and how
// old the numbers are.
//
// The chips are the point. From any tab a manager can see the whole filter
// scope in one line and drop any of it with one click — on the eight old pages
// the scope was invisible unless you scrolled back to the filter bar of the
// page you happened to be standing on.
//
// `עודכן לפני X שניות` ticks off `lastUpdatedAt` every 5 seconds; it is not a
// second timer against the 60s refresh, just a readout of the same clock.

import * as React from "react";

import { Download, Refresh } from "@/components/ui/icons";
import { Clear } from "@/components/ui/icons";
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
        <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-0.5px", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)", whiteSpace: "nowrap" }}>
          {subtitle}
        </div>
        {chips.map((chip) => (
          <button
            key={String(chip.key)}
            type="button"
            onClick={() => onRemoveChip(chip.key)}
            className="dash-press"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "var(--dash-tint)",
              color: "var(--color-primary)",
              border: "none",
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: "inherit",
              borderRadius: 9999,
              padding: "3px 10px",
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            {chip.text}
            <Clear fontSize={11} />
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: "var(--color-ink-muted-48)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 9999,
              background: "var(--color-status-approved)",
            }}
          />
          {age === null ? "טוען נתונים" : `עודכן לפני ${age} שניות`}
        </div>

        {/* §17 — no table export util exists in the repo yet, so the button
            states that rather than pretending to be wired. */}
        <button
          type="button"
          disabled
          title="בקרוב"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--color-canvas)",
            border: "1px solid var(--color-hairline)",
            borderRadius: 8,
            padding: "6px 11px",
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: "inherit",
            color: "var(--color-ink-muted-48)",
            cursor: "not-allowed",
          }}
        >
          <span className="dash-icon">
            <Download fontSize={14} />
          </span>
          ייצוא
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="dash-press"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "var(--color-primary)",
            color: "var(--color-on-primary)",
            border: "none",
            borderRadius: 9999,
            padding: "7px 15px",
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: refreshing ? "default" : "pointer",
            opacity: refreshing ? 0.7 : 1,
          }}
        >
          <span className="dash-icon">
            <Refresh fontSize={14} />
          </span>
          רענן
        </button>
      </div>
    </div>
  );
}
