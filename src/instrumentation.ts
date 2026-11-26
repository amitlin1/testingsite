// Runs once when the app server starts (Next.js instrumentation hook). Every
// background duty of the app starts here — nothing outside the app (no Windows
// task, no script) is needed:
//
//   • the work calendar: built if it is missing, short or out of date, and any
//     נטו figure written without it recomputed (calendar-sync.ts). Fire-and-
//     forget; a failure (database not up yet) is retried by the first dashboard read.
//   • the abandoned-test release: every 5 minutes (stale-tests-timer.ts).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` loads this file too, with no database to talk to.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const [{ ensureWorkCalendar }, { startStaleTestsTimer }] = await Promise.all([
    import("@/app/lib/metrics/ledger/calendar-sync"),
    import("@/app/lib/jobs/stale-tests-timer"),
  ]);
  void ensureWorkCalendar();
  startStaleTestsTimer();
}
