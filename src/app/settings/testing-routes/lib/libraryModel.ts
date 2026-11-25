import { jsonEqual } from "@/lib/json-guards";
import { ID_PATTERNS, TONES } from "@/app/lib/station-fields/schema";
import type { ChoiceOption, Field, FieldId, Tone } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import { IN_USE, type FieldSetJson, type LibraryUseJson, type OptionListJson, type OptionListSavedJson } from "@/app/lib/station-fields/admin-types";
import { bindingKey } from "./cellGroups";
import { inputFields, isOptionField, sameOptions } from "./optionFields";
import { normalizeRouteQuery, withEditor } from "./routeQuery";
import type { RouteQuery } from "./routeQuery";
import { errorCode } from "./wire";
import type { RouteRowJson } from "./wire";
import { agoText } from "./labels";
import { LIBRARY_TEXT, copyNameText, usageChipLabel } from "./libraryLabels";

/**
 * "ערכות ורשימות" — the library's pure half (artboard 8, spec §5.9; artboard 4's shared mode, §5.7):
 * what a write's answer means, the list rows, the set editor's meta line, dirty state and counts,
 * the usage chips and the link each opens, and the list detail's tone table. libraryWrites.ts and
 * components/library/* send and draw what these return.
 */

// ---- what a write's answer means ------------------------------------------------------------------
/** A library write that did not go through: 409 VERSION_CONFLICT ("conflict"), 409 IN_USE on a delete
 *  ("in_use"), any other 4xx ("rejected" — a retry alone will not fix it), a 5xx / no answer
 *  ("failed"). */
export type LibraryWriteError = { kind: "conflict" | "in_use" | "rejected" | "failed"; status: number | null; code: string | null };

export function libraryWriteError(status: number | null, body: unknown): LibraryWriteError {
  const code = errorCode(body);
  if (status == null || status >= 500) return { kind: "failed", status, code };
  if (status === 409 && code === IN_USE) return { kind: "in_use", status, code };
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
/** The set's counts (artboard 8 `fieldsTxt`, `reqN`): input fields — a section header never counts
 *  (as in the station editor). */
export function setCounts(fields: readonly Field[]): { fields: number; required: number } {
  const inputs = inputFields(fields);
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
  return fields.map((f) => ({ ...structuredClone(f), id: newId() }));
}

/** copyNameText of the name, inside the column's LIMITS.libraryName characters. */
export function copyName(name: string): string {
  const suffix = copyNameText("").length;
  return copyNameText(name.slice(0, Math.max(0, LIMITS.libraryName - suffix)));
}

// ---- the set's meta line (artboard 8 `meta`) ------------------------------------------------------------
/** How this session came by the set: created, or duplicated from another set. */
export type SetOrigin = { kind: "created" } | { kind: "duplicated"; from: string };

/**
 * The line under the set's name (artboard 8 `meta`): where a set this session duplicated came from;
 * else created (a set still at version 1) or updated, when, and by whom (the server's updated_by).
 * Artboard 8's "created from {station} › {item}" needs the set's source cell, which the API does not
 * keep — not drawn here.
 */
export function setMetaText(
  set: Pick<FieldSetJson, "version" | "created_at" | "updated_at" | "updated_by">,
  origin: SetOrigin | null,
  nowMs: number,
): string {
  if (origin?.kind === "duplicated") return LIBRARY_TEXT.duplicatedFrom + origin.from;
  const created = set.version <= 1;
  const at = Date.parse(created ? set.created_at : set.updated_at);
  const when = Number.isFinite(at) ? agoText(at, nowMs, LIBRARY_TEXT.now) : LIBRARY_TEXT.now;
  const user = set.updated_by?.trim();
  return (created ? LIBRARY_TEXT.created : LIBRARY_TEXT.updated) + when + (user ? " · " + user : "");
}

// ---- usage chips (artboard 8 `usage`) ------------------------------------------------------------------
/** The kit, the station and the item, joined by " › " (the kit is absent on an item route). */
function usageFullText(use: Pick<LibraryUseJson, "kit_desc" | "station_label" | "item_label">): string {
  return [use.kit_desc, use.station_label, use.item_label].filter((s): s is string => !!s && s.trim() !== "").join(" › ");
}

/**
 * The cell editor on a usage row: the map of the route that holds the place — a kit route for a
 * package-level group (box / each_item / {item_type_id}), the item's own route for "item" — with the
 * row's step and target, focused on its field. null when the route list does not have
 * the route (it was deleted meanwhile).
 */
function usageQuery(use: Pick<LibraryUseJson, "route_id" | "step_uid" | "target" | "field_id">, routes: readonly RouteRowJson[], base: RouteQuery): RouteQuery | null {
  const row = routes.find((r) => r.test_route_id === use.route_id);
  if (!row) return null;
  const at = normalizeRouteQuery({ ...base, type: row.item_type_id, route: row.route_number });
  const field = ID_PATTERNS.field.test(use.field_id) ? use.field_id : null;
  const q = withEditor(at, use.step_uid, use.target, field);
  // A step uid the URL cannot hold drops the editor: the chip then has nowhere to go.
  return q.step != null ? q : null;
}

export type UsageChip = {
  key: string;
  /** The chip's text: the full path, or "… › " and the item after a chip of the same kit and station (of the
   *  same station, on item routes — the server names no kit there). */
  text: string;
  aria: string;
  /** The version the cell holds when older than the set's, else null. */
  oldVersion: number | null;
  query: RouteQuery | null;
};

/** The first `max` uses as chips (artboard 8 draws five), and how many more there are. */
export function usageChips(
  uses: readonly LibraryUseJson[],
  version: number,
  routes: readonly RouteRowJson[],
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
      key: bindingKey(use),
      text: short ? "… › " + use.item_label : full,
      aria: usageChipLabel(full, oldVersion),
      oldVersion,
      query: usageQuery(use, routes, base),
    });
  }
  return { chips, more: Math.max(0, uses.length - max) };
}

/** The cells that hold an older version of the set (artboard 8's outdated bar). */
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
      count: s.fields.filter((f) => isOptionField(f) && f.list_ref?.id === listId).length,
    }))
    .filter((s) => s.count > 0);
}

/** The working copy of a shared list in the options popover. */
export type ListDraft = { name: string; options: ChoiceOption[] };

/** The working copy differs from the saved list: "החל על השדה" saves it as a new version first. */
export function listDraftChanged(list: Pick<OptionListJson, "name" | "options">, draft: ListDraft): boolean {
  return draft.name !== list.name || !sameOptions(draft.options, list.options);
}

/** The linked places a list save leaves to the server's propagate: those on routes this screen
 *  does not hold a working copy of (the screen's own routes take the change in their drafts). */
export function placesOutside(linked: readonly LinkedPlace[], held: ReadonlySet<number>): LinkedPlace[] {
  return linked.filter((l) => !held.has(l.route_id));
}

/** A place a saved list links (OptionListSavedJson.linked). */
export type LinkedPlace = OptionListSavedJson["linked"][number];
