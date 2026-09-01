// The WEEKLY FOLD of the four history dialogs (§5.3, §5.0(7), §2.8).
//
// WHY THIS FILE EXISTS. Every history dialog above 30 points collapses its daily
// series into weeks before it draws anything, so this fold — not the route, and
// not the SQL — is the last thing that touches a number before a manager reads
// it. It lived four times over as a module-private `aggregateToWeekly` inside
// four .tsx files: three byte-identical copies and one variant, none of them
// reachable from a test. A pure function that decides what a manager sees
// deserves a name and a test, so it has both here, and the dialogs import it.
//
// THREE KINDS OF COLUMN, FOUR SUMMARIES — the whole point of the file:
//
//   MEAN   the point-in-time counts (Q2א). Each row is a snapshot of what stood
//          there at noon, so a week's typical standing population is the mean of
//          its days. Summing them would report "7 items" for one item that stood
//          still for a week.
//   SUM    the additive per-day counts — `_new_finishedToday`, `totalProcessed`,
//          `_new_*Samples`. These are events, and a week is how many happened.
//          Averaging them would report a daily rate under a weekly label.
//   LAST   the cumulative series (Q2ב `finishedItems` / `itemsFinished`, §5.3ב).
//          A monotone running total is summarised by where it ENDED; its mean is
//          the middle of the week wearing the label of the end of it.
//   WEIGHTED MEAN, NULL-PRESERVING
//          the §2.8 duration pairs. They are averages already, so they are
//          re-averaged only over the days that HAVE one, weighted by that day's
//          sample count — otherwise a 1-closure day counts as much as a
//          30-closure day. A week in which nothing closed stays NULL. That is
//          the §5.0(7) rule at the fold: "no measurement" and "zero minutes" are
//          different facts, and only the first one may be drawn as a gap.
//
// THE WEEK KEY IS CIVIL-DATE ARITHMETIC, not a Date's local components. The
// original computed it as `new Date("YYYY-MM-DD")` (parsed as UTC midnight) read
// back through LOCAL getDay()/setDate() and re-serialised with toISOString() —
// three timezone changes in one expression. East of Greenwich the three cancel
// and the answer is right, which is why nobody saw it; west of it the same
// series buckets into weeks that start on Saturday. These dates are already
// Asia/Jerusalem business days (§7.2), so they are treated as what they are —
// civil dates — and the fold gives the same answer in every process timezone. In
// Asia/Jerusalem the output is identical to the code this replaces.

/** A daily row as the history endpoints emit it: a business day plus numbers. */
export interface HistoryDailyRow {
  date: string;
  isToday?: boolean;
  [field: string]: unknown;
}

/** `YYYY-MM-DD`, tolerating a full ISO instant. */
function civilDay(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

/**
 * The Sunday that starts the civil week of `day` — Sunday because the Israeli
 * work week does, and the dialogs label these buckets in Hebrew.
 */
export function weekStartOf(day: string): string {
  const d = civilDay(day);
  const [y, m, dd] = d.split("-").map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(dd)) return d;
  const at = Date.UTC(y, m - 1, dd);
  const start = new Date(at - new Date(at).getUTCDay() * 86400000);
  return start.toISOString().slice(0, 10);
}

/** The numeric reading of one field, with a missing / null value read as 0.
 *  Only ever used for the COUNT columns, which are never null on the wire. */
function numberOf(row: HistoryDailyRow, key: string): number {
  const n = parseFloat(String(row?.[key]));
  return Number.isFinite(n) ? n : 0;
}

/** Mean over the bucket, rounded — a standing population is counted in items. */
export function meanOf(rows: HistoryDailyRow[], key: string): number {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((acc, r) => acc + numberOf(r, key), 0) / rows.length);
}

/** Sum over the bucket — for the per-day counts of things that HAPPENED. */
export function sumOf(rows: HistoryDailyRow[], key: string): number {
  return rows.reduce((acc, r) => acc + numberOf(r, key), 0);
}

/** The bucket's LAST value — for a cumulative series (§5.3ב). The rows arrive
 *  in the order the endpoint emitted them, which is ascending by date. */
export function lastOf(rows: HistoryDailyRow[], key: string): number {
  return rows.length === 0 ? 0 : numberOf(rows[rows.length - 1], key);
}

/**
 * Sample-weighted mean over the days that actually measured something, and NULL
 * when none of them did (§5.0(7), §2.8).
 *
 * Never 0: a week in which nothing closed has no average, and a 0 there would
 * read on the chart as "the wait was instant". A day whose sample count is 0 or
 * missing carries no weight even if it somehow carries a value.
 */
export function weightedMeanOf(
  rows: HistoryDailyRow[],
  key: string,
  samplesKey: string
): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = r?.[key];
    if (v === null || v === undefined) continue;
    const value = Number(v);
    if (!Number.isFinite(value)) continue;
    const w = Number(r?.[samplesKey]) || 0;
    if (w <= 0) continue;
    num += value * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** Bucket daily rows by their civil week, keeping each bucket in input order. */
export function groupByWeek(rows: HistoryDailyRow[]): Array<[string, HistoryDailyRow[]]> {
  const byWeek = new Map<string, HistoryDailyRow[]>();
  for (const row of rows) {
    const key = weekStartOf(String(row?.date ?? ""));
    const bucket = byWeek.get(key);
    if (bucket) bucket.push(row);
    else byWeek.set(key, [row]);
  }
  return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** The customer / shipment / item-type dialogs. `finishedKey` is the wire name
 *  that dialog's chart binds its cumulative line to (§5.3ב). */
export function aggregateEntityHistoryWeekly(
  daily: HistoryDailyRow[],
  finishedKey: "finishedItems" | "itemsFinished"
): Array<Record<string, number | string>> {
  return groupByWeek(daily).map(([week, rows]) => ({
    date: week,
    itemsInQueue: meanOf(rows, "itemsInQueue"),
    itemsInTest: meanOf(rows, "itemsInTest"),
    itemsWaitingForResearch: meanOf(rows, "itemsWaitingForResearch"),
    itemsInResearch: meanOf(rows, "itemsInResearch"),
    // §3.1 — the unmapped slice is folded like any other state, never dropped.
    _new_unmapped: meanOf(rows, "_new_unmapped"),
    // Q2ב is cumulative: the week's value is where it ENDED.
    [finishedKey]: lastOf(rows, finishedKey),
    // ...and the additive twin is summed.
    _new_finishedToday: sumOf(rows, "_new_finishedToday"),
  }));
}

/** The station dialog: counts, one summed flow count, and two §2.8 pairs. */
export function aggregateStationHistoryWeekly(
  daily: HistoryDailyRow[]
): Array<Record<string, number | string | null>> {
  return groupByWeek(daily).map(([week, rows]) => ({
    date: week,
    _new_sharedTypeQueue: meanOf(rows, "_new_sharedTypeQueue"),
    itemsInTest: meanOf(rows, "itemsInTest"),
    _new_inResearch: meanOf(rows, "_new_inResearch"),
    _new_unmapped: meanOf(rows, "_new_unmapped"),
    totalProcessed: sumOf(rows, "totalProcessed"),
    _new_waitSamples: sumOf(rows, "_new_waitSamples"),
    _new_handleSamples: sumOf(rows, "_new_handleSamples"),
    _new_waitWallMin: weightedMeanOf(rows, "_new_waitWallMin", "_new_waitSamples"),
    _new_waitWorkMin: weightedMeanOf(rows, "_new_waitWorkMin", "_new_waitSamples"),
    _new_handleWallMin: weightedMeanOf(rows, "_new_handleWallMin", "_new_handleSamples"),
    _new_handleWorkMin: weightedMeanOf(rows, "_new_handleWorkMin", "_new_handleSamples"),
  }));
}
