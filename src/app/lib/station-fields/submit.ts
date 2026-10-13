import type { TransactionClient } from "@/app/lib/prisma";
import { isPackageLevelStationType, loadPackageContext, type PackageContext } from "@/app/lib/packages/context";
import { GATE_FINISH_ON_REQUIRED, evaluateFields, toResultBlock } from "./evaluate";
import type { Drafts, FieldDraft } from "./evaluate";
import { COPY_PENDING, fieldsGateText } from "./labels";
import { resolveStationFields } from "./resolve";
import type { ResolveKitItem, ResolveRoute } from "./resolve";
import type {
  Field, FieldId, FieldValue, FieldsSchemaRef, InputField, KitItemFields, StationFieldsResponse,
} from "./schema";

/**
 * Station fields on the server (route-fields spec §3.3, §3.4). SERVER ONLY: it reads the database.
 * The rules live in the pure module next to it — resolve.ts decides which fields a row answers,
 * evaluate.ts normalises and evaluates the values — and this file loads what they need and turns
 * their answers into HTTP errors.
 *
 * - loadStationFields — GET /api/testing/station-fields: what the popup opening on a row shows.
 * - resolveForSubmission — inside POST /api/testing/results, after the row lock: the fields the
 *   submitted row answers, or null (today's popup: Details are stored as sent).
 * - checkFieldsSubmission — the submitted Details against that answer: the schema the popup was
 *   built from, every value re-derived from the config, notes, the finish gate.
 *
 * A row with no frozen version (fields_version NULL — every row taken in before the first
 * publish) costs no query beyond the row itself; on submit, an item inside a kit adds at most the
 * station type's level and the kit's row (it may answer the kit's version).
 */

/** The client this module reads through: the app's prisma, or the caller's transaction. */
export type StationFieldsDb = Pick<TransactionClient, "$queryRaw" | "test_stations_type" | "route_field_versions">;

const LEGACY: StationFieldsResponse = { mode: "legacy" };

/** current_status 4 (waiting for research) and 5 (in research): research popups never carry fields. */
const isResearchStatus = (status: number | null): boolean => status === 4 || status === 5;

/** An item_routes row with its route (item_routes ⋈ testing_routes on item_type_id + route_number). */
type RouteRow = {
  current_route_step: number;
  current_status: number | null;
  fields_version: number | null;
  /** null when no testing_routes row matches — no config can exist for it. */
  route: ResolveRoute | null;
};

/**
 * The legacy answers resolveStationFields gives before it needs anything beyond the row: no route,
 * no frozen version, or research. Checked first only so those rows skip the remaining queries.
 */
function mayHaveFields(row: RouteRow): row is RouteRow & { route: ResolveRoute; fields_version: number } {
  return row.route != null && row.fields_version != null && !isResearchStatus(row.current_status);
}

// ---- queries ----------------------------------------------------------------------------
async function loadRouteRow(db: StationFieldsDb, itemId: bigint): Promise<RouteRow | null> {
  const rows = await db.$queryRaw<{
    current_route_step: number;
    current_status: number | null;
    fields_version: number | null;
    test_route_id: number | null;
    route_steps: number[] | null;
    step_uids: string[] | null;
  }[]>`
    SELECT ir.current_route_step, ir.current_status, ir.fields_version,
           tr.test_route_id, tr.route_steps, tr.step_uids
    FROM item_routes ir
    LEFT JOIN testing_routes tr
      ON tr.item_type_id = ir.item_type_id
     AND tr.route_number = ir.route_number
    WHERE ir.item_id = ${itemId}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    current_route_step: r.current_route_step,
    current_status: r.current_status,
    fields_version: r.fields_version,
    route: r.test_route_id == null ? null : { test_route_id: r.test_route_id, route_steps: r.route_steps, step_uids: r.step_uids },
  };
}

async function loadRoute(db: StationFieldsDb, itemTypeId: number, routeNumber: number): Promise<ResolveRoute | null> {
  const rows = await db.$queryRaw<{ test_route_id: number; route_steps: number[] | null; step_uids: string[] | null }[]>`
    SELECT test_route_id, route_steps, step_uids
    FROM testing_routes
    WHERE item_type_id = ${itemTypeId} AND route_number = ${routeNumber}
  `;
  return rows[0] ?? null;
}

/** route_field_versions(test_route_id, version).config as stored — resolve.ts parses it. */
async function loadConfig(db: StationFieldsDb, routeId: number, version: number): Promise<unknown> {
  const row = await db.route_field_versions.findUnique({
    where: { test_route_id_version: { test_route_id: routeId, version } },
    select: { config: true },
  });
  return row?.config ?? null;
}

/** Every item inside the kit, by package_seq. */
async function loadKitItems(db: StationFieldsDb, kitId: bigint): Promise<ResolveKitItem[]> {
  const rows = await db.$queryRaw<{ item_id: bigint; package_seq: number | null; item_type_id: number; item_type_desc: string | null }[]>`
    SELECT i.item_id, i.package_seq, i.item_type_id, TRIM(it.item_type_desc) AS item_type_desc
    FROM items i
    JOIN item_types it ON it.item_type_id = i.item_type_id
    WHERE i.package_id = ${kitId}
    ORDER BY i.package_seq, i.item_id
  `;
  return rows.map((r) => ({
    item_id: String(r.item_id),
    package_seq: Number(r.package_seq ?? 0),
    item_type_id: r.item_type_id,
    item_type_desc: r.item_type_desc ?? "",
  }));
}

async function isResearchStation(db: StationFieldsDb, stationId: number): Promise<boolean> {
  const rows = await db.$queryRaw<{ is_research: boolean }[]>`
    SELECT is_research FROM test_stations WHERE test_station_id = ${stationId}
  `;
  return rows[0]?.is_research === true;
}

/** isPackageLevelStationType, asked at most once per station type. */
function packageLevelLookup(db: StationFieldsDb): (typeId: number | null | undefined) => Promise<boolean> {
  const known = new Map<number, boolean>();
  return async (typeId) => {
    if (typeId == null) return false;
    const hit = known.get(typeId);
    if (hit !== undefined) return hit;
    const level = await isPackageLevelStationType(db, typeId);
    known.set(typeId, level);
    return level;
  };
}

type ResolveContext = {
  /** The row is a kit (the box) — loadPackageContext(...).isPackage. */
  rowIsPackage: boolean;
  /** The station the popup opens on, when known: a research station is always legacy. */
  stationId: number | null;
  levelOf: (typeId: number | null | undefined) => Promise<boolean>;
};

/** Loads what resolveStationFields needs for one row (`itemId`) and asks it. */
async function resolveRow(db: StationFieldsDb, itemId: bigint, row: RouteRow, ctx: ResolveContext): Promise<StationFieldsResponse> {
  if (!mayHaveFields(row)) return LEGACY;
  const config = await loadConfig(db, row.route.test_route_id, row.fields_version);
  if (config == null) return LEGACY;
  const stepTypeId = row.route.route_steps?.[row.current_route_step - 1];
  const stepIsPackageLevel = await ctx.levelOf(stepTypeId);
  const stationIsResearch = ctx.stationId != null && (await isResearchStation(db, ctx.stationId));
  const kitItems = ctx.rowIsPackage ? await loadKitItems(db, itemId) : [];
  return resolveStationFields({
    route: row.route,
    fields_version: row.fields_version,
    current_route_step: row.current_route_step,
    current_status: row.current_status,
    stationIsResearch,
    stepIsPackageLevel,
    rowIsPackage: ctx.rowIsPackage,
    config,
    kitItems,
    gate: GATE_FINISH_ON_REQUIRED,
  });
}

// ---- GET /api/testing/station-fields ------------------------------------------------------
/** The item has no item_routes row → 404. */
export class StationFieldsNotFoundError extends Error {
  readonly code = "ITEM_ROUTE_NOT_FOUND";
  constructor(itemId: bigint) {
    super(`no item_routes row for item ${itemId}`);
    this.name = "StationFieldsNotFoundError";
  }
}

/**
 * What the popup opening on `itemId` shows at the row's current step (spec §3.3). A kit row at a
 * package-level step answers "package" with the box fields and every kit item's groups. Throws
 * StationFieldsNotFoundError when the item has no route row; any other failure propagates — the
 * caller answers 500, never "legacy" (the popup blocks on an error, spec §4.2).
 */
export async function loadStationFields(
  db: StationFieldsDb,
  input: { itemId: bigint; stationId?: number | null },
): Promise<StationFieldsResponse> {
  const row = await loadRouteRow(db, input.itemId);
  if (!row) throw new StationFieldsNotFoundError(input.itemId);
  if (!mayHaveFields(row)) return LEGACY;
  const pkg = await loadPackageContext(db, input.itemId);
  return resolveRow(db, input.itemId, row, {
    rowIsPackage: pkg?.isPackage === true,
    stationId: input.stationId ?? null,
    levelOf: packageLevelLookup(db),
  });
}

// ---- POST /api/testing/results: which fields the row answers ----------------------------
/** The row as POST /api/testing/results locked it (SELECT … FOR UPDATE). */
export type LockedRouteRow = {
  item_type_id: number;
  route_number: number;
  current_route_step: number;
  current_status: number | null;
  fields_version: number | null;
};

/** The fields a submitted row answers, and the schema its Details must carry. */
export type FieldsTarget = {
  schema: FieldsSchemaRef;
  /** item: the step's item group; box: the box group; kit_item: each_item, then its own type's group. */
  fields: Field[];
  /** Box rows: every kit item with its groups — decisions[i].fields (close wizard) are checked
   *  against these. Empty for the other targets. */
  kitItems: KitItemFields[];
};

/**
 * Spec §3.4 step 1, from the LOCKED row (never from the body): null when the row has no config
 * (Details are then stored as sent), otherwise the target the Details must answer —
 * - a kit row at a package-level step: "box", on the kit's own route, version and step;
 * - an item inside a kit, submitted by a package-level station type (opening / closing):
 *   "kit_item", on the KIT row's route, frozen version and current step. packageId alone does not
 *   decide it — every item of a kit has one, also at per-item stations;
 * - any other row: "item", on its own route, version and step.
 * Research (status 4 / 5, or a research station) never has a config. Mirrors loadStationFields,
 * so a popup and the submission it sends resolve the same step.
 */
export async function resolveForSubmission(
  tx: StationFieldsDb,
  input: {
    itemId: bigint;
    stationId: number;
    /** test_stations.test_station_type_id of the submitting station. */
    stationTypeId: number | null;
    row: LockedRouteRow;
    pkgCtx: PackageContext | null;
  },
): Promise<FieldsTarget | null> {
  const { itemId, row, pkgCtx } = input;
  if (isResearchStatus(row.current_status)) return null;
  const kitId = pkgCtx?.packageId ?? null;
  // Nothing frozen on the row and not inside a kit: no config is possible, nothing more to read.
  if (row.fields_version == null && kitId == null) return null;
  const levelOf = packageLevelLookup(tx);

  if (kitId != null && (await levelOf(input.stationTypeId))) {
    const kit = await loadRouteRow(tx, kitId);
    if (!kit) return null;
    const res = await resolveRow(tx, kitId, kit, { rowIsPackage: true, stationId: input.stationId, levelOf });
    if (res.mode !== "package") return null;
    const mine = res.items.find((it) => it.item_id === itemId.toString());
    return {
      schema: { ...res.schema, target: "kit_item" },
      fields: mine ? mine.groups.flatMap((g) => g.fields) : [],
      kitItems: [],
    };
  }

  if (row.fields_version == null) return null;
  const route = await loadRoute(tx, row.item_type_id, row.route_number);
  const rowIsPackage = pkgCtx?.isPackage === true;
  const res = await resolveRow(
    tx,
    itemId,
    { current_route_step: row.current_route_step, current_status: row.current_status, fields_version: row.fields_version, route },
    { rowIsPackage, stationId: input.stationId, levelOf },
  );
  if (res.mode === "item") return { schema: res.schema, fields: res.fields, kitItems: [] };
  if (res.mode === "package") return { schema: { ...res.schema, target: "box" }, fields: res.box, kitItems: res.items };
  return null;
}

// ---- POST /api/testing/results: the submitted Details ----------------------------------------
/** JSON.stringify(Details).length above this → 413 (spec §3.4 step 8), when the row has a config. */
export const MAX_DETAILS_JSON = 256_000;

export type FieldsSubmissionCode =
  | "FIELDS_SCHEMA_MISMATCH"   // 409 — the popup was built from another config: reload it
  | "FIELDS_INVALID"           // 400 — a value that does not fit its field (a client bug)
  | "NOTE_TOO_LONG"            // 400 — a note over its note_max, whatever the gate says
  | "FIELDS_INCOMPLETE"        // 422 — the finish gate: required fields or notes missing
  | "DETAILS_TOO_LARGE";       // 413

/** A field the finish gate is waiting for. item_id: a close-wizard decision's item. */
export type MissingField = { field_id: FieldId; reason: "required" | "note"; item_id?: string };

/** Mapped by POST /api/testing/results to { error: message, code, missing } with `status`. */
export class FieldsSubmissionError extends Error {
  readonly status: 400 | 409 | 413 | 422;
  readonly code: FieldsSubmissionCode;
  readonly missing?: MissingField[];
  constructor(status: 400 | 409 | 413 | 422, code: FieldsSubmissionCode, message: string, missing?: MissingField[]) {
    super(message);
    this.name = "FieldsSubmissionError";
    this.status = status;
    this.code = code;
    if (missing) this.missing = missing;
  }
}

const schemaMismatch = () => new FieldsSubmissionError(409, "FIELDS_SCHEMA_MISMATCH", COPY_PENDING.schemaMismatch);
// Technical detail in English, like the route's other client-bug errors: a popup built from the
// config never triggers it.
const invalid = (detail: string) => new FieldsSubmissionError(400, "FIELDS_INVALID", `Invalid station fields: ${detail}`);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** Own property only — never a value inherited through the prototype. */
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

function sameSchema(raw: unknown, want: FieldsSchemaRef): boolean {
  return isObj(raw)
    && own(raw, "route_id") === want.route_id
    && own(raw, "v") === want.v
    && own(raw, "step_uid") === want.step_uid
    && own(raw, "target") === want.target;
}

/**
 * A submitted FieldValue back to the popup's draft of it, so evaluate.ts re-derives the stored
 * value exactly as the popup does (toFieldValue: label, option label and tone, unit, in_range and
 * photo_type from the definition). The value must be of the field's own type, and every option /
 * checklist item it names must exist in the field; a bad value is a 400.
 */
function draftOf(def: InputField, raw: unknown, at: string): FieldDraft {
  if (!isObj(raw) || own(raw, "t") !== def.type) throw invalid(`${at}: expected a ${def.type} value`);
  const note = own(raw, "note");
  if (note != null && typeof note !== "string") throw invalid(`${at}.note`);
  const d: FieldDraft = typeof note === "string" ? { note } : {};
  switch (def.type) {
    case "choice_row": {
      const opt = own(raw, "opt");
      if (opt == null) return d;
      if (typeof opt !== "string" || !def.options.some((o) => o.id === opt)) throw invalid(`${at}.opt: unknown option`);
      return { ...d, opt };
    }
    case "multi_choice": {
      const opts = own(raw, "opts");
      if (opts == null) return d;
      if (!Array.isArray(opts)) throw invalid(`${at}.opts`);
      const ids: string[] = [];
      for (const o of opts as unknown[]) {
        const id = isObj(o) ? own(o, "id") : undefined;
        if (typeof id !== "string" || !def.options.some((x) => x.id === id)) throw invalid(`${at}.opts: unknown option`);
        ids.push(id);
      }
      return { ...d, opts: ids };
    }
    case "pass_fail": {
      const ok = own(raw, "ok");
      if (ok == null) return d;
      if (ok !== "pass" && ok !== "fail") throw invalid(`${at}.ok`);
      return { ...d, ok };
    }
    case "number": {
      const value = own(raw, "value");
      if (value == null) return d;
      if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${at}.value`);
      return { ...d, num: String(value) };
    }
    case "text":
    case "textarea":
    case "scan": {
      const value = own(raw, "value");
      if (value == null) return d;
      if (typeof value !== "string") throw invalid(`${at}.value`);
      return { ...d, text: value };
    }
    case "checklist": {
      const items = own(raw, "items");
      if (items == null) return d;
      if (!Array.isArray(items)) throw invalid(`${at}.items`);
      const checked: Record<string, boolean> = {};
      for (const it of items as unknown[]) {
        const id = isObj(it) ? own(it, "id") : undefined;
        const ok = isObj(it) ? own(it, "ok") : undefined;
        if (typeof id !== "string" || !def.items.some((x) => x.id === id) || typeof ok !== "boolean") {
          throw invalid(`${at}.items: unknown item`);
        }
        checked[id] = ok;
      }
      return { ...d, checked };
    }
    case "photo": {
      const photoType = own(raw, "photo_type");
      if (photoType != null && photoType !== def.photo_type) throw invalid(`${at}.photo_type`);
      const photos = own(raw, "photos");
      if (photos == null) return d;
      if (!Array.isArray(photos) || !photos.every((k: unknown) => typeof k === "string")) throw invalid(`${at}.photos`);
      return { ...d, photos: (photos as string[]).map((objectKey) => ({ previewUrl: "", objectKey })) };
    }
  }
}

/** Drafts for the defined fields only: keys of fields not in the config (and sections) are dropped. */
function draftsOf(defs: readonly Field[], raw: unknown, at: string): Drafts {
  if (raw == null) return {};
  if (!isObj(raw)) throw invalid(`${at}: expected an object`);
  const drafts: Drafts = {};
  for (const def of defs) {
    if (def.type === "section") continue;
    const value = own(raw, def.id);
    if (value != null) drafts[def.id] = draftOf(def, value, `${at}.${def.id}`);
  }
  return drafts;
}

/** The worker's own verdict: ok only as "pass" / "fail", note only as text. */
function verdictInputOf(raw: unknown): { ok?: "pass" | "fail"; note?: string } {
  if (raw == null) return {};
  if (!isObj(raw)) throw invalid("verdict");
  const ok = own(raw, "ok");
  const note = own(raw, "note");
  return { ...(ok === "pass" || ok === "fail" ? { ok } : {}), ...(typeof note === "string" ? { note } : {}) };
}

/** A decision without our keys — the same object when it has none. */
function withoutFields(d: Obj): Obj {
  if (!Object.prototype.hasOwnProperty.call(d, "fields") && !Object.prototype.hasOwnProperty.call(d, "suggested")) return d;
  const { fields: _fields, suggested: _suggested, ...rest } = d;
  return rest;
}

/** One answered field list: the row's own, or a close-wizard decision's (item_id). */
type Answer = { defs: readonly Field[]; values: Record<FieldId, FieldValue>; itemId?: string };

/**
 * Close wizard (spec §3.4 step 7): an item that did not reach the station and was "packed anyway"
 * has no result row of its own, so its fields travel in its decision on the box. Each such
 * decision is checked against that item's groups in this kit (each_item, then its type) — an
 * absent `fields` reads as nothing filled — and gets its own `suggested`. Every other decision
 * (and an item with no fields at this step) keeps no fields / suggested.
 */
function checkDecisions(raw: unknown[], target: FieldsTarget, answers: Answer[]): unknown[] {
  return raw.map((d, i) => {
    if (!isObj(d)) return d;
    if (own(d, "decision") !== "packed_anyway") return withoutFields(d);
    const itemId = own(d, "item_id");
    const kitItem = typeof itemId === "string" || typeof itemId === "number"
      ? target.kitItems.find((it) => it.item_id === String(itemId))
      : undefined;
    if (!kitItem) throw invalid(`decisions[${i}].item_id: not an item of this kit`);
    const defs = kitItem.groups.flatMap((g) => g.fields);
    if (defs.length === 0) return withoutFields(d);
    const block = toResultBlock(defs, draftsOf(defs, own(d, "fields"), `decisions[${i}].fields`), target.schema);
    answers.push({ defs, values: block.fields, itemId: kitItem.item_id });
    return { ...withoutFields(d), fields: block.fields, suggested: block.verdict.suggested };
  });
}

/**
 * Spec §3.4 steps 2–8: the Details to store, or a FieldsSubmissionError.
 *
 * No config (target null): the Details exactly as sent — unless they carry a schema, i.e. a popup
 * built from a config the row no longer resolves to (409: reload it). With a config:
 * - Details.schema must equal target.schema (route_id, v, step_uid, target), else 409;
 * - every field of the config is re-derived from its definition (toResultBlock — only filled
 *   fields are stored, notes dropped where notes are "off"); unknown field keys are dropped,
 *   a value of the wrong type or an unknown option is a 400;
 * - verdict keeps the worker's ok / note; suggested is recomputed, overridden set when they differ;
 * - a note over note_max (default 1000) is a 400 whether or not the gate is on;
 * - with `gate`, missing required fields or notes are a 422 with the artboard text;
 * - box rows: decisions[i] "packed_anyway" as checkDecisions says, under the same note and gate rules;
 *   any other row: decisions[i] keep no fields / suggested — only a box decision answers fields;
 * - Details over MAX_DETAILS_JSON are a 413.
 * Every other key of Details is kept as sent; only schema, fields, verdict and
 * decisions[i].fields / suggested are written.
 */
export function checkFieldsSubmission(target: FieldsTarget | null, input: { details: unknown; gate: boolean }): unknown {
  const { details, gate } = input;
  if (target == null) {
    if (isObj(details) && isObj(own(details, "schema"))) throw schemaMismatch();
    return details;
  }
  if ((JSON.stringify(details) ?? "").length > MAX_DETAILS_JSON) {
    throw new FieldsSubmissionError(413, "DETAILS_TOO_LARGE", "Details too large");
  }
  if (!isObj(details) || !sameSchema(own(details, "schema"), target.schema)) throw schemaMismatch();

  const block = toResultBlock(
    target.fields,
    draftsOf(target.fields, own(details, "fields"), "fields"),
    target.schema,
    verdictInputOf(own(details, "verdict")),
  );
  const out: Obj = { ...details, ...block };
  const answers: Answer[] = [{ defs: target.fields, values: block.fields }];
  const decisions = own(details, "decisions");
  if (Array.isArray(decisions)) {
    out.decisions = target.schema.target === "box"
      ? checkDecisions(decisions, target, answers)
      : decisions.map((d) => (isObj(d) ? withoutFields(d) : d));
  }

  const evaluated = answers.map((a) => ({ answer: a, ev: evaluateFields(a.defs, a.values) }));
  if (evaluated.some(({ ev }) => ev.noteTooLong.length > 0)) {
    throw new FieldsSubmissionError(400, "NOTE_TOO_LONG", COPY_PENDING.noteTooLong);
  }
  if (gate) {
    const missing: MissingField[] = [];
    let required = 0;
    let notes = 0;
    for (const { answer, ev } of evaluated) {
      const at = answer.itemId !== undefined ? { item_id: answer.itemId } : {};
      for (const id of ev.missingRequired) missing.push({ field_id: id, reason: "required", ...at });
      for (const id of ev.missingNotes) missing.push({ field_id: id, reason: "note", ...at });
      required += ev.missingRequired.length;
      notes += ev.missingNotes.length;
    }
    const message = fieldsGateText(required, notes);
    if (message) throw new FieldsSubmissionError(422, "FIELDS_INCOMPLETE", message, missing);
  }
  return out;
}
