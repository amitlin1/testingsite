import { NextResponse } from "next/server";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { parseActor } from "@/app/lib/testing/actor";
import type { StartTestAnswer } from "@/app/lib/testing/contract";
import { startTest } from "@/app/lib/testing/start-release";
import { HttpError } from "@/lib/http/errors";
import { parseDbId, parseItemId, readJsonObject } from "@/lib/http/request";

export const runtime = "nodejs";

/** POST /api/testing/start-test { itemId, stationId, actionUuid, workerId?, workerName? } — a waiting
 *  item (a box: with its items) is in test at the station. event_key = test_started:{actionUuid}
 *  (§4.4): a client retry of the same click is a ledger no-op; without one, a server uuid keeps the
 *  route working and retry idempotency rests on the status guard alone. */
export function POST(req: Request) {
  return ledgerWrite("Failed to start test", async () => {
    const body = await readJsonObject(req);
    const itemId = parseItemId(body.itemId);
    const stationId = parseDbId(body.stationId);
    if (itemId == null || stationId == null) throw new HttpError(400, "itemId and stationId are required");
    const item = await startTest({ itemId, stationId, actor: parseActor(body, "startRelease") });
    return NextResponse.json({ ok: true, item } satisfies StartTestAnswer);
  });
}
