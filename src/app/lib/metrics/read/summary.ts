// The managers' summary screen (/dashboard): two statements, every number on
// it defined here once.
//
// THE WINDOW (business days, both ends inclusive) — what happened in it:
//   shipments in   received_at (else the certificate date) fell in the window
//                  — the same receipt moment Q7's ship turnaround starts from.
//   shipments out  is_sent and finished_at fell in the window — the moment
//                  lib/shipments/save.ts writes when a shipment is sent.
//   boxes in       a box's FIRST route run opened in the window (intake gives
//                  the box its route; a box still pending has no run).
//   boxes out      a box that had been taken in, in a shipment sent in the window.
//   pass / fail    per ITEM (never a box) whose run closed in the window, the
//                  report's overall verdict (item-report overallVerdict): failed
//                  as soon as any step failed, passed when every decided step
//                  passed. A run with no decided step has no verdict and is
//                  counted apart, never folded into either side.
//   route time     per BOX whose run closed in the window, opened_at → closed_at
//                  on both clocks (§5.0(10)), averaged over the SAME runs: a run
//                  outside the work calendar's horizon has no work figure, and
//                  is left out of both averages rather than only one.
//
// NOW — the open shipments (is_sent IS NOT TRUE) as they stand:
//   every items row of an open shipment, with the open interval of its latest
//   route run. A shipment is ready to go back when every top-level unit (a box,
//   or a loose item) is `done`; a pending box (no run) keeps it in work.
//   Items are counted from the moment they exist — intake creates them.
//
// "Finished" is route_run.closed_at with is_trusted, as everywhere (§5.3ב).

import { cnt, num, run, type Built, type MetricsClient } from "./sql";
import type { BusinessDay } from "./period";

/** Items rows that are items: inside a box, or loose — never the box itself. */
const IS_ITEM = (rr: string, t: string) => `(${rr}.is_package_item OR NOT ${t}.is_package)`;

export function buildSummaryPeriod(from: BusinessDay, to: BusinessDay): Built {
  const sql = `
WITH ship AS (
  SELECT count(*) FILTER (WHERE business_date(COALESCE(s.received_at, s.shipment_date AT TIME ZONE 'UTC'))
                                BETWEEN $1::date AND $2::date)                        AS shipments_in,
         count(*) FILTER (WHERE s.is_sent AND business_date(s.finished_at)
                                BETWEEN $1::date AND $2::date)                        AS shipments_out
  FROM shipments s
), box_in AS (
  SELECT count(*) AS boxes_in
  FROM route_run rr
  JOIN item_types t ON t.item_type_id = rr.item_type_id AND t.is_package
  WHERE rr.run_no = 1 AND NOT rr.is_package_item
    AND business_date(rr.opened_at) BETWEEN $1::date AND $2::date
    AND EXISTS (SELECT 1 FROM items b WHERE b.item_id = rr.item_id)
), box_out AS (
  SELECT count(*) AS boxes_out
  FROM items b
  JOIN item_types t ON t.item_type_id = b.item_type_id AND t.is_package
  JOIN shipments s  ON s.id = b.shipment_id
  WHERE b.package_id IS NULL AND s.is_sent
    AND business_date(s.finished_at) BETWEEN $1::date AND $2::date
    AND EXISTS (SELECT 1 FROM route_run rr WHERE rr.item_id = b.item_id)
), verdict AS (
  -- A result belongs to the run of the event it was written with (call site
  -- #14); a result written before the ledger has no event and falls back to
  -- the run's own time span.
  SELECT rr.route_run_id,
         count(tr.*) FILTER (WHERE tr.passed IS NOT NULL) AS decided,
         count(tr.*) FILTER (WHERE tr.passed = false)     AS failed
  FROM route_run rr
  JOIN item_types t ON t.item_type_id = rr.item_type_id
  LEFT JOIN test_results tr ON tr.item_id = rr.item_id
   AND (tr.state_event_id IN (SELECT e.event_id FROM item_state_event e WHERE e.route_run_id = rr.route_run_id)
        OR (tr.state_event_id IS NULL AND tr.created_at BETWEEN rr.opened_at AND rr.closed_at))
  WHERE rr.closed_at IS NOT NULL AND rr.is_trusted
    AND ${IS_ITEM("rr", "t")}
    AND business_date(rr.closed_at) BETWEEN $1::date AND $2::date
  GROUP BY rr.route_run_id
), quality AS (
  SELECT count(*) FILTER (WHERE failed > 0)                 AS items_failed,
         count(*) FILTER (WHERE failed = 0 AND decided > 0) AS items_passed,
         count(*) FILTER (WHERE decided = 0)                AS items_undecided
  FROM verdict
), box_time AS (
  SELECT count(*)                                          AS boxes_finished,
         count(x.work_s)                                   AS boxes_timed,
         avg(x.wall_s) FILTER (WHERE x.work_s IS NOT NULL) AS route_wall_s,
         avg(x.work_s)                                     AS route_work_s
  FROM (
    SELECT EXTRACT(EPOCH FROM (rr.closed_at - rr.opened_at)) AS wall_s,
           work_seconds_between(rr.opened_at, rr.closed_at)  AS work_s
    FROM route_run rr
    JOIN item_types t ON t.item_type_id = rr.item_type_id AND t.is_package
    WHERE NOT rr.is_package_item AND rr.closed_at IS NOT NULL AND rr.is_trusted
      AND business_date(rr.closed_at) BETWEEN $1::date AND $2::date
  ) x
)
SELECT * FROM ship, box_in, box_out, quality, box_time`;
  return { sql, params: [from, to] };
}

export interface SummaryPeriodRow {
  shipments_in: number;
  shipments_out: number;
  boxes_in: number;
  boxes_out: number;
  items_passed: number;
  items_failed: number;
  items_undecided: number;
  boxes_finished: number;
  boxes_timed: number;
  route_wall_s: number | null;
  route_work_s: number | null;
}

export async function summaryPeriod(client: MetricsClient, from: BusinessDay, to: BusinessDay): Promise<SummaryPeriodRow> {
  const [r = {}] = await run(client, buildSummaryPeriod(from, to));
  return {
    shipments_in: cnt(r.shipments_in),
    shipments_out: cnt(r.shipments_out),
    boxes_in: cnt(r.boxes_in),
    boxes_out: cnt(r.boxes_out),
    items_passed: cnt(r.items_passed),
    items_failed: cnt(r.items_failed),
    items_undecided: cnt(r.items_undecided),
    boxes_finished: cnt(r.boxes_finished),
    boxes_timed: cnt(r.boxes_timed),
    route_wall_s: num(r.route_wall_s),
    route_work_s: num(r.route_work_s),
  };
}

export function buildSummaryNow(): Built {
  const sql = `
WITH units AS (
  SELECT it.shipment_id,
         (it.package_id IS NOT NULL OR NOT t.is_package) AS is_item,
         it.package_id IS NULL AS is_top,
         cur.state_key
  FROM shipments s
  JOIN items it     ON it.shipment_id = s.id
  JOIN item_types t ON t.item_type_id = it.item_type_id
  -- One probe per row: the latest run (route_run_uq), then its open interval (isi_run).
  LEFT JOIN LATERAL (
    SELECT ii.state_key
    FROM (SELECT rr.route_run_id FROM route_run rr
          WHERE rr.item_id = it.item_id ORDER BY rr.run_no DESC LIMIT 1) r
    JOIN item_state_interval ii ON ii.route_run_id = r.route_run_id AND upper_inf(ii.valid_range)
    LIMIT 1
  ) cur ON true
  WHERE s.is_sent IS NOT TRUE
), ready AS (
  -- COALESCE: bool_and skips NULLs, and a pending box (no run, no state) must
  -- keep its shipment in work, not vanish from the vote.
  SELECT count(*) AS shipments_ready
  FROM (SELECT shipment_id FROM units WHERE is_top
        GROUP BY shipment_id HAVING bool_and(COALESCE(state_key = 'done', false))) x
)
SELECT (SELECT count(*) FROM shipments s WHERE s.is_sent IS NOT TRUE)                    AS shipments_open,
       (SELECT shipments_ready FROM ready)                                                AS shipments_ready,
       count(*) FILTER (WHERE is_item)                                                    AS items_total,
       count(*) FILTER (WHERE is_item AND state_key = 'queued')                           AS items_waiting,
       count(*) FILTER (WHERE is_item AND state_key = 'testing')                          AS items_in_work,
       count(*) FILTER (WHERE is_item AND state_key IN ('queued_research', 'in_research')) AS items_in_research,
       count(*) FILTER (WHERE is_item AND state_key = 'done')                             AS items_ready
FROM units`;
  return { sql, params: [] };
}

export interface SummaryNowRow {
  shipments_open: number;
  shipments_ready: number;
  items_total: number;
  items_waiting: number;
  items_in_work: number;
  items_in_research: number;
  items_ready: number;
}

export async function summaryNow(client: MetricsClient): Promise<SummaryNowRow> {
  const [r = {}] = await run(client, buildSummaryNow());
  return {
    shipments_open: cnt(r.shipments_open),
    shipments_ready: cnt(r.shipments_ready),
    items_total: cnt(r.items_total),
    items_waiting: cnt(r.items_waiting),
    items_in_work: cnt(r.items_in_work),
    items_in_research: cnt(r.items_in_research),
    items_ready: cnt(r.items_ready),
  };
}
