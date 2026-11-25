// The rail's filter set, described once: each filter's query parameter, how it
// is read, and its header chip. The page URL (state.ts), the request
// (query.ts), the active count and the chips all walk this table; the server
// reads the same parameter names (FILTER_PARAM, dashboard/contract.ts).

import { FILTER_PARAM } from "@/app/lib/dashboard/contract";
import {
  LEGACY_STATUS_LABEL_HE,
  isLegacyStatusFilter,
  type LegacyStatusFilter,
} from "@/app/lib/metrics/vocabulary";

/**
 *   id      a positive whole number, or null.
 *   text    free text, or null; the server matches it.
 *   status  the legacy status selector; "all" is no filter.
 *   scope   "include sent shipments": `showAllHistory=true` in the page URL, and
 *           on the request the shipment scope, which is always sent (§5.0(1)).
 */
type FilterKind = "id" | "text" | "status" | "scope";

/** The chip labels an id filter names its value by. */
export interface ChipLabels {
  customer?: string;
  shipment?: string;
  itemType?: string;
  station?: string;
  stationType?: string;
}

interface FilterSpec {
  key: string;
  kind: FilterKind;
  /** The page URL's and the request's parameter (the scope's request parameter is FILTER_PARAM.scope). */
  param: string;
  /** The chip's text, or its leading word for a filter with a value. */
  chip: string;
  label?: keyof ChipLabels;
}

/** In chip order. */
const FILTERS = [
  { key: "customerId", kind: "id", param: FILTER_PARAM.customerId, chip: "לקוח", label: "customer" },
  { key: "shipmentId", kind: "id", param: FILTER_PARAM.shipmentId, chip: "משלוח", label: "shipment" },
  { key: "itemTypeId", kind: "id", param: FILTER_PARAM.itemTypeId, chip: "סוג פריט", label: "itemType" },
  { key: "testStationId", kind: "id", param: FILTER_PARAM.stationId, chip: "עמדה", label: "station" },
  { key: "testStationTypeId", kind: "id", param: FILTER_PARAM.stationTypeId, chip: "סוג עמדה", label: "stationType" },
  /** Typed as a number but searched as text. */
  { key: "workerId", kind: "text", param: FILTER_PARAM.workerId, chip: "עובד" },
  { key: "itemSerial", kind: "text", param: FILTER_PARAM.itemSerial, chip: "סריאלי" },
  { key: "status", kind: "status", param: FILTER_PARAM.status, chip: "סטטוס" },
  { key: "showAllHistory", kind: "scope", param: "showAllHistory", chip: "כולל משלוחים שנשלחו" },
] as const satisfies readonly FilterSpec[];

type Spec = (typeof FILTERS)[number];

type ValueOf<K extends FilterKind> = K extends "id"
  ? number | null
  : K extends "text"
    ? string | null
    : K extends "status"
      ? LegacyStatusFilter
      : boolean;

export type DashboardFilters = { [S in Spec as S["key"]]: ValueOf<S["kind"]> };
export type FilterKey = keyof DashboardFilters;

const EMPTY_VALUE: { [K in FilterKind]: ValueOf<K> } = { id: null, text: null, status: "all", scope: false };

export const EMPTY_FILTERS = Object.freeze(
  Object.fromEntries(FILTERS.map((f) => [f.key, EMPTY_VALUE[f.kind]])),
) as Readonly<DashboardFilters>;

function readValue(kind: FilterKind, raw: string | null): DashboardFilters[FilterKey] {
  switch (kind) {
    case "id": {
      const n = Number.parseInt(raw ?? "", 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    case "text":
      return raw?.trim() || null;
    case "status":
      return isLegacyStatusFilter(raw) ? raw : "all";
    case "scope":
      return raw === "true";
  }
}

/** Set = differs from the empty filter. */
function isSet(f: DashboardFilters, spec: Spec): boolean {
  return f[spec.key] !== EMPTY_VALUE[spec.kind];
}

/** The filters of a page URL; anything unreadable is no filter. */
export function filtersFromParams(sp: URLSearchParams): DashboardFilters {
  return Object.fromEntries(FILTERS.map((f) => [f.key, readValue(f.kind, sp.get(f.param))])) as DashboardFilters;
}

/** Writes the set filters into a page URL. */
export function writeFilterParams(f: DashboardFilters, p: URLSearchParams): void {
  for (const spec of FILTERS) if (isSet(f, spec)) p.set(spec.param, String(f[spec.key]));
}

/** Appends the set filters to a request, and always the shipment scope. */
export function appendRequestFilters(f: DashboardFilters, p: URLSearchParams): void {
  for (const spec of FILTERS) {
    if (spec.kind === "scope") p.append(FILTER_PARAM.scope, f[spec.key] ? "all" : "open_shipments");
    else if (isSet(f, spec)) p.append(spec.param, String(f[spec.key]));
  }
}

export function countActiveFilters(f: DashboardFilters): number {
  return FILTERS.filter((spec) => isSet(f, spec)).length;
}

export interface FilterChip {
  key: FilterKey;
  text: string;
}

function chipText(spec: Spec, f: DashboardFilters, labels: ChipLabels): string {
  switch (spec.kind) {
    case "id":
      return `${spec.chip} ${labels[spec.label] ?? f[spec.key]}`;
    case "text":
      return `${spec.chip} ${f[spec.key]}`;
    case "status":
      return `${spec.chip} ${LEGACY_STATUS_LABEL_HE[f[spec.key] as Exclude<LegacyStatusFilter, "all">]}`;
    case "scope":
      return spec.chip;
  }
}

/** The header chips: the filter set a tab is scoped by. */
export function activeChips(f: DashboardFilters, labels: ChipLabels): FilterChip[] {
  return FILTERS.filter((spec) => isSet(f, spec)).map((spec) => ({ key: spec.key, text: chipText(spec, f, labels) }));
}
