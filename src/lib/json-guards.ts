/**
 * Guards for JSON a client sent or a jsonb column holds, read without a schema library. Pure:
 * the browser and the server parse configs with the same checks.
 */

export type JsonObject = Record<string, unknown>;

/** Not null and not an array (any prototype): a body or a stored value read loosely. */
export const isRecord = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** A JSON object: not null, not an array, no exotic prototype. */
export function isPlainObj(v: unknown): v is JsonObject {
  if (!isRecord(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Own property only — never a value inherited from a (possibly polluted) prototype. */
export function own<T = unknown>(o: Readonly<Record<string, T>> | null | undefined, k: string): T | undefined {
  return o != null && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

export const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
export const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const oneOf = <T extends string | number>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

/** The length of the value as JSON text; null when it is not JSON (a cycle, a BigInt). */
export function jsonSize(raw: unknown): number | null {
  try {
    return JSON.stringify(raw)?.length ?? 0;
  } catch {
    return null;
  }
}

/** The same JSON, key order ignored: equal when JSON.stringify of each would write the same values
 *  (an undefined member is absent, as JSON writes it). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x ?? null, b[i] ?? null));
  }
  const keysOf = (o: JsonObject) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ao = a as JsonObject;
  const bo = b as JsonObject;
  const keys = keysOf(ao);
  if (keys.length !== keysOf(bo).length) return false;
  return keys.every((k) => jsonEqual(ao[k], own(bo, k)));
}
