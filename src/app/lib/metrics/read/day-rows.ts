/** One row per business day, created on first touch and returned in date order —
 *  how a route merges several day series (Q2א, Q2ב, Q4 …) into one. */
export function dayRows<T extends { date: string }>(seed: (date: string) => T) {
  const byDay = new Map<string, T>();
  return {
    at(date: string): T {
      let row = byDay.get(date);
      if (!row) byDay.set(date, (row = seed(date)));
      return row;
    },
    sorted(): T[] {
      return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    },
  };
}
