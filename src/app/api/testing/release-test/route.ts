import { NextResponse } from "next/server";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { parseActor } from "@/app/lib/testing/actor";
import type { ReleaseTestAnswer } from "@/app/lib/testing/contract";
import { releaseTest } from "@/app/lib/testing/start-release";
import { HttpError } from "@/lib/http/errors";
import { parseDbId, parseItemId, readJsonObject } from "@/lib/http/request";

export const runtime = "nodejs";

/** POST /api/testing/release-test { itemId, stationId, actionUuid, workerId?, workerName? } — a test
 *  closed without a result goes back to waiting (1 → 2, research 5 → 4). event_key =
 *  released_by_user:{actionUuid} (§4.4); without one, a server uuid keeps the route working (the
 *  status guard already makes a duplicate release a no-op). */
export function POST(req: Request) {
  return ledgerWrite("Failed to release test", async () => {
    const body = await readJsonObject(req);
    const itemId = parseItemId(body.itemId);
    const stationId = parseDbId(body.stationId);
    if (itemId == null || stationId == null) throw new HttpError(400, "itemId and stationId are required");
    await releaseTest({ itemId, stationId, actor: parseActor(body, "startRelease") });
    return NextResponse.json({ ok: true } satisfies ReleaseTestAnswer);
  });
}
