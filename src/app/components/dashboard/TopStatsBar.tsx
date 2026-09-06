"use client";

// §7 — the dark strip, rendered on ALL NINE tabs.
//
// The manager never loses sight of the live floor numbers while drilling into a
// tab, so this reads `/api/dashboard/tests/kpis` with the current filters no
// matter which tab is showing.
//
// Every cell here obeys §16.1: a duration names its clock. `המתנה · ברוטו`
// is what the customer experienced and its note carries the work twin — the two
// never share a cell without saying which is which. On dark, links are
// `--color-primary-on-dark`; the action blue is unreadable there.

import * as React from "react";

import { Skeleton } from "@/components/ui";
import type { KpisWire, StationWire } from "@/app/lib/dashboard/api-types";
import { formatCount, formatMinutes, isNil } from "@/app/lib/dashboard/format";

export interface TopStatsBarProps {
  kpis: KpisWire | null;
  stations: StationWire[] | null;
  /** Rows in the slow-items page whose WALL wait has passed 48 hours. */
  stuckCount: number | null;
  loading: boolean;
  onShowStuck: () => void;
}

interface Cell {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  tone: string;
}

export default function TopStatsBar({
  kpis,
  stations,
  stuckCount,
  loading,
  onShowStuck,
}: TopStatsBarProps) {
  // The research pool is station-less and therefore repeats identically on
  // every board row (§8.3). It is read once, never summed.
  const researchPool = stations && stations.length > 0 ? stations[0]._new_researchPoolQueue : null;
  const activeStations = stations
    ? stations.filter((s) => s.itemsInTest > 0 || s._new_itemsInResearch > 0).length
    : null;

  const cells: Cell[] = [
    {
      label: "בבדיקה עכשיו",
      value: formatCount(kpis?.itemsCurrentlyInTest),
      note: isNil(activeStations) ? "" : `${formatCount(activeStations)} עמדות`,
      tone: "var(--color-body-muted)",
    },
    {
      label: "ממתינים",
      value: formatCount(kpis?.itemsCurrentlyInQueue),
      // `מזה`, not `ועוד`: itemsCurrentlyInQueue already counts `queued` AND
      // `queued_research`, so the pool is a breakdown of the number above it.
      note: isNil(researchPool) ? "" : `מזה ${formatCount(researchPool)} בבריכת המחקר`,
      tone: "var(--dash-amber-on-dark)",
    },
    {
      label: "המתנה · ברוטו",
      value: formatMinutes(kpis?.averageQueueTimeMinutes),
      note: isNil(kpis?._new_averageQueueWorkMinutes)
        ? ""
        : `נטו ${formatMinutes(kpis?._new_averageQueueWorkMinutes)}`,
      tone: "var(--dash-green-on-dark)",
    },
    {
      label: "מסלולים שנסגרו",
      value: formatCount(kpis?.totalItemsProcessed),
      note: isNil(kpis?._new_unitsTouched) ? "" : `${formatCount(kpis?._new_unitsTouched)} יחידות טופלו`,
      tone: "var(--color-body-muted)",
    },
    {
      label: "תקועים 48 ש׳+",
      value: formatCount(stuckCount),
      note: (
        <button
          type="button"
          onClick={onShowStuck}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "inherit",
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--color-primary-on-dark)",
            cursor: "pointer",
          }}
        >
          הצג ←
        </button>
      ),
      tone: "var(--color-primary-on-dark)",
    },
  ];

  return (
    <div
      className="dash-strip"
      style={{
        background: "var(--color-surface-tile-1)",
        borderRadius: 12,
        display: "flex",
        color: "var(--color-on-dark)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          style={{ flex: 1, padding: "11px 18px", borderInlineEnd: "1px solid var(--dash-strip-divider)" }}
        >
          <div style={{ fontSize: 11.5, color: "var(--color-body-muted)", fontWeight: 600 }}>
            {cell.label}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.8px", lineHeight: 1.1 }}>
              {loading ? (
                <Skeleton variant="text" width={54} height={28} animation="pulse" />
              ) : (
                cell.value
              )}
            </span>
            <span style={{ fontSize: 11.5, color: cell.tone }}>{cell.note}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
