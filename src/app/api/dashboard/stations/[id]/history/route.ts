// GET /api/dashboard/stations/[id]/history — one station's history, from the
// ledger. §8 stage 6: "stations/[id]/history -> Q2 (station filter) + Q4".
//
// BEFORE: read `station_snapshots` / `station_snapshots_monthly` (0 rows here),
// then appended ONE live point off `item_routes`. Three things in that point are
// worth naming, because they are what this route stops doing:
//
//   1. `averageQueueTime` was `AVG(NOW() - ir.queue_start_time)` over the items
//      waiting AT THIS MOMENT. That is a STATE metric — §5.0(3) calls it
//      `standing_queue_age_*` — and the chart plotted it as if it were the FLOW
//      metric, the time completed waits actually took. §5.0(3): the two never
//      share a column name. On a live call it read 4,921 minutes: the age of a
//      queue standing since the seed's oldest open item, not anybody's wait.
//   2. `current_status IN (2,4)` was counted as "in queue AT THIS STATION". A
//      waiting item is not at a station and never was: `item_state_interval`
//      enforces `CHECK (station_id IS NULL OR state_key IN ('testing',
//      'in_research'))` (§3.6), and a `queued` interval carries the station
//      TYPE it is waiting for instead. Verified on this database: 3,153 queued
//      intervals, 0 with a station_id. Q3 (§5.4) already reports this honestly
//      as `shared_type_queue` — "the queue belongs to the TYPE, not the
//      station" — and this route uses the same definition and the same name.
//      Reporting it as `itemsInQueue` would have been a line pinned at zero
//      forever, which is the silent-zero class the plan exists to kill.
//   3. Its shipment filter was `s_fs.is_sent = false`, and `shipments.is_sent`
//      is nullable — §5.0(1)'s silent-filter class exactly. Gone with the
//      predicate: this is a HISTORICAL endpoint, so `scope` is the constant
//      `all`.
//
// AFTER — Q2א (§5.3) twice and Q4 (§5.5) twice, over one daily grid at 12:00
// Asia/Jerusalem:
//
//   Q2א by station_id      -> `itemsInTest` and `_new_inResearch`, the two
//                             states a station actually holds (Q3's in_test /
//                             in_research), reported apart rather than summed.
//   Q2א by station_type_id -> `_new_sharedTypeQueue`, the items waiting for this
//                             station's TYPE (Q3's shared_type_queue). It is
//                             shared with every other station of the type, and
//                             the name says so.
//   Q4  by station_id      -> `totalProcessed`, which is NOT `result_submitted`
//                             alone: an `in_research` interval closes as
//                             `returned_to_route`, and a research station with
//                             30 treatments a week used to report 3. Plus the
//                             handling clock pair.
//   Q4  by station_type_id -> the WAIT clock pair, over `queued` intervals that
//                             closed that day. `queued_research` carries no
//                             station type (§3.6) so the research pool stays out
//                             of a station's wait, exactly as in Q3.
//
// §2.8 — TWO CLOCKS, FOUR COLUMNS, FOUR NAMES:
//   _new_waitWallMin   / _new_waitWorkMin     "זמן המתנה"  / "זמן המתנה בפועל"
//   _new_handleWallMin / _new_handleWorkMin   "זמן טיפול"  / "זמן טיפול בפועל"
// wall is what happened to the customer; work is the part the lab controls.
// They diverge by ~4x in this lab and that divergence is the signal, not a
// contradiction to reconcile. A day on which nothing closed carries NULL in all
// four — not a zero, and not last week's value carried forward (§5.0(7)); the
// chart draws a gap, which is what a day with no measurement looks like.
//
// §5.0(8): accessory durations are excluded from the ACTIVE-WORK pair (their
// interval is a synthetic ~0-length pair, §4.7) and kept in the WAITING pair —
// an accessory really does wait. buildFlow applies that; the COUNTS include
// accessories either way.
//
// Q2ב is deliberately NOT used here. `route_run` has no station dimension — a
// run is finished as a whole, not at a station — so a cumulative "finished at
// this station" line would be either wrong or silently unfiltered. What a
// station finishes is `steps_processed`, and that is Q4.

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import { toIntOrNull } from "@/app/lib/metrics/filters";
import {
  BadRequest,
  metricsJson,
  requireDialogPeriod,
} from "@/app/lib/metrics/dashboard-request";
import { flow, pitSeries } from "@/app/lib/metrics/queries";

export const runtime = "nodejs";

interface StationHistoryPoint {
  date: string;
  isToday: boolean;
  /** Q3's `in_test` — state `testing` held by THIS station. */
  itemsInTest: number;
  /** Q3's `in_research` — state `in_research` held by THIS station. */
  _new_inResearch: number;
  /** Q3's `shared_type_queue` — waiting for this station's TYPE, shared with
   *  every other station of that type (§5.4). Never "this station's queue". */
  _new_sharedTypeQueue: number;
  /** §3.1 — a status with no metric_state row. Its own slice, never folded in. */
  _new_unmapped: number;
  /** Q4 §5.5: closures that recorded an outcome. Not `result_submitted` alone. */
  totalProcessed: number;
  /** How many closed waits / closed treatments each average is over. */
  _new_waitSamples: number;
  _new_handleSamples: number;
  /** §2.8, the wait pair. NULL when nothing closed that day. */
  _new_waitWallMin: number | null;
  _new_waitWorkMin: number | null;
  /** §2.8, the handling pair. NULL when nothing closed that day. */
  _new_handleWallMin: number | null;
  _new_handleWorkMin: number | null;
}

export const GET = withAuth(async (
  request: NextRequest,
  _ctx,
  routeCtx?: unknown,
) => {
  const params = await (routeCtx as { params: Promise<{ id: string }> }).params;
  const stationId = toIntOrNull(params?.id);

  if (stationId === null) {
    return NextResponse.json({ error: "Station ID is required" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const period = requireDialogPeriod(searchParams);

    // Reference data, not a metric: the type is what the queue hangs off.
    const stationRows = await prisma.$queryRaw<Array<{ test_station_type_id: number | null }>>`
      SELECT test_station_type_id FROM test_stations WHERE test_station_id = ${stationId}
    `;
    if (stationRows.length === 0) {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }
    const stationTypeId = toIntOrNull(stationRows[0]?.test_station_type_id);

    const atStation = { stationId, scope: "all" as const };
    const ofType = { stationTypeId, scope: "all" as const };

    const [held, typeQueue, waiting, working] = await Promise.all([
      pitSeries(prisma, period.from, period.to, atStation),
      // A station with no type cannot have a type queue; asking for one with a
      // NULL filter would return the WHOLE lab's queue (§5.1: NULL means "no
      // filter"), which is the silent-filter failure in reverse.
      stationTypeId === null
        ? Promise.resolve([])
        : pitSeries(prisma, period.from, period.to, { ...ofType, states: ["queued"] }),
      stationTypeId === null
        ? Promise.resolve([])
        : flow(prisma, period.from, period.to, ofType, {
            dimension: "station_type",
            family: "waiting",
            byDay: true,
          }),
      flow(prisma, period.from, period.to, atStation, {
        dimension: "station",
        family: "active_work",
        byDay: true,
      }),
    ]);

    const byDay = new Map<string, StationHistoryPoint>();
    const dayOf = (d: string): StationHistoryPoint => {
      let p = byDay.get(d);
      if (!p) {
        byDay.set(
          d,
          (p = {
            date: d,
            isToday: d === period.today,
            itemsInTest: 0,
            _new_inResearch: 0,
            _new_sharedTypeQueue: 0,
            _new_unmapped: 0,
            totalProcessed: 0,
            _new_waitSamples: 0,
            _new_handleSamples: 0,
            // NULL, not 0: "no wait was measured" and "the wait was zero
            // minutes" are different facts, and the chart must draw the first
            // as a gap (§5.0(7)).
            _new_waitWallMin: null,
            _new_waitWorkMin: null,
            _new_handleWallMin: null,
            _new_handleWorkMin: null,
          })
        );
      }
      return p;
    };

    // Every grid day exists even when nothing happened on it, so the series has
    // a real zero where the old one had nothing at all.
    for (const r of held) {
      const p = dayOf(r.business_day);
      if (r.state_key === "testing") p.itemsInTest = r.items;
      else if (r.state_key === "in_research") p._new_inResearch = r.items;
      else if (r.state_key === "unmapped") p._new_unmapped = r.items;
      // `queued` / `queued_research` cannot carry a station_id (§3.6), so the
      // station-filtered series returns them as zeros; the real queue is the
      // type's, read below.
    }
    for (const r of typeQueue) {
      dayOf(r.business_day)._new_sharedTypeQueue = r.items;
    }

    // Q4 — one row per (close_business_date, dimension); the filter pins the
    // second key, so a day carries at most one row of each family.
    for (const r of waiting) {
      if (!r.d) continue;
      const p = dayOf(r.d);
      p._new_waitSamples = r.n;
      p._new_waitWallMin = r.avg_wall_min;
      p._new_waitWorkMin = r.avg_work_min;
    }
    for (const r of working) {
      if (!r.d) continue;
      const p = dayOf(r.d);
      p.totalProcessed = r.steps_processed;
      p._new_handleSamples = r.n;
      p._new_handleWallMin = r.avg_wall_min;
      p._new_handleWorkMin = r.avg_work_min;
    }

    const data = [...byDay.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );

    // Every filter this endpoint applies is one Q2א and Q4 both express, so
    // there is nothing to declare ignored.
    return metricsJson(data, period, atStation);
  } catch (error: unknown) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching station history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}, { role: "manager" });
