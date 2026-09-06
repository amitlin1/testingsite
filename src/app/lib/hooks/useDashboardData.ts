"use client";

// §4 — every fetch the dashboard makes, in one place.
//
// Three behaviours the eight old pages did not have, and that §12 checks:
//
//  1. A refresh NEVER blanks the screen. `loading` is true only on the first
//     load of an endpoint; after that the previous rows stay mounted and the
//     header shows a 2px indeterminate bar. Sort order and scroll survive.
//  2. The 60s tick is skipped while `document.hidden`, and a tab returning to
//     the foreground refetches immediately if more than 60s have passed.
//  3. A real status code renders a real error (§16.3). The old routes answered
//     `200` with `[]`, which a manager reads as "a quiet day"; these do not, so
//     the UI must not flatten a 500 into an empty table either.
//
// Response HEADERS are part of the payload here: `X-Metrics-Ignored-Filters`
// names a filter the endpoint could not honour, and `X-Metrics-Period-Capped`
// says the server narrowed the window. Both are surfaced, never swallowed.

import * as React from "react";

import { apiFetch } from "@/lib/api/client";
import { buildDashboardQueryParams } from "@/app/lib/dashboard-query-params";
import { getDateRange } from "@/app/lib/dashboard-date-range";
import type { DashboardFilters } from "@/types/dashboard";
import type { DashboardState, TabKey } from "./useDashboardState";

export const REFRESH_MS = 60_000;

/** What the server actually queried, from the `X-Metrics-Period-*` headers. */
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

function metaOf(res: Response): ResourceMeta {
  return {
    ignoredFilters: res.headers.get("X-Metrics-Ignored-Filters"),
    periodFrom: res.headers.get("X-Metrics-Period-From"),
    periodTo: res.headers.get("X-Metrics-Period-To"),
    capped: res.headers.get("X-Metrics-Period-Capped") === "true",
    requestedFrom: res.headers.get("X-Metrics-Period-Requested-From"),
    clampedEnd: res.headers.get("X-Metrics-Period-Clamped-End") === "true",
    scope: res.headers.get("X-Metrics-Scope"),
  };
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The comparison window for every trend on the board.
 *
 * It shifts back by whole DAYS, not by the raw span, and that matters for the
 * default view: `היום` resolves to 07:00-16:00, so a span-sized shift would
 * compare this morning against LAST NIGHT. A one-day shift compares it against
 * the same nine hours yesterday, which is the question the column is asking.
 */
export function previousRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  const shift = days * 86_400_000;
  return {
    startDate: new Date(start.getTime() - shift).toISOString(),
    endDate: new Date(end.getTime() - shift).toISOString(),
  };
}

/** A fixed lookback anchored on the selected window's end (`· 14 ימים`). */
export function rangeEndingAt(endDate: string, days: number): { startDate: string; endDate: string } {
  const end = new Date(endDate);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

// ---------------------------------------------------------------------------
// The endpoint map
// ---------------------------------------------------------------------------

export type ResourceKey =
  | "kpis"
  | "kpisPrev"
  | "stationsLive"
  | "stationsPrev"
  | "slow"
  | "shipments"
  | "customers"
  | "customersPrev"
  | "types"
  | "times"
  | "timesShort"
  | "status"
  | "statusHistory"
  | "jobs";

function withParams(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

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
  const { startDate, endDate } = getDateRange(state.datePreset, state.customStart, state.customEnd);
  // A half-filled custom range resolves to two empty strings, and every dated
  // endpoint answers 400 to that. Asking anyway would turn "the user has picked
  // one date so far" into a row of red error bands, so nothing is asked: only
  // the health endpoint, which takes no dates, stays live.
  if (!startDate || !endDate) return { jobs: "/api/health/jobs" };
  const params = buildDashboardQueryParams(startDate, endDate, state.filters);
  const prev = previousRange(startDate, endDate);
  const prevParams = buildDashboardQueryParams(prev.startDate, prev.endDate, state.filters);
  const short = rangeEndingAt(endDate, 14);
  const shortParams = buildDashboardQueryParams(short.startDate, short.endDate, state.filters);

  const urls: Partial<Record<ResourceKey, string>> = {
    kpis: withParams("/api/dashboard/tests/kpis", params),
    stationsLive: withParams("/api/dashboard/tests/by-station", params),
    // limit is 1..100 (§8.4). The strip's `תקועים` cell and the nav badge count
    // rows inside that page — deliberately a page, not a claim about the whole
    // backlog, which is why the cell is a link into the tab rather than a total.
    slow: withParams("/api/dashboard/tests/slow-items", withLimit(params, 100)),
    jobs: "/api/health/jobs",
  };

  const tab: TabKey = state.tab;

  if (tab === "overview") {
    urls.status = withParams("/api/dashboard/tests/status-distribution", params);
    urls.shipments = withParams("/api/dashboard/tests/shipments", params);
    urls.timesShort = withParams(
      "/api/dashboard/tests/average-times",
      withPeriod(shortParams, "daily"),
    );
  }

  if (tab === "kpis") {
    urls.kpisPrev = withParams("/api/dashboard/tests/kpis", prevParams);
    // §8.2's throughput chart is 20 working days of DAILY buckets.
    const twenty = rangeEndingAt(endDate, 28);
    urls.times = withParams(
      "/api/dashboard/tests/average-times",
      withPeriod(buildDashboardQueryParams(twenty.startDate, twenty.endDate, state.filters), "daily"),
    );
    urls.statusHistory = withParams(
      "/api/dashboard/tests/status-distribution/history",
      buildDashboardQueryParams(twenty.startDate, twenty.endDate, state.filters),
    );
  }

  if (tab === "stations") {
    urls.stationsPrev = withParams("/api/dashboard/tests/by-station", prevParams);
  }

  if (tab === "shipments") {
    urls.shipments = withParams("/api/dashboard/tests/shipments", params);
  }

  if (tab === "times") {
    urls.times = withParams("/api/dashboard/tests/average-times", withPeriod(params, state.period));
  }

  if (tab === "status") {
    urls.status = withParams("/api/dashboard/tests/status-distribution", params);
    urls.statusHistory = withParams(
      "/api/dashboard/tests/status-distribution/history",
      shortParams,
    );
  }

  if (tab === "customers") {
    urls.customers = withParams("/api/dashboard/tests/customer-performance", params);
    urls.customersPrev = withParams("/api/dashboard/tests/customer-performance", prevParams);
  }

  if (tab === "types") {
    // §8.9 — this screen sends NO dates: Q7 has no window, and a startDate the
    // server would ignore is the silent-filter class the rewrite exists to kill.
    // Only the shipment scope travels.
    const typeParams = new URLSearchParams();
    if (state.filters.customerId != null) typeParams.set("customerId", String(state.filters.customerId));
    if (state.filters.shipmentId != null) typeParams.set("shipmentId", String(state.filters.shipmentId));
    if (state.filters.itemTypeId != null) typeParams.set("itemTypeId", String(state.filters.itemTypeId));
    if (state.filters.itemSerial) typeParams.set("itemSerial", state.filters.itemSerial);
    typeParams.set("scope", state.filters.showAllHistory ? "all" : "open_shipments");
    urls.types = withParams("/api/dashboard/tests/item-types", typeParams);
  }

  return urls;
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

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface DashboardData {
  get: <T>(key: ResourceKey) => Resource<T>;
  lastUpdatedAt: number | null;
  refreshing: boolean;
  refresh: () => void;
}

type Store = Partial<Record<ResourceKey, Resource<unknown>>>;

export function useDashboardData(state: DashboardState): DashboardData {
  const urls = React.useMemo(() => endpointsFor(state), [state]);
  const urlKey = React.useMemo(() => JSON.stringify(urls), [urls]);

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
            let message = `שגיאה בטעינת הנתונים (${res.status})`;
            try {
              const body = await res.json();
              if (body?.error) message = `${body.error} (${res.status})`;
            } catch {
              /* a non-JSON error body is still an error */
            }
            return [key, { data: null, error: message, meta: metaOf(res) }] as const;
          }
          seen.current.add(url);
          return [key, { data: await res.json(), error: null, meta: metaOf(res) }] as const;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return null;
          return [
            key,
            { data: null, error: "אין תקשורת עם שרת המדדים", meta: EMPTY_META },
          ] as const;
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
    // `tick` is the refresh pulse; `urlKey` is every filter, tab and range.
  }, [urlKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 60s auto-refresh — never while the tab is hidden, and a tab coming back
  // after more than one period refetches at once rather than waiting out the
  // remainder of an interval it slept through.
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
    <T,>(key: ResourceKey): Resource<T> =>
      (store[key] as Resource<T> | undefined) ?? {
        data: null,
        error: null,
        loading: false,
        meta: EMPTY_META,
      },
    [store],
  );

  return {
    get,
    lastUpdatedAt,
    refreshing,
    refresh: React.useCallback(() => setTick((t) => t + 1), []),
  };
}

const STATUS_LABEL_HE: Record<string, string> = {
  queue: "בתור",
  processing: "בבדיקה",
  finished: "הסתיים",
};

/** The filter set a tab is scoped by, for the header chips. Every filter the
 *  rail's badge counts has a chip here, so the count and the row agree. */
export function activeChips(
  filters: DashboardFilters,
  labels: { customer?: string; shipment?: string; itemType?: string; station?: string; stationType?: string },
): Array<{ key: keyof DashboardFilters; text: string }> {
  const chips: Array<{ key: keyof DashboardFilters; text: string }> = [];
  if (filters.customerId != null) chips.push({ key: "customerId", text: `לקוח ${labels.customer ?? filters.customerId}` });
  if (filters.shipmentId != null) chips.push({ key: "shipmentId", text: `משלוח ${labels.shipment ?? filters.shipmentId}` });
  if (filters.itemTypeId != null) chips.push({ key: "itemTypeId", text: `סוג פריט ${labels.itemType ?? filters.itemTypeId}` });
  if (filters.testStationId != null) chips.push({ key: "testStationId", text: `עמדה ${labels.station ?? filters.testStationId}` });
  if (filters.testStationTypeId != null) chips.push({ key: "testStationTypeId", text: `סוג עמדה ${labels.stationType ?? filters.testStationTypeId}` });
  if (filters.workerId) chips.push({ key: "workerId", text: `עובד ${filters.workerId}` });
  if (filters.itemSerial) chips.push({ key: "itemSerial", text: `סריאלי ${filters.itemSerial}` });
  if (filters.status !== "all") chips.push({ key: "status", text: `סטטוס ${STATUS_LABEL_HE[filters.status]}` });
  if (filters.showAllHistory) chips.push({ key: "showAllHistory", text: "כולל משלוחים שנשלחו" });
  return chips;
}
