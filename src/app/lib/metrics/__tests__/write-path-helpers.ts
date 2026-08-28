// Scratch-database harness for the stage-3 write-path integration suite
// (docs/dashboard-migration-plan-v2.md §9.2ג).
//
// WHY a second connection: the suite drives the REAL route handlers, which go
// through the app's Prisma singleton. Assertions must observe what those
// handlers committed WITHOUT joining their transactions, so every read/seed
// here runs on an independent `pg` Pool. Both point at TEST_DATABASE_URL — a
// throwaway database. Nothing here may ever run against the dev/prod
// DATABASE_URL, which is why setup() overwrites process.env.DATABASE_URL from
// TEST_DATABASE_URL *before* the route modules (and therefore the Prisma
// client) are first imported.
import { Pool, types } from "pg";

// pg hands bigint (OID 20) and numeric (1700) back as strings by default.
// Every ledger id and duration in this suite fits comfortably in a JS number,
// and string-vs-number mismatches in assert.equal are pure noise.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

/** node:test `skip` option: false when the suite can run, else the reason. */
export function skipReason(): string | false {
  return TEST_DATABASE_URL
    ? false
    : "TEST_DATABASE_URL is not set — stage-3 write-path integration suite skipped";
}

// ---------------------------------------------------------------------------
// Fixture vocabulary. Small, fixed ids so failures read like the spec's tables.
// ---------------------------------------------------------------------------

export const CUSTOMER_ID = 7;
export const SHIPMENT_ID = 1;

/** Station types. TYPE_ORPHAN exists but owns no station — call site #11(b). */
export const TYPE_INTAKE = 10;
export const TYPE_FUNC = 20;
export const TYPE_RESEARCH = 30;
export const TYPE_ORPHAN = 99;

export const STATION_INTAKE = 101; // TYPE_INTAKE
export const STATION_FUNC_A = 102; // TYPE_FUNC
export const STATION_FUNC_B = 103; // TYPE_FUNC — second of its type, for #12
export const STATION_RESEARCH = 901; // TYPE_RESEARCH, is_research = true

/** Item types, each with exactly one testing_routes row (route_number 1). */
export const ITEM_TYPE_ONE_STEP = 1; // route_steps = {10}
export const ITEM_TYPE_TWO_STEP = 2; // route_steps = {10, 20}
export const ITEM_TYPE_ORPHAN_STEP = 3; // route_steps = {10, 99}

export const WORKER_ID = 42;
export const WORKER_NAME = "בודק אינטגרציה";

/** Legacy item_routes.current_status ↔ metric_state.state_key (§3.1). */
export const STATUS = {
  testing: 1,
  queued: 2,
  done: 3,
  queued_research: 4,
  in_research: 5,
} as const;

// ---------------------------------------------------------------------------
// Connection + handler wiring
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

type RouteHandler = (req: Request) => Promise<Response>;

type Handlers = {
  results: RouteHandler;
  startTest: RouteHandler;
  releaseTest: RouteHandler;
  releaseStale: RouteHandler;
  createItem: typeof import("../../create-item").createItem;
  prisma: { $disconnect: () => Promise<void>; $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
};

let handlers: Handlers | null = null;

/** The four live write-path routes plus create-item, imported for real. */
export function h(): Handlers {
  if (!handlers) throw new Error("setup() has not run");
  return handlers;
}

export async function q<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
  if (!pool) throw new Error("setup() has not run");
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/**
 * Runs one statement inside an EXPLICIT transaction on a single connection.
 * Needed for isi_rebuild_run, whose `SET CONSTRAINTS ... DEFERRED` only means
 * anything inside a transaction block — and for anything that must not be
 * spread across two pooled connections.
 */
export async function inTransaction<T = Record<string, any>>(
  sql: string,
  params: any[] = [],
): Promise<T[]> {
  if (!pool) throw new Error("setup() has not run");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(sql, params);
    await client.query("COMMIT");
    return res.rows as T[];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function one<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T> {
  const rows = await q<T>(sql, params);
  if (rows.length !== 1) throw new Error(`expected exactly 1 row, got ${rows.length}: ${sql}`);
  return rows[0];
}

export async function setup(): Promise<void> {
  // MUST precede the dynamic imports below: src/app/lib/prisma.ts builds its
  // Pool from process.env.DATABASE_URL at module-evaluation time, and the route
  // modules import it transitively.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  // The reaper is the one handler behind cronSecretGuard; an unset CRON_SECRET
  // means "off" (503), so the suite supplies one and sends the header.
  process.env.CRON_SECRET = process.env.CRON_SECRET || "integration-suite-secret";

  pool = new Pool({ connectionString: TEST_DATABASE_URL });

  await assertLedgerSchemaPresent();

  const results = await import("../../../api/testing/results/route");
  const startTestMod = await import("../../../api/testing/start-test/route");
  const releaseTestMod = await import("../../../api/testing/release-test/route");
  const releaseStaleMod = await import("../../../api/cron/release-stale-tests/route");
  const createItemMod = await import("../../create-item");
  const prismaMod = await import("../../prisma");

  handlers = {
    results: results.POST as RouteHandler,
    startTest: startTestMod.POST as RouteHandler,
    releaseTest: releaseTestMod.POST as RouteHandler,
    releaseStale: releaseStaleMod.POST as RouteHandler,
    createItem: createItemMod.createItem,
    prisma: prismaMod.prisma as unknown as Handlers["prisma"],
  };

  // THE POINT OF THE SCAFFOLD (§3.8): migration A ships the drift detector
  // disabled because the old image keeps writing item_routes while the ledger
  // is still empty. In the scratch DB the ledger is authoritative from row one,
  // so the detector runs for the whole suite and "0 open drift rows" is the
  // final assertion of every test.
  await q("ALTER TABLE item_routes ENABLE TRIGGER trg_metrics_drift");

  await seedWorkCalendar();
}

export async function teardown(): Promise<void> {
  if (handlers) await handlers.prisma.$disconnect();
  if (pool) await pool.end();
  pool = null;
  handlers = null;
}

async function assertLedgerSchemaPresent(): Promise<void> {
  let row: { version: number | null; has_record: boolean } | undefined;
  try {
    [row] = await q<{ version: number | null; has_record: boolean }>(`
      SELECT (SELECT version FROM metrics_schema_version WHERE id = 1) AS version,
             to_regprocedure('metrics_record(text,bigint,text,int,int,int,int,text,text,uuid,text,smallint,jsonb)')
               IS NOT NULL AS has_record
    `);
  } catch (err) {
    throw new Error(
      "TEST_DATABASE_URL does not carry the metrics ledger schema — apply " +
        `prisma/migrations/20260825000000_metrics_ledger_additive first (${(err as Error).message})`,
    );
  }
  if (!row?.has_record || row.version == null) {
    throw new Error("TEST_DATABASE_URL is missing metrics_record() / metrics_schema_version");
  }
}

/**
 * One always-open work span across the whole fixture horizon.
 *
 * The write path only cares THAT the fold can resolve a calendar version (it
 * stamps calendar_version and work_seconds when it closes an interval); the
 * real Sunday–Thursday 07:00–15:35 arithmetic is §9.2ב's subject and is tested
 * against the deterministic fixture, not here. With a single open span
 * work_seconds == wall_seconds, which is exactly the property these tests
 * assert: a closed non-terminal interval carries BOTH clocks, never NULL.
 */
async function seedWorkCalendar(): Promise<void> {
  const [existing] = await q<{ calendar_version: number }>(
    "SELECT calendar_version FROM work_calendar_version WHERE is_current",
  );
  if (existing) return;
  const [ver] = await q<{ calendar_version: number }>(`
    INSERT INTO work_calendar_version (horizon_from, horizon_to, source_digest, is_current)
    VALUES (DATE '2020-01-01', DATE '2035-01-01', 'integration-suite-always-open', true)
    RETURNING calendar_version
  `);
  await q(
    `INSERT INTO work_span (calendar_version, work_date, span, span_seconds, cum_seconds_before)
     VALUES ($1, DATE '2020-01-01',
             tstzrange(TIMESTAMPTZ '2020-01-01 00:00 Asia/Jerusalem',
                       TIMESTAMPTZ '2035-01-01 00:00 Asia/Jerusalem', '[)'),
             EXTRACT(EPOCH FROM (TIMESTAMPTZ '2035-01-01 00:00 Asia/Jerusalem'
                               - TIMESTAMPTZ '2020-01-01 00:00 Asia/Jerusalem'))::int,
             0)`,
    [ver.calendar_version],
  );
}

// ---------------------------------------------------------------------------
// Per-test reset + fixtures
// ---------------------------------------------------------------------------

const TRUNCATE_TABLES = [
  "item_state_interval",
  "item_state_event",
  "route_run",
  "metrics_drift",
  "test_results",
  "item_route_history",
  "research_history",
  "item_routes",
  "items",
  "station_live_counters",
  "testing_routes",
  "test_stations",
  "test_stations_type",
  "item_types",
  "shipments",
  "customers",
  "daily_counters",
].join(", ");

/** Wipes every operational + ledger table and re-seeds the static fixtures. */
export async function resetDb(): Promise<void> {
  // item_state_event is append-only: trg_ise_immutable RAISEs on TRUNCATE as
  // well as UPDATE/DELETE. Lifting it for the wipe is the ONLY place the suite
  // touches that trigger — every test then runs against the real append-only
  // table.
  await q("ALTER TABLE item_state_event DISABLE TRIGGER trg_ise_immutable");
  try {
    await q(`TRUNCATE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`);
  } finally {
    await q("ALTER TABLE item_state_event ENABLE TRIGGER trg_ise_immutable");
  }

  await q("INSERT INTO customers (id, name, customer_code) VALUES ($1, 'INTEGRATION', 'CUST-TEST')", [
    CUSTOMER_ID,
  ]);
  await q(
    `INSERT INTO shipments (id, shipment_code, customer_id, shipment_date, makat, amount, is_sent)
     VALUES ($1, 'SHIP-1', $2, NOW(), 'MK-1', 10, false)`,
    [SHIPMENT_ID, CUSTOMER_ID],
  );

  await q(
    `INSERT INTO item_types (item_type_id, item_type_desc) VALUES
       ($1, 'ONE_STEP'), ($2, 'TWO_STEP'), ($3, 'ORPHAN_STEP')`,
    [ITEM_TYPE_ONE_STEP, ITEM_TYPE_TWO_STEP, ITEM_TYPE_ORPHAN_STEP],
  );
  await q(
    `INSERT INTO test_stations_type (test_station_type_id, test_type_desc, parents_only) VALUES
       ($1, 'INTAKE', true), ($2, 'FUNC', false), ($3, 'RESEARCH', false), ($4, 'ORPHAN', false)`,
    [TYPE_INTAKE, TYPE_FUNC, TYPE_RESEARCH, TYPE_ORPHAN],
  );
  // status 2 = free. TYPE_ORPHAN deliberately gets no station (#11(b)).
  await q(
    `INSERT INTO test_stations (test_station_id, test_station_type_id, test_station_desc, status, is_research) VALUES
       ($1, $5, 'INTAKE-1',   2, false),
       ($2, $6, 'FUNC-A',     2, false),
       ($3, $6, 'FUNC-B',     2, false),
       ($4, $7, 'RESEARCH-1', 2, true)`,
    [
      STATION_INTAKE,
      STATION_FUNC_A,
      STATION_FUNC_B,
      STATION_RESEARCH,
      TYPE_INTAKE,
      TYPE_FUNC,
      TYPE_RESEARCH,
    ],
  );
  await q(
    `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES
       ($1, $4, ARRAY[$4::int],          1),
       ($2, $4, ARRAY[$4::int, $5::int], 1),
       ($3, $4, ARRAY[$4::int, $6::int], 1)`,
    [
      ITEM_TYPE_ONE_STEP,
      ITEM_TYPE_TWO_STEP,
      ITEM_TYPE_ORPHAN_STEP,
      TYPE_INTAKE,
      TYPE_FUNC,
      TYPE_ORPHAN,
    ],
  );
}

export type SeedItemOptions = {
  itemId: number;
  itemTypeId?: number;
  routeNumber?: number;
  stationId?: number | null;
  parentItemId?: number | null;
};

/**
 * Seeds one queued item the way create-item leaves it: the `items` row, the
 * `item_routes` row (status 2, step 1) and the `item_created` ledger event —
 * ALL IN ONE TRANSACTION, so at commit the deferred drift trigger sees legacy
 * status and ledger state agree and every test starts from a clean slate.
 */
export async function seedItem(o: SeedItemOptions): Promise<number> {
  const {
    itemId,
    itemTypeId = ITEM_TYPE_ONE_STEP,
    routeNumber = 1,
    stationId = STATION_INTAKE,
    parentItemId = null,
  } = o;
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model,
                          manufacturer_name, manufacturer_no, shipment_id, parent_item_id)
       VALUES ($1, $2, $3, $4, 'MK-1', 'MODEL', 'MFR', 'MFR-NO', $5, $6)`,
      [itemId, CUSTOMER_ID, itemTypeId, `SN-${itemId}`, SHIPMENT_ID, parentItemId],
    );
    await client.query(
      `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step,
                                test_station_id, created_at, is_finished, queue_start_time, route_number)
       VALUES ($1, $2, 2, 1, $3, NOW(), false, NOW(), $4)`,
      [itemId, itemTypeId, stationId, routeNumber],
    );
    // Call site #1's exact emission (§4.5): item_created → queued, seq 0, the
    // queued interval carrying the station TYPE it waits for.
    await client.query(
      `SELECT metrics_record($1, $2::bigint, 'queued', 1, NULL,
                             (SELECT route_steps[1] FROM testing_routes
                               WHERE item_type_id = $3 AND route_number = $4),
                             NULL, NULL, 'item_created')`,
      [`item_created:${itemId}`, itemId, itemTypeId, routeNumber],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return itemId;
}

/**
 * Runs an out-of-band item_routes mutation with the drift detector lifted.
 *
 * Only for SETUP that deliberately desynchronises legacy status from the
 * ledger (a pre-ledger item, re-arming a row the reaper already released).
 * Test bodies never use it: the whole point of the scaffold is that every
 * real write happens with the detector armed.
 */
export async function withDriftDetectorOff<T>(fn: () => Promise<T>): Promise<T> {
  await q("ALTER TABLE item_routes DISABLE TRIGGER trg_metrics_drift");
  try {
    return await fn();
  } finally {
    await q("ALTER TABLE item_routes ENABLE TRIGGER trg_metrics_drift");
  }
}

/**
 * Seeds an item that predates the ledger: operational rows only, no route_run
 * and no events — the "deployment window" item of §4.2.
 */
export async function seedLegacyItem(o: SeedItemOptions): Promise<number> {
  return withDriftDetectorOff(async () => {
    const {
      itemId,
      itemTypeId = ITEM_TYPE_ONE_STEP,
      routeNumber = 1,
      stationId = STATION_INTAKE,
    } = o;
    await q(
      `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model,
                          manufacturer_name, manufacturer_no, shipment_id, parent_item_id)
       VALUES ($1, $2, $3, $4, 'MK-1', 'MODEL', 'MFR', 'MFR-NO', $5, NULL)`,
      [itemId, CUSTOMER_ID, itemTypeId, `SN-${itemId}`, SHIPMENT_ID],
    );
    await q(
      `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step,
                                test_station_id, created_at, is_finished, queue_start_time, route_number)
       VALUES ($1, $2, 2, 1, $3, NOW(), false, NOW(), $4)`,
      [itemId, itemTypeId, stationId, routeNumber],
    );
    return itemId;
  });
}

/** Backdates processing_start_time so the reaper's cutoff matches the row. */
export async function ageProcessingStart(itemId: number, minutes: number): Promise<void> {
  await q(
    `UPDATE item_routes SET processing_start_time = NOW() - ($2 || ' minutes')::interval
      WHERE item_id = $1`,
    [itemId, String(minutes)],
  );
}

// ---------------------------------------------------------------------------
// Handler invocation
// ---------------------------------------------------------------------------

export function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export type HandlerResult = { status: number; body: any };

async function call(
  handler: RouteHandler,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<HandlerResult> {
  const res = await handler(jsonRequest(path, body, headers));
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

export function startTest(body: Record<string, unknown>): Promise<HandlerResult> {
  return call(h().startTest, "/api/testing/start-test", body);
}

export function releaseTest(body: Record<string, unknown>): Promise<HandlerResult> {
  return call(h().releaseTest, "/api/testing/release-test", body);
}

/** POST /api/testing/results with the worker snapshot every real client sends. */
export function submitResult(body: Record<string, unknown>): Promise<HandlerResult> {
  return call(h().results, "/api/testing/results", {
    WorkerID: WORKER_ID,
    WorkerName: WORKER_NAME,
    Result: 1,
    ...body,
  });
}

export function runReaper(): Promise<HandlerResult> {
  return call(h().releaseStale, "/api/cron/release-stale-tests", {}, {
    "x-cron-secret": process.env.CRON_SECRET as string,
  });
}

// ---------------------------------------------------------------------------
// Ledger readers
// ---------------------------------------------------------------------------

export type EventRow = {
  event_id: number;
  event_key: string;
  route_run_id: number;
  occurred_at: Date;
  seq: number;
  kind: string;
  to_state: string | null;
  step_no: number;
  station_id: number | null;
  station_type_id: number | null;
  worker_id: number | null;
  worker_name: string | null;
  reason: string;
  submit_id: string | null;
  is_trusted: boolean;
  payload: Record<string, any>;
};

/** Every event of an item in the canonical (occurred_at, seq, event_id) order. */
export function events(itemId: number): Promise<EventRow[]> {
  return q<EventRow>(
    "SELECT * FROM item_state_event WHERE item_id = $1 ORDER BY occurred_at, seq, event_id",
    [itemId],
  );
}

export type IntervalRow = {
  interval_id: number;
  route_run_id: number;
  state_key: string;
  is_terminal: boolean;
  step_no: number;
  attempt_no: number;
  station_id: number | null;
  station_type_id: number | null;
  entry_reason: string;
  exit_reason: string | null;
  entry_event_id: number;
  exit_event_id: number | null;
  is_open: boolean;
  opened_at: Date;
  closed_at: Date | null;
  wall_seconds: number | null;
  work_seconds: number | null;
  calendar_version: number | null;
  unit_id: number;
  is_accessory: boolean;
  entered_by_worker_id: number | null;
  exited_by_worker_id: number | null;
};

/** The item's ledger, oldest first — the fold's output, in order. */
export function intervals(itemId: number): Promise<IntervalRow[]> {
  return q<IntervalRow>(
    `SELECT interval_id, route_run_id, state_key, is_terminal, step_no, attempt_no,
            station_id, station_type_id, entry_reason, exit_reason,
            entry_event_id, exit_event_id, upper_inf(valid_range) AS is_open,
            lower(valid_range) AS opened_at, closed_at, wall_seconds, work_seconds,
            calendar_version, unit_id, is_accessory,
            entered_by_worker_id, exited_by_worker_id
       FROM item_state_interval WHERE item_id = $1
      ORDER BY lower(valid_range), interval_id`,
    [itemId],
  );
}

export type RunRow = {
  route_run_id: number;
  run_no: number;
  route_number: number;
  planned_steps: number[];
  opened_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
  unit_id: number;
  is_accessory: boolean;
  customer_id: number;
  shipment_id: number;
  is_trusted: boolean;
};

export function runs(itemId: number): Promise<RunRow[]> {
  return q<RunRow>("SELECT * FROM route_run WHERE item_id = $1 ORDER BY run_no", [itemId]);
}

export function routeRow(itemId: number): Promise<{
  current_status: number;
  current_route_step: number;
  test_station_id: number | null;
  finished_at: Date | null;
  is_finished: boolean;
}> {
  return one(
    `SELECT current_status, current_route_step, test_station_id, finished_at, is_finished
       FROM item_routes WHERE item_id = $1`,
    [itemId],
  );
}

export function testResults(
  itemId: number,
): Promise<{ test_result_id: number; state_event_id: number | null; route_step: number }[]> {
  return q(
    `SELECT test_result_id, state_event_id, route_step FROM test_results
      WHERE item_id = $1 ORDER BY test_result_id`,
    [itemId],
  );
}

export function stationStatus(stationId: number): Promise<number> {
  return one<{ status: number }>(
    "SELECT status FROM test_stations WHERE test_station_id = $1",
    [stationId],
  ).then((r) => r.status);
}

/** The open (upper_inf) interval of an item — the ledger's "current state". */
export async function openInterval(itemId: number): Promise<IntervalRow | null> {
  const rows = await intervals(itemId);
  return rows.find((i) => i.is_open) ?? null;
}

export function openDriftRows(): Promise<
  { item_id: number; legacy_status: number | null; ledger_state: string | null; occurrences: number }[]
> {
  return q(
    `SELECT item_id, legacy_status, ledger_state, occurrences
       FROM metrics_drift WHERE resolved_at IS NULL ORDER BY item_id`,
  );
}
