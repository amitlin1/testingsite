// Q4 — §5.5 durations, BOTH clocks, bucketed by close_business_date.
//
// The old query averaged `processing_start_time - queue_start_time` out of
// item_route_history. Three things were wrong with it and all three are §9.4
// entries:
//  - `queue_start_time` was the ITEM's created_at, so every wait was inflated
//    by however long the item sat before its route began;
//  - intake-wizard rows carried ProcessingStartTime = null, so those durations
//    were 0 and dragged the processing average down;
//  - item_route_history keeps rows for the item's CURRENT station only, so a
//    day whose work happened at an earlier step produced no bucket at all.
// The ledger has a closed interval per step, so the series is denser and the
// averages are over the real population.
//
// TWO CLOCKS (§2.8). `avgWaitingMinutes` / `avgProcessingMinutes` keep their
// meaning — wall time, what the customer experienced — and the work twins
// arrive beside them as `_new_avg*WorkMinutes`, with `_new_avgOffhoursMinutes`
// answering "how much of the delay was the calendar". In this lab the two are
// ~4x apart; that gap is the signal, not a contradiction to be reconciled.
// (The name says `avg` because it is a per-bucket average — tests/kpis reports
// the same quantity as a window TOTAL under `_new_offhoursMinutes`, which is
// §5.10's `kpi_offhours_minutes`. Two different numbers never share a name.)
// The rule covers the tail too: both p95s ship on both clocks, so a reader can
// never compare a waiting tail against a processing tail across clocks.
//
// §5.0(8): accessory durations are excluded from the PROCESSING average (their
// `testing` interval is a synthetic ~0-length pair, §4.7) and kept in the
// WAITING average (an accessory really does wait). Q4 applies that rule; the
// consequence is that recordCount is smaller than it used to be and is now the
// real denominator of the averages (§9.4).
//
// §7.2: buckets are Asia/Jerusalem business days. The old route ran
// DATE_TRUNC in the session timezone and stamped `isToday` via
// `new Date(); setHours(0,0,0,0); toISOString().split('T')[0]`, which renders
// LOCAL midnight as a UTC day and therefore names YESTERDAY east of Greenwich.
//
// §6.3: the "quarterly" preset on the page asks for 3 years. The 13-month UI
// cap applies and is REPORTED in the X-Metrics-Period-* response headers, never
// applied in silence.

import { withAuth } from "@/lib/auth/withAuth";
import { NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { flow, type FlowRow } from "@/app/lib/metrics/queries";
import {
  BadRequest,
  metricsJson,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";
import type { AverageTimesPoint } from "@/types/dashboard";

export const runtime = "nodejs";

interface AverageTimesResponsePoint extends AverageTimesPoint {
  _new_avgWaitingWorkMinutes: number | null;
  _new_avgProcessingWorkMinutes: number | null;
  _new_avgOffhoursMinutes: number | null;
  _new_p95WaitingWallMinutes: number | null;
  _new_p95WaitingWorkMinutes: number | null;
  _new_p95ProcessingWallMinutes: number | null;
  _new_p95ProcessingWorkMinutes: number | null;
  _new_waitRecordCount: number;
  _new_stepsProcessed: number;
}

export const GET = withAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  try {
    // `period` here is the granularity selector (daily | monthly | quarterly);
    // resolvePeriod reads it as such and the SQL rolls close_business_date up
    // with date_trunc, so one bucket definition serves all three.
    const period = requirePeriod(searchParams);
    const filters = filtersFromSearchParams(searchParams);

    const [work, wait] = await Promise.all([
      flow(prisma, period.from, period.to, filters, {
        dimension: "none",
        family: "active_work",
        granularity: period.granularity,
      }),
      flow(prisma, period.from, period.to, filters, {
        dimension: "none",
        family: "waiting",
        granularity: period.granularity,
      }),
    ]);

    // One bucket per business day/month/quarter that has EITHER family. There is
    // no gap-filling and no carry-forward (§5.0(7)): a bucket exists because
    // something closed in it.
    const buckets = new Map<string, { work: FlowRow | null; wait: FlowRow | null }>();
    const at = (d: string) => {
      let e = buckets.get(d);
      if (!e) buckets.set(d, (e = { work: null, wait: null }));
      return e;
    };
    for (const r of wait) if (r.d) at(r.d).wait = r;
    for (const r of work) if (r.d) at(r.d).work = r;

    const data: AverageTimesResponsePoint[] = [...buckets.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([date, e]) => ({
        date,
        // §5.10 keeps avg_times_is_today a client-side flag; the chart uses it
        // for the "live" marker. It is stamped on the real Asia/Jerusalem
        // business day, and only on the daily view where a "today" bucket means
        // anything.
        ...(period.granularity === "daily" && date === period.today ? { isToday: true } : {}),
        avgWaitingMinutes: e.wait ? e.wait.avg_wall_min : null,
        avgProcessingMinutes: e.work ? e.work.avg_wall_min : null,
        recordCount: e.work ? e.work.n : 0,

        _new_avgWaitingWorkMinutes: e.wait ? e.wait.avg_work_min : null,
        _new_avgProcessingWorkMinutes: e.work ? e.work.avg_work_min : null,
        _new_avgOffhoursMinutes: e.work ? e.work.avg_offhours_min : null,
        _new_p95WaitingWallMinutes: e.wait ? e.wait.p95_wall_min : null,
        _new_p95WaitingWorkMinutes: e.wait ? e.wait.p95_work_min : null,
        _new_p95ProcessingWallMinutes: e.work ? e.work.p95_wall_min : null,
        _new_p95ProcessingWorkMinutes: e.work ? e.work.p95_work_min : null,
        // The waiting family has its own denominator — it keeps accessories.
        _new_waitRecordCount: e.wait ? e.wait.n : 0,
        _new_stepsProcessed: e.work ? e.work.steps_processed : 0,
      }));

    return metricsJson(data, period, filters);
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching average times:", error);
    return NextResponse.json(
      { error: "Failed to fetch average times" },
      { status: 500 }
    );
  }
}, { role: "manager" });
