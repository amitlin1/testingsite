// GET /api/dashboard/stats/completion-history — the completion curve, from the ledger.
//
// §5.10, shipment family: `completion_history_percentage | Q2ב + Q7`. Stage 5 of
// docs/dashboard-migration-plan-v2.md.
//
// WHAT THIS REPLACES
// ------------------
// The old route read `shipment_snapshots_monthly.completion_percentage` — a
// STORED ratio, computed against `shipments.amount` (an inventory number), which
// froze with the wrong denominator and which no amount of re-reading could
// correct (§2.7 is the rule written from this exact failure). On this database
// that table holds 0 rows, so the endpoint has been answering `[]` with HTTP 200.
// It also carried two live faults:
//   - `AND s.shipment_id = $n` against `shipments`, which has no such column:
//     any request with a shipmentId filter raised 42703 and returned HTTP 500.
//   - `itemTypeId` was read out of the query string and then never used.
// Both are honoured now.
//
// THE NUMBER
// ----------
// Per shipment, per sampled business day: closed route_runs over opened
// route_runs, both cumulative to that day. "Finished" is a `route_run` closure
// and nothing else (§5.3ב); the denominator is the routed population as of that
// day, never `shipments.amount` (§5.8). Days before the shipment had anything
// routed carry no point at all rather than a fabricated 0% (§5.0(7)). See
// src/app/lib/metrics/completion-series.ts for the full derivation.
//
// SCOPE is constant `all` — §5.0(1): `open_shipments` is the default for LIVE
// endpoints, `all` is fixed for HISTORICAL ones. A shipment that was despatched
// inside the window is precisely what a history chart must keep.
//
// GRAIN. `granularity=daily|monthly|quarterly` is honoured when given. The
// default is chosen from the window, because the source it replaced was fixed
// monthly and the chart's period picker offers 30 days as well as 12 months:
// a monthly grain over a 30-day window is ONE point, which is not a history.
// So: up to 45 days -> daily, beyond that -> monthly. Whatever the grain, the
// cumulative sums are computed over EVERY day and only the REPORTING is sparse.
//
// RESPONSE SHAPE is unchanged and is load-bearing in an unusual way: the chart
// derives its series from the object keys, treating every key that is not
// `date`/`formattedDate` as a shipment code. A metadata field added to these
// rows would render as a phantom shipment line — so the period notice, the
// grain and the filters route_run cannot express are returned as headers, not
// as body fields. (There is no two-clock pair here either: §2.8 pairs
// DURATIONS, and this endpoint reports a ratio.)

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { type Granularity } from "@/app/lib/metrics/period";
import {
  BadRequest,
  metricsJson,
  qualify,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";
import {
  completionSeries,
  completionSeriesIgnored,
  sampleDays,
} from "@/app/lib/metrics/completion-series";

export const runtime = "nodejs";

const GRAINS: readonly string[] = ["daily", "monthly", "quarterly"];

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  // Contract preserved: the two dates stay required, with the message this
  // endpoint has always returned.
  if (!searchParams.get("startDate") || !searchParams.get("endDate")) {
    return NextResponse.json({ error: "Date range required" }, { status: 400 });
  }

  try {
    const grainParam = searchParams.get("granularity") ?? searchParams.get("grain");
    const explicitGrain: Granularity | null = GRAINS.includes(String(grainParam))
      ? (String(grainParam) as Granularity)
      : null;

    // Asia/Jerusalem business days; the 13-month cap (§6.3) and the
    // no-future-days clamp are applied last and REPORTED, never in silence.
    // Resolved before the grain is chosen, because the CAPPED window is what
    // the grain has to suit.
    const resolved = requirePeriod(searchParams);

    const granularity: Granularity =
      explicitGrain ?? (resolved.days <= 45 ? "daily" : "monthly");
    // The header must report the grain the series was actually sampled at, not
    // the one the request happened to name.
    const period = { ...resolved, granularity };

    // §5.0(1): historical endpoint, so scope is fixed at `all`.
    const filters = { ...filtersFromSearchParams(searchParams), scope: "all" as const };
    const ignored = qualify("completionSeries", completionSeriesIgnored(filters));

    const days = sampleDays(period.from, period.to, granularity);
    const rows = await completionSeries(prisma, period.from, period.to, days, filters);

    // One object per sampled day: { date, [shipmentCode]: "12.3" }. The value is
    // a one-decimal string, as the chart has always received it. A shipment with
    // nothing routed yet on that day contributes NO key — the line simply has
    // not started (connectNulls), rather than claiming 0%.
    const byDate = new Map<string, Record<string, string>>();
    for (const d of days) byDate.set(d, { date: d });
    for (const r of rows) {
      if (r.completion_pct === null) continue;
      const bucket = byDate.get(r.business_day);
      if (!bucket) continue;
      // Two shipments could in principle carry the same code; the chart is keyed
      // by code, so disambiguate rather than let one overwrite the other.
      const key = r.shipment_code || `#${r.shipment_id}`;
      const label = bucket[key] === undefined ? key : `${key} (#${r.shipment_id})`;
      bucket[label] = r.completion_pct.toFixed(1);
    }

    // Days with no shipment at all are dropped rather than emitted as an empty
    // point: the chart would render a gap either way, and an empty object is not
    // information (§5.0(7)).
    const grouped = days
      .map((d) => byDate.get(d)!)
      .filter((o) => Object.keys(o).length > 1);

    return metricsJson(grouped, period, filters, ignored);
  } catch (error: unknown) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching completion history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}, { role: "manager" });
