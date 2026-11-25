/**
 * Item statuses (item_routes.current_status → the item_status table): the ids the code branches on,
 * the groups it asks about, the station statuses beside them, their Hebrew names, and one tone per
 * status so every screen paints a status the same way (the
 * Items table, the item history, the summary tiles, the testing queue). The tones follow the
 * package artboards' STATES: waiting is amber, in test is blue, done is green. Text stays ink; the
 * tone colours a dot or a fill.
 */

export const ItemStatus = {
  InTest: 1,
  Queued: 2,
  Done: 3,
  AwaitResearch: 4,
  InResearch: 5,
  /** A box at its closing step while some of its items are still elsewhere (docs/packages/PLAN.md §4). */
  AwaitPackageItems: 6,
} as const;

// ---- status groups: the lists raw SQL interpolates (Prisma.join) and the predicates over them ----

/** Waiting in a queue: for a station of its step's type, or for a research station. */
export const WAITING_STATUSES = [ItemStatus.Queued, ItemStatus.AwaitResearch] as const;
/** Being tested now: at a station, or at a research station. */
export const IN_TEST_STATUSES = [ItemStatus.InTest, ItemStatus.InResearch] as const;
/** Waiting for research or in research. */
export const RESEARCH_STATUSES = [ItemStatus.AwaitResearch, ItemStatus.InResearch] as const;
/** At its route step's own station type: waiting there or in test there (not research). */
export const AT_STEP_STATUSES = [ItemStatus.Queued, ItemStatus.InTest] as const;

const isIn = (group: readonly number[]) => (s: number | null | undefined): boolean => s != null && group.includes(s);

export const isWaitingStatus = isIn(WAITING_STATUSES);
export const isInTestStatus = isIn(IN_TEST_STATUSES);
export const isResearchStatus = isIn(RESEARCH_STATUSES);
export const isAtStepStatus = isIn(AT_STEP_STATUSES);

/** A test is abandoned (released back to waiting by the reaper) after this many minutes without a
 *  result, unless its station type says otherwise — test_stations_type.stale_after_minutes'
 *  column default (prisma/schema.prisma), and the answer for an item parked with no station. */
export const DEFAULT_STALE_AFTER_MINUTES = 30;

/** test_stations.status (the test_station_status table). */
export const StationStatus = {
  /** A worker is testing at it. */
  Active: 1,
  Free: 2,
  /** Never assigned work. */
  Disabled: 3,
} as const;

export const STATUS_NAMES: Record<number, string> = {
  [ItemStatus.InTest]: "בבדיקה",
  [ItemStatus.Queued]: "ממתין",
  [ItemStatus.Done]: "הושלם",
  [ItemStatus.AwaitResearch]: "ממתין למחקר",
  [ItemStatus.InResearch]: "במחקר",
  [ItemStatus.AwaitPackageItems]: "ממתין לפריטי המארז",
};

export type StatusTone = "waiting" | "active" | "done" | "neutral";

const STATUS_TONE: Record<number, StatusTone> = {
  [ItemStatus.InTest]: "active",
  [ItemStatus.Queued]: "waiting",
  [ItemStatus.Done]: "done",
  [ItemStatus.AwaitResearch]: "waiting",
  [ItemStatus.InResearch]: "active",
  [ItemStatus.AwaitPackageItems]: "waiting",
};

export function toneOfStatus(statusId: number | string | null | undefined): StatusTone {
  const id = typeof statusId === "string" ? parseInt(statusId, 10) : statusId;
  return (id != null && STATUS_TONE[id]) || "neutral";
}

/** Dot / fill colour per tone (graphics: each clears 3:1 on white). */
export const TONE_DOT: Record<StatusTone, string> = {
  waiting: "var(--color-status-late)",
  active: "var(--color-primary)",
  done: "var(--color-status-approved)",
  neutral: "var(--color-ink-muted-48)",
};
