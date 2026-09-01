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

/** §5.0(1). `open_shipments` for live endpoints, constant `all` for historical ones. */
export type MetricsScope = "open_shipments" | "all";

/** The legacy UI's status selector (src/types/dashboard.ts). */
export type LegacyStatusFilter = "all" | "queue" | "processing" | "finished";

/** metric_state.state_key — the vocabulary, §3.1. */
export type StateKey =
  | "testing"
  | "queued"
  | "done"
  | "queued_research"
  | "in_research"
  | "unmapped";

export const ALL_STATE_KEYS: readonly StateKey[] = [
  "testing",
  "queued",
  "done",
  "queued_research",
  "in_research",
  "unmapped",
];

/**
 * The legacy `status` param projected onto metric_state flags (§5.10, "status
 * counts 4/5 — duplicated in the broad sets, now separate"). The mapping is
 * explicit rather than derived at runtime so that a new state added to
 * metric_state cannot silently change what "queue" means on an old screen.
 */
const LEGACY_STATUS_SETS: Record<LegacyStatusFilter, StateKey[] | null> = {
  all: null,
  queue: ["queued", "queued_research"], // ms.is_waiting
  processing: ["testing", "in_research"], // ms.is_active_work
  finished: ["done"], // ms.is_terminal
};

/** Translate the legacy `status` query param into a state-key set (null = no filter). */
export function statesForLegacyStatus(status: string | null | undefined): StateKey[] | null {
  if (!status) return null;
  const set = LEGACY_STATUS_SETS[status as LegacyStatusFilter];
  return set === undefined ? null : set;
}

/** Every dimension the dashboard may filter on. All optional; unset === no filter. */
export interface MetricFilters {
  customerId?: number | null;
  shipmentId?: number | null;
  itemTypeId?: number | null;
  stationId?: number | null;
  stationTypeId?: number | null;
  /** Matched against item_state_interval.exited_by_worker_id — a real column on
   *  the interval, unlike the legacy predicate that threw 42703 and returned
   *  zeros with HTTP 200 (§9.4). */
  workerId?: number | null;
  itemSerial?: string | null;
  /** §4.7 / §5.0(8): exclude accessory rows entirely (`parents_only`). */
  parentsOnly?: boolean;
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

export interface FilterFragment {
  /** SQL, already ANDed, starting with a leading newline. Safe to paste into a WHERE or an ON. */
  sql: string;
  /** Bind values, in placeholder order. */
  params: unknown[];
  /** First free placeholder ordinal after this fragment. */
  nextIndex: number;
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
  // would resolve to it and silently compare the wrong row. (transcription fix)
  return `
  AND (${$(0)}::int    IS NULL OR ${a}.customer_id         = ${$(0)})
  AND (${$(1)}::int    IS NULL OR ${a}.shipment_id         = ${$(1)})
  AND (${$(2)}::int    IS NULL OR ${a}.item_type_id        = ${$(2)})
  AND (${$(3)}::int    IS NULL OR ${a}.station_id          = ${$(3)})
  AND (${$(4)}::int    IS NULL OR ${a}.station_type_id     = ${$(4)})
  AND (${$(5)}::int    IS NULL OR ${a}.exited_by_worker_id = ${$(5)})
  AND (${$(6)}::text   IS NULL OR ${a}.serial_no           = ${$(6)})
  AND (NOT ${$(7)}::boolean OR ${a}.is_accessory = false)
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
    f.parentsOnly === true,
    f.scope === "all" ? "all" : "open_shipments",
    states,
  ];
}

/** SQL + params + next ordinal for the interval-side block. */
export function intervalFilter(
  f: MetricFilters = {},
  alias = "i",
  startIndex = 1
): FilterFragment {
  return {
    sql: intervalFilterSql(alias, startIndex),
    params: intervalFilterParams(f),
    nextIndex: startIndex + FILTER_PARAM_COUNT,
  };
}

/**
 * The route_run-side block (Q2ב, §5.3ב).
 *
 * route_run carries only the dimensions that are constant for a whole pass:
 * customer, shipment, item type, serial, accessory-ness. Station, station type,
 * worker and status are per-STEP and do not exist on the run — a run that is
 * "finished" was finished as a whole, not at a station. Rather than silently
 * ignoring those filters (the §5.0 failure class), {@link runFilterIgnored}
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
  AND (NOT ${$(4)}::boolean OR ${a}.is_accessory = false)
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
    f.parentsOnly === true,
    f.scope === "all" ? "all" : "open_shipments",
  ];
}

/** Filters that route_run cannot express, given this filter object. */
export function runFilterIgnored(f: MetricFilters = {}): string[] {
  const out: string[] = [];
  if (toIntOrNull(f.stationId) !== null) out.push("stationId");
  if (toIntOrNull(f.stationTypeId) !== null) out.push("stationTypeId");
  if (toIntOrNull(f.workerId) !== null) out.push("workerId");
  if (f.states && f.states.length > 0) out.push("states");
  return out;
}

export function runFilter(
  f: MetricFilters = {},
  alias = "rr",
  startIndex = 1
): FilterFragment & { ignored: string[] } {
  return {
    sql: runFilterSql(alias, startIndex),
    params: runFilterParams(f),
    nextIndex: startIndex + RUN_FILTER_PARAM_COUNT,
    ignored: runFilterIgnored(f),
  };
}

/**
 * Read the filter set out of a dashboard query string, wire-compatible with
 * src/app/lib/dashboard-query-params.ts.
 *
 * `showSent` is deliberately NOT read (§5.0(1) — it is deleted). `scope` is the
 * one parameter; `showAllHistory=true` is accepted as the legacy spelling of
 * `scope=all` so the parity harness can drive the old and the new side from one
 * URL.
 */
export function filtersFromSearchParams(
  sp: URLSearchParams,
  defaults: Partial<MetricFilters> = {}
): MetricFilters {
  const scopeParam = sp.get("scope");
  const scope: MetricsScope =
    scopeParam === "all" || scopeParam === "open_shipments"
      ? scopeParam
      : sp.get("showAllHistory") === "true"
        ? "all"
        : (defaults.scope ?? "open_shipments");

  return {
    customerId: toIntOrNull(sp.get("customerId")),
    shipmentId: toIntOrNull(sp.get("shipmentId")),
    itemTypeId: toIntOrNull(sp.get("itemTypeId")),
    stationId: toIntOrNull(sp.get("testStationId")),
    stationTypeId: toIntOrNull(sp.get("testStationTypeId")),
    workerId: toIntOrNull(sp.get("workerId")),
    itemSerial: toTextOrNull(sp.get("itemSerial")),
    parentsOnly: sp.get("parentsOnly") === "true" || defaults.parentsOnly === true,
    states: statesForLegacyStatus(sp.get("status")) ?? defaults.states ?? null,
    scope,
  };
}
