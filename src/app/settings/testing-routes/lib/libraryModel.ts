import { TONES } from "@/app/lib/station-fields/schema";
import type {
  ChoiceOption, Field, FieldId, GroupTarget, InputField, RouteFieldsConfig, StepUid, Tone,
} from "@/app/lib/station-fields/schema";
import { ShapeError, parseFieldList, parseOptionList } from "@/app/lib/station-fields/validate";
import type { FieldSetJson, LibraryUseJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import { jsonEqual } from "./draftModel";
import type { OptionField } from "./editorModel";
import { normalizeRouteQuery, parseTargetParam, encodeTarget, withEditor } from "./routeQuery";
import type { RouteQuery } from "./routeQuery";
import { LIBRARY_COPY_PENDING, LIBRARY_TEXT, copyNameText, usageChipLabel } from "./libraryLabels";

/**
 * "ערכות ורשימות" — the library's pure half (artboard 8, spec §5.9; artboard 4's shared mode, §5.7):
 * the wire bodies of the option-lists / field-sets API checked before the screen builds on them,
 * what a write's answer means, the list rows, the set editor's meta line, dirty state and counts,
 * the usage chips and the link each opens, the list detail's tone table, and the edits a saved
 * shared list makes to the linked fields of a route's working copy. useLibrary.ts and
 * components/library/* draw and send what these return.
 */

// ---- the wire, checked ----------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** A body that is not what the contract (admin-types.ts) says. */
export class LibraryBodyError extends Error {}

function shaped<T>(read: () => T, what: string): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof ShapeError) throw new LibraryBodyError(what + ": " + e.message);
    throw e;
  }
}

/** One OptionListJson (GET list member, POST answer); options through the server's own shape check. */
export function parseOptionListJson(v: unknown): OptionListJson {
  if (!isObj(v) || !isId(v.id) || typeof v.name !== "string" || !isId(v.version) || typeof v.updated_at !== "string" || !isStrOrNull(v.updated_by)) {
    throw new LibraryBodyError("option list");
  }
  const u = v.usage;
  if (!isObj(u) || !isCount(u.fields) || !isCount(u.routes)) throw new LibraryBodyError("option list usage");
  return {
    id: v.id,
    name: v.name,
    options: shaped(() => parseOptionList(v.options), "option list options"),
    version: v.version,
    updated_at: v.updated_at,
    updated_by: v.updated_by,
    usage: { fields: u.fields, routes: u.routes },
  };
}

/** One FieldSetJson (GET list member, POST answer); fields through the server's own shape check. */
export function parseFieldSetJson(v: unknown): FieldSetJson {
  if (
    !isObj(v) || !isId(v.id) || typeof v.name !== "string" || !isId(v.version)
    || typeof v.created_at !== "string" || typeof v.updated_at !== "string" || !isStrOrNull(v.updated_by)
  ) {
    throw new LibraryBodyError("field set");
  }
  const u = v.usage;
  if (!isObj(u) || !isCount(u.cells) || !isCount(u.outdated)) throw new LibraryBodyError("field set usage");
  return {
    id: v.id,
    name: v.name,
    fields: shaped(() => parseFieldList(v.fields), "field set fields"),
    version: v.version,
    created_at: v.created_at,
    updated_at: v.updated_at,
    updated_by: v.updated_by,
    usage: { cells: u.cells, outdated: u.outdated },
  };
}

export function parseOptionListsJson(v: unknown): OptionListJson[] {
  if (!Array.isArray(v)) throw new LibraryBodyError("option lists");
  return v.map(parseOptionListJson);
}

export function parseFieldSetsJson(v: unknown): FieldSetJson[] {
  if (!Array.isArray(v)) throw new LibraryBodyError("field sets");
  return v.map(parseFieldSetJson);
}

function targetOf(v: unknown): GroupTarget | null {
  if (v === "item" || v === "box" || v === "each_item") return v;
  if (isObj(v) && isId(v.item_type_id)) return { item_type_id: v.item_type_id };
  return null;
}

/** GET …/[id]/usage → LibraryUseJson[]. */
export function parseLibraryUses(v: unknown): LibraryUseJson[] {
  if (!Array.isArray(v)) throw new LibraryBodyError("usage");
  return v.map((u) => {
    const target = isObj(u) ? targetOf(u.target) : null;
    if (
      !isObj(u) || target == null || !isId(u.route_id) || typeof u.step_uid !== "string" || typeof u.field_id !== "string"
      || !isCount(u.ver) || (u.in !== "draft" && u.in !== "published") || !isStrOrNull(u.kit_desc)
      || typeof u.station_label !== "string" || typeof u.item_label !== "string"
    ) {
      throw new LibraryBodyError("usage row");
    }
    return {
      route_id: u.route_id, step_uid: u.step_uid, target, field_id: u.field_id, ver: u.ver, in: u.in,
      kit_desc: u.kit_desc, station_label: u.station_label, item_label: u.item_label,
    };
  });
}

/** The members of a GET /api/settings/testing-routes row the library needs: which map a usage
 *  chip opens (route_id → item_type_id + route_number). */
export type RouteIndexRow = { test_route_id: number; item_type_id: number; route_number: number };

export function parseRouteIndex(v: unknown): RouteIndexRow[] {
  if (!Array.isArray(v)) throw new LibraryBodyError("routes");
  return v.map((r) => {
    if (!isObj(r) || !isId(r.test_route_id) || !isId(r.item_type_id) || !isId(r.route_number)) throw new LibraryBodyError("route row");
    return { test_route_id: r.test_route_id, item_type_id: r.item_type_id, route_number: r.route_number };
  });
}

/** PUT / POST …/propagate answers. */
export function parseVersionAnswer(v: unknown): number {
  if (!isObj(v) || !isId(v.version)) throw new LibraryBodyError("version");
  return v.version;
}

export type LinkedPlace = { route_id: number; step_uid: string; field_id: string };

/** PUT /api/settings/option-lists/[id] → { version, linked }. */
export function parseOptionListSaved(v: unknown): { version: number; linked: LinkedPlace[] } {
  const version = parseVersionAnswer(v);
  const linked = (v as Obj).linked;
  if (!Array.isArray(linked)) throw new LibraryBodyError("linked");
  return {
    version,
    linked: linked.map((l) => {
      if (!isObj(l) || !isId(l.route_id) || typeof l.step_uid !== "string" || typeof l.field_id !== "string") throw new LibraryBodyError("linked row");
      return { route_id: l.route_id, step_uid: l.step_uid, field_id: l.field_id };
    }),
  };
}

export function parsePropagated(v: unknown): number {
  if (!isObj(v) || !isCount(v.updated_drafts)) throw new LibraryBodyError("propagate");
  return v.updated_drafts;
}

// ---- what a write's answer means ------------------------------------------------------------------
/** A library write that did not go through: 409 VERSION_CONFLICT ("conflict"), 409 IN_USE on a delete
 *  ("in_use"), any other 4xx ("rejected" — a retry alone will not fix it), a 5xx / no answer
 *  ("failed"). */
export type LibraryWriteError = { kind: "conflict" | "in_use" | "rejected" | "failed"; status: number | null; code: string | null };

export function libraryWriteError(status: number | null, body: unknown): LibraryWriteError {
  const code = isObj(body) && typeof body.code === "string" ? body.code : null;
  if (status == null || status >= 500) return { kind: "failed", status, code };
  if (status === 409 && code === "IN_USE") return { kind: "in_use", status, code };
  if (status === 409) return { kind: "conflict", status, code };
  return { kind: "rejected", status, code };
}

// ---- search ------------------------------------------------------------------------------------------
/** Artboard 8 / 4 search: the trimmed query inside the name (case-blind for Latin names). */
export function matchesName(name: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return q === "" || name.toLocaleLowerCase().includes(q);
}

export function filterByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  return items.filter((i) => matchesName(i.name, query));
}

// ---- a set's fields ------------------------------------------------------------------------------------
const isInput = (f: Field): f is InputField => f.type !== "section";

/** The set's counts (artboard 8 `fieldsTxt`, `reqN`): input fields — a section header never counts
 *  (as in the station editor). */
export function setCounts(fields: readonly Field[]): { fields: number; required: number } {
  const inputs = fields.filter(isInput);
  return { fields: inputs.length, required: inputs.filter((f) => f.required).length };
}

/** "שמירה כגרסה {v+1}" is aria-disabled while a field has no name (artboard 8 `hasEmpty`). */
export function hasUnnamedField(fields: readonly Field[]): boolean {
  return fields.some((f) => f.label.trim() === "");
}

/** The working copy of a set: its name and fields as edited, not saved yet. */
export type SetDraft = { name: string; fields: Field[] };

/** The draft differs from what the server holds (the row's dot, "שינויים שלא נשמרו"). */
export function setDraftDirty(set: Pick<FieldSetJson, "name" | "fields">, draft: SetDraft | null): boolean {
  return draft != null && (draft.name !== set.name || !jsonEqual(draft.fields, set.fields));
}

/** The fields of a duplicated set (artboard 8 `addSet(base)`): deep copies with ids of their own —
 *  a field id is minted once and never shared. */
export function copySetFields(fields: readonly Field[], newId: () => FieldId): Field[] {
  return fields.map((f) => ({ ...(JSON.parse(JSON.stringify(f)) as Field), id: newId() }));
}

/** "{name} · עותק", inside the column's 100 characters. */
export function copyName(name: string): string {
  const suffix = copyNameText("").length;
  return copyNameText(name.slice(0, Math.max(0, 100 - suffix)));
}

// ---- the set's meta line (artboard 8 `meta`) ------------------------------------------------------------
/** How this session came by the set: "+ ערכה חדשה", or "שכפל" of another set. */
export type SetOrigin = { kind: "created" } | { kind: "duplicated"; from: string };

/** A relative time: "עכשיו" under a minute and "לפני יומיים" are artboard 8's; the rest COPY-PENDING.
 *  A time ahead of this clock reads as now. */
export function agoText(atMs: number, nowMs: number): string {
  const c = LIBRARY_COPY_PENDING;
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return LIBRARY_TEXT.now;
  if (minutes === 1) return c.agoMinute;
  if (minutes < 60) return c.agoPrefix + minutes + c.agoMinutesSuffix;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return c.agoHour;
  if (hours < 24) return c.agoPrefix + hours + c.agoHoursSuffix;
  const days = Math.floor(hours / 24);
  if (days === 1) return c.agoDay;
  if (days === 2) return LIBRARY_TEXT.twoDaysAgo;
  return c.agoPrefix + days + c.agoDaysSuffix;
}

/**
 * The line under the set's name: "שוכפלה מ: {name}" for a set this session duplicated; "נוצרה
 * {when}[ · {user}]" for a set still at version 1; else "עודכנה {when}[ · {user}]" (artboard 8:
 * "עודכנה לפני יומיים · נועה לוי", "נוצרה עכשיו · נועה לוי", "עודכנה עכשיו · נועה לוי"). The user is
 * the server's updated_by. "נוצרה מתוך: {station} › {item}" needs the set's source cell, which the API
 * does not keep — not drawn here.
 */
export function setMetaText(
  set: Pick<FieldSetJson, "version" | "created_at" | "updated_at" | "updated_by">,
  origin: SetOrigin | null,
  nowMs: number,
): string {
  if (origin?.kind === "duplicated") return LIBRARY_TEXT.duplicatedFrom + origin.from;
  const created = set.version <= 1;
  const at = Date.parse(created ? set.created_at : set.updated_at);
  const when = Number.isFinite(at) ? agoText(at, nowMs) : LIBRARY_TEXT.now;
  const user = set.updated_by?.trim();
  return (created ? LIBRARY_TEXT.created : LIBRARY_TEXT.updated) + when + (user ? " · " + user : "");
}

// ---- usage chips (artboard 8 `usage`) ------------------------------------------------------------------
/** "מארז עמדת עבודה › בדיקה ויזואלית › מחשב" (the kit is absent on an item route). */
export function usageFullText(use: Pick<LibraryUseJson, "kit_desc" | "station_label" | "item_label">): string {
  return [use.kit_desc, use.station_label, use.item_label].filter((s): s is string => !!s && s.trim() !== "").join(" › ");
}

/**
 * The cell editor on a usage row: the map of the route that holds the place — a kit route for a
 * package-level group (box / each_item / {item_type_id}), the item's own route for "item" — with the
 * row's step and target, focused on its field ("עבור לשדה"). null when the route list does not have
 * the route (it was deleted meanwhile).
 */
export function usageQuery(use: Pick<LibraryUseJson, "route_id" | "step_uid" | "target" | "field_id">, routes: readonly RouteIndexRow[], base: RouteQuery): RouteQuery | null {
  const row = routes.find((r) => r.test_route_id === use.route_id);
  const target = parseTargetParam(encodeTarget(use.target));
  if (!row || !target) return null;
  const at = normalizeRouteQuery({ ...base, type: row.item_type_id, route: row.route_number });
  const field = /^f_[a-z0-9]{8}$/.test(use.field_id) ? use.field_id : null;
  const q = withEditor(at, use.step_uid as StepUid, target, field);
  // A step uid the URL cannot hold drops the editor: the chip then has nowhere to go.
  return q.step != null ? q : null;
}

export type UsageChip = {
  key: string;
  /** The chip's text: the full path, or "… › {item}" after a chip of the same kit and station (of the
   *  same station, on item routes — the server names no kit there). */
  text: string;
  aria: string;
  /** The version the cell holds when older than the set's ("גרסה {n}"), else null. */
  oldVersion: number | null;
  query: RouteQuery | null;
};

/** The first `max` uses as chips (artboard 8 draws five), and how many more there are ("+{n} נוספים"). */
export function usageChips(
  uses: readonly LibraryUseJson[],
  version: number,
  routes: readonly RouteIndexRow[],
  base: RouteQuery,
  max = 5,
): { chips: UsageChip[]; more: number } {
  const chips: UsageChip[] = [];
  let prevHead: string | null = null;
  for (const use of uses.slice(0, max)) {
    const full = usageFullText(use);
    const head = [use.kit_desc, use.station_label].filter(Boolean).join(" › ");
    const short = prevHead != null && prevHead === head;
    prevHead = head;
    const oldVersion = use.ver < version ? use.ver : null;
    chips.push({
      key: use.route_id + "|" + use.step_uid + "|" + encodeTarget(use.target),
      text: short ? "… › " + use.item_label : full,
      aria: usageChipLabel(full, oldVersion),
      oldVersion,
      query: usageQuery(use, routes, base),
    });
  }
  return { chips, more: Math.max(0, uses.length - max) };
}

/** The cells that hold an older version of the set ("{n} תאים משתמשים בגרסה קודמת של הערכה"). */
export function outdatedUses(uses: readonly LibraryUseJson[], version: number): LibraryUseJson[] {
  return uses.filter((u) => u.ver < version);
}

// ---- option lists ----------------------------------------------------------------------------------------
/** The verdict table (artboard 8 `tones`): each tone with the labels of its options, in tone order. */
export function toneRows(options: readonly ChoiceOption[]): { tone: Tone; labels: string[] }[] {
  return TONES.map((tone) => ({ tone, labels: options.filter((o) => o.tone === tone).map((o) => o.label) }));
}

export function failCount(options: readonly ChoiceOption[]): number {
  return options.filter((o) => o.tone === "fail").length;
}

/** "בערכות שדות" (artboard 8 `inSets`): every set with fields linked to the list, and how many. */
export function setsUsingList(sets: readonly Pick<FieldSetJson, "id" | "name" | "fields">[], listId: number): { id: number; name: string; count: number }[] {
  return sets
    .map((s) => ({
      id: s.id,
      name: s.name,
      count: s.fields.filter((f) => (f.type === "choice_row" || f.type === "multi_choice") && f.list_ref?.id === listId).length,
    }))
    .filter((s) => s.count > 0);
}

/** Two option lists alike: the same options (id, label, tone) in the same order. */
export function sameOptions(a: readonly ChoiceOption[], b: readonly ChoiceOption[]): boolean {
  return a.length === b.length && a.every((o, i) => o.id === b[i].id && o.label === b[i].label && o.tone === b[i].tone);
}

/** The working copy of a shared list in the options popover. */
export type ListDraft = { name: string; options: ChoiceOption[] };

/** The working copy differs from the saved list: "החל על השדה" saves it as a new version first. */
export function listDraftChanged(list: Pick<OptionListJson, "name" | "options">, draft: ListDraft): boolean {
  return draft.name !== list.name || !sameOptions(draft.options, list.options);
}

/** A field linked to a list (spec §5.7 "קישור השדה"): list_ref {id, ver} and a copy of its options. */
export function linkToList<F extends OptionField>(field: F, list: { id: number; version: number; options: readonly ChoiceOption[] }): F {
  return { ...field, options: list.options.map((o) => ({ ...o })), list_ref: { id: list.id, ver: list.version } };
}

/**
 * A saved shared list reaching the linked fields of one working copy (spec §5.7: "השדות האחרים
 * המקושרים מתעדכנים בטיוטות שלהם"): every choice field linked to `listId` takes the list's options
 * and list_ref.ver = `version`. Mutates `cfg` (pass draftStore.edit's copy); returns how many fields
 * changed — 0 means the route has nothing to save.
 */
export function relinkListInConfig(cfg: RouteFieldsConfig, list: { id: number; version: number; options: readonly ChoiceOption[] }): number {
  let changed = 0;
  for (const step of Object.values(cfg.steps)) {
    for (const group of step.groups) {
      group.fields = group.fields.map((f) => {
        if ((f.type !== "choice_row" && f.type !== "multi_choice") || f.list_ref?.id !== list.id) return f;
        if (f.list_ref.ver === list.version && sameOptions(f.options, list.options)) return f;
        changed += 1;
        return linkToList(f, list);
      });
    }
  }
  return changed;
}

/** The linked places a list save leaves to the server's propagate: those on routes this screen
 *  does not hold a working copy of (the screen's own routes take the change in their drafts). */
export function placesOutside(linked: readonly LinkedPlace[], held: ReadonlySet<number>): LinkedPlace[] {
  return linked.filter((l) => !held.has(l.route_id));
}

/** The list a new "שורת בדיקה" links to (artboard 2: the new row's options are "תקינות כללית"). */
export const DEFAULT_CHECK_LIST_NAME = "תקינות כללית";

/** The shared list named "תקינות כללית", or null. */
export function findDefaultCheckList<L extends { name: string }>(lists: readonly L[] | null | undefined): L | null {
  return lists?.find((l) => l.name.trim() === DEFAULT_CHECK_LIST_NAME) ?? null;
}
