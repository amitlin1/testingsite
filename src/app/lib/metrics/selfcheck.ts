// metrics_selfcheck() (plan §3.10) and the §10.2 "is this red?" rule.
//
// ONE definition of red, three consumers: the nightly metrics-selfcheck job
// (which records the verdict in job_run.detail), GET /api/health/jobs, and the
// dashboard tile. A tile with its own copy of the thresholds is a tile that
// disagrees with the endpoint the operator checks next.
//
// Nothing here imports a runtime module — the payload types and evaluateHealth()
// are equally usable from the client component that renders the tile.

import type { TransactionClient } from "@/app/lib/prisma";
import type { prisma } from "@/app/lib/prisma";
import type { JobStatus } from "@/app/lib/metrics/jobRun";

export interface SelfcheckRow {
  checkName: string;
  /** bigint in SQL; every check fits a JS number. NULL when the check has no answer. */
  value: number | null;
  detail: string | null;
}

/**
 * The checks whose ONLY healthy value is zero (§10.2 item 3). Everything else
 * metrics_selfcheck returns is a gauge, not an alarm: open_intervals is the live
 * WIP count, calendar_horizon_days has its own floor below, ledger_bytes is
 * capacity, and calendar_sanity_net_minutes is a 455-on-an-ordinary-day sanity
 * print that a legitimate change to the work-hours screen would move — §10.2
 * does not list it, so it is displayed and never reddens the tile.
 *
 * auto_opened_runs is included even though §10.2 phrases it as "grows after the
 * deployment window": nothing here can know that baseline, and after cutover the
 * correct count is 0 — an uncovered writer is exactly what it exists to catch.
 */
export const ANOMALY_CHECKS: readonly string[] = [
  "drift_open",
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

/** Hebrew labels for the checks the tile names out loud. */
const CHECK_LABEL_HE: Record<string, string> = {
  drift_open: "סטיות פתוחות בין הסטטוס הישן ל־ledger",
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

/** One scheduled job's operational state, as /api/health/jobs reports it. */
export interface JobHealthRow {
  jobName: string;
  labelHe: string;
  /** Scheduled period in seconds — the 2× in the staleness rule (§10.2). */
  intervalSeconds: number;
  lastSuccessAt: string | null;
  secondsSinceSuccess: number | null;
  lastRunAt: string | null;
  lastRunStatus: JobStatus | null;
  lastErrorText: string | null;
  lastSuccessRows: number | null;
  /** now() - last_success > interval × 2, or never succeeded at all. */
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

/**
 * Run the 12 checks. STABLE and read-only, so it is equally correct on the base
 * client or inside a job's transaction — the selfcheck job calls it twice in one
 * transaction, before and after its own healing, and both readings are of that
 * transaction's snapshot.
 */
export async function runSelfcheck(
  client: TransactionClient | typeof prisma,
): Promise<SelfcheckRow[]> {
  const rows = await client.$queryRaw<
    { check_name: string; value: bigint | null; detail: string | null }[]
  >`SELECT check_name, value, detail FROM metrics_selfcheck()`;
  return rows.map((r) => ({
    checkName: r.check_name,
    value: r.value === null ? null : Number(r.value),
    detail: r.detail,
  }));
}

export function selfcheckValue(rows: SelfcheckRow[], checkName: string): number | null {
  return rows.find((r) => r.checkName === checkName)?.value ?? null;
}

/** The anomaly rows that are actually non-zero right now. */
export function selfcheckAnomalies(rows: SelfcheckRow[]): SelfcheckRow[] {
  return rows.filter((r) => ANOMALY_CHECKS.includes(r.checkName) && (r.value ?? 0) !== 0);
}

/**
 * The §10.2 verdict. Red when a scheduled job has not succeeded within twice its
 * own period, when the calendar horizon has run short, or when any zero-healthy
 * check is non-zero (drift_open among them).
 *
 * A NULL calendar_horizon_days means there is no current work_calendar_version
 * at all — every work_seconds the ledger writes from now on would be NULL. That
 * is worse than a short horizon, not better, so it counts as red.
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
    reasons.push("אין גרסת לוח עבודה פעילה — work_seconds ייכתב ריק");
  } else if (horizon < MIN_CALENDAR_HORIZON_DAYS) {
    reasons.push(`אופק לוח העבודה ${horizon} ימים (מתחת ל־${MIN_CALENDAR_HORIZON_DAYS})`);
  }

  for (const row of selfcheckAnomalies(checks)) {
    reasons.push(`${checkLabelHe(row.checkName)}: ${row.value}`);
  }

  return { healthy: reasons.length === 0, reasons };
}
