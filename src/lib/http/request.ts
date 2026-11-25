import { HttpError } from "./errors";

/** Row ids are int4 columns: a larger number names no row, and Postgres refuses it as a parameter
 *  (a 500) rather than find nothing. */
export const INT4_MAX = 2147483647;

/** Item ids (items.item_id and every column that points at it) are int8. */
export const INT8_MAX = BigInt("9223372036854775807");

/** A positive int4: a number that can be a row id. */
export const isDbId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;

/** Digits as written in a path, a query or a body: a string, or a safe integer a JSON body sent. */
function digitsOf(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) ? String(raw) : null;
  return typeof raw === "string" ? raw : null;
}

/** A path, query or body value as an int4 row id; null for anything else ("", "abc", "0", "1.5",
 *  beyond int4). */
export function parseDbId(raw: unknown): number | null {
  const s = digitsOf(raw);
  if (s == null || !/^[0-9]{1,15}$/.test(s)) return null;
  const n = Number(s);
  return isDbId(n) ? n : null;
}

/** A path, query or body value as an int8 item id, read as text so no digit is lost past 2^53;
 *  null for anything else ("", "abc", "0", "1.5", beyond int8). */
export function parseItemId(raw: unknown): bigint | null {
  const s = digitsOf(raw);
  if (s == null || !/^[0-9]{1,19}$/.test(s)) return null;
  const n = BigInt(s);
  return n >= BigInt(1) && n <= INT8_MAX ? n : null;
}

/** parseDbId, or a 400 with `message` thrown for errorResponse to answer. */
export function requireDbId(raw: unknown, message: string): number {
  const id = parseDbId(raw);
  if (id == null) throw new HttpError(400, message);
  return id;
}

/** The request body as a JSON object; anything else (malformed JSON, an array, a scalar) → 400 INVALID_BODY. */
export async function readJsonObject(req: Request, message = "Body must be a JSON object"): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, message, { code: "INVALID_BODY" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, message, { code: "INVALID_BODY" });
  }
  return body as Record<string, unknown>;
}
