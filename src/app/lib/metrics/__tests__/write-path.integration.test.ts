// Stage-3 write-path integration suite (docs/dashboard-migration-plan-v2.md
// §9.2ג — "ה־fold: לכל אחד מ־31 מסלולי הפליטה: שורת event, מצב ledger,
// attempt_no, station_id, exit_reason").
//
// These tests drive the REAL route handlers — src/app/api/testing/results,
// start-test, release-test and the cron reaper are imported and invoked with
// constructed Request objects, exactly as Next would. None of them is wrapped
// in withAuth (authentication lives in the middleware, src/lib/routes.ts), so
// no bypass is needed; the reaper's cronSecretGuard is satisfied the way the
// Windows scheduler satisfies it, with the x-cron-secret header.
//
// THE FINAL ASSERTION OF EVERY TEST is `assertNoDrift()`: every item_routes row
// must agree with its open ledger interval. A call site that writes item_routes
// without emitting its event — the exact failure class the ledger exists to
// eliminate — makes the two disagree and the test fails.
//
// Until migration B this was policed by a CONSTRAINT TRIGGER writing into
// metrics_drift. That scaffold was dropped once the dual-run week was green (a
// trigger on every item_routes write is real cost on the hot path of a test
// submission). The check is now computed on demand in openDriftRows(), which is
// strictly stronger: the trigger only saw rows a transaction happened to touch,
// this compares every row in the table.
//
// The suite runs ONLY when TEST_DATABASE_URL points at a throwaway database
// carrying migration 20260825000000_metrics_ledger_additive. Without it the
// whole describe block is skipped, so plain `npm test` stays green.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as H from "./write-path-helpers";

/** The drift detector must be silent after every covered path. */
async function assertNoDrift(): Promise<void> {
  const rows = await H.openDriftRows();
  assert.deepEqual(
    rows,
    [],
    `item_routes disagrees with the ledger — a write path changed the row without emitting its event: ${JSON.stringify(rows)}`,
  );
}

function ms(d: Date): number {
  return new Date(d).getTime();
}

describe("stage 3 — metrics write path", { skip: H.skipReason() }, () => {
  before(async () => {
    await H.setup();
  });
  after(async () => {
    await H.teardown();
  });
  beforeEach(async () => {
    await H.resetDb();
  });

  // -------------------------------------------------------------------------
  // #1 — create-item
  // -------------------------------------------------------------------------

  it("#1 create-item emits item_created, opening the run and the queued interval in the same tx", async () => {
    const itemId: number = await H.h().prisma.$transaction((tx: any) =>
      H.h().createItem(tx, {
        customer: H.CUSTOMER_ID,
        itemType: H.ITEM_TYPE_TWO_STEP,
        serialNumber: "SN-CREATE",
        makat: "MK-1",
        model: "MODEL",
        manufacturer: "MFR",
        manufacturerNo: "MFR-NO",
        shipment: H.SHIPMENT_ID,
        routeNumber: 1,
      }),
    );

    const ev = await H.events(itemId);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event_key, `item_created:${itemId}`);
    assert.equal(ev[0].reason, "item_created");
    assert.equal(ev[0].to_state, "queued");
    assert.equal(ev[0].kind, "transition");
    assert.equal(ev[0].seq, 0);
    assert.equal(ev[0].step_no, 1);
    // A queued item has no station by construction; it carries the station TYPE
    // it is waiting for (§3.6), which feeds Q3's shared-type queue.
    assert.equal(ev[0].station_id, null);
    assert.equal(ev[0].station_type_id, H.TYPE_INTAKE);
    // The auto-open marker is suppressed for item_created — this is the run's
    // legitimate birth, not a surprise (§4.2).
    assert.equal(ev[0].payload.auto_opened_run, undefined);

    const [run] = await H.runs(itemId);
    assert.equal(run.run_no, 1);
    assert.equal(run.closed_at, null);
    assert.deepEqual(run.planned_steps, [H.TYPE_INTAKE, H.TYPE_FUNC]);
    assert.equal(run.unit_id, itemId);
    assert.equal(run.is_accessory, false);
    assert.equal(run.customer_id, H.CUSTOMER_ID);
    assert.equal(run.shipment_id, H.SHIPMENT_ID);

    const isi = await H.intervals(itemId);
    assert.equal(isi.length, 1);
    assert.equal(isi[0].state_key, "queued");
    assert.equal(isi[0].is_open, true);
    assert.equal(isi[0].attempt_no, 1);
    assert.equal(isi[0].step_no, 1);
    assert.equal(isi[0].station_id, null);
    assert.equal(isi[0].station_type_id, H.TYPE_INTAKE);
    assert.equal(isi[0].entry_reason, "item_created");

    const route = await H.routeRow(itemId);
    assert.equal(route.current_status, H.STATUS.queued);
    assert.equal(route.current_route_step, 1);

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #2 / #9 / #10 — the normal finishing path
  // -------------------------------------------------------------------------

  it("#9+#10 normal finish emits two events in ONE tx with seq 0/1 and distinct occurred_at, and closes the run", async () => {
    const itemId = 5001;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });

    const startUuid = randomUUID();
    const started = await H.startTest({
      itemId,
      stationId: H.STATION_INTAKE,
      actionUuid: startUuid,
    });
    assert.equal(started.status, 200);

    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 1,
      SubmitID: submitId,
      Passed: true,
    });
    assert.equal(res.status, 200);

    const ev = await H.events(itemId);
    assert.deepEqual(
      ev.map((e) => e.reason),
      ["item_created", "test_started", "result_submitted", "result_submitted"],
    );
    assert.equal(ev[1].event_key, `test_started:${startUuid}`);

    const [advance, finish] = [ev[2], ev[3]];
    // §4.4: the key carries the identity of the TRANSITION, not just the human
    // action — otherwise ON CONFLICT DO NOTHING would swallow the route close.
    assert.equal(advance.event_key, `result_submitted:${submitId}:${itemId}:0`);
    assert.equal(finish.event_key, `result_submitted:${submitId}:${itemId}:1`);
    assert.equal(advance.seq, 0);
    assert.equal(finish.seq, 1);
    assert.equal(advance.to_state, "queued");
    assert.equal(finish.to_state, "done");
    assert.equal(advance.route_run_id, finish.route_run_id);
    assert.equal(advance.submit_id, submitId);
    assert.equal(finish.submit_id, submitId);
    assert.equal(finish.worker_id, H.WORKER_ID);
    assert.equal(finish.worker_name, H.WORKER_NAME);
    // The per-item clamp (§3.3): two events of one transaction can never share
    // an occurred_at, or the fold would drop the second.
    assert.ok(ms(finish.occurred_at) > ms(advance.occurred_at), "occurred_at must strictly increase");

    const [run] = await H.runs(itemId);
    assert.notEqual(run.closed_at, null);
    assert.equal(run.close_reason, "result_submitted");

    const isi = await H.intervals(itemId);
    assert.deepEqual(
      isi.map((i) => [i.state_key, i.step_no, i.attempt_no]),
      [
        ["queued", 1, 1],
        ["testing", 1, 1],
        ["queued", 2, 1],
        ["done", 2, 1],
      ],
    );
    const testing = isi[1];
    assert.equal(testing.station_id, H.STATION_INTAKE);
    assert.equal(testing.exit_reason, "result_submitted");
    assert.equal(testing.exited_by_worker_id, H.WORKER_ID);
    assert.equal(testing.is_open, false);
    // Both clocks are stamped when a non-terminal interval closes (§2.8).
    assert.notEqual(testing.wall_seconds, null);
    assert.notEqual(testing.work_seconds, null);
    assert.notEqual(testing.calendar_version, null);

    const done = isi[3];
    assert.equal(done.is_terminal, true);
    assert.equal(done.is_open, true, "a done interval stays open forever");
    assert.equal(done.exit_reason, null);

    // #14: the result row anchors to the event that ended the submission.
    const results = await H.testResults(itemId);
    assert.equal(results.length, 1);
    assert.equal(results[0].state_event_id, finish.event_id);

    const route = await H.routeRow(itemId);
    assert.equal(route.current_status, H.STATUS.done);
    assert.equal(route.is_finished, true);
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 2);

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #8 / #2 / #5 — the research cycle
  // -------------------------------------------------------------------------

  it("#8→#2→#5 research cycle produces the four-interval chain and re-queues at attempt_no=2", async () => {
    const itemId = 5002;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });

    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    const sendId = randomUUID();
    const sent = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: sendId,
      sendToResearch: true,
    });
    assert.equal(sent.status, 200);

    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });

    const returnId = randomUUID();
    const returned = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: returnId,
      returnToRoute: true,
    });
    assert.equal(returned.status, 200);

    const ev = await H.events(itemId);
    const transitions = ev.filter((e) => e.kind === "transition");
    assert.deepEqual(
      transitions.map((e) => [e.reason, e.to_state]),
      [
        ["item_created", "queued"],
        ["test_started", "testing"],
        ["sent_to_research", "queued_research"],
        ["test_started", "in_research"],
        ["returned_to_route", "queued"],
      ],
    );
    const sendEvent = transitions[2];
    assert.equal(sendEvent.event_key, `sent_to_research:${sendId}:${itemId}:0`);
    assert.equal(sendEvent.step_no, 1, "sendToResearch does not advance the step");
    const returnEvent = transitions[4];
    assert.equal(returnEvent.event_key, `returned_to_route:${returnId}:${itemId}:0`);
    assert.equal(returnEvent.step_no, 1, "returnToRoute re-queues at the SAME step");

    const isi = await H.intervals(itemId);
    assert.deepEqual(
      isi.map((i) => [i.state_key, i.step_no, i.attempt_no, i.exit_reason]),
      [
        ["queued", 1, 1, "test_started"],
        ["testing", 1, 1, "sent_to_research"],
        ["queued_research", 1, 1, "test_started"],
        ["in_research", 1, 1, "returned_to_route"],
        // attempt_no is computed inside the DB — the handler never knows it.
        ["queued", 1, 2, null],
      ],
    );
    assert.equal(isi[2].station_type_id, null, "queued_research carries no station type (§3.6)");
    assert.equal(isi[2].station_id, null);
    assert.equal(isi[3].station_id, H.STATION_RESEARCH);
    assert.equal(isi[4].entry_reason, "returned_to_route");
    assert.equal(isi[4].is_open, true);

    const route = await H.routeRow(itemId);
    assert.equal(route.current_status, H.STATUS.queued);

    await assertNoDrift();
  });

  it("#6 finishRoute out of research emits one result_submitted → done and closes the run", async () => {
    const itemId = 5008;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
      sendToResearch: true,
    });
    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });

    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: submitId,
      finishRoute: true,
    });
    assert.equal(res.status, 200);

    const ev = await H.events(itemId);
    const finish = ev[ev.length - 1];
    // Only ONE event on this branch: the route ends where the research sits,
    // so nothing advances and no next-station recommendation is computed.
    assert.equal(finish.event_key, `result_submitted:${submitId}:${itemId}:0`);
    assert.equal(finish.reason, "result_submitted");
    assert.equal(finish.to_state, "done");
    assert.equal(finish.seq, 0);
    assert.equal(finish.step_no, 1, "finishRoute does not touch current_route_step");
    assert.equal(finish.station_id, H.STATION_RESEARCH);

    const isi = await H.intervals(itemId);
    assert.equal(isi[isi.length - 2].state_key, "in_research");
    assert.equal(isi[isi.length - 2].exit_reason, "result_submitted");
    assert.equal(isi[isi.length - 1].state_key, "done");
    assert.equal(isi[isi.length - 1].is_open, true);

    const [run] = await H.runs(itemId);
    assert.notEqual(run.closed_at, null);
    assert.equal(run.close_reason, "result_submitted");

    const results = await H.testResults(itemId);
    assert.equal(results[results.length - 1].state_event_id, finish.event_id);
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.done);

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #7 — the interim research save
  // -------------------------------------------------------------------------

  it("#7 research_note (5→5) is a note and does NOT close the in_research interval", async () => {
    const itemId = 5003;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
      sendToResearch: true,
    });
    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });

    const before = await H.intervals(itemId);
    const openBefore = before.find((i) => i.is_open)!;
    assert.equal(openBefore.state_key, "in_research");

    const noteId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: noteId,
    });
    assert.equal(res.status, 200);

    const ev = await H.events(itemId);
    const note = ev[ev.length - 1];
    // §4.4: the note key carries no seq suffix.
    assert.equal(note.event_key, `research_note:${noteId}:${itemId}`);
    assert.equal(note.kind, "note");
    assert.equal(note.reason, "research_note");
    assert.equal(note.to_state, null);

    const isiAfter = await H.intervals(itemId);
    assert.equal(isiAfter.length, before.length, "a note must not create an interval");
    const openAfter = isiAfter.find((i) => i.is_open)!;
    assert.equal(openAfter.interval_id, openBefore.interval_id);
    assert.equal(openAfter.state_key, "in_research");
    assert.equal(openAfter.closed_at, null);
    assert.equal(openAfter.exit_reason, null);

    // #14 on the 5→5 path: the result row anchors to the note.
    const results = await H.testResults(itemId);
    assert.equal(results[results.length - 1].state_event_id, note.event_id);

    const route = await H.routeRow(itemId);
    assert.equal(route.current_status, H.STATUS.in_research);

    await assertNoDrift();
  });

  it("#7 replayed with the same SubmitID emits no second event (live idempotency)", async () => {
    const itemId = 5004;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
      sendToResearch: true,
    });
    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });

    // The interim-save path is the one live route with no optimistic status
    // guard in front of it (5→5 touches no item_routes column), so a client
    // retry really does reach metrics_record a second time with the same key.
    const noteId = randomUUID();
    const body = {
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: noteId,
    };
    const first = await H.submitResult(body);
    const eventsAfterFirst = await H.events(itemId);
    const intervalsAfterFirst = await H.intervals(itemId);
    const retry = await H.submitResult(body);
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);

    const eventsAfterRetry = await H.events(itemId);
    assert.equal(eventsAfterRetry.length, eventsAfterFirst.length, "replay must not append an event");
    assert.equal(
      eventsAfterRetry.filter((e) => e.reason === "research_note").length,
      1,
    );
    assert.equal((await H.intervals(itemId)).length, intervalsAfterFirst.length);

    // Both submissions persisted their own result row (row 1 belongs to the
    // earlier sendToResearch submit), and both point at the ONE note event —
    // the replay returned the original event_id rather than minting a second.
    const results = await H.testResults(itemId);
    assert.equal(results.length, 3);
    const note = eventsAfterRetry.find((e) => e.reason === "research_note")!;
    assert.equal(results[1].state_event_id, note.event_id);
    assert.equal(results[2].state_event_id, note.event_id);

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #3 / #4 — release by user, release by reaper
  // -------------------------------------------------------------------------

  it("#3 release-test emits released_by_user, re-queues at attempt_no=2 and frees the station", async () => {
    const itemId = 5005;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 1);

    const actionUuid = randomUUID();
    const res = await H.releaseTest({ itemId, stationId: H.STATION_INTAKE, actionUuid });
    assert.equal(res.status, 200);

    const ev = await H.events(itemId);
    const released = ev[ev.length - 1];
    assert.equal(released.event_key, `released_by_user:${actionUuid}`);
    assert.equal(released.reason, "released_by_user");
    assert.equal(released.to_state, "queued");
    assert.equal(released.step_no, 1);
    assert.equal(released.station_id, null, "a waiting item has no station");
    assert.equal(released.station_type_id, H.TYPE_INTAKE, "…but it still waits for a type");

    const isi = await H.intervals(itemId);
    const open = isi[isi.length - 1];
    assert.equal(open.state_key, "queued");
    assert.equal(open.attempt_no, 2);
    assert.equal(open.entry_reason, "released_by_user");
    assert.equal(isi[1].exit_reason, "released_by_user");

    const route = await H.routeRow(itemId);
    assert.equal(route.current_status, H.STATUS.queued);
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 2);

    await assertNoDrift();
  });

  it("#4 reaper emits released_stale set-based, frees the station, and a restart lands attempt_no=2", async () => {
    const itemId = 5006;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.ageProcessingStart(itemId, 120);

    const res = await H.runReaper();
    assert.equal(res.status, 200);
    assert.equal(res.body.releasedCount, 1);
    assert.deepEqual(res.body.itemIds, [String(itemId)]);
    assert.equal(res.body.stationsFreed, 1);

    const ev = await H.events(itemId);
    const stale = ev[ev.length - 1];
    assert.equal(stale.reason, "released_stale");
    assert.equal(stale.to_state, "queued");
    assert.match(stale.event_key, new RegExp(`^released_stale:${itemId}:\\d{12}$`));

    const isi = await H.intervals(itemId);
    assert.equal(isi[isi.length - 1].entry_reason, "released_stale");
    assert.equal(isi[isi.length - 1].attempt_no, 2);
    assert.equal(isi[1].exit_reason, "released_stale");
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 2);
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.queued);

    // The worker picks the item up again: a second `testing` attempt at the
    // same step, numbered by the DB.
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    const restarted = (await H.intervals(itemId)).at(-1)!;
    assert.equal(restarted.state_key, "testing");
    assert.equal(restarted.step_no, 1);
    assert.equal(restarted.attempt_no, 2);

    await assertNoDrift();
  });

  it("#4 two reaper passes inside the same minute produce ONE event (per-minute key)", async () => {
    const itemId = 5007;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.ageProcessingStart(itemId, 120);

    const minuteBefore = (await H.one<{ m: string }>("SELECT to_char(clock_timestamp(),'YYYYMMDDHH24MI') AS m")).m;
    await H.runReaper();

    // Overlapping reaper runs are the real hazard the per-minute stamp guards
    // against. Re-arming the row out of band (detector lifted — this is setup,
    // not a write path) reproduces the window without a second process.
    await H.withDriftDetectorOff(() =>
      H.q(
        `UPDATE item_routes SET current_status = 1, processing_start_time = NOW() - INTERVAL '120 minutes'
          WHERE item_id = $1`,
        [itemId],
      ),
    );
    // Assert the second pass actually RAN and released the row. Without this a
    // crashed or no-op second pass leaves exactly one event and satisfies the
    // "one event" assertion below vacuously — the test would then pass for the
    // opposite of the reason it exists.
    const second = await H.runReaper();
    assert.equal(second.status, 200, "second reaper pass must succeed");
    assert.equal(second.body.releasedCount, 1, "second pass must release the re-armed row");
    const minuteAfter = (await H.one<{ m: string }>("SELECT to_char(clock_timestamp(),'YYYYMMDDHH24MI') AS m")).m;

    const stale = (await H.events(itemId)).filter((e) => e.reason === "released_stale");
    if (minuteBefore === minuteAfter) {
      assert.equal(stale.length, 1, "same minute ⇒ same event_key ⇒ replay, one event");
    } else {
      // Both passes straddled a minute boundary: the keys legitimately differ.
      assert.equal(stale.length, 2);
      assert.notEqual(stale[0].event_key, stale[1].event_key);
    }
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.queued);

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #4 — the reaper's threshold is PER STATION TYPE
  //
  // The endpoint used to apply one hardcoded 30 to every bench and to both
  // status 1 and status 5, so no testing or in_research interval could exceed
  // ~35 minutes or span a night. Its job is to catch an ABANDONED dialog, not
  // to cap how long a test may take: when a test genuinely runs for hours the
  // item is physically occupying the bench, and keeping that bench locked is
  // the CORRECT answer. How long a test legitimately runs is a property of the
  // STATION TYPE, so the threshold lives on
  // test_stations_type.stale_after_minutes (0 = never reap this type) and every
  // candidate row is measured against its own type, resolved through
  // item_routes -> test_stations -> test_stations_type.
  // -------------------------------------------------------------------------

  it("#4 a long-timeout type is untouched at the old flat 30 and reaped only past its OWN threshold", async () => {
    const itemId = 5080;
    // Four hours — a functional bench session. Under the hardcoded constant
    // this item was reverted mid-test and its bench handed to the next worker
    // while the unit was still standing on it.
    await setStaleAfterMinutes(H.TYPE_INTAKE, 240);
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    // Twice the old cap, half its own: the exact window the old code got wrong.
    await H.ageProcessingStart(itemId, 120);
    const early = await H.runReaper();
    assert.equal(early.status, 200);
    assert.equal(early.body.releasedCount, 0, "120 minutes is not stale for a 240-minute type");
    assert.equal(early.body.stationsFreed, 0);
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.testing);
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 1, "the bench stays occupied");
    assert.equal(
      (await H.events(itemId)).filter((e) => e.reason === "released_stale").length,
      0,
      "and no event is emitted for a row that was never selected",
    );
    // The `testing` interval is still the open one — a two-hour test, a shape
    // the ledger simply could not contain before.
    const stillTesting = (await H.openInterval(itemId))!;
    assert.equal(stillTesting.state_key, "testing");
    assert.equal(stillTesting.entry_reason, "test_started");

    await H.ageProcessingStart(itemId, 241);
    const late = await H.runReaper();
    assert.equal(late.body.releasedCount, 1, "past its own threshold it is abandoned after all");
    assert.deepEqual(late.body.itemIds, [String(itemId)]);
    assert.equal(late.body.stationsFreed, 1);

    const stale = (await H.events(itemId)).at(-1)!;
    assert.equal(stale.reason, "released_stale");
    assert.equal(stale.to_state, "queued");
    assert.match(stale.event_key, new RegExp(`^released_stale:${itemId}:\\d{12}$`));
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.queued);
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 2);

    await assertNoDrift();
  });

  it("#4 stale_after_minutes = 0 opts a type out of the reaper entirely, however old the row", async () => {
    const itemId = 5081;
    // A research bench holds a unit open for days. There is no age at which
    // "the researcher must have abandoned it" becomes a safe guess, so the type
    // opts out — status 5 included, which the flat constant also governed.
    await setStaleAfterMinutes(H.TYPE_RESEARCH, 0);
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.in_research);

    // Nine days: past anything a "very large number" encoding of "never" would
    // have survived. 0 is excluded from the selection, never compared against.
    await H.ageProcessingStart(itemId, 9 * 24 * 60);
    const res = await H.runReaper();
    assert.equal(res.status, 200);
    assert.equal(res.body.releasedCount, 0);
    assert.equal(res.body.stationsFreed, 0);

    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.in_research);
    assert.equal(await H.stationStatus(H.STATION_RESEARCH), 1, "the bench is still occupied");
    const open = (await H.openInterval(itemId))!;
    assert.equal(open.state_key, "in_research");
    assert.equal(open.entry_reason, "test_started");
    assert.equal(
      (await H.events(itemId)).filter((e) => e.reason === "released_stale").length,
      0,
      "a multi-day research episode stays ONE interval, not a chain of short sessions",
    );

    await assertNoDrift();
  });

  it("#4 an unconfigured type still reaps exactly as the hardcoded 30 did — 29 stays, 31 goes", async () => {
    const itemId = 5082;
    // resetDb never sets the column, so the fixture types carry its DEFAULT.
    // That is the fail-safe the migration is built around: a floor nobody has
    // configured behaves precisely as the constant did.
    const fixtureType = await H.one<{ stale_after_minutes: number }>(
      "SELECT stale_after_minutes FROM test_stations_type WHERE test_station_type_id = $1",
      [H.TYPE_INTAKE],
    );
    assert.equal(fixtureType.stale_after_minutes, 30, "the fixture never set it — the DEFAULT did");

    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    await H.ageProcessingStart(itemId, 29);
    assert.equal((await H.runReaper()).body.releasedCount, 0, "29 minutes is inside the threshold");
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.testing);
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 1);

    await H.ageProcessingStart(itemId, 31);
    const res = await H.runReaper();
    assert.equal(res.body.releasedCount, 1, "31 minutes is past it");
    assert.equal(res.body.stationsFreed, 1);
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.queued);
    assert.equal(await H.stationStatus(H.STATION_INTAKE), 2);
    assert.equal((await H.intervals(itemId)).at(-1)!.entry_reason, "released_stale");

    await assertNoDrift();
  });

  it("#4 a row with no station falls back to DEFAULT_STALE_MINUTES, not to the type it came from", async () => {
    const itemId = 5083;
    // item_routes.test_station_id is nullable, so a row can sit in status 1
    // with no station and therefore no type to read a threshold from. Setting
    // the type it came from to "never" is what makes this discriminating: if
    // the join leaked a type onto a station-less row, this item would sit
    // locked forever instead of falling back to the endpoint's own 30.
    await setStaleAfterMinutes(H.TYPE_INTAKE, 0);
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    // Not a desync — item_routes still says 1 and the ledger still says
    // `testing` — so the drift detector stays armed across this write.
    await H.q("UPDATE item_routes SET test_station_id = NULL WHERE item_id = $1", [itemId]);

    await H.ageProcessingStart(itemId, 20);
    assert.equal((await H.runReaper()).body.releasedCount, 0, "20 < the 30-minute fallback");
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.testing);

    await H.ageProcessingStart(itemId, 45);
    const res = await H.runReaper();
    assert.equal(res.body.releasedCount, 1, "45 > the 30-minute fallback");
    assert.deepEqual(res.body.itemIds, [String(itemId)]);
    // Nothing to free: `freed` gets an empty array_agg and touches no station.
    assert.equal(res.body.stationsFreed, 0);
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.queued);
    assert.equal((await H.events(itemId)).at(-1)!.reason, "released_stale");

    await assertNoDrift();
  });

  it("#4 mixed batch: ONE statement reaps only the rows past THEIR OWN threshold", async () => {
    // Four benches, three thresholds, one pass. The endpoint is a single
    // set-based statement, so "each row against its own type" has to hold
    // inside one plan — it cannot be rescued by looping in JS afterwards.
    const shortStale = 5084; // INTAKE,   30 min, aged 90   → past it
    const longStale = 5085; //  FUNC,    240 min, aged 300  → past it
    const longFresh = 5086; //  FUNC,    240 min, aged 90   → well inside it
    const neverStale = 5087; // RESEARCH,      0, aged 90h  → opted out
    await setStaleAfterMinutes(H.TYPE_INTAKE, 30);
    await setStaleAfterMinutes(H.TYPE_FUNC, 240);
    await setStaleAfterMinutes(H.TYPE_RESEARCH, 0);

    const bench = [
      [shortStale, H.STATION_INTAKE, 90],
      [longStale, H.STATION_FUNC_A, 300],
      [longFresh, H.STATION_FUNC_B, 90],
      [neverStale, H.STATION_RESEARCH, 90 * 60],
    ] as const;
    for (const [itemId, stationId, ageMinutes] of bench) {
      await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
      await H.startTest({ itemId, stationId, actionUuid: randomUUID() });
      await H.ageProcessingStart(itemId, ageMinutes);
    }

    const res = await H.runReaper();
    assert.equal(res.status, 200);
    assert.equal(res.body.releasedCount, 2);
    assert.deepEqual(
      [...res.body.itemIds].sort(),
      [String(shortStale), String(longStale)].sort(),
      "two different thresholds, both crossed, resolved in the same statement",
    );
    assert.equal(res.body.stationsFreed, 2, "and only the reaped rows' benches are freed");

    assert.equal((await H.routeRow(shortStale)).current_status, H.STATUS.queued);
    assert.equal((await H.routeRow(longStale)).current_status, H.STATUS.queued);
    assert.equal((await H.routeRow(longFresh)).current_status, H.STATUS.testing);
    assert.equal((await H.routeRow(neverStale)).current_status, H.STATUS.in_research);

    assert.equal(await H.stationStatus(H.STATION_INTAKE), 2);
    assert.equal(await H.stationStatus(H.STATION_FUNC_A), 2);
    assert.equal(await H.stationStatus(H.STATION_FUNC_B), 1, "an in-progress bench is not handed away");
    assert.equal(await H.stationStatus(H.STATION_RESEARCH), 1);

    // Exactly one event per reaped row and none for the others: `freed`
    // consumes `recorded` through array_agg precisely so no selected row can be
    // skipped by a lazily-filled CTE, and the unselected rows emit nothing.
    for (const [itemId] of bench) {
      const staleEvents = (await H.events(itemId)).filter((e) => e.reason === "released_stale");
      const expected = itemId === shortStale || itemId === longStale ? 1 : 0;
      assert.equal(staleEvents.length, expected, `released_stale events for item ${itemId}`);
    }

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #15 — the synthetic accessory pair
  // -------------------------------------------------------------------------

  it("#15 accessory submitted from status 2 gets the synthetic pair: a CLOSED testing interval and shifted seq", async () => {
    const parentId = 5010;
    const accessoryId = 5011;
    await H.seedItem({ itemId: parentId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.seedItem({
      itemId: accessoryId,
      itemTypeId: H.ITEM_TYPE_ONE_STEP,
      parentItemId: parentId,
    });

    // The intake wizard submits accessories in a loop while they are still
    // status 2 and holds none of their route data — so the handler resolves
    // CurrentRouteStep / RouteStepsLength from the DB.
    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: accessoryId,
      StationID: H.STATION_INTAKE,
      SubmitID: submitId,
      Passed: true,
    });
    assert.equal(res.status, 200);

    const ev = await H.events(accessoryId);
    assert.deepEqual(
      ev.map((e) => [e.reason, e.to_state, e.seq]),
      [
        ["item_created", "queued", 0],
        ["test_started", "testing", 0],
        ["result_submitted", "queued", 1],
        ["result_submitted", "done", 2],
      ],
    );
    assert.equal(ev[1].event_key, `test_started:${submitId}:${accessoryId}:0`);
    assert.equal(ev[1].payload.synthetic_pair, true);
    assert.equal(ev[1].station_id, H.STATION_INTAKE);
    // Every later event of the tx shifts by +1 (§4.5 #9/#10 "1 כשקדם #15").
    assert.equal(ev[2].event_key, `result_submitted:${submitId}:${accessoryId}:1`);
    assert.equal(ev[3].event_key, `result_submitted:${submitId}:${accessoryId}:2`);
    // One human action, one submit_id, across the whole pair.
    assert.equal(new Set(ev.slice(1).map((e) => e.submit_id)).size, 1);

    const isi = await H.intervals(accessoryId);
    const testing = isi.find((i) => i.state_key === "testing")!;
    assert.ok(testing, "without #15 an accessory would never have a testing interval");
    assert.equal(testing.is_open, false, "the synthetic pair closes it in the same tx");
    assert.equal(testing.exit_reason, "result_submitted");
    assert.equal(testing.station_id, H.STATION_INTAKE);
    assert.notEqual(testing.wall_seconds, null);
    assert.equal(testing.is_accessory, true);
    assert.equal(testing.unit_id, parentId, "the accessory's intervals belong to the parent's unit");

    const [run] = await H.runs(accessoryId);
    assert.equal(run.is_accessory, true);
    assert.equal(run.unit_id, parentId);
    assert.notEqual(run.closed_at, null);

    const results = await H.testResults(accessoryId);
    assert.equal(results.length, 1);
    assert.equal(results[0].state_event_id, ev[3].event_id, "Q8 anchors pass/fail to the exit event");

    // The parent is untouched and still agrees with the ledger.
    assert.equal((await H.routeRow(parentId)).current_status, H.STATUS.queued);
    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #11 — the "no continuation" finishes, now inside the main tx (§4.8)
  // -------------------------------------------------------------------------

  it("#11(b) no station of the required type finishes the item WITH its event, in the submit's own tx", async () => {
    const itemId = 5020;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ORPHAN_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: submitId,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.isLastStation, true);

    const ev = await H.events(itemId);
    const advance = ev[ev.length - 2];
    const finish = ev[ev.length - 1];
    assert.equal(advance.reason, "result_submitted");
    assert.equal(advance.to_state, "queued");
    assert.equal(finish.event_key, `no_station_for_type:${submitId}:${itemId}:1`);
    assert.equal(finish.reason, "no_station_for_type");
    assert.equal(finish.to_state, "done");
    assert.equal(finish.seq, 1);
    assert.equal(finish.station_type_id, H.TYPE_ORPHAN);
    assert.equal(finish.payload.branch, "no_station_of_type");

    const open = (await H.openInterval(itemId))!;
    assert.equal(open.state_key, "done");
    const [run] = await H.runs(itemId);
    assert.equal(run.close_reason, "no_station_for_type");
    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.done);

    // §4.5 #14 lists #5/#6/#8/#9/#10 — not #11. The result row stays anchored
    // to the advance event; the finish is a route-level fact, not a result.
    const results = await H.testResults(itemId);
    assert.equal(results[0].state_event_id, advance.event_id);

    await assertNoDrift();
  });

  it("#11(a) returnToRoute onto a step the settings screen deleted finishes the item, and planned_steps keeps the snapshot", async () => {
    const itemId = 5021;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });

    // step 1 → step 2
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
    });
    // step 2 → research → back
    await H.startTest({ itemId, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_FUNC_A,
      CurrentRouteStep: 2,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
      sendToResearch: true,
    });
    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });

    // PUT /api/settings/testing-routes overwrites route_steps in place — this
    // is the classic cause of #11(a): the item is parked on a step that no
    // longer exists.
    await H.q(
      "UPDATE testing_routes SET route_steps = ARRAY[$2::int] WHERE item_type_id = $1 AND route_number = 1",
      [H.ITEM_TYPE_TWO_STEP, H.TYPE_INTAKE],
    );

    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 2,
      RouteStepsLength: 2, // the client's stale copy of the route
      SubmitID: submitId,
      returnToRoute: true,
    });
    assert.equal(res.status, 200);

    const ev = await H.events(itemId);
    const requeue = ev[ev.length - 2];
    const finish = ev[ev.length - 1];
    assert.equal(requeue.event_key, `returned_to_route:${submitId}:${itemId}:0`);
    assert.equal(requeue.to_state, "queued");
    assert.equal(finish.event_key, `no_station_for_type:${submitId}:${itemId}:1`);
    assert.equal(finish.to_state, "done");
    assert.equal(finish.payload.branch, "route_shortened");
    assert.ok(ms(finish.occurred_at) > ms(requeue.occurred_at));

    const open = (await H.openInterval(itemId))!;
    assert.equal(open.state_key, "done", "without #11(a) the ledger would sit on queued forever");
    const [run] = await H.runs(itemId);
    assert.notEqual(run.closed_at, null);
    // §3.2: the run's plan is a snapshot; editing settings cannot rewrite
    // retroactively what this run's last step was.
    assert.deepEqual(run.planned_steps, [H.TYPE_INTAKE, H.TYPE_FUNC]);

    assert.equal((await H.routeRow(itemId)).current_status, H.STATUS.done);
    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #12 — station_reassigned, two sites in one submission
  // -------------------------------------------------------------------------

  it("#12 regular route: the in-tx step assignment (seq 2) and the load-balancing pick (seq 3) are two events", async () => {
    const itemId = 5031;
    // Two stations of the destination type, so the load-balancing block at the
    // end of the transaction actually runs and reassigns on top of the earlier
    // findStationForRouteStep pick.
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: submitId,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.isLastStation, false);

    const notes = (await H.events(itemId)).filter((e) => e.reason === "station_reassigned");
    assert.equal(notes.length, 2);
    const bySeq = new Map(notes.map((n) => [n.seq, n]));
    assert.equal(bySeq.get(2)!.event_key, `station_reassigned:${submitId}:${itemId}:2`);
    assert.equal(bySeq.get(2)!.payload.site, "route_step_assignment");
    assert.equal(bySeq.get(3)!.event_key, `station_reassigned:${submitId}:${itemId}:3`);
    assert.equal(bySeq.get(3)!.payload.site, "next_station_load_balancing");
    assert.equal(bySeq.get(3)!.station_type_id, H.TYPE_FUNC);
    // The last pick is the one item_routes ends up carrying.
    assert.equal((await H.routeRow(itemId)).test_station_id, bySeq.get(3)!.station_id);

    // Notes never reach the fold: step 1 queued → testing → step 2 queued.
    assert.deepEqual(
      (await H.intervals(itemId)).map((i) => [i.state_key, i.step_no]),
      [
        ["queued", 1],
        ["testing", 1],
        ["queued", 2],
      ],
    );

    await assertNoDrift();
  });

  it("#12 research route: two station_reassigned sites in one submission are TWO events (the explicit per-site seq)", async () => {
    const itemId = 5030;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    const submitId = randomUUID();
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: submitId,
      sendToResearch: true,
    });
    assert.equal(res.status, 200);

    const notes = (await H.events(itemId)).filter((e) => e.reason === "station_reassigned");
    // Without the explicit seq both sites would mint the same event_key and the
    // second would be classified a "true replay" and swallowed (§4.4).
    assert.equal(notes.length, 2);
    assert.deepEqual(
      notes.map((n) => n.seq).sort(),
      [2, 3],
    );
    assert.equal(new Set(notes.map((n) => n.event_key)).size, 2);
    assert.equal(new Set(notes.map((n) => n.event_id)).size, 2);
    const bySeq = new Map(notes.map((n) => [n.seq, n]));
    assert.equal(bySeq.get(3)!.event_key, `station_reassigned:${submitId}:${itemId}:3`);
    assert.equal(bySeq.get(3)!.payload.site, "find_best_research_station");
    assert.equal(bySeq.get(2)!.event_key, `station_reassigned:${submitId}:${itemId}:2`);
    assert.equal(bySeq.get(2)!.payload.site, "research_load_balancing");
    assert.ok(notes.every((n) => n.kind === "note"));

    // Notes are audit only — the fold ignores them entirely.
    const isi = await H.intervals(itemId);
    assert.deepEqual(
      isi.map((i) => i.state_key),
      ["queued", "testing", "queued_research"],
    );

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // #14 — test_results.state_event_id across the branches
  // -------------------------------------------------------------------------

  it("#14 every submission's test_results row carries the state_event_id of its own branch", async () => {
    const itemId = 5040;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_TWO_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
      sendToResearch: true,
    });
    await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
    });
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 2,
      SubmitID: randomUUID(),
      returnToRoute: true,
    });

    const ev = await H.events(itemId);
    const byId = new Map(ev.map((e) => [e.event_id, e]));
    const results = await H.testResults(itemId);
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.state_event_id != null), "no result row may be unanchored");
    assert.deepEqual(
      results.map((r) => byId.get(r.state_event_id as number)!.reason),
      // The returned_to_route link is the v1 omission §4.5 #14 calls out: it is
      // the most common way a research result reaches the system, and without
      // it those results vanish from Q8.
      ["sent_to_research", "research_note", "returned_to_route"],
    );

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // Retry / replay
  // -------------------------------------------------------------------------

  it("a retried submit with the same SubmitID does not advance the route twice and adds nothing to the ledger", async () => {
    const itemId = 5050;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });

    const body = {
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 1,
      SubmitID: randomUUID(),
    };
    assert.equal((await H.submitResult(body)).status, 200);

    const evBefore = await H.events(itemId);
    const isiBefore = await H.intervals(itemId);
    const runsBefore = await H.runs(itemId);
    const routeBefore = await H.routeRow(itemId);
    const resultsBefore = await H.testResults(itemId);
    const historyBefore = await H.q("SELECT count(*)::int AS n FROM item_route_history WHERE item_id = $1", [itemId]);

    const retry = await H.submitResult(body);
    // The Phase-0 optimistic guard (finished_at IS NULL + current_route_step)
    // matches 0 rows, the handler throws, and the WHOLE transaction — ledger
    // events included — rolls back. That is the §4.8 guarantee read backwards.
    assert.equal(retry.status, 404);

    assert.deepEqual(await H.events(itemId), evBefore);
    assert.deepEqual(await H.intervals(itemId), isiBefore);
    assert.deepEqual(await H.runs(itemId), runsBefore);
    assert.deepEqual(await H.routeRow(itemId), routeBefore);
    assert.deepEqual(await H.testResults(itemId), resultsBefore);
    assert.deepEqual(
      await H.q("SELECT count(*)::int AS n FROM item_route_history WHERE item_id = $1", [itemId]),
      historyBefore,
    );

    await assertNoDrift();
  });

  it("R1 — replaying a final event after the run closed returns the original id with zero side effects", async () => {
    const itemId = 5051;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    const submitId = randomUUID();
    await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 1,
      SubmitID: submitId,
    });

    const evBefore = await H.events(itemId);
    const isiBefore = await H.intervals(itemId);
    const runsBefore = await H.runs(itemId);
    const finish = evBefore[evBefore.length - 1];
    assert.equal(finish.to_state, "done");
    assert.notEqual(runsBefore[0].closed_at, null);

    // Replay the identical call. Before the §4.2 fix this walked into the
    // auto-open branch — closing the done interval with 'reroute' and opening
    // an empty run — before ever reaching the ON CONFLICT.
    const [replayed] = await H.q<{ event_id: number }>(
      `SELECT metrics_record($1, $2::bigint, 'done', $3, $4, $5, $6, $7,
                             'result_submitted', $8::uuid, 'transition', 1::smallint, '{}'::jsonb) AS event_id`,
      [
        finish.event_key,
        itemId,
        finish.step_no,
        finish.station_id,
        finish.station_type_id,
        finish.worker_id,
        finish.worker_name,
        submitId,
      ],
    );

    assert.equal(replayed.event_id, finish.event_id, "replay returns the ORIGINAL event_id");
    assert.deepEqual(await H.events(itemId), evBefore);
    assert.deepEqual(await H.runs(itemId), runsBefore, "no new run may be opened");
    const isiAfter = await H.intervals(itemId);
    assert.deepEqual(isiAfter, isiBefore);
    const done = isiAfter[isiAfter.length - 1];
    assert.equal(done.is_open, true);
    assert.equal(done.exit_reason, null);
    assert.equal(done.closed_at, null);

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // Auto-open, manual_override, rebuild
  // -------------------------------------------------------------------------

  it("auto-open — a legacy item's first transition opens a run and marks payload.auto_opened_run", async () => {
    const itemId = 5060;
    // An item created by the OLD image between the backfill and the cutover:
    // operational rows, no route_run, no events (§4.2).
    await H.seedLegacyItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    assert.deepEqual(await H.runs(itemId), []);

    const actionUuid = randomUUID();
    const res = await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid });
    assert.equal(res.status, 200, "a legacy row must NOT fail the worker's submit with a 500");

    const ev = await H.events(itemId);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event_key, `test_started:${actionUuid}`);
    assert.equal(ev[0].payload.auto_opened_run, true, "surprise opens are marked and counted in selfcheck");

    const [run] = await H.runs(itemId);
    assert.equal(run.run_no, 1);
    assert.deepEqual(run.planned_steps, [H.TYPE_INTAKE]);

    const isi = await H.intervals(itemId);
    assert.equal(isi.length, 1);
    assert.equal(isi[0].state_key, "testing");
    assert.equal(isi[0].attempt_no, 1);
    assert.equal(isi[0].station_id, H.STATION_INTAKE);
    assert.equal(isi[0].is_open, true);

    await assertNoDrift();
  });

  it("manual_override on a finished item opens run #2 and closes the done interval with exit_reason='reroute'", async () => {
    const itemId = 5070;
    await finishItem(itemId);
    const run1 = (await H.runs(itemId))[0];

    await manualOverride(itemId);

    const runsAfter = await H.runs(itemId);
    assert.equal(runsAfter.length, 2);
    assert.equal(runsAfter[0].route_run_id, run1.route_run_id);
    assert.equal(runsAfter[1].run_no, 2);
    assert.equal(runsAfter[1].closed_at, null);

    const isi = await H.intervals(itemId);
    const done = isi.find((i) => i.state_key === "done")!;
    assert.equal(done.route_run_id, run1.route_run_id);
    assert.equal(done.is_open, false, "metrics_open_run bounds the terminal interval");
    assert.equal(done.exit_reason, "reroute");
    assert.equal(ms(done.closed_at!), ms(runsAfter[1].opened_at));

    const open = (await H.openInterval(itemId))!;
    assert.equal(open.state_key, "queued");
    assert.equal(open.route_run_id, runsAfter[1].route_run_id);
    assert.equal(open.entry_reason, "manual_override");

    // manual_override is on the §4.2 exclusion list — its own run-open is
    // expected, not a surprise, so it carries no auto_opened_run marker.
    const override = (await H.events(itemId)).at(-1)!;
    assert.equal(override.reason, "manual_override");
    assert.equal(override.payload.auto_opened_run, undefined);

    await assertNoDrift();
  });

  it("R2 — isi_rebuild_run on a run that is NOT the last reproduces it and leaves the live run untouched", async () => {
    const itemId = 5071;
    await finishItem(itemId);
    await manualOverride(itemId);

    const [run1, run2] = await H.runs(itemId);
    const before = await H.intervals(itemId);
    const liveBefore = before.find((i) => i.route_run_id === run2.route_run_id)!;

    // SET CONSTRAINTS ... DEFERRED inside isi_rebuild_run only has meaning in
    // an explicit transaction block, which is also how the runbook calls it.
    const [n] = await H.inTransaction<{ n: number }>("SELECT isi_rebuild_run($1) AS n", [
      run1.route_run_id,
    ]);
    assert.equal(n.n, 4, "item_created + test_started + result_submitted ×2");

    const after = await H.intervals(itemId);
    assert.deepEqual(
      after.map((i) => [i.state_key, i.step_no, i.attempt_no, i.exit_reason]),
      before.map((i) => [i.state_key, i.step_no, i.attempt_no, i.exit_reason]),
      "the fold is deterministic — a rebuild reproduces the ledger",
    );

    const doneAfter = after.find((i) => i.route_run_id === run1.route_run_id && i.state_key === "done")!;
    assert.equal(doneAfter.exit_reason, "reroute", "the next run's boundary is restored");
    assert.equal(ms(doneAfter.closed_at!), ms(run2.opened_at));

    const runsAfter = await H.runs(itemId);
    assert.equal(ms(runsAfter[0].closed_at!), ms(run1.closed_at!), "run1.closed_at must not move");
    assert.equal(runsAfter[1].closed_at, null);

    const liveAfter = after.find((i) => i.route_run_id === run2.route_run_id)!;
    assert.equal(liveAfter.interval_id, liveBefore.interval_id, "the live run's interval is not rebuilt");
    assert.equal(liveAfter.is_open, true);

    await assertNoDrift();
  });

  it("R3 — one orphan item_routes row cannot kill the reaper batch", async () => {
    // ir_item_fk ships NOT VALID because orphan item_routes rows are proven to
    // exist on the production volume. metrics_open_run INNER JOINs items, so an
    // orphan reaching metrics_record raises inside the reaper's single
    // statement and rolls back the WHOLE batch — the floor's safety net would
    // then be dead forever, since the same orphan matches again every run.
    const healthy = 7301;
    const orphan = 7302;

    await H.seedItem({ itemId: healthy, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId: healthy, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await H.ageProcessingStart(healthy, 120);

    // An item_routes row with NO items row, stale and in-test — the exact
    // poison class the deleted PUT /api/items/[id]/status used to produce.
    // The row has to predate the constraint, which is precisely why migration A
    // adds ir_item_fk as NOT VALID: dropping and re-adding it NOT VALID around
    // the insert reproduces the production shape exactly (existing rows
    // unchecked, new writes enforced).
    await H.withDriftDetectorOff(async () => {
      await H.q("ALTER TABLE item_routes DROP CONSTRAINT ir_item_fk");
      try {
        await H.q(
          `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step,
                                    test_station_id, created_at, is_finished, queue_start_time,
                                    processing_start_time, route_number)
           VALUES ($1, $2, 1, 1, $3, NOW(), false, NOW() - INTERVAL '180 minutes',
                   NOW() - INTERVAL '150 minutes', 1)`,
          [orphan, H.ITEM_TYPE_ONE_STEP, H.STATION_INTAKE],
        );
      } finally {
        await H.q(
          `ALTER TABLE item_routes ADD CONSTRAINT ir_item_fk
             FOREIGN KEY (item_id) REFERENCES items(item_id) NOT VALID`,
        );
      }
    });

    const res = await H.runReaper();
    assert.equal(res.status, 200, "the reaper must survive an orphan row");
    assert.equal(res.body.releasedCount, 1, "the healthy item is still released");

    const healthyRow = await H.one<{ current_status: number }>(
      "SELECT current_status FROM item_routes WHERE item_id = $1", [healthy],
    );
    assert.equal(healthyRow.current_status, H.STATUS.queued, "healthy item back in queue");

    const orphanRow = await H.one<{ current_status: number }>(
      "SELECT current_status FROM item_routes WHERE item_id = $1", [orphan],
    );
    assert.equal(orphanRow.current_status, H.STATUS.testing, "the orphan is skipped, not released");
    assert.equal((await H.events(orphan)).length, 0, "and produces no events");

    await assertNoDrift();
  });

  it("R4 — a research note on a run-less legacy item opens a run instead of 500ing", async () => {
    // §4.2 promises graceful degradation, but auto-open originally covered only
    // kind='transition'. A note on an item with no run returned NULL, which
    // recordNote turned into a 500 — so every interim research save on a legacy
    // item failed, while the equivalent transition succeeded.
    const itemId = 7310;
    await H.seedLegacyItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.withDriftDetectorOff(() =>
      H.q(
        `UPDATE item_routes SET current_status = 5, processing_start_time = NOW()
          WHERE item_id = $1`, [itemId],
      ),
    );
    assert.equal((await H.q("SELECT 1 FROM route_run WHERE item_id = $1", [itemId])).length, 0);

    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_RESEARCH,
      CurrentRouteStep: 1,
      RouteStepsLength: 1,
      SubmitID: randomUUID(),
    });
    assert.equal(res.status, 200, "the interim research save must not 500");

    const notes = (await H.events(itemId)).filter((e) => e.reason === "research_note");
    assert.equal(notes.length, 1, "the note was recorded");
    assert.equal(
      (await H.q("SELECT 1 FROM route_run WHERE item_id = $1", [itemId])).length, 1,
      "a run was auto-opened for it",
    );

    await assertNoDrift();
  });

  // -------------------------------------------------------------------------
  // Local composition helpers
  // -------------------------------------------------------------------------

  /**
   * Sets one station type's reaper threshold — the column the endpoint now
   * reads instead of its old constant. Reference data, not a write path: no
   * item_routes row is touched, so the drift detector stays armed.
   */
  async function setStaleAfterMinutes(typeId: number, minutes: number): Promise<void> {
    await H.q(
      "UPDATE test_stations_type SET stale_after_minutes = $2 WHERE test_station_type_id = $1",
      [typeId, minutes],
    );
  }

  /** Seeds an item and drives it through the real handlers to `done`. */
  async function finishItem(itemId: number): Promise<void> {
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    const res = await H.submitResult({
      ItemID: itemId,
      StationID: H.STATION_INTAKE,
      CurrentRouteStep: 1,
      RouteStepsLength: 1,
      SubmitID: randomUUID(),
    });
    assert.equal(res.status, 200);
  }

  /**
   * The manager override of §4.5 #13: PUT /api/items/[id]/status is DELETED,
   * and its replacement is "a new manager-guarded endpoint that emits
   * manual_override". Until that endpoint exists this exercises the contract
   * it must honour — the item_routes UPDATE and the event in ONE transaction.
   */
  async function manualOverride(itemId: number): Promise<void> {
    await H.h().prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`
        UPDATE item_routes
           SET current_status = 2, current_route_step = 1, is_finished = false,
               finished_at = NULL, queue_start_time = NOW()
         WHERE item_id = ${BigInt(itemId)}
      `;
      await tx.$queryRaw`
        SELECT metrics_record(
          ${`manual_override:${randomUUID()}`}, ${BigInt(itemId)}::bigint, 'queued', 1,
          NULL::int, ${H.TYPE_INTAKE}::int, NULL::int, NULL,
          'manual_override') AS event_id
      `;
    });
  }
});
