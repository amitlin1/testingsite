import type { ChoiceOption, Field } from "@/app/lib/station-fields/schema";
import type { FieldSetJson, LibraryUseJson, OptionListJson, OptionListSavedJson } from "@/app/lib/station-fields/admin-types";
import { isOk, request } from "./api";
import { libraryWriteError, placesOutside } from "./libraryModel";
import type { LibraryWriteError, LinkedPlace } from "./libraryModel";
import { relinkListInConfig } from "./optionFields";
import { API, BadBody, parseFieldSet, parseLibraryUses, parseOptionList, parseOptionListSaved, parsePropagated, parseVersion } from "./wire";
import type { DraftStore } from "./draftStore";

/**
 * The library's writes (spec §3.2 option-lists / field-sets rows; artboards 4 and 8). Each answers
 * `{ ok: true, data }` or `{ ok: false, error }` (libraryModel.libraryWriteError); none throws. They do
 * not reload the lists (resources.ts) — the caller does, once it is done.
 */

export type LibraryResult<T> = { ok: true; data: T } | { ok: false; error: LibraryWriteError };

async function send<T>(url: string, method: string, body: unknown, parse: (b: unknown) => T): Promise<LibraryResult<T>> {
  const answer = await request(url, { method, body });
  if (!isOk(answer)) return { ok: false, error: libraryWriteError(answer.status, answer.body) };
  try {
    return { ok: true, data: parse(answer.body) };
  } catch (e) {
    if (e instanceof BadBody) return { ok: false, error: libraryWriteError(null, null) };
    throw e;
  }
}

const ignore = () => null;

export function createOptionList(input: { name: string; options: ChoiceOption[] }): Promise<LibraryResult<OptionListJson>> {
  return send(API.optionLists, "POST", input, parseOptionList);
}

/** A new version of the list (409 VERSION_CONFLICT when `base_version` is stale). */
export function saveOptionList(id: number, input: { name: string; options: ChoiceOption[]; base_version: number }): Promise<LibraryResult<OptionListSavedJson>> {
  return send(API.optionList(id), "PUT", input, parseOptionListSaved);
}

/** 409 IN_USE while a field is linked to it. */
export function deleteOptionList(id: number): Promise<LibraryResult<null>> {
  return send(API.optionList(id), "DELETE", undefined, ignore);
}

/** The linked fields' drafts take the list's current version (drafts only — nothing is published). */
function propagateOptionList(id: number, targets: LinkedPlace[]): Promise<LibraryResult<number>> {
  return send(API.optionListPropagate(id), "POST", { targets }, parsePropagated);
}

export function createFieldSet(input: { name: string; fields: Field[] }): Promise<LibraryResult<FieldSetJson>> {
  return send(API.fieldSets, "POST", input, parseFieldSet);
}

/** The set editor's save as the next version (409 VERSION_CONFLICT when `base_version` is stale). */
export function saveFieldSet(id: number, input: { name: string; fields: Field[]; base_version: number }): Promise<LibraryResult<number>> {
  return send(API.fieldSet(id), "PUT", input, parseVersion);
}

export function deleteFieldSet(id: number): Promise<LibraryResult<null>> {
  return send(API.fieldSet(id), "DELETE", undefined, ignore);
}

/** Where a set is used, one row per cell; null when the read failed. */
export async function fetchFieldSetUsage(id: number): Promise<LibraryUseJson[] | null> {
  const answer = await request(API.fieldSetUsage(id));
  try {
    if (answer.status !== 200) throw new Error("HTTP " + answer.status);
    return parseLibraryUses(answer.body);
  } catch (e) {
    console.error("Field set usage failed", e);
    return null;
  }
}

// ---- a saved list / set reaching the drafts --------------------------------------------------------
/**
 * After PUT …/option-lists/[id] (spec §5.7 "החל על השדה"): every field linked to the list takes its new
 * options, in drafts only. The routes this screen holds a working copy of take the change locally —
 * each autosaves on its own rev, so no write races the server's propagate and the map shows the
 * unpublished change at once; the linked places on every other route go to POST …/propagate as its
 * `targets`. Resolves the propagate's answer (ok with 0 when nothing was left for it).
 */
export async function reachLinkedFields(
  store: DraftStore,
  list: { id: number; version: number; options: readonly ChoiceOption[] },
  linked: readonly LinkedPlace[],
): Promise<LibraryResult<number>> {
  const held = store.heldRouteIds();
  for (const id of held) store.edit(id, (cfg) => { relinkListInConfig(cfg, list); });
  const outside = placesOutside(linked, held);
  if (outside.length === 0) return { ok: true, data: 0 };
  return propagateOptionList(list.id, outside);
}

/**
 * "עדכן את כולם" of a field set: the server rewrites the drafts of the cells holding an older version.
 * The working copies of those routes are saved first (flushAll) and read back after (reloadRoute), so
 * the screen's copy never races the server's write.
 */
export async function propagateSetToDrafts(store: DraftStore, setId: number, routeIds: readonly number[]): Promise<LibraryResult<number>> {
  await store.flushAll();
  const r = await send(API.fieldSetPropagate(setId), "POST", {}, parsePropagated);
  if (r.ok) {
    const held = store.heldRouteIds();
    await Promise.all([...new Set(routeIds)].filter((id) => held.has(id)).map((id) => store.reloadRoute(id)));
  }
  return r;
}
