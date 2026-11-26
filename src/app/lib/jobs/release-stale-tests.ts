// The abandoned-test release ("reaper"): the job body shared by the in-app
// timer (stale-tests-timer.ts) and the manual endpoint POST /api/cron/release-stale-tests.

import { Prisma } from "@prisma/client";
import { JOB_NAMES, runJob, type JobOutcome } from "./jobRun";
import type { MetricsReason } from "@/app/lib/metrics/vocabulary";
import { DEFAULT_STALE_AFTER_MINUTES, IN_TEST_STATUSES, ItemStatus, StationStatus } from "@/lib/item-status";

const REASON: MetricsReason = "released_stale";

/**
 * Release abandoned tests — run every 5 minutes by the app itself
 * (stale-tests-timer.ts, started in src/instrumentation.ts); POST
 * /api/cron/release-stale-tests runs the same job by hand.
 *
 * Safety net for the in-test lock: opening a test dialog calls
 * /api/testing/start-test, which locks the item into "in test" (1) / "in
 * research" (5), and the dialog's onClose releases it back to waiting when
 * closed without a submitted result. That release never fires if the worker
 * abandons the tab outright (closed laptop, crash, lost connection) — the
 * item, and its physical test station, would stay locked forever. Run this
 * every few minutes to revert anything that has been sitting in-test /
 * in-research past ITS STATION TYPE'S threshold with no result recorded.
 *
 * THE THRESHOLD IS PER STATION TYPE, NOT GLOBAL. What this endpoint catches is
 * an ABANDONED dialog; it is not a cap on how long a test may take. When a test
 * genuinely runs for hours the item is physically occupying the bench, and
 * keeping that bench locked is the CORRECT answer — releasing it would hand the
 * station to a second item while the first is still in the chamber. How long a
 * test legitimately runs is a property of the station type, so the threshold
 * lives on test_stations_type.stale_after_minutes: minutes with no result
 * before the revert, 0 = never reap this type. Every candidate row is measured
 * against its own type, resolved through
 * item_routes -> test_stations -> test_stations_type. Rows whose type says 0
 * are never selected at all; rows with no station (item_routes.test_station_id
 * is nullable) have no type to ask and take DEFAULT_STALE_AFTER_MINUTES, the
 * column's own DEFAULT — so "unconfigured" means one single thing.
 *
 * Set-based single statement per §4.6:
 * - `due` is the read-only selection. It resolves each candidate's threshold
 *   once (CROSS JOIN LATERAL, so the COALESCE is written once and the planner
 *   evaluates it once) and applies it. The `now` instant still comes from JS
 *   and is still cast to ::timestamp, exactly as the old flat cutoff was — only
 *   the OFFSET became per-row, so the clock semantics against the
 *   timestamp-without-time-zone column are unchanged.
 * - `released` reverts the selected rows and is the only source of truth for
 *   which items were touched.
 * - `recorded` emits one released_stale ledger event per item via
 *   metrics_record(). The per-minute stamp in the event_key makes overlapping
 *   runs a replay no-op; a poison legacy row (in test with no open
 *   route_run) no longer kills the batch — metrics_record's auto-open (§4.2)
 *   opens a run for it.
 * - `freed` returns the stations to "free" in the SAME statement, so
 *   overlapping runs can never flip a station back to free while a worker is
 *   starting a test on it.
 *
 * CORRECTNESS, not style: `freed` consumes `recorded` through array_agg. A
 * plain SELECT CTE is filled lazily, only as far as the outer query demands —
 * a semi-join plan could stop before calling metrics_record() for every row,
 * silently dropping events depending on the planner. An aggregate must consume
 * ALL of its input, so array_agg forces every `recorded` row to execute.
 * (`recorded` is referenced more than once, so PostgreSQL materializes it —
 * evaluated exactly once; the trailing SELECT reads the materialized rows.)
 *
 * Wrapped in runJob (§10.1): the advisory xact lock the reaper never had, plus
 * a job_run row per run. The lock does not replace the set-based statement's own
 * safety — it means two overlapping 5-minute ticks stop competing at all, and
 * the loser is reported as a HEALTHY skip (status "skipped_overlap").
 */
export type ReleaseStaleDetail = { itemIds: string[]; stationsFreed: number };

export async function releaseStaleTestsJob(): Promise<JobOutcome<ReleaseStaleDetail>> {
  const now = new Date();

  return runJob<ReleaseStaleDetail>(
    JOB_NAMES.releaseStaleTests,
    async (tx) => {
      const rows = await tx.$queryRaw<
        { released_count: bigint; item_ids: bigint[] | null; stations_freed: bigint }[]
      >`
        WITH due AS (
          SELECT ir.item_id
            FROM item_routes ir
            -- LEFT, not INNER: test_station_id is nullable, and a row parked
            -- in test with no station must still be reapable. It has no type, so the
            -- COALESCE below gives it DEFAULT_STALE_AFTER_MINUTES.
            LEFT JOIN test_stations ts
                   ON ts.test_station_id = ir.test_station_id
            LEFT JOIN test_stations_type tt
                   ON tt.test_station_type_id = ts.test_station_type_id
            CROSS JOIN LATERAL (
              SELECT COALESCE(tt.stale_after_minutes, ${DEFAULT_STALE_AFTER_MINUTES}) AS minutes
            ) threshold
           WHERE ir.current_status IN (${Prisma.join(IN_TEST_STATUSES)})
             AND ir.processing_start_time IS NOT NULL
             AND ir.finished_at IS NULL
             -- 0 means "this type is never auto-released" — a burn-in chamber, a
             -- research bench that legitimately holds a unit for days. Excluded
             -- here rather than modelled as a huge number, so it stays a
             -- deliberate opt-out and not an arithmetic accident.
             AND threshold.minutes > 0
             AND ir.processing_start_time
                   < ${now}::timestamp - (threshold.minutes * interval '1 minute')
             -- Orphan guard. ir_item_fk ships NOT VALID because item_routes rows
             -- with no items row are proven to exist on the production volume.
             -- metrics_open_run INNER JOINs items, so letting one orphan into
             -- metrics_record raises inside this single statement and rolls back
             -- the ENTIRE batch — the release, every other item's event and the
             -- station frees — forever, since the orphan matches again next run.
             -- The reaper is the floor's safety net; it must never be hostage to
             -- one bad legacy row. Orphans are surfaced by metrics_selfcheck.
             AND EXISTS (SELECT 1 FROM items i WHERE i.item_id = ir.item_id)
        ), released AS (
          UPDATE item_routes
             SET current_status = CASE WHEN current_status = ${ItemStatus.InResearch} THEN ${ItemStatus.AwaitResearch}::int ELSE ${ItemStatus.Queued}::int END,
                 processing_start_time = NULL,
                 queue_start_time = NOW()
           -- item_id is item_routes' primary key, so this is one index probe per
           -- selected row; the joins in "due" are not re-evaluated here.
           WHERE item_id IN (SELECT item_id FROM due)
          RETURNING item_id, current_status, current_route_step, test_station_id
        ), recorded AS (
          SELECT metrics_record(
            ${REASON}::text||':'||r.item_id||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MI'),
            r.item_id,
            CASE WHEN r.current_status = ${ItemStatus.AwaitResearch} THEN 'queued_research' ELSE 'queued' END,
            r.current_route_step, NULL, NULL, NULL, NULL, ${REASON}) AS event_id,
            r.item_id,
            r.test_station_id
          FROM released r
        ), freed AS (
          UPDATE test_stations ts SET status = ${StationStatus.Free}
           WHERE ts.test_station_id = ANY (
             (SELECT array_agg(test_station_id) FROM recorded
               WHERE test_station_id IS NOT NULL)::int[])
          RETURNING ts.test_station_id
        )
        SELECT (SELECT count(*) FROM recorded)         AS released_count,
               (SELECT array_agg(item_id) FROM recorded) AS item_ids,
               (SELECT count(*) FROM freed)            AS stations_freed
      `;

      const result = rows[0];
      return {
        rowsAffected: Number(result?.released_count ?? 0),
        detail: {
          // The released ids ARE the audit trail: this endpoint takes an item
          // away from a worker, and "which ones, when" is the only question
          // asked afterwards. A run big enough to bloat the jsonb is itself the
          // incident the row exists to record.
          itemIds: (result?.item_ids ?? []).map((id) => id.toString()),
          stationsFreed: Number(result?.stations_freed ?? 0),
        },
      };
    },
  );
}
