// GET /api/dashboard/item-types/[id]/history — one item type's history, from
// the ledger. §8 stage 6: "item-types/[id]/history -> Q2 (item type filter) —
// FIXES A PERMANENT HTTP 500".
//
// THE 500. The old route's "today" query carried
//
//     LEFT JOIN (SELECT item_type_id, SUM(amount) AS total_items
//                FROM shipments GROUP BY item_type_id) shipment_totals ...
//
// and `shipments` has no `item_type_id` column (it has customer_id, makat,
// amount — an item TYPE is a property of the item, not of the consignment). So
// every single request raised 42703 and the catch turned it into
// `{"error":"Internal Server Error","details":"... column \"item_type_id\" does
// not exist"}` with HTTP 500. Not intermittent: the column has never existed, so
// the dialog has never once rendered. Reproduced before this change:
//
//     GET /api/dashboard/item-types/7/history?period=alldays -> HTTP 500
//
// It is fixed by deletion, not by repair: `SUM(shipments.amount)` was reaching
// for a stock number to use as the denominator of a completion ratio, which
// §5.8 forbids outright. The number is gone with the column.
//
// AFTER: Q2א for the active states, Q2ב for the closures, over a daily grid in
// Asia/Jerusalem, filtered on `item_type_id` — a real column on both
// `item_state_interval` and `route_run`. See src/app/lib/metrics/entity-history.ts.
//
// §5.8's note applies to the Q2ב side: an item type is counted by
// `route_run_id`, never by `unit_id` — accessories share their parent's unit_id
// but carry a type of their own, and unit_id there undercounts by ~4x. Q2ב
// counts closures (one per run), so this is satisfied by construction.
//
// §5.0(1): historical endpoint, so `scope` is the constant `all`.

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
  const itemTypeId = toIntOrNull(params?.id);

  if (itemTypeId === null) {
    return NextResponse.json({ error: "Item Type ID is required" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const period = requireDialogPeriod(searchParams);
    const filters = { itemTypeId, scope: "all" as const };

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
    console.error("Error fetching item type history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}, { role: "manager" });
