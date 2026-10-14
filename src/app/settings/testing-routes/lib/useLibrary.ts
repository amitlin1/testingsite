"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import type { ChoiceOption, Field } from "@/app/lib/station-fields/schema";
import type { FieldSetJson, LibraryUseJson, OptionListJson } from "@/app/lib/station-fields/admin-types";
import { copyConfig } from "./draftModel";
import type { DraftStore } from "./draftStore";
import {
  LibraryBodyError, libraryWriteError, parseFieldSetJson, parseFieldSetsJson, parseLibraryUses, parseOptionListJson,
  parseOptionListSaved, parseOptionListsJson, parsePropagated, parseRouteIndex, parseVersionAnswer, placesOutside,
  relinkListInConfig,
} from "./libraryModel";
import type { LibraryWriteError, LinkedPlace, RouteIndexRow } from "./libraryModel";

/**
 * The library's data on the client (spec §3.2 option-lists / field-sets rows; artboards 4 and 8):
 *
 *   useOptionLists()   GET /api/settings/option-lists   — the library, the options popover's shared
 *                      mode, the editor's "רשימה: {name}" and its new "שורת בדיקה" (editorModel.newField)
 *   useFieldSets()     GET /api/settings/field-sets     — the library and the map's "הערכה עודכנה"
 *   useRouteIndex()    GET /api/settings/testing-routes — which map a usage chip opens
 *
 * Each is ONE store for the whole page (module level, behind useSyncExternalStore): the popover, the
 * editor and the library read the same answer, and a reload from any of them reaches all. The first
 * subscriber starts the load; `reload()` asks again (a reload keeps the data on screen). A failed
 * read is the error state, never an empty library.
 *
 * The writes below answer `{ ok: true, data }` or `{ ok: false, error }` (libraryModel.libraryWriteError);
 * they never throw. They do not reload the stores — the caller does, once it is done.
 */

// ---- one shared GET ---------------------------------------------------------------------------------
export type ResourceState<T> =
  | { status: "loading" }
  | { status: "error"; retrying: boolean }
  | { status: "ready"; data: T; reloading: boolean };

const LOADING = { status: "loading" } as const;

class Resource<T> {
  private state: ResourceState<T> = LOADING;
  private readonly listeners = new Set<() => void>();
  private inflight: Promise<boolean> | null = null;
  private started = false;

  constructor(private readonly url: string, private readonly parse: (body: unknown) => T) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.started) {
      this.started = true;
      void this.load();
    }
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ResourceState<T> => this.state;
  readonly getServerSnapshot = (): ResourceState<T> => LOADING;

  private set(next: ResourceState<T>): void {
    this.state = next;
    for (const l of [...this.listeners]) l();
  }

  /** Ask again; resolves true with a fresh answer. One request at a time (a call meanwhile shares it). */
  readonly load = (): Promise<boolean> => {
    if (this.inflight) return this.inflight;
    const prev = this.state;
    if (prev.status === "ready") this.set({ ...prev, reloading: true });
    else if (prev.status === "error") this.set({ status: "error", retrying: true });
    this.inflight = (async () => {
      try {
        const res = await apiFetch(this.url, { cache: "no-store" });
        if (res.status !== 200) throw new Error("HTTP " + res.status);
        const data = this.parse(await res.json());
        this.set({ status: "ready", data, reloading: false });
        return true;
      } catch (e) {
        // A non-200, no answer, or a body that is not the contract (LibraryBodyError).
        console.error("Library load failed: " + this.url, e);
        const now = this.state;
        // A reload that failed keeps what is on screen; a first load shows the error.
        this.set(now.status === "ready" ? { ...now, reloading: false } : { status: "error", retrying: false });
        return false;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  };
}

const optionListsResource = new Resource<OptionListJson[]>("/api/settings/option-lists", parseOptionListsJson);
const fieldSetsResource = new Resource<FieldSetJson[]>("/api/settings/field-sets", parseFieldSetsJson);
const routeIndexResource = new Resource<RouteIndexRow[]>("/api/settings/testing-routes", parseRouteIndex);

function useResource<T>(r: Resource<T>): ResourceState<T> {
  return React.useSyncExternalStore(r.subscribe, r.getSnapshot, r.getServerSnapshot);
}

export type LibraryData<T> = { state: ResourceState<T>; data: T | null; reload: () => Promise<boolean> };

function dataOf<T>(state: ResourceState<T>): T | null {
  return state.status === "ready" ? state.data : null;
}

/** The shared option lists (archived ones are not listed). */
export function useOptionLists(): LibraryData<OptionListJson[]> {
  const state = useResource(optionListsResource);
  return { state, data: dataOf(state), reload: optionListsResource.load };
}

/** The field sets (archived ones are not listed). */
export function useFieldSets(): LibraryData<FieldSetJson[]> {
  const state = useResource(fieldSetsResource);
  return { state, data: dataOf(state), reload: fieldSetsResource.load };
}

/** test_route_id → item_type_id + route_number, for the usage chips. */
export function useRouteIndex(): LibraryData<RouteIndexRow[]> {
  const state = useResource(routeIndexResource);
  return { state, data: dataOf(state), reload: routeIndexResource.load };
}

const EMPTY_NAMES: Readonly<Record<number, string>> = Object.freeze({});

/** Names of the shared lists by id — StationFieldEditor's `listNames` ("רשימה: {name}"). */
export function useOptionListNames(): Readonly<Record<number, string>> {
  const { data } = useOptionLists();
  return React.useMemo(() => (data ? Object.fromEntries(data.map((l) => [l.id, l.name])) : EMPTY_NAMES), [data]);
}

/** Names of the field sets by id — FieldsMap's `setNames` (the cell's set Tag). */
export function useFieldSetNames(): Readonly<Record<number, string>> {
  const { data } = useFieldSets();
  return React.useMemo(() => (data ? Object.fromEntries(data.map((s) => [s.id, s.name])) : EMPTY_NAMES), [data]);
}

const EMPTY_VERSIONS: Readonly<Record<number, number>> = Object.freeze({});

/** The latest version of every field set by id — useFieldsMap(context, setVersions) marks "הערכה
 *  עודכנה" on a cell holding an older one. The same object until the sets change. */
export function useFieldSetVersions(): Readonly<Record<number, number>> {
  const { data } = useFieldSets();
  return React.useMemo(() => (data ? Object.fromEntries(data.map((s) => [s.id, s.version])) : EMPTY_VERSIONS), [data]);
}

// ---- writes --------------------------------------------------------------------------------------------
export type LibraryResult<T> = { ok: true; data: T } | { ok: false; error: LibraryWriteError };

async function send<T>(url: string, method: string, body: unknown, parse: (b: unknown) => T): Promise<LibraryResult<T>> {
  let res: Response;
  try {
    res = await apiFetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: libraryWriteError(null, null) };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status !== 200 && res.status !== 201) return { ok: false, error: libraryWriteError(res.status, json) };
  try {
    return { ok: true, data: parse(json) };
  } catch (e) {
    if (e instanceof LibraryBodyError) return { ok: false, error: libraryWriteError(null, null) };
    throw e;
  }
}

const ignore = () => null;
const LISTS = "/api/settings/option-lists";
const SETS = "/api/settings/field-sets";

export function createOptionList(input: { name: string; options: ChoiceOption[] }): Promise<LibraryResult<OptionListJson>> {
  return send(LISTS, "POST", input, parseOptionListJson);
}

/** A new version of the list (409 VERSION_CONFLICT when `base_version` is stale). */
export function saveOptionList(id: number, input: { name: string; options: ChoiceOption[]; base_version: number }): Promise<LibraryResult<{ version: number; linked: LinkedPlace[] }>> {
  return send(`${LISTS}/${id}`, "PUT", input, parseOptionListSaved);
}

/** 409 IN_USE while a field is linked to it. */
export function deleteOptionList(id: number): Promise<LibraryResult<null>> {
  return send(`${LISTS}/${id}`, "DELETE", undefined, ignore);
}

/** The linked fields' drafts take the list's current version (drafts only — nothing is published). */
export function propagateOptionList(id: number, targets?: LinkedPlace[]): Promise<LibraryResult<number>> {
  return send(`${LISTS}/${id}/propagate`, "POST", targets ? { targets } : {}, parsePropagated);
}

export function createFieldSet(input: { name: string; fields: Field[] }): Promise<LibraryResult<FieldSetJson>> {
  return send(SETS, "POST", input, parseFieldSetJson);
}

/** "שמירה כגרסה {v+1}" (409 VERSION_CONFLICT when `base_version` is stale). */
export function saveFieldSet(id: number, input: { name: string; fields: Field[]; base_version: number }): Promise<LibraryResult<number>> {
  return send(`${SETS}/${id}`, "PUT", input, parseVersionAnswer);
}

export function deleteFieldSet(id: number): Promise<LibraryResult<null>> {
  return send(`${SETS}/${id}`, "DELETE", undefined, ignore);
}

/** "עדכן את כולם": every cell holding an older version takes the set's current one, in its draft. */
export function propagateFieldSet(id: number): Promise<LibraryResult<number>> {
  return send(`${SETS}/${id}/propagate`, "POST", {}, parsePropagated);
}

/** Where a set is used ("בשימוש ב-{n} תאים"), one row per cell; null when the read failed. */
export async function fetchFieldSetUsage(id: number): Promise<LibraryUseJson[] | null> {
  try {
    const res = await apiFetch(`${SETS}/${id}/usage`, { cache: "no-store" });
    if (res.status !== 200) return null;
    return parseLibraryUses(await res.json());
  } catch (e) {
    console.error("Field set usage failed", e);
    return null;
  }
}

// ---- a saved list reaching its linked fields (spec §5.7 "החל על השדה") -------------------------------------
/**
 * After PUT …/option-lists/[id]: every field linked to the list takes its new options, in drafts only.
 * The routes this screen holds a working copy of (draftStore) take the change locally — each autosaves
 * on its own rev, so no write races the server's propagate and the map shows "שינוי שלא פורסם" at
 * once; the linked places on every other route go to POST …/propagate as its `targets`. Resolves the
 * propagate's answer (ok with 0 when nothing was left for it).
 */
export async function reachLinkedFields(
  store: DraftStore,
  list: { id: number; version: number; options: readonly ChoiceOption[] },
  linked: readonly LinkedPlace[],
): Promise<LibraryResult<number>> {
  const model = store.getSnapshot().model;
  const held = new Set(Object.keys(model.routes).map(Number));
  for (const id of held) {
    const entry = model.routes[id];
    if (!entry || relinkListInConfig(copyConfig(entry.current), list) === 0) continue;
    store.edit(id, (cfg) => {
      relinkListInConfig(cfg, list);
    });
  }
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
  const r = await propagateFieldSet(setId);
  if (r.ok) {
    const held = store.getSnapshot().model.routes;
    await Promise.all([...new Set(routeIds)].filter((id) => held[id] != null).map((id) => store.reloadRoute(id)));
  }
  return r;
}
