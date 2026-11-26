// The abandoned-test release runs inside the app: every 5 minutes, from the
// moment the server starts (src/instrumentation.ts). Nothing outside the app —
// no Windows task, no .bat file — is involved.
//
// Unlike the work calendar, a clock is the right trigger here: abandoning a
// test sends no event (the laptop closed, the tab crashed), so the only signal
// is time passing. The period is SCHEDULED_JOBS' intervalSeconds, the same
// number the health tile grades the job against (red after twice that with no
// successful run). Two app processes on one database cannot release twice:
// runJob's advisory lock makes the second a healthy skip.

import { metricsSchemaGate } from "@/app/lib/metrics/ledger/schema-gate";
import { JOB_NAMES, SCHEDULED_JOBS } from "./jobRun";
import { releaseStaleTestsJob } from "./release-stale-tests";

const PERIOD_MS =
  (SCHEDULED_JOBS.find((j) => j.name === JOB_NAMES.releaseStaleTests)?.intervalSeconds ?? 300) * 1000;
/** The first run waits a little, so it does not compete with the server's own start. */
const FIRST_RUN_MS = 30_000;

// On globalThis: one timer per server process, however many module copies Next makes.
type State = { started: boolean; running: boolean };
const g = globalThis as unknown as { __staleTestsTimer?: State };
const state = (g.__staleTestsTimer ??= { started: false, running: false });

async function tick(): Promise<void> {
  if (state.running) return; // a slow run is not stacked on by the next tick
  state.running = true;
  try {
    if (await metricsSchemaGate()) return; // the job writes the ledger; the gate logs why it refused
    await releaseStaleTestsJob();
  } catch (err) {
    // runJob has already written the failed job_run row the health tile reads.
    console.error("release-stale-tests failed", err);
  } finally {
    state.running = false;
  }
}

/** Starts the 5-minute release, once per server process. */
export function startStaleTestsTimer(): void {
  if (state.started) return;
  state.started = true;
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), PERIOD_MS).unref();
  }, FIRST_RUN_MS).unref();
}
