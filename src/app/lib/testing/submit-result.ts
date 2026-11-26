import { Prisma } from "@prisma/client";
import { prisma, type TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { ItemStatus, StationStatus, isResearchStatus } from "@/lib/item-status";
import { parseDbId, parseItemId } from "@/lib/http/request";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { recordNote, recordTransition, type EventKeyParts } from "@/app/lib/metrics/ledger/record";
import { loadPackageContext, type PackageContext } from "@/app/lib/packages/context";
import { recheckPackageReadiness } from "@/app/lib/packages/readiness";
import { GATE_FINISH_ON_REQUIRED } from "@/app/lib/station-fields/evaluate";
import { checkFieldsSubmission, resolveForSubmission } from "@/app/lib/station-fields/submit";
import {
  findBestStation,
  findLeastLoadedResearchStation,
  findLeastWaitingStation,
  findStationForRouteStep,
} from "@/app/lib/station-assignment";
import { parseActor, type Actor } from "./actor";
import type { NextStationResult, PackageGateAnswer, ResearchStation, ResultBody } from "./contract";

/**
 * POST /api/testing/results: one result of one item at a station, and everything it moves — the
 * route, the research queue, the next station, the box gate — with its metrics ledger events
 * (docs/architecture/dashboard-migration-plan-v2.md §4.5: the call sites are numbered there).
 */

/** A result as the route takes it, after the request's checks. */
export type ResultInput = {
  itemId: bigint;
  stationId: number;
  /** The route step the result is for: the body's, else the row's. */
  step: number;
  queueStartTime: Date;
  processingStartTime: Date | null;
  sentAt: Date | null;
  returnAt: Date | null;
  result: number;
  comments?: string;
  passed?: boolean;
  details?: unknown;
  /** The body's item type, else the row's. */
  itemTypeId: number;
  sendToResearch?: boolean;
  /** Research: back to the route at the same step (5→2). */
  returnToRoute?: boolean;
  /** Research: the route ends here (5→3). */
  finishRoute?: boolean;
  actor: Actor;
  now: Date;
};

/** The body the route reads: the contract's, and two research_history columns no client sends. */
export type ResultRequest = ResultBody & { SentAt?: string; ReturnAt?: string };

/**
 * The body as a ResultInput. Route and timing fields may be omitted — a wizard submitting one result
 * per item inside a box doesn't hold each item's route — and are then read from the item's row.
 */
export async function resultInputOf(body: ResultRequest): Promise<ResultInput> {
  const { Result } = body;
  const itemId = parseItemId(body.ItemID);
  const stationId = parseDbId(body.StationID);
  if (itemId == null || stationId == null) throw new HttpError(400, "ItemID and StationID are required");
  // A missing SubmitID gets a server one (actor.ts); the payload marker server_generated_submit_id
  // shows the request has no retry idempotency.
  const actor = parseActor(body, "results");

  let { CurrentRouteStep, RouteStepsLength, QueueStartTime, ProcessingStartTime, ItemTypeId, CreatedAt } = body;
  if (CurrentRouteStep === undefined || RouteStepsLength === undefined || !QueueStartTime || !ItemTypeId || !CreatedAt) {
    const [info] = await prisma.$queryRaw<{
      current_route_step: number;
      queue_start_time: Date;
      processing_start_time: Date | null;
      item_type_id: number;
      created_at: Date;
      route_len: number;
    }[]>`
      SELECT ir.current_route_step, ir.queue_start_time, ir.processing_start_time, ir.item_type_id, ir.created_at,
             COALESCE(array_length(tr.route_steps, 1), 0) AS route_len
      FROM item_routes ir
      LEFT JOIN testing_routes tr ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
      WHERE ir.item_id = ${itemId}
    `;
    if (info) {
      if (CurrentRouteStep === undefined) CurrentRouteStep = info.current_route_step;
      if (RouteStepsLength === undefined) RouteStepsLength = Number(info.route_len) || 0;
      if (!QueueStartTime && info.queue_start_time) QueueStartTime = new Date(info.queue_start_time).toISOString();
      if (ProcessingStartTime === undefined) ProcessingStartTime = info.processing_start_time ? new Date(info.processing_start_time).toISOString() : null;
      if (!ItemTypeId) ItemTypeId = info.item_type_id;
      if (!CreatedAt && info.created_at) CreatedAt = new Date(info.created_at).toISOString();
    }
  }

  if (Result === undefined || CurrentRouteStep === undefined || !QueueStartTime || RouteStepsLength === undefined || RouteStepsLength <= 0) {
    throw new HttpError(400, "ItemID, StationID, CurrentRouteStep, RouteStepsLength (must be > 0), QueueStartTime, and Result are required");
  }

  const dateOf = (v: string | null | undefined) => {
    const iso = v ? normalizeToUtcIso(v) : null;
    return iso ? new Date(iso) : null;
  };
  const sentAt = dateOf(body.SentAt);
  const returnAt = dateOf(body.ReturnAt);
  const queueStartTime = dateOf(QueueStartTime);
  const processingStartTime = dateOf(ProcessingStartTime);
  if (!queueStartTime) throw new HttpError(400, "Invalid QueueStartTime");

  return {
    itemId,
    stationId,
    step: CurrentRouteStep as number,
    queueStartTime,
    processingStartTime,
    sentAt,
    returnAt,
    result: Result,
    comments: body.Comments,
    passed: body.Passed,
    details: body.Details,
    itemTypeId: ItemTypeId as number,
    sendToResearch: body.sendToResearch,
    returnToRoute: body.returnToRoute,
    finishRoute: body.finishRoute,
    actor,
    now: new Date(),
  };
}

export type SubmitOutcome =
  | { replay: true }
  | {
      replay: false;
      researchId: number | null;
      logId: number | null;
      next: NextStationResult;
      recommendedResearchStation: ResearchStation | null;
      packageGate: PackageGateAnswer | null;
    };

/** item_routes as the transaction locks it (FOR UPDATE). */
type LockedRouteRow = {
  route_number: number;
  current_status: number;
  item_type_id: number;
  current_route_step: number;
  fields_version: number | null;
};

/** One submit inside its transaction. */
type Submit = {
  tx: TransactionClient;
  r: ResultInput;
  routeNumber: number;
  currentStatus: number;
  /** The submitting station's type: the events carry it. */
  stationTypeId: number | null;
  /** Events after a synthetic start shift one seq (call site #15). */
  seqOffset: number;
  /** Every event's payload starts with it. */
  payload: Record<string, unknown>;
  /** testing_routes reads by "itemType:step" — nothing in a submit writes testing_routes. */
  steps: Map<string, RouteStepRow | undefined>;
};

/** Where a result left the item's row. */
type Moved = { status: number | null; step: number | null; itemTypeId: number | null; eventId: bigint | null };

/**
 * The result, in ONE transaction: history, item_routes, research history, the station, the ledger
 * events, the next station with its "no continuation" finishes (§4.8) and the box gate — so a
 * done-write can never commit without its event. The timeout is above Prisma's 5 s default because
 * the next-station section runs inside it.
 */
export function submitResult(r: ResultInput): Promise<SubmitOutcome> {
  return prisma.$transaction((tx) => submitInTx(tx, r), { maxWait: 5000, timeout: 15000 });
}

async function submitInTx(tx: TransactionClient, r: ResultInput): Promise<SubmitOutcome> {
  // FOR UPDATE is a LOCK-ORDER guarantee, not an optimisation. Every other write path (start-test,
  // release-test, the reaper, the intake) takes the item_routes ROW lock first and
  // metrics_record's per-item advisory lock second. Call site #15 below emits BEFORE this handler's
  // first UPDATE, so without this it would take the advisory lock first and invert the order — a
  // box item's submit and a start-test on the same item could then deadlock (ABBA). Taking the row
  // lock here makes the order identical everywhere; the UPDATEs below would have taken it anyway,
  // so nothing is held longer than before.
  //
  // item_type_id / current_route_step / fields_version: the station-fields check below resolves the
  // step from THIS locked row, never from the body.
  const [row] = await tx.$queryRaw<LockedRouteRow[]>`
    SELECT route_number, current_status, item_type_id, current_route_step, fields_version
    FROM item_routes
    WHERE item_id = ${r.itemId}
    FOR UPDATE
  `;
  if (!row) throw new HttpError(404, "Item route not found");

  // IDEMPOTENCY, decided by the submit_id alone — before anything is read or written. One
  // submit_id is one human action on one item.
  //
  // Per-event event_key deduplication is NOT enough here, and relying on it was a real defect found
  // end-to-end on the deployed image: a retry of an already-committed submit advanced the route TWO
  // more steps and finished the item. The keys all differ on the second call because `seq` shifts
  // when call site #15's synthetic test_started fires, and whether it fires depends on the item's
  // CURRENT status — which the first call changed. So every key was new and nothing was recognised
  // as a replay.
  //
  // Scoped to (submit_id, item_id) on purpose: the intake wizard sends ONE submit_id for the parent
  // AND every item in the box (§4.7, so `operations` counts the human action once), and each of those is a
  // different item that must still be processed.
  //
  // Only a CLIENT-supplied id can be trusted for this. A server-minted fallback is unique per
  // request and would never match.
  if (r.actor.fromClient) {
    const replayed = await tx.$queryRaw<{ event_id: bigint }[]>`
      SELECT event_id FROM item_state_event
       WHERE submit_id = ${r.actor.actionId}::uuid AND item_id = ${r.itemId}
       LIMIT 1
    `;
    if (replayed.length > 0) return { replay: true };
  }

  const inResearch = row.current_status === ItemStatus.InResearch;

  // Package model (docs/features/packages/PLAN.md §4): is this row the box or an item inside one?
  const pkgCtx = await loadPackageContext(tx, r.itemId);
  if (pkgCtx?.isPackage && r.sendToResearch === true) {
    // Research is for items. A box in research would strand its items at the opening station with
    // no one to submit for them.
    throw new HttpError(409, "מארז לא נשלח למחקר — הפניה למחקר היא של פריטים בלבד", { code: "PACKAGE_CANNOT_GO_TO_RESEARCH" });
  }

  const writeRouteHistory = !inResearch || r.returnToRoute === true || r.finishRoute === true;
  const writeResearchHistory = inResearch || (row.current_status === ItemStatus.InTest && r.sendToResearch === true);

  const [stationType] = await tx.$queryRaw<{ test_station_type_id: number }[]>`
    SELECT test_station_type_id FROM test_stations WHERE test_station_id = ${r.stationId}
  `;
  const stationTypeId = stationType?.test_station_type_id ?? null;

  // Station fields (route-fields spec §3.4): checked and re-derived from the published config
  // before the first write, so a rejected submit leaves nothing behind, and a replay (above) is
  // never checked again. A row taken in before the first publish (fields_version NULL) keeps its
  // Details exactly as sent.
  const fieldsTarget = await resolveForSubmission(tx, {
    itemId: r.itemId,
    stationId: r.stationId,
    stationTypeId,
    row,
    pkgCtx,
  });
  const details = checkFieldsSubmission(fieldsTarget, {
    details: r.details,
    // "העבר לחקר" and research are never gated; note length always is.
    gate: GATE_FINISH_ON_REQUIRED && r.sendToResearch !== true && !isResearchStatus(row.current_status),
  });

  const seqOffset = row.current_status === ItemStatus.Queued ? 1 : 0;
  const s: Submit = {
    tx,
    r,
    routeNumber: row.route_number,
    currentStatus: row.current_status,
    stationTypeId,
    seqOffset,
    payload: r.actor.fromClient ? {} : { server_generated_submit_id: true },
    steps: new Map(),
  };
  if (seqOffset) await recordSyntheticStart(s);

  const logId = writeRouteHistory ? await insertRouteHistory(s) : null;

  let m: Moved;
  if (inResearch && r.returnToRoute === true) m = await returnToRoute(s);
  else if (inResearch && r.finishRoute === true) m = await finishRoute(s);
  else if (inResearch) m = await researchNote(s, row.item_type_id);
  else if (r.sendToResearch === true) m = await sendToResearch(s);
  else m = await advance(s);

  if (writeRouteHistory && (!m.step || !m.itemTypeId)) {
    throw new HttpError(500, "Failed to update item route");
  }

  if (r.sendToResearch !== true && !(inResearch && !r.returnToRoute && !r.finishRoute) && !(inResearch && r.returnToRoute === true)) {
    await finishIfRouteEnded(s, m);
  }

  const researchId = writeResearchHistory ? await insertResearchHistory(s) : null;
  await insertTestResult(s, details, m.eventId);
  await tx.test_stations.update({
    where: { test_station_id: r.stationId },
    data: { status: StationStatus.Free },
  });

  const recommendedResearchStation = r.sendToResearch === true ? await assignResearchStation(s, m) : null;
  const next = await nextStationOrFinish(s, m);

  const packageGate = await recheckGate(s, pkgCtx, m.status);

  return { replay: false, researchId, logId, next, recommendedResearchStation, packageGate };
}

function who(s: Submit) {
  return { workerId: s.r.actor.workerId, workerName: s.r.actor.workerName, submitId: s.r.actor.actionId };
}

/** A submit's events are keyed reason:action:item:seq (§4.4): the seq tells one submit's moves apart. */
const inSubmit = (s: Submit): EventKeyParts => ({ actionId: s.r.actor.actionId, item: true, seq: true });

/** Call site #15 (§4.5/§4.7): an item submitted while still queued never went through start-test —
 *  the intake wizard tests the items under their box, and package-level queues never list them.
 *  Without a synthetic test_started the item would have no `testing` interval, ever. */
async function recordSyntheticStart(s: Submit): Promise<void> {
  await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "testing",
    stepNo: s.r.step,
    stationId: s.r.stationId,
    stationTypeId: s.stationTypeId,
    ...who(s),
    reason: "test_started",
    seq: 0,
    payload: { ...s.payload, synthetic_pair: true },
  });
}

async function insertRouteHistory(s: Submit): Promise<number | null> {
  const [h] = await s.tx.$queryRaw<{ log_id: number }[]>`
    INSERT INTO item_route_history (
      item_id, test_station_id, current_route_step,
      queue_start_time, processing_start_time, processing_end_time,
      worker_id, route_number
    )
    VALUES (
      ${s.r.itemId}, ${s.r.stationId}, ${s.r.step},
      ${s.r.queueStartTime}::timestamp,
      ${s.r.processingStartTime}::timestamp,
      ${s.r.now}::timestamp,
      ${s.r.actor.workerId || null}, ${s.routeNumber}
    )
    RETURNING log_id
  `;
  return h?.log_id || null;
}

async function insertResearchHistory(s: Submit): Promise<number | null> {
  const [h] = await s.tx.$queryRaw<{ research_id: number }[]>`
    INSERT INTO research_history (
      item_id, station_id, result, comments, worker_id, sent_at, return_at
    )
    VALUES (
      ${s.r.itemId}, ${s.r.stationId}, ${s.r.result}, ${s.r.comments || null},
      ${s.r.actor.workerId || null},
      ${s.r.sentAt}::timestamp,
      ${s.r.returnAt}::timestamp
    )
    RETURNING research_id
  `;
  return h?.research_id || null;
}

/** The result itself (the box's or an item's — each is its own routed item). state_event_id
 *  anchors it to its ledger event (call site #14), so Q8 can join pass/fail onto state intervals. */
async function insertTestResult(s: Submit, details: unknown, stateEventId: bigint | null): Promise<void> {
  await s.tx.$executeRaw`
    INSERT INTO test_results (
      item_id, test_station_id, test_station_type_id, route_number, route_step,
      worker_id, passed, result, comments, details, state_event_id
    )
    VALUES (
      ${s.r.itemId}, ${s.r.stationId}, ${s.stationTypeId}, ${s.routeNumber}, ${s.r.step},
      ${s.r.actor.workerId || null}, ${s.r.passed ?? null}, ${s.r.result}, ${s.r.comments || null},
      ${details != null ? JSON.stringify(details) : null}::jsonb,
      ${stateEventId}
    )
  `;
}

// ---- the transitions ---------------------------------------------------------------------------

type RouteUpdateRow = { current_status: number; current_route_step: number; item_type_id: number; route_number: number };

/** The row's UPDATE for a result. `guard` is optimistic concurrency: an action that already moved
 *  the item (a duplicate submit, two workers with the same wizard open) matches 0 rows and fails
 *  here instead of moving it twice. */
async function updateRoute(s: Submit, set: Prisma.Sql, guard: Prisma.Sql): Promise<RouteUpdateRow> {
  const [u] = await s.tx.$queryRaw<RouteUpdateRow[]>`
    UPDATE item_routes
    SET ${set}
    WHERE item_id = ${s.r.itemId} AND route_number = ${s.routeNumber} AND finished_at IS NULL
      AND ${guard}
    RETURNING current_status, current_route_step, item_type_id, route_number
  `;
  if (!u) throw new HttpError(404, "Item route not found or already finished");
  return u;
}

const movedTo = (u: RouteUpdateRow, eventId: bigint | null): Moved =>
  ({ status: u.current_status, step: u.current_route_step, itemTypeId: u.item_type_id, eventId });

/** Research over (5→2), re-queued at the SAME step; attempt_no advances inside the DB. Call site
 *  #5. The station is NULL: a waiting item's station is NULL by construction. */
async function returnToRoute(s: Submit): Promise<Moved> {
  const u = await updateRoute(
    s,
    Prisma.sql`current_status = ${ItemStatus.Queued}, queue_start_time = ${s.r.now}::timestamp`,
    Prisma.sql`current_status = ${ItemStatus.InResearch}`,
  );
  const eventId = await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "queued",
    stepNo: u.current_route_step,
    stationId: null,
    stationTypeId: null,
    ...who(s),
    reason: "returned_to_route",
    seq: 0,
    payload: s.payload,
  });
  return movedTo(u, eventId);
}

/** The route finishes out of research (5→3). Call site #6. */
async function finishRoute(s: Submit): Promise<Moved> {
  const u = await updateRoute(
    s,
    Prisma.sql`current_status = ${ItemStatus.Done}, finished_at = ${s.r.now}::timestamp, is_finished = true`,
    Prisma.sql`current_status = ${ItemStatus.InResearch}`,
  );
  const eventId = await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "done",
    stepNo: u.current_route_step,
    stationId: s.r.stationId,
    stationTypeId: s.stationTypeId,
    ...who(s),
    reason: "result_submitted",
    seq: 0,
    payload: s.payload,
  });
  return movedTo(u, eventId);
}

/** An interim research save (5→5): item_routes stays, the research interval stays open; the note
 *  is what test_results anchors to. Call site #7. */
async function researchNote(s: Submit, rowItemTypeId: number): Promise<Moved> {
  const eventId = await recordNote(s.tx, {
    key: { actionId: s.r.actor.actionId, item: true },
    itemId: s.r.itemId,
    stepNo: s.r.step,
    stationId: s.r.stationId,
    stationTypeId: s.stationTypeId,
    ...who(s),
    reason: "research_note",
    seq: 0,
    payload: s.payload,
  });
  return { status: s.currentStatus, step: s.r.step, itemTypeId: rowItemTypeId || s.r.itemTypeId, eventId };
}

/** Diverted to the research queue (1→4) at the same step — the diversion itself is what's marked
 *  (call site #8) — and assigned to a research station. */
async function sendToResearch(s: Submit): Promise<Moved> {
  const u = await updateRoute(
    s,
    Prisma.sql`current_status = ${ItemStatus.AwaitResearch}, queue_start_time = ${s.r.now}::timestamp, processing_start_time = NULL`,
    Prisma.sql`current_status = ${ItemStatus.InTest}`,
  );
  const eventId = await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "queued_research",
    stepNo: u.current_route_step,
    stationId: null,
    stationTypeId: null,
    ...who(s),
    reason: "sent_to_research",
    seq: 0,
    payload: s.payload,
  });
  const stationId = await findBestStation(s.tx, "research");
  if (stationId !== null) {
    await reassign(s, { stationId, stepNo: u.current_route_step, seq: 3, site: "find_best_research_station" });
  }
  return movedTo(u, eventId);
}

/** The normal advance: queued for the NEXT step (call site #9; station NULL by construction for a
 *  waiting item), and assigned to a station of that step's type. */
async function advance(s: Submit): Promise<Moved> {
  const u = await updateRoute(
    s,
    Prisma.sql`current_status = ${ItemStatus.Queued}, current_route_step = current_route_step + 1, queue_start_time = ${s.r.now}::timestamp`,
    Prisma.sql`current_route_step = ${s.r.step}`,
  );
  const eventId = await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "queued",
    stepNo: u.current_route_step,
    stationId: null,
    stationTypeId: null,
    ...who(s),
    reason: "result_submitted",
    seq: s.seqOffset,
    payload: s.payload,
  });
  if (u.item_type_id && u.current_route_step) {
    const stationId = await findStationForRouteStep(s.tx, u.item_type_id, u.route_number, u.current_route_step);
    if (stationId !== null) {
      await reassign(s, { stationId, stepNo: u.current_route_step, seq: 2, site: "route_step_assignment" });
    }
  }
  return movedTo(u, eventId);
}

/** Call site #12 (§4.5): the item is assigned to a station — a note, never a transition. Each site
 *  has its own seq, so two reassignments in one submit never collapse into one event_key. */
async function reassign(
  s: Submit,
  a: { stationId: number; stationTypeId?: number | null; stepNo: number; seq: 2 | 3; site: string },
): Promise<void> {
  await s.tx.$executeRaw`
    UPDATE item_routes SET test_station_id = ${a.stationId}
    WHERE item_id = ${s.r.itemId} AND route_number = ${s.routeNumber} AND finished_at IS NULL
  `;
  await recordNote(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    stepNo: a.stepNo,
    stationId: a.stationId,
    stationTypeId: a.stationTypeId,
    ...who(s),
    reason: "station_reassigned",
    seq: a.seq,
    payload: { ...s.payload, station_id: a.stationId, site: a.site },
  });
}

// ---- the end of the route ----------------------------------------------------------------------

/** A route step's station type and the route's length (testing_routes.route_steps, 1-based). */
type RouteStepRow = { next_station_type_id: number | null; route_length: number | null };

async function routeStepAt(s: Submit, itemTypeId: number | null, step: number): Promise<RouteStepRow | undefined> {
  const key = `${itemTypeId}:${step}`;
  if (!s.steps.has(key)) {
    const [stepRow] = await s.tx.$queryRaw<RouteStepRow[]>`
      SELECT
        route_steps[${step}] AS next_station_type_id,
        array_length(route_steps, 1) AS route_length
      FROM testing_routes
      WHERE item_type_id = ${itemTypeId} AND route_number = ${s.routeNumber}
    `;
    s.steps.set(key, stepRow);
  }
  return s.steps.get(key);
}

/** No station type at the step: past the route's end, or the route was shortened in settings. */
const routeEndsAt = (stepRow: RouteStepRow | undefined, step: number): boolean =>
  !stepRow?.next_station_type_id || step > (stepRow.route_length || 0);

/** item_routes done. Call sites #11(b) and #11(c) leave is_finished as it was — unlike every other
 *  finish; kept as found, for the owner to decide. */
async function finishItem(s: Submit, at: Date, markFinished: boolean): Promise<void> {
  await s.tx.$executeRaw`
    UPDATE item_routes
    SET current_status = ${ItemStatus.Done}, finished_at = ${at}::timestamp${markFinished ? Prisma.sql`, is_finished = true` : Prisma.empty}
    WHERE item_id = ${s.r.itemId} AND route_number = ${s.routeNumber}
  `;
}

/** The step the item advanced to does not exist: done, in the SAME tx as the advance (call site
 *  #10). The seq keeps its key distinct from #9's (§4.4: the key carries the transition identity,
 *  not just the human action). */
async function finishIfRouteEnded(s: Submit, m: Moved): Promise<void> {
  if (m.status === ItemStatus.Done) return;
  const step = m.step as number;
  if (!routeEndsAt(await routeStepAt(s, m.itemTypeId, step), step)) return;
  await finishItem(s, s.r.now, true);
  m.status = ItemStatus.Done;
  m.eventId = await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "done",
    stepNo: step,
    stationId: s.r.stationId,
    stationTypeId: s.stationTypeId,
    ...who(s),
    reason: "result_submitted",
    seq: 1 + s.seqOffset,
    payload: s.payload,
  });
}

/** Call site #11 (§4.5): the item cannot continue — done, with its event, in the same tx. */
async function finishWithoutStation(
  s: Submit,
  f: { stepNo: number; stationTypeId: number | null; branch: string; markFinished: boolean },
): Promise<void> {
  await finishItem(s, new Date(), f.markFinished);
  await recordTransition(s.tx, {
    key: inSubmit(s),
    itemId: s.r.itemId,
    toState: "done",
    stepNo: f.stepNo,
    stationId: null,
    stationTypeId: f.stationTypeId,
    ...who(s),
    reason: "no_station_for_type",
    seq: 1 + s.seqOffset,
    payload: { ...s.payload, branch: f.branch },
  });
}

// ---- where it goes next ------------------------------------------------------------------------

/** The research station an item sent to research is shown and assigned (call site #12, seq 2). */
async function assignResearchStation(s: Submit, m: Moved): Promise<ResearchStation | null> {
  // Only the QUERY is best-effort. The writes it implies (the assignment and its ledger note) are
  // not: a failed note must fail the submit, never leave a poisoned transaction behind a success.
  let picked: Awaited<ReturnType<typeof findLeastLoadedResearchStation>> = null;
  try {
    picked = await findLeastLoadedResearchStation(s.tx);
  } catch (researchError) {
    console.error("Error calculating research station:", researchError);
  }
  if (!picked) return null;
  const station: ResearchStation = {
    stationId: picked.test_station_id,
    stationDesc: (picked.test_station_desc || "").trim(),
    stationTypeId: picked.test_station_type_id,
    stationTypeName: (picked.station_type_name || "").trim(),
    currentLoad: Number(picked.current_load ?? 0),
  };
  await reassign(s, {
    stationId: station.stationId,
    stationTypeId: station.stationTypeId ?? null,
    stepNo: m.step ?? s.r.step,
    seq: 2,
    site: "research_load_balancing",
  });
  return station;
}

/** The next station of the route, or the end of it — in the submit's tx (§4.8), so its reads see
 *  this submit's own writes. */
async function nextStationOrFinish(s: Submit, m: Moved): Promise<NextStationResult> {
  try {
    return await pickNextStation(s, m);
  } catch (calcError) {
    console.error("Error calculating next station recommendation:", calcError);
    // Call site #11(c): the error fallback — the item finishes WITH its event, in the same tx. If
    // the tx itself is already aborted (a failed SQL statement above) these writes rethrow and the
    // whole submission rolls back (§4.8).
    if (s.routeNumber && m.itemTypeId) {
      await finishWithoutStation(s, { stepNo: m.step ?? s.r.step, stationTypeId: null, branch: "calc_error", markFinished: false });
      m.status = ItemStatus.Done;
    }
    return { isLastStation: true };
  }
}

async function pickNextStation(s: Submit, m: Moved): Promise<NextStationResult> {
  const { sendToResearch, returnToRoute, finishRoute } = s.r;
  const inResearch = s.currentStatus === ItemStatus.InResearch;
  // Sent to research: assignResearchStation picked its station. Walking the regular route_steps here
  // would overwrite it with a non-research station of the step's type.
  if (sendToResearch === true) return { isLastStation: false };
  if (inResearch && !returnToRoute && !finishRoute) return { isLastStation: true };
  if (!m.status || m.step === null || m.status === ItemStatus.Done || !m.itemTypeId) return { isLastStation: true };

  const step = inResearch && returnToRoute === true ? s.r.step : m.step;
  const stepRow = await routeStepAt(s, m.itemTypeId, step);
  if (!stepRow?.next_station_type_id || routeEndsAt(stepRow, step)) {
    // The route was shortened in settings (classic case: returnToRoute onto a step that no longer
    // exists): done, with its event.
    await finishWithoutStation(s, { stepNo: step, stationTypeId: null, branch: "route_shortened", markFinished: true });
    m.status = ItemStatus.Done;
    return { isLastStation: true };
  }

  const stationTypeId = stepRow.next_station_type_id;
  const picked = await findLeastWaitingStation(s.tx, stationTypeId);
  if (!picked) {
    // No station of the type at all: nothing can ever test the item.
    await finishWithoutStation(s, { stepNo: step, stationTypeId, branch: "no_station_of_type", markFinished: false });
    m.status = ItemStatus.Done;
    return { isLastStation: true };
  }
  await reassign(s, { stationId: picked.test_station_id, stationTypeId, stepNo: step, seq: 3, site: "next_station_load_balancing" });
  return {
    isLastStation: false,
    nextStation: {
      testStationId: picked.test_station_id,
      testStationDesc: (picked.test_station_desc || "").trim(),
      stationTypeId,
      routeStep: step,
    },
  };
}

/**
 * The meeting point (docs/features/packages/PLAN.md §4), after every write above: an ITEM inside a box moved
 * (advanced, finished, went to research) — its box may now be ready, or may have to keep waiting;
 * the BOX itself advanced onto a package-level step and is queued there — it waits (status 6) until
 * every item is present. Same transaction, so the box never commits in a status that disagrees with
 * where its items are.
 */
async function recheckGate(s: Submit, pkgCtx: PackageContext | null, status: number | null): Promise<PackageGateAnswer | null> {
  const boxId = pkgCtx?.packageId != null
    ? pkgCtx.packageId
    : pkgCtx?.isPackage && status === ItemStatus.Queued ? s.r.itemId : null;
  if (boxId == null) return null;
  const g = await recheckPackageReadiness(s.tx, boxId, {
    submitId: s.r.actor.actionId, workerId: s.r.actor.workerId, workerName: s.r.actor.workerName,
  });
  return { packageId: g.packageId.toString(), status: g.status, blockingItemIds: g.blockingItemIds.map(String) };
}

/** A replay's next station: where the item is assigned now, in the shape of the original answer.
 *  Best effort — a failed read answers nothing, and the client then says it does not know. */
export async function whereItemIsNow(itemId: bigint): Promise<NextStationResult> {
  try {
    const [row] = await prisma.$queryRaw<{
      is_finished: boolean;
      current_status: number;
      current_route_step: number;
      test_station_id: number | null;
      test_station_desc: string | null;
      test_station_type_id: number | null;
    }[]>`
      SELECT ir.is_finished, ir.current_status, ir.current_route_step, ir.test_station_id,
             ts.test_station_desc, ts.test_station_type_id
      FROM item_routes ir
      LEFT JOIN test_stations ts ON ts.test_station_id = ir.test_station_id
      WHERE ir.item_id = ${itemId}
      LIMIT 1
    `;
    if (!row) return {};
    if (row.is_finished || row.current_status === ItemStatus.Done) return { isLastStation: true };
    if (row.test_station_id == null || row.test_station_type_id == null) return {};
    return {
      isLastStation: false,
      nextStation: {
        testStationId: row.test_station_id,
        testStationDesc: (row.test_station_desc ?? "").trim(),
        stationTypeId: row.test_station_type_id,
        routeStep: row.current_route_step,
      },
    };
  } catch (error) {
    console.error("Error reading where a replayed item is now:", error);
    return {};
  }
}
