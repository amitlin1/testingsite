// How every ledger read runs: the client shape, the coercions, and the §5.0(9)
// lint every statement of the catalogue passes at module load (queries.ts).

/** Structural type satisfied by PrismaClient, a transaction client, or any thin
 *  pg wrapper — the queries never touch generated CRUD (the range columns are
 *  Unsupported("tstzrange")), so this is all they need. */
export interface MetricsClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export type Raw = Record<string, unknown>;

/** numeric/decimal/bigint/string -> number | null, with no silent 0-for-NULL. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Counts: NULL means "no rows", which for a count is 0. */
export function cnt(v: unknown): number {
  return num(v) ?? 0;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

// ---------------------------------------------------------------------------
// §5.0(9) guard
// ---------------------------------------------------------------------------

const PROBE_RE = /(\w+)\.valid_range\s*(?:@>|&&)/g;

/** Keywords that OPEN a boolean clause, and the ones that END it. Only ever
 *  matched at the probe's own paren depth. */
const CLAUSE_OPEN_RE = /\b(?:WHERE|ON|HAVING)\b/gi;
const CLAUSE_END_RE =
  /\b(?:GROUP\s+BY|ORDER\s+BY|WINDOW|LIMIT|OFFSET|FETCH|RETURNING|UNION|INTERSECT|EXCEPT|FROM|JOIN)\b/gi;

/**
 * Blank out string literals and SQL comments, preserving every index.
 *
 * Not paranoia: Q5's statement carries paragraphs of `--` prose that contain
 * the words FROM and WHERE and the parentheses of `work_seconds_between(lo,hi)`.
 * Scanning the raw text would let a comment open a clause, close one, or shift
 * the paren depth of every probe after it. Masking also means a guard that
 * exists only in a comment does not count as a guard.
 */
function maskLiterals(sql: string): string {
  const out = sql.split("");
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      out[i++] = " ";
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out[i] = " "; // '' — an escaped quote, not the end of the literal
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        const closing = sql[i] === "'";
        out[i++] = " ";
        if (closing) break;
      }
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) out[i++] = " ";
      out[i] = " ";
      if (i + 1 < sql.length) out[i + 1] = " ";
      i += 2;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Paren depth of every character. `(` and `)` carry the OUTER depth. */
function parenDepths(masked: string): Int32Array {
  const d = new Int32Array(masked.length);
  let cur = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "(") d[i] = cur++;
    else if (masked[i] === ")") d[i] = --cur;
    else d[i] = cur;
  }
  return d;
}

/** Last match of `re` at depth `depth` inside [lo, hi). */
function lastAtDepth(masked: string, d: Int32Array, re: RegExp, lo: number, hi: number, depth: number): number {
  re.lastIndex = lo;
  let found = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null && m.index < hi) {
    if (d[m.index] === depth) found = m.index;
  }
  return found;
}

/** First match of `re` at depth `depth` inside [lo, hi). */
function firstAtDepth(masked: string, d: Int32Array, re: RegExp, lo: number, hi: number, depth: number): number {
  re.lastIndex = lo;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null && m.index < hi) {
    if (d[m.index] === depth) return m.index;
  }
  return -1;
}

/**
 * Fail loudly if any range probe in a generated query lacks its
 * `NOT <alias>.is_terminal` companion. This is the single predicate that
 * separates "~400ms" from ">120s" (§6.1) and it is too easy to drop while
 * editing SQL, so every statement of the catalogue is checked mechanically.
 *
 * THE GUARD IS LOOKED FOR IN THE PROBE'S OWN CLAUSE, NOT IN THE STATEMENT:
 * a statement that aliases the interval the same way in several clauses (Q3)
 * would otherwise let one surviving guard cover them all. A probe's clause is
 * the innermost enclosing parenthesis group, narrowed to the span between the
 * nearest clause keyword before it and the nearest clause-ending keyword after
 * it, both at the probe's own paren depth.
 */
export function guardRangeProbes(sql: string, label: string): string {
  const masked = maskLiterals(sql);
  const d = parenDepths(masked);
  const missing = new Set<string>();

  PROBE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROBE_RE.exec(masked)) !== null) {
    const alias = m[1];
    const p = m.index;
    const depth = d[p];

    // The innermost enclosing parenthesis group.
    let groupStart = 0;
    for (let j = p; j >= 0; j--) {
      if (masked[j] === "(" && d[j] === depth - 1) {
        groupStart = j + 1;
        break;
      }
    }
    let groupEnd = masked.length;
    for (let j = p; j < masked.length; j++) {
      if (masked[j] === ")" && d[j] === depth - 1) {
        groupEnd = j;
        break;
      }
    }

    const opened = lastAtDepth(masked, d, CLAUSE_OPEN_RE, groupStart, p, depth);
    const ended = firstAtDepth(masked, d, CLAUSE_END_RE, p, groupEnd, depth);
    const clause = masked.slice(opened >= 0 ? opened : groupStart, ended >= 0 ? ended : groupEnd);

    if (!new RegExp(`NOT\\s+${alias}\\.is_terminal\\b`).test(clause)) missing.add(alias);
  }

  if (missing.size > 0) {
    throw new Error(
      `${label}: range probe on ${[...missing].map((a) => `${a}.valid_range`).join(", ")} ` +
        `without NOT <alias>.is_terminal in the same clause — §5.0(9); the partial GiST index would be skipped`
    );
  }
  return sql;
}

/** A statement and its bind values. */
export interface Built {
  sql: string;
  params: unknown[];
}

export async function run<T extends Raw = Raw>(client: MetricsClient, b: Built): Promise<T[]> {
  return (await client.$queryRawUnsafe<T[]>(b.sql, ...b.params)) ?? [];
}
