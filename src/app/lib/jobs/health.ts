// The §10.2 "is this red?" rule and the GET /api/health/jobs payload — one
// definition with three consumers: the metrics-selfcheck job (a manual tool,
// which records the verdict), the health endpoint, and the dashboard's health strip.
// Client-safe: no runtime import.

/** One row of metrics_selfcheck(). NULL when the check has no answer. */
export interface SelfcheckRow {
  checkName: string;
  value: number | null;
  detail: string | null;
}

export type JobStatus = "running" | "ok" | "failed" | "skipped_overlap";

/**
 * The checks whose ONLY healthy value is zero (§10.2 item 3). The rest of what
 * metrics_selfcheck returns are gauges: open_intervals is the live WIP count,
 * calendar_horizon_days has its own floor below, ledger_bytes is capacity, and
 * calendar_sanity_net_minutes is a 455-on-an-ordinary-day print that a
 * legitimate change on the work-hours screen would move — §10.2 does not list
 * it, so it never reddens the tile.
 *
 * auto_opened_runs is included although §10.2 phrases it as "grows after the
 * deployment window": nothing here knows that baseline, and after cutover the
 * correct count is 0 — an uncovered writer is what it exists to catch.
 */
export const ANOMALY_CHECKS: readonly string[] = [
  "auto_opened_runs",
  "intervals_missing_work_seconds",
  "intervals_stale_calendar",
  "runs_open_past_60d",
  "runs_with_zero_intervals",
  "intervals_at_station_without_station_id",
  "intervals_negative_offhours",
];

/** §10.2: below this many days of calendar horizon the tile goes red. */
export const MIN_CALENDAR_HORIZON_DAYS = 30;

const CHECK_LABEL_HE: Record<string, string> = {
  auto_opened_runs: "מסלולים שנפתחו אוטומטית (כותב לא מכוסה)",
  intervals_missing_work_seconds: "מקטעים סגורים ללא שעות עבודה",
  intervals_stale_calendar: "מקטעים שטרם חושבו מחדש ללוח הנוכחי",
  runs_open_past_60d: "מסלולים פתוחים מעל 60 יום",
  runs_with_zero_intervals: "מסלולים ללא אף מקטע",
  intervals_at_station_without_station_id: "מקטעי עמדה ללא מזהה עמדה",
  intervals_negative_offhours: "שעות מחוץ למשמרת שליליות",
  calendar_horizon_days: "אופק לוח העבודה (ימים)",
};

export function checkLabelHe(checkName: string): string {
  return CHECK_LABEL_HE[checkName] ?? checkName;
}

/** One scheduled job's operational state. */
export interface JobHealthRow {
  jobName: string;
  labelHe: string;
  /** Scheduled period in seconds. */
  intervalSeconds: number;
  lastSuccessAt: string | null;
  secondsSinceSuccess: number | null;
  lastRunAt: string | null;
  lastRunStatus: JobStatus | null;
  lastErrorText: string | null;
  lastSuccessRows: number | null;
  stale: boolean;
}

export interface JobsHealthPayload {
  generatedAt: string;
  healthy: boolean;
  /** Hebrew, one line per reason the tile is red. Empty when healthy. */
  reasons: string[];
  jobs: JobHealthRow[];
  checks: SelfcheckRow[];
}

/** §10.2: no success within twice the job's own period. Never having succeeded
 *  is the worse case, not an exemption. */
export function isStale(intervalSeconds: number, secondsSinceSuccess: number | null): boolean {
  return secondsSinceSuccess === null || secondsSinceSuccess > intervalSeconds * 2;
}

export function selfcheckValue(rows: SelfcheckRow[], checkName: string): number | null {
  return rows.find((r) => r.checkName === checkName)?.value ?? null;
}

/** The zero-healthy checks that are not zero right now. */
export function selfcheckAnomalies(rows: SelfcheckRow[]): SelfcheckRow[] {
  return rows.filter((r) => ANOMALY_CHECKS.includes(r.checkName) && (r.value ?? 0) !== 0);
}

/**
 * The §10.2 verdict: red when a job is stale, when the calendar horizon is short
 * or missing, or when a zero-healthy check is not zero. A NULL horizon means no
 * current work_calendar_version at all — every work_seconds written from now on
 * would be NULL — so it is red, not "unknown".
 */
export function evaluateHealth(
  jobs: JobHealthRow[],
  checks: SelfcheckRow[],
): { healthy: boolean; reasons: string[] } {
  const reasons: string[] = [];

  for (const job of jobs) {
    if (!job.stale) continue;
    reasons.push(
      job.lastSuccessAt === null
        ? `המשימה ${job.labelHe} מעולם לא הסתיימה בהצלחה`
        : `המשימה ${job.labelHe} לא הצליחה מאז ${job.lastSuccessAt}`,
    );
  }

  const horizon = selfcheckValue(checks, "calendar_horizon_days");
  if (horizon === null) {
    reasons.push(
      "אין לוח שעות עבודה, ולכן הנטו לא מחושב. הוא נבנה בעליית השרת ובכל שמירה במסך שעות עבודה — אם ההודעה נשארת, הסיבה ביומן השרת (work calendar sync failed)",
    );
  } else if (horizon < MIN_CALENDAR_HORIZON_DAYS) {
    reasons.push(`אופק לוח העבודה ${horizon} ימים (מתחת ל־${MIN_CALENDAR_HORIZON_DAYS})`);
  }

  for (const row of selfcheckAnomalies(checks)) {
    reasons.push(`${checkLabelHe(row.checkName)}: ${row.value}`);
  }

  return { healthy: reasons.length === 0, reasons };
}
