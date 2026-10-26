"use client";
import React from "react";
import { ArrowLeft, Flag } from "lucide-react";
import type { NextStationResult } from "@/types";
import { HAIR, HAIR_2, INK, MUTED } from "@/app/components/packages/packageUi";

/**
 * "העמדה הבאה" on a package wizard's done step. The page's next-station dialog
 * tells where a single item goes after its result; a box's opening or closing
 * records one result per item and then the box's, so the wizard's own done step
 * lists them all — each row from its own POST /api/testing/results answer.
 * Station names come from the DB (the answer), never from here.
 */

/** Where a row goes next: a station, the end of its route, or unknown (no answer). */
export type NextStop =
  | { kind: "station"; name: string }
  | { kind: "end" }
  | { kind: "unknown" };

/** A result answer as a NextStop. */
export function nextStopOf(result: NextStationResult | null | undefined | void): NextStop {
  if (!result) return { kind: "unknown" };
  if (result.isLastStation) return { kind: "end" };
  const name = result.nextStation?.testStationDesc?.trim();
  return name ? { kind: "station", name } : { kind: "unknown" };
}

export const NEXT_STATION_TEXT = {
  title: "העמדה הבאה",
  end: "סוף המסלול",
  unknown: "לא ידוע",
  allEnd: "אין עמדה הבאה — המארז והפריטים שבו סיימו את המסלול.",
} as const;

export function nextStopText(stop: NextStop): string {
  if (stop.kind === "station") return stop.name;
  return stop.kind === "end" ? NEXT_STATION_TEXT.end : NEXT_STATION_TEXT.unknown;
}

export type NextStopRow = {
  key: string;
  /** "00" for the box, the item's package_seq otherwise. */
  badge: string;
  label: string;
  stop: NextStop;
  /** A second line under the station ("ממתין לפריטים"). */
  note?: string;
};

/** The done step's list: one row per box / item, its next station at the end. When every row ends
 *  its route, one line says so instead of a list of "סוף המסלול". */
export function NextStationList({ rows }: { rows: NextStopRow[] }) {
  if (rows.length === 0) return null;
  if (rows.every((r) => r.stop.kind === "end")) {
    return (
      <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, fontSize: 14.5, color: INK, fontWeight: 600 }}>
        <Flag size={17} strokeWidth={1.9} aria-hidden style={{ color: MUTED }} />
        {NEXT_STATION_TEXT.allEnd}
      </div>
    );
  }
  return (
    <section aria-label={NEXT_STATION_TEXT.title} style={{ width: "100%", maxWidth: 480, marginTop: 22, textAlign: "start" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 6 }}>{NEXT_STATION_TEXT.title}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${HAIR}`, borderRadius: 12, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <li
            key={r.key}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i === 0 ? undefined : `1px solid ${HAIR_2}` }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, fontVariantNumeric: "tabular-nums", minWidth: 20 }}>{r.badge}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
            <ArrowLeft size={15} strokeWidth={1.9} aria-hidden style={{ color: MUTED, flex: "none" }} />
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0, maxWidth: "50%" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: r.stop.kind === "unknown" ? MUTED : INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                {nextStopText(r.stop)}
              </span>
              {r.note && <span style={{ fontSize: 12, color: MUTED }}>{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
