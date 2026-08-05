"use client";
import * as React from "react";
import type { ResolvedDay } from "@/lib/workHours/types";

/* ---------- Shifthouse tokens (single action blue, no shadows) ---------- */
export const INK = "#1d1d1f";
export const BODY = "#444";
export const MUTED = "#7a7a7a";
export const FAINT = "#9a9aa0";
export const HAIRLINE = "#e0e0e0";
export const SOFT = "#f5f5f7";
export const DIVIDER = "#f0f0f0";
export const BLUE = "#0066cc";
export const TINT = "rgba(0,102,204,0.09)";
export const DANGER = "#bf3535";

export const card: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 18,
};

export const WEEKDAY_HEADERS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
export const EM_DASH = "—";

/**
 * Wrap any RANGE of clock/date values so RTL never flips it to "15:35–07:00".
 * A single time or date does not need this.
 */
export function Bdi({ children }: { children: React.ReactNode }) {
  return (
    <bdi dir="ltr" style={{ unicodeBidi: "isolate" }}>
      {children}
    </bdi>
  );
}

/** "07:00" + "15:35" → "07:00–15:35" (already LTR-isolated by <Bdi>). */
export function timeRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  return `${start}–${end}`;
}

/** "2026-09-04" → "4.9" (day.month, no leading zeros — matches the mock). */
export function dayDotMonth(dateISO: string): string {
  const [, m, d] = dateISO.split("-").map(Number);
  return `${d}.${m}`;
}

/** day-of-month number for a calendar cell. */
export function dayNum(dateISO: string): number {
  return Number(dateISO.split("-")[2]);
}

/** "ספטמבר 2026" for the calendar header. */
export function monthTitle(year: number, month0: number): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(
    new Date(year, month0, 1),
  );
}

/** Break clause for a working day's detail line. */
function breakClause(d: ResolvedDay): string {
  return d.breakStart && d.breakEnd
    ? `הפסקה ${d.breakStart}–${d.breakEnd}`
    : "ללא הפסקה";
}

/**
 * The muted second line under a record in the "החודש" list and inside cells.
 * Ranges are returned bare; callers wrap them with <Bdi> where rendered.
 */
export function recordDetail(d: ResolvedDay): string {
  if (d.isWorking && d.start && d.end) {
    return `${d.start}–${d.end} · ${breakClause(d)}`;
  }
  switch (d.category) {
    case "full_off":
      return "יום מלא · חג";
    case "vacation":
      return "יום מלא";
    case "eve":
      return "ללא עבודה · ניתן לפתוח עד 12:00";
    case "shabbat":
      return "לא עובדים";
    default:
      return "לא עובדים";
  }
}
