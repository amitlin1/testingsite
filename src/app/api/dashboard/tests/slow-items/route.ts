// The slowest steps: Q6 (§5.7). Closed active-work intervals of the window,
// each with the QUEUE interval before it (exact: the EXCLUDE constraint makes
// the previous interval end where this one starts). Ordered by the WORK clock
// (§5.10) — "what did the lab actually spend time on", not "what sat through a
// weekend". Accessories never appear: their testing interval is a synthetic
// ~0-length pair (§5.0(8)).

import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import type { SlowItemWire } from "@/app/lib/dashboard/contract";
import { slowSteps } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("window", "Failed to fetch slow items", async ({ period, filters, searchParams }) => {
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw === null ? 20 : Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, "limit must be between 1 and 100");
  }

  const rows = await slowSteps(prisma, period.from, period.to, filters, limit);

  const slowItems = rows.map(
    (r) =>
      ({
        itemId: r.item_id,
        serialNo: r.serial_no,
        makat: r.makat,
        model: r.model ?? "",
        stationName: r.station_name,
        routeStep: r.step_no,
        workerId: r.worker_id,
        queueTimeMinutes: r.queue_wall_min,
        processingTimeMinutes: r.test_wall_min,
        totalTimeMinutes: r.total_wall_min,

        _new_attemptNo: r.attempt_no,
        _new_entryReason: r.entry_reason,
        _new_workerName: r.worker_name,
        _new_customerId: r.customer_id,
        _new_customerName: r.customer_name,
        _new_queueWorkMinutes: r.queue_work_min,
        _new_processingWorkMinutes: r.test_work_min,
        _new_totalWorkMinutes: r.total_work_min,
      }) satisfies SlowItemWire,
  );

  return { body: slowItems, filters };
});
