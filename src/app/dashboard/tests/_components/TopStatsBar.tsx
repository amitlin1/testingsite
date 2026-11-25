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
//
// The notes are NEUTRAL: no threshold says the queue is bad or the net wait is
// good, so neither is painted amber or green regardless of its value. The one
// coloured note is the link to the stuck items.
//
// The values use tabular numerals: Rubik's digits are proportional, and without
// them the strip jittered sideways on every 60-second refresh.

import * as React from "react";

import { Skeleton } from "@/components/ui";
import { ArrowForward } from "@/components/ui/icons";
import { boardSummary, type KpisView, type StationView } from "@/app/lib/dashboard/contract";
import { STUCK_HOURS, formatCount, formatMinutes, isNil } from "../_lib/format";

export interface TopStatsBarProps {
  kpis: KpisView | null;
  stations: StationView[] | null;
  /** Rows in the slow-items page whose WALL wait has passed STUCK_HOURS. */
  stuckCount: number | null;
  loading: boolean;
  onShowStuck: () => void;
}

interface Cell {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
}

export default function TopStatsBar({
  kpis,
  stations,
  stuckCount,
  loading,
  onShowStuck,
}: TopStatsBarProps) {
  const board = stations ? boardSummary(stations) : null;
  const researchPool = board?.researchPool ?? null;
  const activeStations = board?.activeStations ?? null;

  const cells: Cell[] = [
    {
      label: "בבדיקה עכשיו",
      value: formatCount(kpis?.itemsCurrentlyInTest),
      note: isNil(activeStations) ? "" : `${formatCount(activeStations)} עמדות`,
    },
    {
      label: "ממתינים",
      value: formatCount(kpis?.itemsCurrentlyInQueue),
      // `מזה`, not `ועוד`: itemsCurrentlyInQueue already counts `queued` AND
      // `queued_research`, so the pool is a breakdown of the number above it.
      note: isNil(researchPool) ? "" : `מזה ${formatCount(researchPool)} בבריכת המחקר`,
    },
    {
      label: "המתנה · ברוטו",
      value: formatMinutes(kpis?.averageQueueTimeMinutes),
      note: isNil(kpis?.averageQueueWorkMinutes)
        ? ""
        : `נטו ${formatMinutes(kpis?.averageQueueWorkMinutes)}`,
    },
    {
      label: "מסלולים שנסגרו",
      value: formatCount(kpis?.totalItemsProcessed),
      note: isNil(kpis?.unitsTouched) ? "" : `${formatCount(kpis?.unitsTouched)} יחידות טופלו`,
    },
    {
      label: `תקועים ${STUCK_HOURS} ש׳+`,
      value: formatCount(stuckCount),
      note: (
        <button type="button" onClick={onShowStuck} className="dash-link dash-link--on-dark">
          הצג
          <ArrowForward fontSize={13} aria-hidden />
        </button>
      ),
    },
  ];

  return (
    <div
      className="dash-strip"
      style={{
        background: "var(--color-surface-tile-1)",
        borderRadius: "var(--r-md)",
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
          <div style={{ fontSize: "var(--text-fine)", color: "var(--color-body-muted)", fontWeight: 600 }}>
            {cell.label}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
            <span
              style={{
                fontSize: "var(--text-kpi)",
                fontWeight: 700,
                letterSpacing: "var(--ls-display)",
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {loading ? (
                <Skeleton variant="text" width={54} height={26} animation="pulse" />
              ) : (
                cell.value
              )}
            </span>
            <span style={{ fontSize: "var(--text-fine)", color: "var(--color-body-muted)" }}>{cell.note}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
