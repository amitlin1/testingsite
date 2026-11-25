import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { errorCode } from "@/lib/errors";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { fixSequence } from "@/app/lib/fix-sequence";
import { NAME_TAKEN, readStaleAfterMinutes } from "@/app/lib/lookups/contract";

/**
 * The lookup tables the pickers and the settings screens list — item types, customers, sources,
 * item statuses, stations, station statuses, station types: one read per table (names come back
 * trimmed: the CHAR(50) columns are padded), and what their settings CRUD shares. Each URL keeps
 * its own JSON shape and order through a mapper in its route. SERVER ONLY.
 */

// ---- reads ------------------------------------------------------------------------------------
/** `byName`: ordered by name; else in table order. */
export async function listItemTypes({ byName = false } = {}) {
  const rows = await prisma.item_types.findMany({
    ...(byName ? { orderBy: { item_type_desc: "asc" as const } } : {}),
    select: { item_type_id: true, item_type_desc: true, is_package: true },
  });
  return rows.map((r) => ({ ...r, item_type_desc: r.item_type_desc.trim() }));
}

/** customer_code as stored (VARCHAR: the settings screen trims what it shows). */
export async function listCustomers(orderBy: "id" | "name") {
  const rows = await prisma.customers.findMany({ orderBy: orderBy === "id" ? { id: "asc" } : { name: "asc" } });
  return rows.map((r) => ({ ...r, name: r.name.trim() }));
}

export async function listSources() {
  const rows = await prisma.sources.findMany({ orderBy: { source_id: "asc" } });
  return rows.map((r) => ({ source_id: r.source_id, source_desc: r.source_desc.trim() }));
}

export async function listItemStatuses() {
  const rows = await prisma.item_status.findMany({ orderBy: { item_status_id: "asc" } });
  return rows.map((r) => ({ item_status_id: r.item_status_id, item_status_desc: r.item_status_desc.trim() }));
}

export async function listTestStationStatuses() {
  const rows = await prisma.test_station_status.findMany({ orderBy: { test_station_status_id: "asc" } });
  return rows.map((r) => ({ test_station_status_id: r.test_station_status_id, test_station_status_desc: r.test_station_status_desc.trim() }));
}

/** The stations by name, each with its station type's name; `typeId` narrows them to one type. */
export async function listStations(typeId?: number) {
  const where: Prisma.test_stationsWhereInput = typeId === undefined ? {} : { test_station_type_id: typeId };
  const rows = await prisma.test_stations.findMany({
    where,
    include: { test_stations_type: { select: { test_type_desc: true } } },
    orderBy: { test_station_desc: "asc" },
  });
  return rows.map(({ test_stations_type, ...r }) => ({
    ...r,
    test_station_desc: r.test_station_desc.trim(),
    test_type_desc: test_stations_type.test_type_desc.trim(),
  }));
}

/** The station types by id, each with how many stations it has. */
export async function listStationTypes() {
  const rows = await prisma.test_stations_type.findMany({
    orderBy: { test_station_type_id: "asc" },
    include: { _count: { select: { test_stations: true } } },
  });
  return rows.map(({ _count, ...r }) => ({ ...r, test_type_desc: r.test_type_desc.trim(), station_count: _count.test_stations }));
}

/**
 * A list GET. A failed read answers 500 `{ error: fallback }` — or, with `emptyOnError`, an empty
 * list. That is a reported bug kept as it was: the screens then show "nothing yet" instead of an
 * error (the newer endpoints answer 500, spec §11 rule 12); the owner decides.
 */
export async function listJson(read: () => Promise<unknown[]>, fallback: string, { emptyOnError = false } = {}): Promise<Response> {
  try {
    return NextResponse.json(await read());
  } catch (error) {
    if (!emptyOnError) return errorResponse(error, fallback);
    console.error(fallback, error);
    return NextResponse.json([]);
  }
}

// ---- writes -----------------------------------------------------------------------------------
/** A required name: a non-blank string, trimmed; null for anything else. */
export const requiredText = (raw: unknown): string | null => (typeof raw === "string" && raw.trim() ? raw.trim() : null);

/** What a settings write answers for each of Prisma's refusals it expects. */
type Refusals = {
  /** P2025 — the row does not exist → 404. */
  notFound?: string;
  /** P2003 — other rows still reference it → 409. */
  inUse?: string;
};

/** The settings tables' refusal to delete a row other records still use. */
export const IN_USE_TEXT = "המחיקה נכשלה. ייתכן שהרשומה בשימוש במסכים אחרים; בדוק ונסה שוב.";

/** Prisma's refusals as a settings route answers them; anything else errorResponse(fallback). */
export function prismaRefusal(error: unknown, texts: Refusals, fallback: string): Response {
  const code = errorCode(error);
  if (code === "P2025" && texts.notFound) return NextResponse.json({ error: texts.notFound }, { status: 404 });
  if (code === "P2003" && texts.inUse) return NextResponse.json({ error: texts.inUse }, { status: 409 });
  return errorResponse(error, fallback);
}

/** A name no two rows may share: `taken(exceptId)` looks the name up among the rows other than
 *  `exceptId`. A write that breaks it answers 400 `text`, code NAME_TAKEN. */
export type NameRule = { text: string; taken: (exceptId?: number) => Promise<boolean> };

/** The lookup tables whose rows have a unique name: [id column, name column]. */
const NAME_COLUMNS = {
  customers: ["id", "name"],
  sources: ["source_id", "source_desc"],
  item_status: ["item_status_id", "item_status_desc"],
  test_station_status: ["test_station_status_id", "test_station_status_desc"],
  item_types: ["item_type_id", "item_type_desc"],
  test_stations: ["test_station_id", "test_station_desc"],
  test_stations_type: ["test_station_type_id", "test_type_desc"],
} as const;

export type NamedTable = keyof typeof NAME_COLUMNS;

/**
 * No two rows of `table` share a name, compared trimmed and case-blind. Raw SQL on purpose: most
 * of these columns are CHAR(50), padded with spaces, and Prisma's `mode: "insensitive"` compares
 * the padding (Postgres' bpchar ILIKE) — it never matched there, and it reads % and _ as wildcards.
 * The table and column names are this map's, never input.
 */
export function uniqueName(table: NamedTable, name: string, text: string): NameRule {
  const [idColumn, nameColumn] = NAME_COLUMNS[table];
  return {
    text,
    taken: async (exceptId) => {
      const rows = await prisma.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM ${table} WHERE lower(trim(${nameColumn})) = lower(trim($1)) AND ($2::int IS NULL OR ${idColumn} <> $2::int) LIMIT 1`,
        name,
        exceptId ?? null,
      );
      return rows.length > 0;
    },
  };
}

const nameTaken = (rule: NameRule) => new HttpError(400, rule.text, { code: NAME_TAKEN });

/** The int4 id sequence of a table rows were inserted into with explicit ids (seed scripts, a
 *  station type's id change), so it can fall behind them. */
type IdSequence = { table: string; idColumn: string; name: string; retryFailed: string };

/**
 * Inserts a lookup row. `duplicate`: refused before the insert, or when the insert hits the unique
 * index on the name. `sequence`: the id sequence is repaired before the insert, and when the insert
 * hits the primary key once more with one retry (409 `retryFailed` when that fails too) — a stopgap
 * until the sequences are fixed for good.
 */
export async function insertLookupRow<T>(
  create: () => Promise<T>,
  o: { duplicate?: NameRule; sequence?: IdSequence },
): Promise<T> {
  const { duplicate, sequence } = o;
  if (duplicate && (await duplicate.taken())) throw nameTaken(duplicate);
  const repair = (s: IdSequence) => fixSequence(prisma, s.table, s.idColumn, s.name);
  if (sequence) await repair(sequence);
  try {
    return await create();
  } catch (error) {
    if (errorCode(error) !== "P2002") throw error;
    if (duplicate && (!sequence || (await duplicate.taken()))) throw nameTaken(duplicate);
    if (!sequence) throw error;
    await repair(sequence);
    try {
      return await create();
    } catch (retryError) {
      console.error(`Insert into ${sequence.table} failed after the sequence repair:`, retryError);
      throw new HttpError(409, sequence.retryFailed);
    }
  }
}

/** Refuses a write to row `exceptId` (none: a new row) whose name another row already has. */
export async function assertNameFree(rule: NameRule, exceptId?: number): Promise<void> {
  if (await rule.taken(exceptId)) throw nameTaken(rule);
}

/** Updates lookup row `id` under its name rule: refused before the write, or when the write hits the
 *  unique index on the name. */
export async function updateLookupRow<T>(id: number, update: () => Promise<T>, duplicate: NameRule): Promise<T> {
  await assertNameFree(duplicate, id);
  try {
    return await update();
  } catch (error) {
    if (errorCode(error) === "P2002") throw nameTaken(duplicate);
    throw error;
  }
}

/**
 * The POST, PUT and DELETE of a lookup table whose only field is a unique name (item statuses,
 * sources, station statuses). The body carries the name under `field`; every answer is `json(row)`.
 */
export function lookupWrites<Row>(t: {
  table: NamedTable;
  field: string;
  /** The name rule's 400 text. */
  duplicate: string;
  create: (name: string) => Promise<Row>;
  update: (id: number, name: string) => Promise<Row>;
  remove: (id: number) => Promise<unknown>;
  json: (row: Row) => Record<string, unknown>;
  sequence?: IdSequence;
  texts: { notFound: string; createFailed: string; updateFailed: string; deleteFailed: string };
}) {
  type Ctx = { params: Promise<{ id: string }> };
  const rule = (name: string) => uniqueName(t.table, name, t.duplicate);
  const readName = async (req: Request) => {
    const name = requiredText((await readJsonObject(req))[t.field]);
    if (!name) throw new HttpError(400, "Description is required");
    return name;
  };
  return {
    async POST(req: Request) {
      try {
        const name = await readName(req);
        const created = await insertLookupRow(() => t.create(name), { duplicate: rule(name), sequence: t.sequence });
        return NextResponse.json(t.json(created));
      } catch (error) {
        return errorResponse(error, t.texts.createFailed);
      }
    },
    async PUT(req: Request, { params }: Ctx) {
      try {
        const id = parseDbId((await params).id);
        const name = await readName(req);
        if (id === null) throw new HttpError(404, t.texts.notFound);
        return NextResponse.json(t.json(await updateLookupRow(id, () => t.update(id, name), rule(name))));
      } catch (error) {
        return prismaRefusal(error, { notFound: t.texts.notFound }, t.texts.updateFailed);
      }
    },
    async DELETE(_req: Request, { params }: Ctx) {
      const { id } = await params;
      try {
        const rowId = parseDbId(id);
        if (rowId === null) throw new HttpError(404, t.texts.notFound);
        await t.remove(rowId);
        return NextResponse.json({ success: true, id });
      } catch (error) {
        return prismaRefusal(error, { notFound: t.texts.notFound, inUse: IN_USE_TEXT }, t.texts.deleteFailed);
      }
    },
  };
}

// ---- station types ----------------------------------------------------------------------------
/** stale_after_minutes as a write takes it: undefined when the body leaves it out, 400 when it is
 *  not a whole number >= 0 (lookups/contract.ts readStaleAfterMinutes). */
export function parseStaleAfterMinutes(raw: unknown): number | undefined {
  const n = readStaleAfterMinutes(raw);
  if (n === null) throw new HttpError(400, "זמן שחרור אוטומטי חייב להיות מספר שלם של דקות, 0 או יותר");
  return n;
}
