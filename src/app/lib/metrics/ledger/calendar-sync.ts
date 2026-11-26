// Keeps the work calendar (work_calendar_version / work_span — the table every
// נטו figure is read from) in step with the work-hours settings. From inside
// the app, and only when something can have changed:
//
//   • the app server starts  → ensureWorkCalendar()     (src/instrumentation.ts)
//   • a work-hours save      → requestCalendarRebuild() (settings write path)
//
// Both run the rebuild-work-calendar job: rebuild if the sources changed (a
// digest no-op otherwise), then recompute the past intervals the new version
// affects, batch after batch until none is left. Nothing polls, nothing runs on
// a schedule, and no script outside the app is involved. The calendar is built
// five years ahead (work-calendar.ts), so it never needs rolling forward between
// two starts. Why the table exists at all: docs/features/dashboard-times.md.
//
// The dashboard and item reads also call ensureWorkCalendar(): a no-op once a
// sync has succeeded in this process, it is there for the one case startup
// cannot cover — the database was unreachable when the server came up.

import { JOB_NAMES, runJob } from "@/app/lib/jobs/jobRun";
import { metricsSchemaGate } from "./schema-gate";
import { RECONCILE_BATCH_ROWS, syncWorkCalendarInTx, type WorkCalendarSync } from "./work-calendar";

/** A request waits at most this long for a sync in flight, then is served with what is there. */
const MAX_WAIT_MS = 8_000;
/** After a failed sync, a read may try again after this. */
const RETRY_MS = 60_000;
/** The job is locked by another process (or an operator's manual call): wait, then redo. */
const LOCKED_WAIT_MS = 5_000;
const LOCKED_TRIES = 12;

// On globalThis, not in module scope: Next bundles every route separately, so a
// module-level variable is one copy PER ROUTE — ten routes loading at once
// would start ten syncs.
type State = { ready: boolean; failedAt: number; running: Promise<void> | null; again: boolean };
const g = globalThis as unknown as { __workCalendarSync?: State };
const state = (g.__workCalendarSync ??= { ready: false, failedAt: 0, running: null, again: false });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One full sync: rebuild if needed, then recompute batch after batch. Throws on failure. */
async function syncOnce(): Promise<void> {
  if (await metricsSchemaGate()) throw new Error("the metrics schema is older than this app");
  let calendar: WorkCalendarSync["calendar"] | null = null;
  let recomputed = 0;
  for (let locked = 0; ; ) {
    const outcome = await runJob<WorkCalendarSync>(JOB_NAMES.rebuildWorkCalendar, async (tx) => {
      const r = await syncWorkCalendarInTx(tx);
      return { rowsAffected: r.reconciledIntervals, detail: r };
    });
    if (outcome.status === "skipped_overlap" || !outcome.detail) {
      // Redone, not skipped: a save must never be lost to a lock (OWNER-LIST B-14).
      if (++locked >= LOCKED_TRIES) throw new Error("the rebuild-work-calendar job stayed locked");
      await sleep(LOCKED_WAIT_MS);
      continue;
    }
    calendar ??= outcome.detail.calendar;
    recomputed += outcome.detail.reconciledIntervals;
    if (outcome.detail.reconciledIntervals < RECONCILE_BATCH_ROWS) break;
  }
  if (calendar?.status === "rebuilt" || recomputed > 0) {
    console.info(`work calendar: ${calendar?.status ?? "kept"}, ${recomputed} past intervals recomputed`);
  }
}

/** Runs a sync, or joins the one running. `again`: a save while running asks for one more pass. */
function sync(again: boolean): Promise<void> {
  if (state.running) {
    if (again) state.again = true;
    return state.running;
  }
  state.running = (async () => {
    try {
      do {
        state.again = false;
        await syncOnce();
      } while (state.again);
      state.ready = true;
    } catch (err) {
      state.ready = false;
      state.failedAt = Date.now();
      console.error("work calendar sync failed", err);
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

/** After a save on the work-hours screen. Fire-and-forget: the save never waits on it. */
export function requestCalendarRebuild(): void {
  void sync(true);
}

/** At server start, and before reads until a sync has succeeded. Never throws. */
export async function ensureWorkCalendar(): Promise<void> {
  if (state.ready) return;
  if (!state.running && Date.now() - state.failedAt < RETRY_MS) return;
  await Promise.race([sync(false), sleep(MAX_WAIT_MS)]);
}
