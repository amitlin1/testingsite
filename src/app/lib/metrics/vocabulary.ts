// The ledger's vocabulary — the state keys, their groupings and the reasons —
// written once. Pure and client-safe.
//
// The database is the source of the LABELS (metric_state.label_he, read by the
// routes). This module holds only keys and groupings, which must match the
// metric_state flags of the migrations (20260825000000, 20260915120000): a new
// state is a migration plus an entry here.

/** metric_state.state_key (§3.1). */
export type StateKey =
  | "testing"
  | "queued"
  | "done"
  | "queued_research"
  | "waiting_for_package_items"
  | "in_research"
  | "unmapped";

/** metric_state.is_waiting. */
export const WAITING_STATES: readonly StateKey[] = ["queued", "queued_research", "waiting_for_package_items"];

/** metric_state.is_active_work. */
export const ACTIVE_STATES: readonly StateKey[] = ["testing", "in_research"];

/** Every reason an event can carry (§3.4). `correction` is a manual-SQL path,
 *  never written through metrics_record(). */
export type MetricsReason =
  | "item_created"
  | "test_started"
  | "released_by_user"
  | "released_stale"
  | "result_submitted"
  | "sent_to_research"
  | "returned_to_route"
  | "research_note"
  | "no_station_for_type"
  | "station_reassigned"
  | "manual_override"
  | "legacy_import"
  | "package_items_pending"
  | "package_items_ready"
  | "package_reset"
  | "correction";

/** A step handed back to the queue without a result — by the worker or by the reaper. */
export const RELEASE_REASONS = ["released_by_user", "released_stale"] as const satisfies readonly MetricsReason[];

/** The legacy `status` selector of the dashboard (query param `status`). */
export type LegacyStatusFilter = "all" | "queue" | "processing" | "finished";

export const LEGACY_STATUS_FILTERS: readonly LegacyStatusFilter[] = ["all", "queue", "processing", "finished"];

/** The selector projected onto states. Explicit rather than derived from the
 *  flags at runtime, so a state added to metric_state cannot silently change
 *  what "queue" means on a screen. null = no filter. */
export const LEGACY_STATUS_STATES: Record<LegacyStatusFilter, readonly StateKey[] | null> = {
  all: null,
  queue: WAITING_STATES,
  processing: ACTIVE_STATES,
  finished: ["done"],
};

export const LEGACY_STATUS_LABEL_HE: Record<Exclude<LegacyStatusFilter, "all">, string> = {
  queue: "בתור",
  processing: "בבדיקה",
  finished: "הסתיים",
};

export function isLegacyStatusFilter(v: unknown): v is LegacyStatusFilter {
  return LEGACY_STATUS_FILTERS.includes(v as LegacyStatusFilter);
}
