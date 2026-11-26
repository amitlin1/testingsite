// The one shell every /api/dashboard route runs in: manager-only, the window
// resolved once, the filters read once, every X-Metrics-* header written here,
// and one error contract (HttpError → its 400; anything else → logged 500).
//
// Headers rather than body fields, because most answers are arrays the screens
// consume as they are. What they say: the window the server actually queried
// (the 13-month cap and the future clamp are reported, never applied in
// silence — §6.3), the shipment scope the query ran with, and the filters some
// part of the answer could not honour (§5.0(1): never dropped in silence).

import { withAuth, type RouteParams } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { HISTORY_PRESET_MONTHS, METRICS_HEADER, isHistoryPreset } from "@/app/lib/dashboard/contract";
import { ensureWorkCalendar } from "@/app/lib/metrics/ledger/calendar-sync";
import { filtersFromSearchParams, type MetricFilters } from "@/app/lib/metrics/read/filters";
import { resolvePeriod, toBusinessDay, type ResolvedPeriod } from "@/app/lib/metrics/read/period";

/**
 * How a route takes its window:
 *   window  startDate + endDate, both required (the tabs).
 *   dialog  the history dialogs' `period` preset, a window in months
 *           (alldays | 12months | 3years — anything else is alldays). Explicit
 *           startDate + endDate still win. The grid is daily at every preset.
 *   none    no window: entity progress (Q7) is a state query.
 */
export type PeriodMode = "window" | "dialog" | "none";

type PeriodOf<M extends PeriodMode> = M extends "none" ? undefined : ResolvedPeriod;

export interface MetricsRequest<M extends PeriodMode, P extends RouteParams> {
  searchParams: URLSearchParams;
  period: PeriodOf<M>;
  filters: MetricFilters;
  params: P;
}

export interface MetricsAnswer {
  body: unknown;
  /** The filters the query ran with — the scope header reports these, not the request. */
  filters: MetricFilters;
  /** The window actually served, when it differs from the resolved one (a chosen grain). */
  period?: ResolvedPeriod;
  /** Qualified (`source:filter`) names some part of the answer could not honour. */
  ignored?: readonly string[];
}

function requirePeriod(sp: URLSearchParams): ResolvedPeriod {
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  if (!startDate || !endDate) throw new HttpError(400, "startDate and endDate are required");
  if (toBusinessDay(startDate) === null || toBusinessDay(endDate) === null) {
    throw new HttpError(400, "Invalid date format");
  }
  // `period` is the granularity on tests/average-times; on no route is it a window.
  return resolvePeriod({ startDate, endDate, granularity: sp.get("granularity") ?? sp.get("period") });
}

function requireDialogPeriod(sp: URLSearchParams): ResolvedPeriod {
  if (sp.get("startDate") && sp.get("endDate")) return requirePeriod(sp);
  const preset = sp.get("period");
  return resolvePeriod({ months: HISTORY_PRESET_MONTHS[isHistoryPreset(preset) ? preset : "alldays"] });
}

function metricsHeaders(period: ResolvedPeriod | undefined, answer: MetricsAnswer): Record<string, string> {
  const h: Record<string, string> = {};
  if (period) {
    h[METRICS_HEADER.periodFrom] = period.from;
    h[METRICS_HEADER.periodTo] = period.to;
    h[METRICS_HEADER.granularity] = period.granularity;
  }
  h[METRICS_HEADER.scope] = answer.filters.scope === "all" ? "all" : "open_shipments";
  if (period?.capped) {
    h[METRICS_HEADER.capped] = "true";
    h[METRICS_HEADER.requestedFrom] = period.requestedFrom;
    h[METRICS_HEADER.capFloor] = period.capFloor;
  }
  if (period?.clampedEnd) {
    h[METRICS_HEADER.clampedEnd] = "true";
    h[METRICS_HEADER.requestedTo] = period.requestedTo;
  }
  if (answer.ignored && answer.ignored.length > 0) {
    h[METRICS_HEADER.ignoredFilters] = answer.ignored.join(",");
  }
  return h;
}

/**
 * A manager-only dashboard GET. `failure` is the 500 body's message. `historical`: the scope is the
 * constant `all` whatever the request says (§5.0(1)) — the past must not rewrite itself the day one
 * of its shipments is despatched.
 */
export function metricsRoute<M extends PeriodMode, P extends RouteParams = Record<string, never>>(
  mode: M,
  failure: string,
  run: (req: MetricsRequest<M, P>) => Promise<MetricsAnswer>,
  { historical = false } = {},
) {
  return withAuth<P>(
    async (req, { params }) => {
      try {
        const searchParams = new URL(req.url).searchParams;
        const period = (
          mode === "window" ? requirePeriod(searchParams) : mode === "dialog" ? requireDialogPeriod(searchParams) : undefined
        ) as PeriodOf<M>;
        const filters: MetricFilters = { ...filtersFromSearchParams(searchParams), ...(historical ? { scope: "all" } : {}) };
        // Every נטו figure is read off the work calendar. A no-op once it has
        // been synced in this process (normally at server start, calendar-sync.ts).
        await ensureWorkCalendar();
        const answer = await run({ searchParams, period, filters, params });
        return Response.json(answer.body, { headers: metricsHeaders(answer.period ?? period, answer) });
      } catch (error) {
        return errorResponse(error, failure);
      }
    },
    { perm: ACCESS.dashboard },
  );
}
