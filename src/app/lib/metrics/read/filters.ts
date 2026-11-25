// The §5.1 filter block — written ONCE (docs/dashboard-migration-plan-v2.md).
//
// "One definition per metric" breaks the moment the filter set is retyped for
// each query, so every ledger query (Q1, Q2, Q4, Q5, Q6, Q7, Q8) emits the
// SAME text from here. The block is a fixed-arity, always-present list of
// `IS NULL OR ...` guards rather than a conditionally assembled string: the
// plan shape then never depends on which filters the caller happened to set,
// and "did this endpoint forget filter X" is answerable by reading one file.
//
// SAFETY: nothing user-supplied is ever concatenated into SQL. The only
// interpolated tokens are the table alias (validated against a strict
// identifier regex) and the parameter ordinals, which this module generates.
//
// §5.0(1): the open-shipments predicate is `s.is_sent IS NOT TRUE`, never
// `s.is_sent = false`. shipments.is_sent is Boolean? (nullable) and raw-SQL
// writers bypass Prisma's default, so `= false` silently drops every NULL
// shipment — exactly the silent-filter class this block exists to kill.

import { LEGACY_STATUS_STATES, isLegacyStatusFilter, type StateKey } from "../vocabulary";
import { FILTER_PARAM, type MetricsSource } from "@/app/lib/dashboard/contract";

/** §5.0(1). `open_shipments` for live endpoints, constant `all` for historical ones. */
export type MetricsScope = "open_shipments" | "all";

/** The legacy `status` param as a state set; null = no filter (also for an unknown value). */
export function statesForLegacyStatus(status: string | null | undefined): readonly StateKey[] | null {
  return isLegacyStatusFilter(status) ? LEGACY_STATUS_STATES[status] : null;
}

/** Every dimension the dashboard may filter on. All optional; unset === no filter. */
export interface MetricFilters {
  customerId?: number | null;
  shipmentId?: number | null;
  itemTypeId?: number | null;
  stationId?: number | null;
  stationTypeId?: number | null;
  /** Matched against item_state_interval.exited_by_worker_id. */
  workerId?: number | null;
  itemSerial?: string | null;
  /** Boxes only: exclude the items inside packages (docs/packages/PLAN.md §9, 13). */
  packagesOnly?: boolean;
  /** Status set, as metric_state keys. null/undefined = every state. */
  states?: readonly string[] | null;
  /** §5.0(1). Defaults to `open_shipments`; historical endpoints pass `all`. */
  scope?: MetricsScope;
}

/** Number of bind parameters the interval-side block consumes. */
export const FILTER_PARAM_COUNT = 10;
/** Number of bind parameters the route_run-side block consumes. */
export const RUN_FILTER_PARAM_COUNT = 6;

const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function checkAlias(alias: string): string {
  if (!ALIAS_RE.test(alias)) throw new Error(`unsafe SQL alias: ${JSON.stringify(alias)}`);
  return alias;
}

function checkIndex(startIndex: number): number {
  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new Error(`filter startIndex must be a positive integer, got ${startIndex}`);
  }
  return startIndex;
}

export function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toTextOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * The §5.1 block, over an `item_state_interval` alias.
 *
 * `alias` is the interval alias — `i` in Q1/Q4/Q5/Q6/Q8 and inside Q2's
 * LEFT JOIN ON. Q2 puts the block in the JOIN condition, NOT the WHERE, so
 * grid days with no matching rows survive as zeros instead of vanishing from
 * the series (§5.1).
 */
export function intervalFilterSql(alias = "i", startIndex = 1): string {
  const a = checkAlias(alias);
  const p = checkIndex(startIndex);
  const $ = (n: number) => `$${p + n}`;
  // The shipments alias is `s_flt`, not the spec's bare `s`: in Q2 the outer
  // query already binds `s` to the metric_state cross-join, and a bare `s` here
  // would resolve to it and silently compare the wrong row.
  return `
  AND (${$(0)}::int    IS NULL OR ${a}.customer_id         = ${$(0)})
  AND (${$(1)}::int    IS NULL OR ${a}.shipment_id         = ${$(1)})
  AND (${$(2)}::int    IS NULL OR ${a}.item_type_id        = ${$(2)})
  AND (${$(3)}::int    IS NULL OR ${a}.station_id          = ${$(3)})
  AND (${$(4)}::int    IS NULL OR ${a}.station_type_id     = ${$(4)})
  AND (${$(5)}::int    IS NULL OR ${a}.exited_by_worker_id = ${$(5)})
  AND (${$(6)}::text   IS NULL OR ${a}.serial_no           = ${$(6)})
  AND (NOT ${$(7)}::boolean OR ${a}.is_package_item = false)
  AND (${$(8)}::text = 'all'
       OR EXISTS (SELECT 1 FROM shipments s_flt
                   WHERE s_flt.id = ${a}.shipment_id AND s_flt.is_sent IS NOT TRUE))
  AND (${$(9)}::text[] IS NULL OR ${a}.state_key = ANY(${$(9)}::text[]))`;
}

/** Bind values for {@link intervalFilterSql}, in placeholder order. Always 10 values. */
export function intervalFilterParams(f: MetricFilters = {}): unknown[] {
  const states = f.states && f.states.length > 0 ? f.states.map(String) : null;
  return [
    toIntOrNull(f.customerId),
    toIntOrNull(f.shipmentId),
    toIntOrNull(f.itemTypeId),
    toIntOrNull(f.stationId),
    toIntOrNull(f.stationTypeId),
    toIntOrNull(f.workerId),
    toTextOrNull(f.itemSerial),
    // never null: `NOT NULL::boolean` is NULL, and the AND would drop every row.
    f.packagesOnly === true,
    f.scope === "all" ? "all" : "open_shipments",
    states,
  ];
}

/**
 * The route_run-side block (Q2ב, §5.3ב).
 *
 * route_run carries only the dimensions that are constant for a whole pass:
 * customer, shipment, item type, serial, whether it is an item inside a box. Station, station type,
 * worker and status are per-STEP and do not exist on the run — a run that is
 * "finished" was finished as a whole, not at a station. {@link unhonoured}
 * names the ones this block cannot honour so the caller can surface them.
 */
export function runFilterSql(alias = "rr", startIndex = 1): string {
  const a = checkAlias(alias);
  const p = checkIndex(startIndex);
  const $ = (n: number) => `$${p + n}`;
  return `
  AND (${$(0)}::int  IS NULL OR ${a}.customer_id  = ${$(0)})
  AND (${$(1)}::int  IS NULL OR ${a}.shipment_id  = ${$(1)})
  AND (${$(2)}::int  IS NULL OR ${a}.item_type_id = ${$(2)})
  AND (${$(3)}::text IS NULL OR ${a}.serial_no    = ${$(3)})
  AND (NOT ${$(4)}::boolean OR ${a}.is_package_item = false)
  AND (${$(5)}::text = 'all'
       OR EXISTS (SELECT 1 FROM shipments s_flt
                   WHERE s_flt.id = ${a}.shipment_id AND s_flt.is_sent IS NOT TRUE))`;
}

/** Bind values for {@link runFilterSql}, in placeholder order. Always 6 values. */
export function runFilterParams(f: MetricFilters = {}): unknown[] {
  return [
    toIntOrNull(f.customerId),
    toIntOrNull(f.shipmentId),
    toIntOrNull(f.itemTypeId),
    toTextOrNull(f.itemSerial),
    f.packagesOnly === true,
    f.scope === "all" ? "all" : "open_shipments",
  ];
}

/** The filter set of a dashboard query string (the names are FILTER_PARAM). An absent or unknown
 *  scope is `open_shipments`. */
export function filtersFromSearchParams(sp: URLSearchParams): MetricFilters {
  const p = FILTER_PARAM;
  return {
    customerId: toIntOrNull(sp.get(p.customerId)),
    shipmentId: toIntOrNull(sp.get(p.shipmentId)),
    itemTypeId: toIntOrNull(sp.get(p.itemTypeId)),
    stationId: toIntOrNull(sp.get(p.stationId)),
    stationTypeId: toIntOrNull(sp.get(p.stationTypeId)),
    workerId: toIntOrNull(sp.get(p.workerId)),
    itemSerial: toTextOrNull(sp.get(p.itemSerial)),
    packagesOnly: sp.get(p.packagesOnly) === "true",
    states: statesForLegacyStatus(sp.get(p.status)),
    scope: sp.get(p.scope) === "all" ? "all" : "open_shipments",
  };
}

/** For the entity-progress screens: a filter that identifies the screen's entity selects its rows
 *  (none set: every row) rather than narrowing the runs inside them. */
export function selectEntity<R extends { entity_id: number }>(
  rows: R[],
  id: number | null | undefined,
  idOf: (row: R) => number | null | undefined = (row) => row.entity_id,
): R[] {
  return id == null ? rows : rows.filter((row) => idOf(row) === id);
}

// ---------------------------------------------------------------------------
// Which filters each source can honour (§5.0(1): a filter that cannot be
// honoured is named, never dropped in silence)
// ---------------------------------------------------------------------------

export type FilterName =
  | "customerId"
  | "shipmentId"
  | "itemTypeId"
  | "stationId"
  | "stationTypeId"
  | "workerId"
  | "itemSerial"
  | "packagesOnly"
  | "scope"
  | "states";

/** Every filter a request set, in this order — the order header values are written in. */
function requested(f: MetricFilters): FilterName[] {
  const set: Array<[FilterName, boolean]> = [
    ["customerId", toIntOrNull(f.customerId) !== null],
    ["shipmentId", toIntOrNull(f.shipmentId) !== null],
    ["itemTypeId", toIntOrNull(f.itemTypeId) !== null],
    ["stationId", toIntOrNull(f.stationId) !== null],
    ["stationTypeId", toIntOrNull(f.stationTypeId) !== null],
    ["workerId", toIntOrNull(f.workerId) !== null],
    ["itemSerial", toTextOrNull(f.itemSerial) !== null],
    ["packagesOnly", f.packagesOnly === true],
    ["scope", f.scope === "open_shipments"],
    ["states", (f.states?.length ?? 0) > 0],
  ];
  return set.filter(([, on]) => on).map(([name]) => name);
}

/**
 * What each anchor can express. The interval block (Q1, Q2א, Q4, Q5, Q6, Q8)
 * honours every filter and is not listed.
 *   runs            route_run (Q2ב, Q2ג, the completion series): only the
 *                   dimensions constant for a whole pass.
 *   entityProgress  Q7: route_run plus the entity's own table; a serial no
 *                   longer identifies an entity once the run is the unit.
 *   liveBoard       Q3 carries no filter block (the state of the LAB); its rows
 *                   still carry station and station type, and the legacy status
 *                   is projected onto its columns.
 */
const HONOURS = {
  runs: new Set<FilterName>(["customerId", "shipmentId", "itemTypeId", "itemSerial", "packagesOnly", "scope"]),
  entityProgress: new Set<FilterName>(["customerId", "shipmentId", "itemTypeId", "packagesOnly", "scope"]),
  liveBoard: new Set<FilterName>(["stationId", "stationTypeId", "states"]),
} as const;

export type FilterAnchor = keyof typeof HONOURS;

/** The filters `f` asks for that `anchor` cannot express. */
export function unhonoured(anchor: FilterAnchor, f: MetricFilters = {}): FilterName[] {
  return requested(f).filter((name) => !HONOURS[anchor].has(name));
}

/**
 * Tag each name with the part of the response that ignores it. In every one of
 * these responses SOME numbers honour the filter and one cannot, and a bare
 * "stationId" would leave the reader guessing which.
 */
export function qualify(source: MetricsSource, names: readonly string[]): string[] {
  return names.map((n) => `${source}:${n}`);
}
