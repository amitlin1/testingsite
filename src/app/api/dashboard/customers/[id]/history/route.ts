// GET /api/dashboard/customers/[id]/history — one customer's history, from the
// ledger. §8 stage 6: "customers/[id]/history -> Q2 (customer filter)".
//
// BEFORE: read `customer_snapshots` / `customer_snapshots_monthly` (0 rows on
// this database, and garbage by construction wherever they are not empty — every
// row was written by a date-less function that stored NOW() under a past date),
// then appended ONE live point counted off `item_routes.current_status`. A real
// call returned a one-element array: today, labelled "history".
//
// AFTER: Q2א for the active states and Q2ב for the closures, over a daily grid
// in Asia/Jerusalem. The derivation, and what happened to the four columns that
// are not here any more, is in src/app/lib/metrics/entity-history.ts.
//
// §5.0(1): historical endpoint, so `scope` is the constant `all`. A customer's
// past must not rewrite itself the day one of their shipments is despatched.

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
  const customerId = toIntOrNull(params?.id);

  if (customerId === null) {
    return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const period = requireDialogPeriod(searchParams);
    const filters = { customerId, scope: "all" as const };

    const { points, ignoredFilters } = await entityHistory(
      prisma,
      period,
      filters,
      "finishedItems"
    );

    return metricsJson(points, period, filters, qualify("finishedCumulative", ignoredFilters));
  } catch (error: unknown) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching customer history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}, { role: "manager" });
