// Number, duration and date rendering for the dashboard (§9), plus the tone
// thresholds §8 fixes per column.
//
// The one rule everything here enforces: `null` is a real answer and renders as
// an em dash, never as 0 and never as the string "null%" (§16.3). A caller that
// wants a zero has to say zero.

export const EM_DASH = "—";

/** Rubik renders these; both are palette values from §9 / the build guide. */
export const DASH_COLORS = {
  ink: "var(--color-ink)",
  muted: "var(--color-ink-muted-48)",
  primary: "var(--color-primary)",
  amber: "var(--dash-amber-ink)",
  red: "var(--color-destructive)",
  green: "var(--color-status-approved)",
} as const;

/** The five-step chart ramp (§9). Index 0 is the strongest. */
export const RAMP = [
  "var(--dash-ramp-1)",
  "var(--dash-ramp-2)",
  "var(--dash-ramp-3)",
  "var(--dash-ramp-4)",
  "var(--dash-ramp-5)",
] as const;

export function isNil(v: number | null | undefined): v is null | undefined {
  return v === null || v === undefined || Number.isNaN(v);
}

/** Whole numbers with Hebrew thousands separators. */
export function formatCount(v: number | null | undefined): string {
  if (isNil(v)) return EM_DASH;
  return Math.round(v).toLocaleString("he-IL");
}

/**
 * §9: averages are rounded to whole minutes, never `41.83 דק׳`.
 * Under an hour reads in minutes; under ten hours as hours + minutes; above
 * that the minutes are noise and are dropped.
 */
export function formatMinutes(v: number | null | undefined): string {
  if (isNil(v)) return EM_DASH;
  const total = Math.round(v);
  if (total < 60) return `${total} דק׳`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours >= 10) return `${Math.round(total / 60)} שע׳`;
  return mins === 0 ? `${hours} שע׳` : `${hours} שע׳ ${mins} דק׳`;
}

/**
 * The queue-age form (§8.3): minutes below the hour, one decimal of an hour
 * above it. `גיל התור כרגע` runs in hours, so this is the column that reads it.
 */
export function formatQueueAge(v: number | null | undefined): string {
  if (isNil(v)) return EM_DASH;
  if (v < 60) return `${Math.round(v)} דק׳`;
  return `${(v / 60).toFixed(1)} שע׳`;
}

export function formatHours(v: number | null | undefined, digits = 1): string {
  if (isNil(v)) return EM_DASH;
  return `${v.toFixed(digits)} שע׳`;
}

/** `null%` is never printed; an absent ratio is an em dash (§16.3). */
export function formatPercent(v: number | null | undefined, digits = 0): string {
  if (isNil(v)) return EM_DASH;
  return `${v.toFixed(digits)}%`;
}

/** Dense table dates: `12/08`. */
export function formatShortDate(v: string | null | undefined): string {
  if (!v) return EM_DASH;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Header dates: `23 באוגוסט 2026`. */
export function formatLongDate(v: Date | string | null | undefined): string {
  if (!v) return EM_DASH;
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

/** 24-hour clock, Jerusalem — the `נכון ל-HH:MM` stamp (§8.7). */
export function formatClock(v: string | null | undefined): string {
  if (!v) return EM_DASH;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  });
}

/** `YYYY-MM-DD` for an axis tick, rendered `dd/MM`. */
export function formatDayTick(day: string): string {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

// ---------------------------------------------------------------------------
// Tones. Each threshold belongs to exactly one column, per §8.
// ---------------------------------------------------------------------------

/**
 * §8.3: the age of the OLDEST item still standing in a station type's queue.
 *
 * The thresholds are hours, not minutes, and they are deliberately far above the
 * ones a MEAN age would deserve: this grades the single worst item, so red at
 * two hours would light up every row on the board. Red past a full day, amber
 * past a working day. Both are opening positions — tune them against a week of
 * real numbers.
 */
export const QUEUE_AGE_RED_MIN = 24 * 60;
export const QUEUE_AGE_AMBER_MIN = 8 * 60;

export function queueAgeTone(minutes: number | null | undefined): string {
  if (isNil(minutes)) return DASH_COLORS.muted;
  if (minutes > QUEUE_AGE_RED_MIN) return DASH_COLORS.red;
  if (minutes > QUEUE_AGE_AMBER_MIN) return DASH_COLORS.amber;
  return DASH_COLORS.ink;
}

/** The mean of completed waits keeps the old, minute-scale thresholds. */
export function waitAverageTone(minutes: number | null | undefined): string {
  if (isNil(minutes)) return DASH_COLORS.muted;
  if (minutes > 120) return DASH_COLORS.red;
  if (minutes > 45) return DASH_COLORS.amber;
  return DASH_COLORS.ink;
}

/** §8.4: how long a stuck item has been waiting. Red at 48h, amber at 24h. */
export function stuckTone(minutes: number | null | undefined): string {
  if (isNil(minutes)) return DASH_COLORS.muted;
  if (minutes >= 48 * 60) return DASH_COLORS.red;
  if (minutes >= 24 * 60) return DASH_COLORS.amber;
  return DASH_COLORS.ink;
}

/** §8.5 / §8.8 / §8.9: a completion bar goes amber below 40%. */
export function completionTone(pct: number | null | undefined): string {
  if (isNil(pct)) return DASH_COLORS.muted;
  return pct < 40 ? DASH_COLORS.amber : DASH_COLORS.primary;
}

/**
 * §8.2 delta colouring. `improvement` says which direction is good, because a
 * rising queue and a rising throughput are not the same news.
 */
export function deltaTone(pct: number | null, lowerIsBetter: boolean): string {
  // Under 3% is noise on a lab this size, and colouring it amber turns every
  // trend column into a wall of warnings nobody reads.
  if (isNil(pct) || Math.abs(pct) < FLAT_PCT) return DASH_COLORS.muted;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  if (good) return DASH_COLORS.green;
  return Math.abs(pct) > 20 ? DASH_COLORS.red : DASH_COLORS.amber;
}

/** Below this the movement is reported as flat rather than as a direction. */
export const FLAT_PCT = 3;

/** `▲ 8%` / `▼ 6%` / `— 1%`, or an em dash when there is nothing to compare. */
export function formatDelta(pct: number | null): string {
  if (isNil(pct)) return EM_DASH;
  const rounded = Math.round(pct);
  if (Math.abs(pct) < FLAT_PCT) return `— ${Math.abs(rounded)}%`;
  return `${rounded > 0 ? "▲" : "▼"} ${Math.abs(rounded)}%`;
}

/**
 * Percentage change between two windows. Returns null — not 0 — when the
 * earlier window has no answer to compare against, so the cell reads as an em
 * dash instead of claiming the number held steady.
 */
export function changePct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (isNil(current) || isNil(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * §8.4's `ניסיון` column: `1` / `2 · חזרה` / `3 · אחרי נטישה`. The reason is
 * what tells a retest apart from a restart after the reaper abandoned the step.
 */
export function formatAttempt(attemptNo: number, entryReason: string): { text: string; tone: string } {
  const restart = entryReason === "restart_after_abandonment" || entryReason === "after_abandonment";
  const rework = entryReason === "rework" || entryReason === "returned_to_route" || attemptNo > 1;
  if (restart) return { text: `${attemptNo} · אחרי נטישה`, tone: DASH_COLORS.red };
  if (rework && attemptNo > 1) return { text: `${attemptNo} · חזרה`, tone: DASH_COLORS.amber };
  return { text: String(attemptNo), tone: DASH_COLORS.muted };
}

/**
 * §16.3 — the amber pill's text. `X-Metrics-Ignored-Filters` arrives qualified
 * (`liveBoard:customerId`), so both halves are translated: a reader is told
 * which part of the response could not honour the filter, not just that
 * something was dropped.
 */
const FILTER_LABEL_HE: Record<string, string> = {
  customerId: "לקוח",
  shipmentId: "משלוח",
  itemTypeId: "סוג פריט",
  stationId: "עמדה",
  stationTypeId: "סוג עמדה",
  workerId: "מס׳ עובד",
  itemSerial: "סריאלי",
  parentsOnly: "פריטי אב בלבד",
  scope: "משלוחים פתוחים בלבד",
  dateRange: "טווח תאריכים",
  status: "סטטוס",
};

const SOURCE_LABEL_HE: Record<string, string> = {
  liveBoard: "הלוח החי",
  entityProgress: "מצב הישות",
  finishedCumulative: "מסלולים שנסגרו",
  completionSeries: "עקומת ההשלמה",
  totalItemsProcessed: "מסלולים שנסגרו",
};

export interface IgnoredFilterNotice {
  /** e.g. `הלוח החי אינו מסנן לפי לקוח / סוג פריט` */
  text: string;
  names: string[];
}

export function describeIgnoredFilters(raw: string | null | undefined): IgnoredFilterNotice | null {
  if (!raw) return null;
  const bySource = new Map<string, string[]>();
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [source, name] = entry.includes(":") ? entry.split(":") : ["liveBoard", entry];
    const label = FILTER_LABEL_HE[name] ?? name;
    const list = bySource.get(source) ?? [];
    if (!list.includes(label)) list.push(label);
    bySource.set(source, list);
  }
  if (bySource.size === 0) return null;
  const parts: string[] = [];
  const names: string[] = [];
  for (const [source, labels] of bySource) {
    parts.push(`${SOURCE_LABEL_HE[source] ?? source} אינו מסנן לפי ${labels.join(" / ")}`);
    names.push(...labels);
  }
  return { text: parts.join(" · "), names };
}
