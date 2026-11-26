// The shell of a job's manual endpoint. Nothing calls these on a schedule any
// more — the app runs its jobs itself (src/instrumentation.ts); an operator
// calls one by hand with the shared secret (`curl.exe --fail`), so a healthy
// no-op — an overlap skip, a red selfcheck verdict — must still be HTTP 200.

import { cronSecretGuard } from "@/lib/auth/cron-secret";
import { errorResponse } from "@/lib/http/errors";
import { metricsSchemaGate } from "@/app/lib/metrics/ledger/schema-gate";

export function cronRoute(
  opts: {
    /** A job that writes the ledger refuses to run on an out-of-date schema (§8 stage 3). */
    schemaGate: boolean;
    /** The 500 body. */
    failure: string;
  },
  run: () => Promise<Response>,
) {
  return async (req: Request): Promise<Response> => {
    const denied = cronSecretGuard(req);
    if (denied) return denied;
    if (opts.schemaGate) {
      const outdated = await metricsSchemaGate();
      if (outdated) return outdated;
    }
    try {
      return await run();
    } catch (error) {
      return errorResponse(error, opts.failure);
    }
  };
}
