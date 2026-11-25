import assert from "node:assert/strict";
import { HttpError } from "@/lib/http/errors";
import * as H from "@/test-support/db-harness";

/** The station-fields integration suites' shared steps. */

/** `p` is refused with an HttpError of this status and code; returns it. */
export async function rejectsHttp(p: Promise<unknown>, status: number, code: string): Promise<HttpError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof HttpError, `expected an HttpError, got ${String(e)}`);
    assert.equal(e.status, status, `${e.code}: ${e.message}`);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`expected ${status} ${code}, got success`);
}

/** A testing_routes row as a script inserts one: these steps and uids. */
export async function insertRoute(itemTypeId: number, steps: number[], uids: string[], routeNumber = 1): Promise<number> {
  const row = await H.one<{ test_route_id: number }>(
    `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number, step_uids)
     VALUES ($1, $2, $3::int[], $4, $5::text[]) RETURNING test_route_id`,
    [itemTypeId, steps[0], steps, routeNumber, uids],
  );
  return row.test_route_id;
}

/** Route 1 of the item type gets these step uids (the harness seeds its routes without any). */
export async function giveUids(itemTypeId: number, uids: string[]): Promise<number> {
  const row = await H.one<{ test_route_id: number }>(
    `UPDATE testing_routes SET step_uids = $2::text[]
      WHERE item_type_id = $1 AND route_number = 1 RETURNING test_route_id`,
    [itemTypeId, uids],
  );
  return row.test_route_id;
}
