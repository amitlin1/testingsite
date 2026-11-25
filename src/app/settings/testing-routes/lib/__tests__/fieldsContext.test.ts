import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignedStepUids, contextRouteIds, contextRoutes, otherKits, ownOrNewest, routeOwnerLabel, sortedLines, stationLabel,
} from "../fieldsContext";
import { KIT_A, KIT_B, STATIONS, artboard1, line } from "./fixtures";

/** The queries every view of the screen reads the kit's context through. */

test("the context's routes: the kit's own first, then each line's in map order — a route two lines run, once", () => {
  const ctx = artboard1();
  assert.deepEqual(contextRouteIds(ctx), [100, 101, 102, 103, 104]);
  // Lines out of order on the wire, and a second line on the computer's route.
  const pc = ctx.lines[0];
  const shuffled = { ...ctx, lines: [ctx.lines[3], { ...line(99, pc.item_type_id, pc.item_type_desc, 1, 9, 9, pc.route), route_number: pc.route_number }, ...ctx.lines.slice(0, 3)] };
  assert.deepEqual(sortedLines(shuffled).map((l) => l.line_id), [...ctx.lines.map((l) => l.line_id), 99]);
  assert.deepEqual(contextRoutes(shuffled).map((r) => r.route.test_route_id), [100, 101, 102, 103, 104]);
  assert.deepEqual(contextRouteIds({ ...ctx, kit: null }), [101, 102, 103, 104], "a kit without a route of its own");
});

test("step uids count only when they line up with the steps", () => {
  assert.deepEqual(alignedStepUids({ route_steps: [11, 12], step_uids: ["s_a", "s_b"] }), ["s_a", "s_b"]);
  assert.deepEqual(alignedStepUids({ route_steps: [11, 12], step_uids: ["s_a"] }), [null, null]);
  assert.deepEqual(alignedStepUids({ route_steps: [11, 12], step_uids: null }), [null, null]);
  assert.deepEqual(alignedStepUids({ route_steps: [11, 12], step_uids: ["s_a", ""] }), ["s_a", null]);
});

test("the version the screen names: the route on screen's, else the newest", () => {
  const rows = [{ id: 1, v: 4 }, { id: 2, v: 7 }, { id: 3, v: 5 }];
  const pick = (own: number | null) => ownOrNewest(rows, own, (r) => r.id, (r) => r.v);
  assert.equal(pick(3)?.v, 5, "its own, even when older");
  assert.equal(pick(9)?.v, 7, "not among them: the newest");
  assert.equal(pick(null)?.v, 7);
  assert.equal(ownOrNewest([] as typeof rows, 1, (r) => r.id, (r) => r.v), null);
});

test("other kits leave out the kit on screen; an unknown station type reads 'ID {n}'", () => {
  assert.deepEqual(otherKits([KIT_A, KIT_B], KIT_A.package_type_id), [KIT_B]);
  assert.equal(stationLabel(STATIONS, 12), STATIONS[12].label);
  assert.equal(stationLabel({ 12: { label: "  ", package_level: false } }, 12), "ID 12");
  assert.equal(stationLabel(STATIONS, 77), "ID 77");
});

test("the item a route is about: the kit for its own route, else the first line that runs it", () => {
  const ctx = artboard1();
  assert.equal(routeOwnerLabel(ctx, 100), ctx.subject.desc);
  assert.equal(routeOwnerLabel(ctx, 102), ctx.lines[1].item_type_desc);
  assert.equal(routeOwnerLabel(ctx, 999), ctx.subject.desc, "a route the context does not have");
});
