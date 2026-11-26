// Runs once when the app server starts (Next.js instrumentation hook).
//
// Builds the work calendar if it is missing, short or out of date, and
// recomputes any נטו figure written without it — so net time never depends on
// a script outside the app (calendar-sync.ts). Fire-and-forget: the server does
// not wait for it, and a failure (database not up yet) is retried by the first
// dashboard read.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` loads this file too, with no database to talk to.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureWorkCalendar } = await import("@/app/lib/metrics/ledger/calendar-sync");
  void ensureWorkCalendar();
}
