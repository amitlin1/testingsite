// Request plumbing shared by the stage-5 dashboard endpoints (§8 stage 5).
//
// The six converted routes (kpis, by-station, average-times,
// status-distribution, status-distribution/history, slow-items) all need the
// same three things, and each of them is a place where the old code had a bug
// worth not reproducing six times:
//
//  1. RESOLVE THE WINDOW ONCE. resolvePeriod() applies the 13-month UI cap
//     (§6.3) and the "no future days" clamp, in Asia/Jerusalem (§7.2). The old
//     routes each did their own `new Date(...).toISOString().split('T')[0]`,
//     which names YESTERDAY east of Greenwich.
//  2. REPORT THE CAP INSTEAD OF APPLYING IT SILENTLY. period.capped /
//     clampedEnd already carry that; here they become response headers, so a
//     caller that asked for 3 years and got 13 months can tell (§6.3). Headers
//     rather than body fields because five of the six responses are arrays
//     whose shape the React components consume unchanged (§8 stage 5).
//  3. NAME THE FILTERS A QUERY CANNOT HONOUR. Q2ב is anchored on route_run,
//     which has no station / station type / worker / state dimension, and Q3
//     (the live board, §5.4) carries no filter block at all. §5.0's whole
//     first rule is that a filter must never be dropped in silence.
//
// The `_new_` prefix on the two-clock additions is deliberate and matches the
// parity harness (scripts/dashboard-parity.js): it marks a field the OLD
// response never had, so the harness reports it as an addition rather than as
// a changed number, and so stage 6 can find every field the components have
// not adopted yet with one grep.

import { NextResponse } from "next/server";

import type { MetricFilters } from "./filters";
import {
  PeriodError,
  resolvePeriod,
  toBusinessDay,
  type ResolvedPeriod,
} from "./period";
import type { MetricsClient } from "./queries";

/** A 400 the route turns into the same JSON body the old endpoints returned. */
export class BadRequest extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

/**
 * Resolve the window, keeping the old query-param contract exactly:
 * startDate + endDate are required, an unparseable one is a 400, and
 * start > end is a 400 with the message the clients have always seen.
 *
 * Everything after that is §6.3/§7.2: business days in Asia/Jerusalem, capped
 * at 13 months, clamped at today, and both clamps reported (see
 * {@link periodHeaders}).
 */
export function requirePeriod(sp: URLSearchParams): ResolvedPeriod {
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  if (!startDate || !endDate) {
    throw new BadRequest("startDate and endDate are required");
  }
  if (toBusinessDay(startDate) === null || toBusinessDay(endDate) === null) {
    throw new BadRequest("Invalid date format");
  }
  try {
    return resolvePeriod(sp);
  } catch (err) {
    if (err instanceof PeriodError) throw new BadRequest("startDate must be before endDate");
    throw err;
  }
}

/**
 * What the server actually queried, as headers. `Capped` is the 13-month UI cap
 * (§6.3) having moved the start; `ClampedEnd` is a request that reached into
 * the future. Both are absent when they did not fire, so their presence alone
 * is the signal.
 */
export function periodHeaders(
  period: ResolvedPeriod,
  filters: MetricFilters,
  ignoredFilters: string[] = []
): HeadersInit {
  const h: Record<string, string> = {
    "X-Metrics-Period-From": period.from,
    "X-Metrics-Period-To": period.to,
    "X-Metrics-Period-Granularity": period.granularity,
    // The scope the QUERY ran with, taken from the filter object rather than
    // from the parsed request: a historical endpoint pins it to `all` (§5.0(1))
    // and a header echoing the request would have quietly disagreed with the
    // numbers underneath it.
    "X-Metrics-Scope": filters.scope === "all" ? "all" : "open_shipments",
  };
  if (period.capped) {
    h["X-Metrics-Period-Capped"] = "true";
    h["X-Metrics-Period-Requested-From"] = period.requestedFrom;
    h["X-Metrics-Period-Cap-Floor"] = period.capFloor;
  }
  if (period.clampedEnd) {
    h["X-Metrics-Period-Clamped-End"] = "true";
    h["X-Metrics-Period-Requested-To"] = period.requestedTo;
  }
  if (ignoredFilters.length > 0) {
    // §5.0(1): a filter that cannot be honoured is named, never dropped in
    // silence. Object-shaped responses carry this inline as
    // `_new_ignoredFilters`; array-shaped ones carry it here.
    h["X-Metrics-Ignored-Filters"] = ignoredFilters.join(",");
  }
  return h;
}

/** JSON response + the period headers. */
export function metricsJson(
  data: unknown,
  period: ResolvedPeriod,
  filters: MetricFilters,
  ignoredFilters: string[] = []
): NextResponse {
  return NextResponse.json(data, { headers: periodHeaders(period, filters, ignoredFilters) });
}

/**
 * Q3 (§5.4) is the live board of the LAB, and its SQL deliberately carries no
 * §5.1 filter block — §5.1 lists Q1, Q2, Q4, Q5, Q6, Q7, Q8 and not Q3. Two of
 * the dimensions are still answerable outside SQL, because the board row itself
 * carries them (station id and station type id); the rest are per-item facts
 * the board never selected. This names the ones a caller asked for and the
 * board cannot honour.
 */
export function liveBoardIgnoredFilters(f: MetricFilters): string[] {
  const out: string[] = [];
  if (f.customerId != null) out.push("customerId");
  if (f.shipmentId != null) out.push("shipmentId");
  if (f.itemTypeId != null) out.push("itemTypeId");
  if (f.workerId != null) out.push("workerId");
  if (f.itemSerial != null) out.push("itemSerial");
  if (f.parentsOnly === true) out.push("parentsOnly");
  if (f.scope === "open_shipments") out.push("scope");
  return qualify("liveBoard", out);
}

/**
 * Tag each ignored filter with the part of the response that ignores it.
 *
 * A bare "stationId" would be ambiguous in exactly the way §5.0(1) is about:
 * in every one of these responses SOME numbers honour the filter and one
 * number cannot, and a reader has to be told which. `finishedCumulative:stationId`
 * says it; "stationId" invites the reader to assume the whole response is
 * unfiltered, or that nothing is.
 */
export function qualify(what: string, names: string[]): string[] {
  return names.map((n) => `${what}:${n}`);
}

// ---------------------------------------------------------------------------
// metric_state — the labels and the legacy ids
// ---------------------------------------------------------------------------

export interface MetricStateInfo {
  legacyStatusId: number | null;
  labelHe: string;
}

/**
 * §5.10: status labels come from metric_state.label_he, and the wire contract
 * of the two status-distribution endpoints is still the legacy numeric status
 * id (the charts colour by "1".."5" until stage 6 moves the components off it).
 * Both are READ FROM metric_state rather than retyped here: §2.1, one source of
 * truth, and a state added to the vocabulary must not need a second edit in a
 * route file.
 *
 * Cached for the life of the process — metric_state is seed data written by the
 * migration, not something a request can change. A failed load is not cached.
 */
let metricStateCache: Promise<Record<string, MetricStateInfo>> | null = null;

export function metricStates(client: MetricsClient): Promise<Record<string, MetricStateInfo>> {
  if (!metricStateCache) {
    metricStateCache = client
      .$queryRawUnsafe<Array<{ state_key: string; legacy_status_id: number | null; label_he: string }>>(
        "SELECT state_key, legacy_status_id, label_he FROM metric_state"
      )
      .then((rows) =>
        Object.fromEntries(
          (rows ?? []).map((r) => [
            String(r.state_key),
            {
              legacyStatusId:
                r.legacy_status_id === null || r.legacy_status_id === undefined
                  ? null
                  : Number(r.legacy_status_id),
              labelHe: String(r.label_he),
            },
          ])
        )
      )
      .catch((err) => {
        metricStateCache = null; // a transient failure must not be cached forever
        throw err;
      });
  }
  return metricStateCache;
}

/** The status id a component keys off, falling back to the state key itself for
 *  a state with no legacy equivalent (`unmapped`). */
export function legacyStatusOf(map: Record<string, MetricStateInfo>, stateKey: string): string {
  const id = map[stateKey]?.legacyStatusId;
  return id === null || id === undefined ? stateKey : String(id);
}

/** The Hebrew label, from metric_state (§5.10); never a hardcoded map. */
export function labelOf(map: Record<string, MetricStateInfo>, stateKey: string): string {
  return map[stateKey]?.labelHe ?? stateKey;
}
