/**
 * Instants on the wire, on screen and in printed documents. Timestamps are stored in UTC and
 * travel as ISO 8601 strings ending in Z; screens and documents show them in the business timezone.
 */

import { BUSINESS_TZ } from "@/lib/time/civil";

/** A Date or a date string as a UTC ISO string; null for nothing or an invalid date. */
export function normalizeToUtcIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A UTC ISO string in the business timezone ("25/11/2025, 21:45:00" by default); null for nothing or an
 *  invalid date — each formatter below prints its own blank. */
function localText(utcIsoString: string | null | undefined, options?: Intl.DateTimeFormatOptions): string | null {
  if (!utcIsoString) return null;
  const date = new Date(utcIsoString);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: BUSINESS_TZ,
    ...options,
  }).format(date);
}

const DATE_ONLY: Intl.DateTimeFormatOptions = { hour: undefined, minute: undefined, second: undefined };
const EM_DASH = "—";

/** "25/11/2025, 21:45:00"; "—" for nothing or an invalid date. */
export function formatDateTime(utcIsoString: string | null | undefined): string {
  return localText(utcIsoString) ?? EM_DASH;
}

/** "25/11/2025"; "-" for nothing or an invalid date. */
export function formatDate(utcIsoString: string | null | undefined): string {
  return localText(utcIsoString, DATE_ONLY) ?? "-";
}

/** The item screens' moment (items table and dialog, files panel, item history, report
 *  templates): date + time without seconds; "—" for nothing or an invalid date. */
export function formatMoment(iso: string | null | undefined): string {
  return localText(iso, { second: undefined }) ?? EM_DASH;
}

/** The item screens' day (table columns, the route stepper); "—" for nothing or an invalid date. */
export function formatDay(iso: string | null | undefined): string {
  return localText(iso, DATE_ONLY) ?? EM_DASH;
}

/** "12m 30s" (short) or "01:23:45" (long); "-" for nothing or a negative duration. */
export function formatDuration(milliseconds: number | null | undefined, format: "short" | "long" = "long"): string {
  if (milliseconds === null || milliseconds === undefined || isNaN(milliseconds) || milliseconds < 0) return "-";

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (format === "short") {
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

type DateInput = Date | string | null | undefined;

function docPartsOf(d: DateInput): { date: string; time: string } | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toLocaleDateString("he-IL", { timeZone: BUSINESS_TZ, day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "."),
    time: date.toLocaleTimeString("he-IL", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit" }),
  };
}

/** A printed document's date (item reports, shipment documents): "dd.mm.yyyy", or
 *  "dd.mm.yyyy · HH:mm" with the time; "—" when there is no date. */
export function formatDocDate(d: DateInput, withTime = false): string {
  const p = docPartsOf(d);
  if (!p) return "—";
  return withTime ? `${p.date} · ${p.time}` : p.date;
}

/** A printed document's date and time apart (a report's step columns); "—" and "" when there is no date. */
export function docDateParts(d: DateInput): { date: string; time: string } {
  return docPartsOf(d) ?? { date: "—", time: "" };
}
