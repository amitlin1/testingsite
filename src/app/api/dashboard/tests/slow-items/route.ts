// Q6 — §5.7 the slowest steps.
//
// The old query read item_route_history and computed the wait as
// `processing_start_time - queue_start_time`, where queue_start_time was the
// ITEM's created_at: every wait was inflated by however long the item sat
// before its route even began, and intake-wizard rows reported a 0 duration
// because ProcessingStartTime was null (§9.4, both entries). It also reported
// the item's CURRENT station and route step rather than the step that was
// actually slow.
//
// Here the candidate set is closed active-work intervals in the window, and the
// preceding QUEUE interval is joined through a LATERAL on
// `p.closed_at = lower(c.valid_range)`. That is exact, not approximate: the
// EXCLUDE constraint on item_state_interval guarantees the previous interval
// ends exactly where this one starts. The CTE narrows to 500 rows before the
// LATERAL runs.
//
// §5.0(8): accessories are excluded outright — an accessory's `testing`
// interval is a synthetic ~0-length pair (§4.7) and can never be a slow step.
//
// §2.8 / §5.0(10): the table's three columns keep their wall-clock meaning and
// gain work twins. ORDERING IS BY THE WORK CLOCK (§5.10), which is the whole
// point of the screen — "what did the lab actually spend time on", not "what
// sat through a weekend". A different set of rows therefore surfaces than the
// old wall-time ordering produced.

import { withAuth } from "@/lib/auth/withAuth";
import { NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { slowSteps } from "@/app/lib/metrics/queries";
import {
  BadRequest,
  metricsJson,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";
import type { SlowItemRow } from "@/types/dashboard";

export const runtime = "nodejs";

interface SlowItemResponseRow
  extends Omit<SlowItemRow, "serialNo" | "makat"> {
  // items.serial_no and items.makat are text columns (prisma/schema.prisma);
  // the legacy `number` typing was wrong and the old route already returned
  // whatever the driver produced. Typed honestly here.
  serialNo: string | null;
  makat: string | null;
  /** §5.10 — tells a retest apart from a first pass and from a restart after
   *  the reaper abandoned the step. */
  _new_attemptNo: number;
  _new_entryReason: string;
  _new_workerName: string | null;
  _new_queueWorkMinutes: number | null;
  _new_processingWorkMinutes: number | null;
  _new_totalWorkMinutes: number | null;
}

export const GET = withAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  try {
    const period = requirePeriod(searchParams);
    const filters = filtersFromSearchParams(searchParams);

    const limitRaw = searchParams.get("limit");
    const limit = limitRaw === null ? 20 : Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new BadRequest("limit must be between 1 and 100");
    }

    const rows = await slowSteps(prisma, period.from, period.to, filters, limit);

    const slowItems: SlowItemResponseRow[] = rows.map((r) => ({
      itemId: r.item_id,
      serialNo: r.serial_no,
      makat: r.makat,
      model: r.model ?? "",
      stationName: r.station_name,
      // The step that was slow, from the interval — not the item's current step.
      routeStep: r.step_no,
      workerId: r.worker_id,
      queueTimeMinutes: r.queue_wall_min,
      processingTimeMinutes: r.test_wall_min,
      totalTimeMinutes: r.total_wall_min,

      _new_attemptNo: r.attempt_no,
      _new_entryReason: r.entry_reason,
      _new_workerName: r.worker_name,
      _new_queueWorkMinutes: r.queue_work_min,
      _new_processingWorkMinutes: r.test_work_min,
      _new_totalWorkMinutes: r.total_work_min,
    }));

    return metricsJson(slowItems, period, filters);
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // The old route answered HTTP 200 with `[]` on any failure — "no slow
    // items" and "the query blew up" looked identical on screen.
    console.error("Error fetching slow items:", error);
    return NextResponse.json({ error: "Failed to fetch slow items" }, { status: 500 });
  }
}, { role: "manager" });
