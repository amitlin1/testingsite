"use client";

// §4 — every fetch the tabs make, in one place (the history dialog reads its
// own endpoints, HistoryOverlay.tsx).
//
//  1. A refresh NEVER blanks the screen. `loading` is true only on the first
//     load of an endpoint; after that the previous rows stay mounted and the
//     header shows a 2px indeterminate bar. Sort order and scroll survive.
//  2. The 60s tick is skipped while `document.hidden`, and a tab returning to
//     the foreground refetches immediately if more than 60s have passed.
//  3. A real status code renders a real error (§16.3): a 500 is never shown as
//     an empty table, which a manager would read as "a quiet day".
//
// Response HEADERS are part of the payload: `X-Metrics-Ignored-Filters` names a
// filter the endpoint could not honour, and `X-Metrics-Period-Capped` says the
// server narrowed the window. Both are surfaced, never swallowed.

import * as React from "react";

import { apiFetch } from "@/lib/api/client";
import {
  FILTER_PARAM,
  METRICS_HEADER,
  adaptAverageTimes,
  adaptCustomers,
  adaptItemTypes,
  adaptKpis,
  adaptShipments,
  adaptSlowItems,
  adaptStations,
  adaptStatus,
  adaptStatusHistory,
  type AverageTimesView,
  type CustomerView,
  type ItemTypeView,
  type KpisView,
  type ShipmentView,
  type SlowItemView,
  type StationView,
  type StatusHistoryView,
  type StatusView,
} from "@/app/lib/dashboard/contract";
import type { JobsHealthPayload } from "@/app/lib/jobs/health";
import { buildDashboardQueryParams, getDateRange, previousRange } from "./query"; // + rangeEndingAt for the kpis / status tabs
import type { DashboardState } from "./state";

export const REFRESH_MS = 60_000;

/** What the server actually queried, from the `X-Metrics-*` headers. */
export interface ResourceMeta {
  ignoredFilters: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** The 13-month UI cap moved the start (§16.3). */
  capped: boolean;
  requestedFrom: string | null;
  /** The request reached into the future and the end was pulled back. */
  clampedEnd: boolean;
  scope: string | null;
}

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  meta: ResourceMeta;
}

const EMPTY_META: ResourceMeta = {
  ignoredFilters: null,
  periodFrom: null,
  periodTo: null,
  capped: false,
  requestedFrom: null,
  clampedEnd: false,
  scope: null,
};

export function metaOf(res: Response): ResourceMeta {
  return {
    ignoredFilters: res.headers.get(METRICS_HEADER.ignoredFilters),
    periodFrom: res.headers.get(METRICS_HEADER.periodFrom),
    periodTo: res.headers.get(METRICS_HEADER.periodTo),
    capped: res.headers.get(METRICS_HEADER.capped) === "true",
    requestedFrom: res.headers.get(METRICS_HEADER.requestedFrom),
    clampedEnd: res.headers.get(METRICS_HEADER.clampedEnd) === "true",
    scope: res.headers.get(METRICS_HEADER.scope),
  };
}

/** What a failed request shows: the server's `error` and the status, else
 *  `fallback (status)`. A non-JSON error body is still an error. */
export async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return body?.error ? `${body.error} (${res.status})` : `${fallback} (${res.status})`;
}

// ---------------------------------------------------------------------------
// The endpoint map
// ---------------------------------------------------------------------------

/** Each resource as the screens read it — the endpoint's body through its adapter. */
export interface ResourceViews {
  kpis: KpisView;
  kpisPrev: KpisView;
  stationsLive: StationView[];
  stationsPrev: StationView[];
  slow: SlowItemView[];
  shipments: ShipmentView[];
  customers: CustomerView[];
  customersPrev: CustomerView[];
  types: ItemTypeView[];
  times: AverageTimesView[];
  timesShort: AverageTimesView[];
  status: StatusView[];
  statusHistory: StatusHistoryView[];
  jobs: JobsHealthPayload;
}

export type ResourceKey = keyof ResourceViews;

/** Applied once, when the body arrives. The body is JSON from our own routes,
 *  typed by the contract — this is the one place that trusts it. */
const ADAPT: { [K in ResourceKey]: (body: never) => ResourceViews[K] } = {
  kpis: adaptKpis,
  kpisPrev: adaptKpis,
  stationsLive: adaptStations,
  stationsPrev: adaptStations,
  slow: adaptSlowItems,
  shipments: adaptShipments,
  customers: adaptCustomers,
  customersPrev: adaptCustomers,
  types: adaptItemTypes,
  times: adaptAverageTimes,
  timesShort: adaptAverageTimes,
  status: adaptStatus,
  statusHistory: adaptStatusHistory,
  jobs: (body: JobsHealthPayload) => body,
};

function adapt<K extends ResourceKey>(key: K, body: unknown): ResourceViews[K] {
  return (ADAPT[key] as (body: unknown) => ResourceViews[K])(body);
}

function withParams(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

function withLimit(params: URLSearchParams, limit: number): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("limit", String(limit));
  return next;
}

function withPeriod(params: URLSearchParams, period: string): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("period", period);
  return next;
}

/** The item-types request's params: Q7 has no window, so no dates. The rail's
 *  station and status pickers on that tab are not sent either, and nothing
 *  says so — a known bug, left for the owner. */
const ITEM_TYPE_PARAMS: string[] = [
  FILTER_PARAM.customerId,
  FILTER_PARAM.shipmentId,
  FILTER_PARAM.itemTypeId,
  FILTER_PARAM.itemSerial,
  FILTER_PARAM.scope,
];

/** False while a custom range has only one of its two dates. */
export function rangeIsComplete(state: DashboardState): boolean {
  const { startDate, endDate } = getDateRange(state.datePreset, state.customStart, state.customEnd);
  return Boolean(startDate && endDate);
}

/**
 * Which URLs a given state needs. `kpis`, `stationsLive` and `slow` are on every
 * tab: the dark strip is rendered on all nine (§4) and the `פריטים איטיים` nav
 * badge counts stuck items from wherever the manager is standing.
 */
export function endpointsFor(state: DashboardState): Partial<Record<ResourceKey, string>> {
  const range = getDateRange(state.datePreset, state.customStart, state.customEnd);
  // A half-filled custom range: every dated endpoint would answer 400, which
  // would turn "the user has picked one date so far" into a row of red error
  // bands. Only the health endpoint, which takes no dates, stays live.
  if (!range.startDate || !range.endDate) return { jobs: "/api/health/jobs" };
  const params = buildDashboardQueryParams(state.filters, range);
  const prevParams = buildDashboardQueryParams(state.filters, previousRange(range));

  const urls: Partial<Record<ResourceKey, string>> = {
    kpis: withParams("/api/dashboard/tests/kpis", params),
    stationsLive: withParams("/api/dashboard/tests/by-station", params),
    // limit is 1..100 (§8.4). The strip's `תקועים` cell and the nav badge count
    // rows inside that page — deliberately a page, not a claim about the whole
    // backlog, which is why the cell is a link into the tab rather than a total.
    slow: withParams("/api/dashboard/tests/slow-items", withLimit(params, 100)),
    jobs: "/api/health/jobs",
  };

  switch (state.tab) {
    case "overview":
      // No average-times chart here since 2026-11-26 (it lives on its own tab),
      // so `timesShort` is no longer fetched.
      urls.status = withParams("/api/dashboard/tests/status-distribution", params);
      urls.shipments = withParams("/api/dashboard/tests/shipments", params);
      break;
    // kpis tab — hidden on request (2026-11-26):
    // case "kpis": {
    //   urls.kpisPrev = withParams("/api/dashboard/tests/kpis", prevParams);
    //   // §8.2's throughput chart is 20 working days of DAILY buckets.
    //   const twenty = buildDashboardQueryParams(state.filters, rangeEndingAt(range.endDate, 28));
    //   urls.times = withParams("/api/dashboard/tests/average-times", withPeriod(twenty, "daily"));
    //   urls.statusHistory = withParams("/api/dashboard/tests/status-distribution/history", twenty);
    //   break;
    // }
    case "stations":
      urls.stationsPrev = withParams("/api/dashboard/tests/by-station", prevParams);
      break;
    case "shipments":
      urls.shipments = withParams("/api/dashboard/tests/shipments", params);
      break;
    case "times":
      urls.times = withParams("/api/dashboard/tests/average-times", withPeriod(params, state.period));
      break;
    // status tab — hidden on request (2026-11-26):
    // case "status": {
    //   const shortParams = buildDashboardQueryParams(state.filters, rangeEndingAt(range.endDate, 14));
    //   urls.status = withParams("/api/dashboard/tests/status-distribution", params);
    //   urls.statusHistory = withParams("/api/dashboard/tests/status-distribution/history", shortParams);
    //   break;
    // }
    case "customers":
      urls.customers = withParams("/api/dashboard/tests/customer-performance", params);
      urls.customersPrev = withParams("/api/dashboard/tests/customer-performance", prevParams);
      break;
    case "types": {
      const typeParams = new URLSearchParams(
        [...buildDashboardQueryParams(state.filters, null)].filter(([name]) => ITEM_TYPE_PARAMS.includes(name)),
      );
      urls.types = withParams("/api/dashboard/tests/item-types", typeParams);
      break;
    }
  }

  return urls;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface DashboardData {
  get: <K extends ResourceKey>(key: K) => Resource<ResourceViews[K]>;
  lastUpdatedAt: number | null;
  refreshing: boolean;
  refresh: () => void;
}

type Store = Partial<Record<ResourceKey, Resource<unknown>>>;

const NOT_ASKED: Resource<never> = { data: null, error: null, loading: false, meta: EMPTY_META };

export function useDashboardData(state: DashboardState): DashboardData {
  // The endpoints by their text: a new `state` object with the same filters keeps the same
  // `urls`, so the fetch below runs only when an endpoint's URL really changes.
  const urlKey = React.useMemo(() => JSON.stringify(endpointsFor(state)), [state]);
  const urls = React.useMemo(() => JSON.parse(urlKey) as Partial<Record<ResourceKey, string>>, [urlKey]);

  const [store, setStore] = React.useState<Store>({});
  const [lastUpdatedAt, setLastUpdatedAt] = React.useState<number | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  // Keyed by URL, not by resource name: a tab switch that leaves an endpoint's
  // URL unchanged must keep its rows on screen rather than flash a skeleton.
  const seen = React.useRef(new Set<string>());
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const entries = Object.entries(urls) as Array<[ResourceKey, string]>;

    setStore((prev) => {
      const next: Store = {};
      for (const [key, url] of entries) {
        const existing = prev[key];
        // First sight of this URL is the only time the body may be empty.
        const first = !seen.current.has(url);
        next[key] = {
          data: first ? null : (existing?.data ?? null),
          error: first ? null : (existing?.error ?? null),
          loading: first,
          meta: existing?.meta ?? EMPTY_META,
        };
      }
      return next;
    });
    setRefreshing(true);

    let cancelled = false;
    Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const res = await apiFetch(url, { signal: controller.signal });
          if (!res.ok) {
            const message = await failureMessage(res, "שגיאה בטעינת הנתונים");
            return [key, { data: null, error: message, meta: metaOf(res) }] as const;
          }
          seen.current.add(url);
          return [key, { data: adapt(key, await res.json()), error: null, meta: metaOf(res) }] as const;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return null;
          return [key, { data: null, error: "אין תקשורת עם שרת המדדים", meta: EMPTY_META }] as const;
        }
      }),
    ).then((results) => {
      if (cancelled || controller.signal.aborted) return;
      setStore((prev) => {
        const next: Store = { ...prev };
        for (const result of results) {
          if (!result) continue;
          const [key, value] = result;
          next[key] = {
            // A failed refresh keeps the last good rows on screen (§11); the
            // error rides above the card instead of replacing the page.
            data: value.data ?? prev[key]?.data ?? null,
            error: value.error,
            loading: false,
            meta: value.meta,
          };
        }
        return next;
      });
      setRefreshing(false);
      setLastUpdatedAt(Date.now());
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `tick` is the refresh pulse; `urls` is every filter, tab and range.
  }, [urls, tick]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setTick((t) => t + 1);
    }, REFRESH_MS);

    const onVisible = () => {
      if (document.hidden) return;
      setLastUpdatedAt((at) => {
        if (at !== null && Date.now() - at > REFRESH_MS) setTick((t) => t + 1);
        return at;
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const get = React.useCallback(
    <K extends ResourceKey>(key: K): Resource<ResourceViews[K]> =>
      (store[key] as Resource<ResourceViews[K]> | undefined) ?? NOT_ASKED,
    [store],
  );

  return {
    get,
    lastUpdatedAt,
    refreshing,
    refresh: React.useCallback(() => setTick((t) => t + 1), []),
  };
}
