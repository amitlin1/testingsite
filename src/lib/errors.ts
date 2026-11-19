/**
 * Reading what a `catch` caught (it is `unknown`: anything can be thrown).
 *
 * Each reads one field the way `error.field` did on an Error, and gives "" / undefined for anything
 * else, so a caller's fallback (`errorMessage(e) || "השמירה נכשלה"`) behaves as before.
 */

function field(e: unknown, key: string): unknown {
  return typeof e === "object" && e !== null ? (e as Record<string, unknown>)[key] : undefined;
}

/** An Error's message; "" for anything else. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "";
}

/** A thrown value's `code` (Prisma's "P2002", Postgres' "23505", a domain error's own). */
export function errorCode(e: unknown): string | undefined {
  const code = field(e, "code");
  return typeof code === "string" ? code : undefined;
}

/** A Postgres error's `detail` (e.g. which key a unique violation hit). */
export function errorDetail(e: unknown): string | undefined {
  const detail = field(e, "detail");
  return typeof detail === "string" ? detail : undefined;
}
