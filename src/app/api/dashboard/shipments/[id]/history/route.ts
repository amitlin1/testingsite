// GET /api/dashboard/shipments/[id]/history — one shipment's history, from the
// ledger. §8 stage 6: "shipments/[id]/history -> Q2 (shipment filter)".
//
// BEFORE: read `shipment_snapshots` / `shipment_snapshots_monthly` (0 rows here,
// and written by the date-less snapshot function everywhere else), then appended
// ONE live point off `item_routes.current_status`, with a `completionPercentage`
// computed against `shipments.amount` — an INVENTORY number that §5.8 forbids as
// the denominator of a test ratio, and the exact defect that froze
// `shipment_snapshots.completion_percentage` near zero.
//
// AFTER: Q2א for the active states, Q2ב for the closures, over a daily grid in
// Asia/Jerusalem. See src/app/lib/metrics/entity-history.ts.
//
// The completion CURVE for a shipment is a separate endpoint that already exists
// on the ledger — GET /api/dashboard/stats/completion-history?shipmentId=N,
// whose denominator is the routed population as of each day (§5.3ב + §5.8). It
// is not recomputed here; one definition, one place.
//
// §5.0(1): historical endpoint, so `scope` is the constant `all` — a despatched
// shipment is precisely what a shipment history has to keep showing.

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import { toIntOrNull } from "@/app/lib/metrics/filters";
import {
  BadRequest,
  metricsJson,
  qualify,
  requireDialogPeriod,
} from "@/app/lib/metrics/dashboard-request";
import { entityHistory } from "@/app/lib/metrics/entity-history";

export const runtime = "nodejs";

export const GET = withAuth(async (
  request: NextRequest,
  _ctx,
  routeCtx?: unknown,
) => {
  const params = await (routeCtx as { params: Promise<{ id: string }> }).params;
  const shipmentId = toIntOrNull(params?.id);

  if (shipmentId === null) {
    return NextResponse.json({ error: "Shipment ID is required" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const period = requireDialogPeriod(searchParams);
    const filters = { shipmentId, scope: "all" as const };

    const { points, ignoredFilters } = await entityHistory(
      prisma,
      period,
      filters,
      "itemsFinished"
    );

    return metricsJson(points, period, filters, qualify("finishedCumulative", ignoredFilters));
  } catch (error: unknown) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching shipment history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}, { role: "manager" });
