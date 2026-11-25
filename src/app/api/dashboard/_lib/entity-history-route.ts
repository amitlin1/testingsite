// The customer, shipment and item-type history dialogs: one series (Q2א + Q2ב,
// src/app/lib/metrics/read/entity-history.ts) under three filters. Historical.

import { prisma } from "@/lib/db";
import { requireDbId } from "@/lib/http/request";
import type { EntityHistoryWire } from "@/app/lib/dashboard/contract";
import { entityHistory, type EntityHistoryRow } from "@/app/lib/metrics/read/entity-history";
import { qualify, type MetricFilters } from "@/app/lib/metrics/read/filters";
import { metricsRoute } from "./metrics-route";

type FinishedKey = "finishedItems" | "itemsFinished";

/** The row with `finished` renamed to the route's spelling, in place (key order kept). */
function spell(row: EntityHistoryRow, finishedKey: FinishedKey): EntityHistoryWire {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k === "finished" ? finishedKey : k, v]),
  ) as unknown as EntityHistoryWire;
}

export function entityHistoryRoute(opts: {
  /** The filter the `[id]` sets. */
  filter: "customerId" | "shipmentId" | "itemTypeId";
  /** How this route has always spelled the cumulative closures. */
  finishedKey: FinishedKey;
  /** The 400 body for an id that is not one. */
  badId: string;
  /** The 500 body. */
  failure: string;
}) {
  return metricsRoute<"dialog", { id: string }>("dialog", opts.failure, async ({ period, params, filters: { scope } }) => {
    const filters: MetricFilters = { [opts.filter]: requireDbId(params.id, opts.badId), scope };
    const { points, ignoredFilters } = await entityHistory(prisma, period, filters);
    return {
      body: points.map((p) => spell(p, opts.finishedKey)),
      filters,
      ignored: qualify("finishedCumulative", ignoredFilters),
    };
  }, { historical: true });
}
