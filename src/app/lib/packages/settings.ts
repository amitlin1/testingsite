/** Shared parsing for the package-type settings routes. */

/** "" / null → null; otherwise a whole number ≥ 1, or an error string. */
export function parseDefaultRoute(raw: unknown): { value: number | null } | { error: string } {
  if (raw === undefined || raw === null || `${raw}`.trim() === "") return { value: null };
  const n = typeof raw === "number" ? raw : Number(`${raw}`.trim());
  if (!Number.isInteger(n) || n < 1) return { error: "מסלול ברירת מחדל חייב להיות מספר שלם, 1 או יותר" };
  return { value: n };
}
