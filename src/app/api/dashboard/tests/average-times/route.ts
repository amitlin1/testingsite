// Waiting against processing, both clocks (§2.8), bucketed by the close day
// (or month / quarter: `period` is the granularity here). Q4 (§5.5) excludes
// accessories from the PROCESSING durations (their `testing` interval is a
// synthetic ~0-length pair, §4.7) and keeps them in the WAITING ones — so the
// two families carry two denominators. A bucket exists because something closed
// in it: no gap-filling, no carry-forward (§5.0(7)).

import { prisma } from "@/lib/db";
import type { AverageTimesWire } from "@/app/lib/dashboard/contract";
import { dayRows } from "@/app/lib/metrics/read/day-rows";
import { flow, type FlowRow } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("window", "Failed to fetch average times", async ({ period, filters }) => {
  const [work, wait] = await Promise.all([
    flow(prisma, period.from, period.to, filters, { dimension: "none", family: "active_work", granularity: period.granularity }),
    flow(prisma, period.from, period.to, filters, { dimension: "none", family: "waiting", granularity: period.granularity }),
  ]);

  const buckets = dayRows((date) => ({ date, work: null as FlowRow | null, wait: null as FlowRow | null }));
  for (const r of wait) if (r.d) buckets.at(r.d).wait = r;
  for (const r of work) if (r.d) buckets.at(r.d).work = r;

  const data = buckets.sorted().map(
    ({ date, work: w, wait: q }) =>
      ({
        date,
        // Stamped on the Asia/Jerusalem business day, and only on the daily
        // view, where a "today" bucket means anything.
        ...(period.granularity === "daily" && date === period.today ? { isToday: true as const } : {}),
        avgWaitingMinutes: q ? q.avg_wall_min : null,
        avgProcessingMinutes: w ? w.avg_wall_min : null,
        recordCount: w ? w.n : 0,

        _new_avgWaitingWorkMinutes: q ? q.avg_work_min : null,
        _new_avgProcessingWorkMinutes: w ? w.avg_work_min : null,
        _new_avgOffhoursMinutes: w ? w.avg_offhours_min : null,
        _new_p95WaitingWallMinutes: q ? q.p95_wall_min : null,
        _new_p95WaitingWorkMinutes: q ? q.p95_work_min : null,
        _new_p95ProcessingWallMinutes: w ? w.p95_wall_min : null,
        _new_p95ProcessingWorkMinutes: w ? w.p95_work_min : null,
        _new_waitRecordCount: q ? q.n : 0,
        _new_stepsProcessed: w ? w.steps_processed : 0,
      }) satisfies AverageTimesWire,
  );

  return { body: data, filters };
});
