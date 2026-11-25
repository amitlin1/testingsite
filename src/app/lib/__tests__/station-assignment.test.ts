// The next-station pick a result shows the worker: fewest items waiting, then fewest waiting or in
// test, a random one among equals — over the load rows the database counts (stubbed here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findLeastWaitingStation } from "../station-assignment";

type Load = { id: number; waiting: number; inTest: number };
const txOf = (loads: Load[]) => ({
  $queryRaw: (async () => loads.map((l) => ({
    test_station_id: l.id,
    test_station_desc: `S${l.id}`,
    waiting_count: BigInt(l.waiting),
    in_test_count: BigInt(l.inTest),
    total_active: BigInt(l.waiting + l.inTest),
  }))) as never,
});

test("fewest waiting wins, then fewest active", async () => {
  // In the query's order (waiting, then active, then id).
  const picked = await findLeastWaitingStation(txOf([
    { id: 3, waiting: 0, inTest: 1 },
    { id: 1, waiting: 0, inTest: 4 },
    { id: 2, waiting: 1, inTest: 0 },
  ]), 20);
  assert.deepEqual(picked, { test_station_id: 3, test_station_desc: "S3" });
});

test("a tie on both is any of the tied, never another", async () => {
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const picked = await findLeastWaitingStation(txOf([
      { id: 1, waiting: 2, inTest: 0 },
      { id: 2, waiting: 2, inTest: 0 },
      { id: 3, waiting: 2, inTest: 1 },
    ]), 20);
    seen.add(picked!.test_station_id);
  }
  assert.deepEqual([...seen].sort(), [1, 2]);
});

test("no station of the type: null", async () => {
  assert.equal(await findLeastWaitingStation(txOf([]), 20), null);
});
