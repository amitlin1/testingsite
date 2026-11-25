"use client";
import * as React from "react";
import { STEP_UNKNOWN, type FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { request } from "./api";
import type { Fetcher } from "./api";
import {
  EMPTY_DRAFT_MODEL, draftReducer, entryHasDraft, saveFailed, stepsOutOfContextKey, summarize,
} from "./draftModel";
import type { ConfigMutator, DraftAction, DraftConflict, DraftModel, DraftSummary, RouteDraft, SaveError, SaveOp } from "./draftModel";
import { API, BadBody, errorCode, parseDraftConflict, parseDraftDeleted, parseDraftSaved, parseRouteFields } from "./wire";
import type { DraftSavedJson } from "@/app/lib/station-fields/admin-types";

/**
 * The admin screen's draft store (route-fields spec §3.2, §3.4.1, §5.2, D6): draftModel's state
 * plus the writes — debounced autosave, discard, flush — behind useSyncExternalStore, so the
 * header, the map, the editor and the publish dialog all read one working copy without
 * prop-drilling.
 *
 * Autosave, per route:
 *   - every edit (re)starts an ~800 ms timer; when it fires, PUT …/[id]/fields/draft
 *     { config, base_rev } with the working copy;
 *   - at most ONE write per route is in flight. An edit made meanwhile is saved right after it, on
 *     the new draft_rev — no lost update, no parallel PUTs;
 *   - 200 → rev / savedAt / issues; 409 DRAFT_CONFLICT → the conflict state (no more PUTs for the
 *     route until reloadRoute); a 409 whose draft is exactly what was sent is the answer to a write
 *     that already happened (PUT is idempotent with base_rev) and counts as saved;
 *   - network / 5xx → the error state, retried after 2 s, 5 s and 15 s, then by retry() or the next
 *     edit; any other refusal (400, 404) waits for retry() / the next edit;
 *   - 409 STEP_UNKNOWN (the route's steps changed under the draft) → the error state, and the route
 *     is read back (reloadRoute, lead decision D7): the config can only be saved against the steps
 *     the route has now. Its entry then holds other steps than the context on screen, and the
 *     store tells the page (onContextStale) to ask for the context again so the map follows.
 * A failed DELETE ("ביטול הטיוטה") is retried by retry() as a DELETE. Edits made while a discard
 * runs are saved once it is over.
 * Multi-route edits (bulk actions, apply set, paste) call edit() once per route; each route
 * autosaves on its own (spec §3.2: no endpoint of their own).
 *
 * The store is keyed by test_route_id, not by the map on screen: load() merges a new context, so
 * an item route shared by two kits keeps its working copy (and its pending save) when the admin
 * switches between them.
 */

export type TimerApi = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type DraftStoreOptions = {
  /** Default apiFetch (401 → refresh → retry once). */
  fetch?: Fetcher;
  /** Autosave debounce. Default 800 ms (spec §5.2). */
  debounceMs?: number;
  /** Automatic retries of a PUT that failed on the network or with a 5xx. */
  retryDelaysMs?: readonly number[];
  /** Default the global timers and Date.now (tests pass their own clock). */
  timers?: TimerApi;
  now?: () => number;
};

export type DraftSnapshot = {
  model: DraftModel;
  summary: DraftSummary;
  /** This browser's time of the last autosave THIS session made for the context on screen (lead
   *  decision: a draft another admin saved earlier shows no save time); null once the screen moves
   *  to another context or no route of it holds a draft any more. */
  sessionSavedAt: number | null;
};

/** flushAll / discardAll: ok, or the routes that could not be written. */
export type FlushResult = { ok: true } | { ok: false; failed: number[]; conflicts: number[] };

const DEFAULT_DEBOUNCE_MS = 800;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15000];

// ---- answers --------------------------------------------------------------------------------------
/** What a write's answer means for the route (pure; the store dispatches it). */
export type WriteOutcome =
  | { type: "saved"; result: DraftSavedJson }
  | { type: "discarded"; rev: number }
  | { type: "conflict"; conflict: DraftConflict }
  | { type: "failed"; error: SaveError };

function orNull<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch (e) {
    if (e instanceof BadBody) return null;
    throw e;
  }
}

/** The answer of PUT (op "put") or DELETE (op "delete") …/fields/draft; status null = no answer. */
export function writeOutcome(op: SaveOp, status: number | null, body: unknown): WriteOutcome {
  if (status == null) return { type: "failed", error: { kind: "network", op } };
  if (status === 200) {
    if (op === "put") {
      const result = orNull(() => parseDraftSaved(body));
      if (result) return { type: "saved", result };
    } else {
      const rev = orNull(() => parseDraftDeleted(body));
      if (rev != null) return { type: "discarded", rev };
    }
    return { type: "failed", error: { kind: "server", op, status } };
  }
  if (status === 409) {
    const c = orNull(() => parseDraftConflict(body));
    if (c) return { type: "conflict", conflict: { draft: c.draft, rev: c.draft_rev, updatedAt: c.draft_updated_at, updatedBy: c.draft_updated_by } };
  }
  if (status >= 500) return { type: "failed", error: { kind: "server", op, status } };
  return { type: "failed", error: { kind: "rejected", op, status, code: errorCode(body) } };
}

/** A PUT of this session landed: the entry was writing a config and now holds it, error-free. */
function savedNow(was: RouteDraft | undefined, is: RouteDraft | undefined): boolean {
  return !!was && !!is && was.saving && was.inFlight != null && !is.saving && is.error == null && is.conflict == null && is.serverDraft != null;
}

const sameOrder = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id, i) => id === b[i]);

// ---- the store ------------------------------------------------------------------------------------
export class DraftStore {
  private model: DraftModel = EMPTY_DRAFT_MODEL;
  private snapshot: DraftSnapshot = { model: EMPTY_DRAFT_MODEL, summary: summarize(EMPTY_DRAFT_MODEL), sessionSavedAt: null };
  private readonly listeners = new Set<() => void>();
  private readonly staleListeners = new Set<() => void>();
  private readonly fetcher: Fetcher | undefined;
  private readonly debounceMs: number;
  private readonly retryDelays: readonly number[];
  private readonly timers: TimerApi;
  private readonly now: () => number;
  /** Debounce timers, by route. */
  private readonly saveTimers = new Map<number, unknown>();
  /** Automatic-retry timers and the attempts made, by route. */
  private readonly retryTimers = new Map<number, unknown>();
  private readonly retryAttempts = new Map<number, number>();
  /** Re-checked after every change (flushAll / discardAll wait on them). */
  private waiters: (() => void)[] = [];
  /** While > 0, an edit saves at once (a flush is waiting for it). */
  private flushing = 0;
  /** While a discard runs, nothing autosaves. */
  private discarding = false;
  /** Routes being read back by reloadRoute: they do not autosave meanwhile. */
  private readonly reloading = new Set<number>();
  private lastContext: FieldsContextJson | null = null;
  /** draftModel.stepsOutOfContextKey the stale listeners were last told about ("" = none). */
  private staleKey = "";

  constructor(options: DraftStoreOptions = {}) {
    this.fetcher = options.fetch;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
    };
    this.now = options.now ?? Date.now;
  }

  // -- useSyncExternalStore ------------------------------------------------------------------------
  /** Arrow members: pass them to useSyncExternalStore as they are. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): DraftSnapshot => this.snapshot;

  /** Called once per change of steps: a route read back with other steps than the context on
   *  screen has (409 STEP_UNKNOWN) — the map's columns are the context's, so the page asks for it
   *  again. */
  onContextStale(listener: () => void): () => void {
    this.staleListeners.add(listener);
    return () => {
      this.staleListeners.delete(listener);
    };
  }

  /** The routes the store holds a working copy of (the context's, and any still saving). */
  heldRouteIds(): Set<number> {
    return new Set(Object.keys(this.model.routes).map(Number));
  }

  private dispatch(action: DraftAction): void {
    const prev = this.model;
    const next = draftReducer(prev, action);
    if (next === prev) return;
    this.model = next;
    let sessionSavedAt = this.snapshot.sessionSavedAt;
    if (next.order.some((id) => savedNow(prev.routes[id], next.routes[id]))) sessionSavedAt = this.now();
    else if (!sameOrder(prev.order, next.order) || !next.order.some((id) => next.routes[id] != null && entryHasDraft(next.routes[id]))) sessionSavedAt = null;
    this.snapshot = { model: next, summary: summarize(next), sessionSavedAt };
    for (const l of [...this.listeners]) l();
    if (action.type === "load" || action.type === "routeLoaded") this.checkStale();
    this.wake();
  }

  private checkStale(): void {
    const key = this.lastContext ? stepsOutOfContextKey(this.model, this.lastContext) : "";
    if (key === this.staleKey) return;
    this.staleKey = key;
    if (key !== "") for (const l of [...this.staleListeners]) l();
  }

  private entry(routeId: number): RouteDraft | undefined {
    return this.model.routes[routeId];
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** Resolves once `done()` holds, re-checked after every change. */
  private until(done: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (done()) resolve();
        else this.waiters.push(check);
      };
      check();
    });
  }

  // -- reads and edits -------------------------------------------------------------------------------
  /** A (re)loaded fields-context: entries merge by route id (draftModel.mergeRoute). Loading the
   *  same answer object again does nothing. */
  load(context: FieldsContextJson): void {
    if (context === this.lastContext) return;
    this.lastContext = context;
    this.dispatch({ type: "load", context });
    // A merge can leave an entry dirty with no timer (e.g. the published version moved under
    // unsaved edits): make sure it saves.
    for (const id of this.model.order) {
      const e = this.entry(id);
      if (e && e.dirty && !e.saving && !e.conflict && !this.saveTimers.has(id)) this.schedule(id);
    }
  }

  /** Edit one route's working copy. `mutate` gets a deep copy of `current` and changes it in place
   *  or returns the next config; the route autosaves ~800 ms after its last edit. An edit that
   *  changes nothing does nothing. */
  edit(routeId: number, mutate: ConfigMutator): void {
    const before = this.entry(routeId);
    if (!before) return;
    this.dispatch({ type: "edit", routeId, mutate });
    const e = this.entry(routeId);
    if (e === before) return;
    if (e && e.dirty && !e.conflict) this.schedule(routeId);
    else this.cancelTimer(routeId);   // back to what the server holds: nothing to save
  }

  /** Write the routes in error (all, or one) again now: a failed PUT saves the working copy, a
   *  failed DELETE deletes the draft again. */
  retry(routeId?: number): void {
    const ids = routeId == null ? [...this.heldRouteIds()] : [routeId];
    for (const id of ids) {
      const e = this.entry(id);
      if (!e || !e.error) continue;
      this.retryAttempts.delete(id);
      this.cancelRetry(id);
      if (e.error.op === "delete") {
        if (!e.saving) void this.write(id, "delete", e.conflict ? e.conflict.rev : e.rev);
      } else {
        this.startSave(id);
      }
    }
  }

  /** "טען מחדש": take the route as the server has it now (GET …/[id]/fields), dropping its local
   *  edits — the way out of a conflict. Waits for a write in flight. false when the read failed
   *  (the entry is left as it was). */
  async reloadRoute(routeId: number): Promise<boolean> {
    if (!this.entry(routeId) || this.reloading.has(routeId)) return false;
    this.reloading.add(routeId);
    try {
      this.cancelTimer(routeId);
      this.cancelRetry(routeId);
      await this.until(() => !this.entry(routeId)?.saving);
      const answer = await request(API.routeFields(routeId), { fetcher: this.fetcher });
      let parsed = null;
      try {
        if (answer.status !== 200) throw new BadBody("HTTP " + answer.status);
        parsed = parseRouteFields(answer.body);
      } catch (e) {
        console.error("Reading route " + routeId + " back failed", e);
      }
      if (!parsed || parsed.route.test_route_id !== routeId) return false;
      this.retryAttempts.delete(routeId);
      this.dispatch({ type: "routeLoaded", route: parsed });
      return true;
    } finally {
      this.reloading.delete(routeId);
      // A failed read leaves the entry as it was: let its edits save again — unless the server
      // refused them (a refusal waits for retry() / the next edit; a STEP_UNKNOWN would only be
      // refused again).
      const e = this.entry(routeId);
      if (e && e.dirty && !e.saving && !e.conflict && e.error?.kind !== "rejected" && !this.saveTimers.has(routeId)) {
        this.schedule(routeId);
      }
    }
  }

  /** reloadRoute for every route in conflict. */
  async reloadConflicts(): Promise<boolean> {
    const ids = this.snapshot.summary.conflictRoutes;
    const results = await Promise.all(ids.map((id) => this.reloadRoute(id)));
    return results.every(Boolean);
  }

  /** Save every pending edit now and resolve when nothing is left to save — the publish dialog
   *  awaits it before publish-preview. Resolves { ok: false } (it never hangs) when a route could
   *  not be saved: a failed write or a conflict. */
  async flushAll(): Promise<FlushResult> {
    this.flushing += 1;
    try {
      for (const id of this.heldRouteIds()) {
        this.cancelTimer(id);
        this.cancelRetry(id);
        this.startSave(id);
      }
      await this.until(() => Object.values(this.model.routes).every((e) => !e.saving && (!e.dirty || e.conflict != null || e.error != null)));
      return this.result();
    } finally {
      this.flushing -= 1;
    }
  }

  /** "ביטול הטיוטה": DELETE …/fields/draft for every route with a server draft (base_rev = its
   *  rev, or the conflict's), then every route back to its published version. Waits for writes in
   *  flight first; nothing autosaves meanwhile. */
  async discardAll(): Promise<FlushResult> {
    this.discarding = true;
    try {
      for (const id of this.heldRouteIds()) {
        this.cancelTimer(id);
        this.cancelRetry(id);
      }
      await this.until(() => Object.values(this.model.routes).every((e) => !e.saving));
      const entries = Object.values(this.model.routes);
      await Promise.all(entries.map((e) => {
        const serverHas = e.conflict ? e.conflict.draft != null : e.serverDraft != null;
        if (!serverHas) {
          this.dispatch({ type: "discardLocal", routeId: e.routeId });
          return Promise.resolve();
        }
        return this.write(e.routeId, "delete", e.conflict ? e.conflict.rev : e.rev);
      }));
      return this.result();
    } finally {
      this.discarding = false;
      // An edit made while the discard ran found autosave off: save it now (a route whose DELETE
      // failed keeps its error and waits for retry() — its edits are the ones to discard).
      for (const e of Object.values(this.model.routes)) {
        if (e.dirty && !e.saving && !e.conflict && !e.error && !this.saveTimers.has(e.routeId)) this.schedule(e.routeId);
      }
      this.wake();
    }
  }

  /** Start every pending save now (the page is leaving: unmount, another view). Idempotent — safe
   *  under StrictMode's double effects. */
  flushPending(): void {
    for (const id of [...this.saveTimers.keys()]) {
      this.cancelTimer(id);
      this.startSave(id);
    }
  }

  private result(): FlushResult {
    const all = Object.values(this.model.routes);
    const conflicts = all.filter((e) => e.conflict != null).map((e) => e.routeId);
    const failed = all.filter((e) => e.conflict == null && saveFailed(e)).map((e) => e.routeId);
    return failed.length === 0 && conflicts.length === 0 ? { ok: true } : { ok: false, failed, conflicts };
  }

  // -- writes ---------------------------------------------------------------------------------------
  private schedule(routeId: number): void {
    this.cancelTimer(routeId);
    if (this.flushing > 0) {
      this.startSave(routeId);
      return;
    }
    this.saveTimers.set(routeId, this.timers.setTimeout(() => {
      this.saveTimers.delete(routeId);
      this.startSave(routeId);
    }, this.debounceMs));
  }

  private cancelTimer(routeId: number): void {
    const h = this.saveTimers.get(routeId);
    if (h !== undefined) {
      this.timers.clearTimeout(h);
      this.saveTimers.delete(routeId);
    }
  }

  private cancelRetry(routeId: number): void {
    const h = this.retryTimers.get(routeId);
    if (h !== undefined) {
      this.timers.clearTimeout(h);
      this.retryTimers.delete(routeId);
    }
  }

  /** PUT the working copy — unless a write is in flight (it saves this one when it lands), the
   *  route is in conflict or being reloaded, a discard runs, or there is nothing to save. */
  private startSave(routeId: number): void {
    const e = this.entry(routeId);
    if (!e || e.saving || e.conflict || !e.dirty || this.discarding || this.reloading.has(routeId)) return;
    void this.write(routeId, "put", e.rev);
  }

  private async write(routeId: number, op: SaveOp, baseRev: number): Promise<void> {
    this.dispatch(op === "put" ? { type: "saveStart", routeId } : { type: "discardStart", routeId });
    const e = this.entry(routeId);
    if (!e || !e.saving) return;
    const body = op === "put" ? { config: e.inFlight, base_rev: baseRev } : { base_rev: baseRev };
    const answer = await request(API.routeDraft(routeId), { method: op === "put" ? "PUT" : "DELETE", body, fetcher: this.fetcher });
    const outcome = writeOutcome(op, answer.status, answer.body);
    switch (outcome.type) {
      case "saved":
        this.dispatch({ type: "saveDone", routeId, result: outcome.result });
        break;
      case "discarded":
        this.dispatch({ type: "discardDone", routeId, rev: outcome.rev });
        break;
      case "conflict":
        this.dispatch({ type: "conflict", routeId, op, conflict: outcome.conflict });
        break;
      case "failed":
        this.dispatch({ type: "fail", routeId, error: outcome.error });
        break;
    }
    this.afterWrite(routeId);
  }

  private afterWrite(routeId: number): void {
    const e = this.entry(routeId);
    if (!e) return;
    if (e.error && e.error.op === "put" && e.error.kind !== "rejected") this.scheduleRetry(routeId);
    else if (!e.error) {
      this.retryAttempts.delete(routeId);
      this.cancelRetry(routeId);
    }
    // An edit made while the write was in flight: its timer already fired (and found the write in
    // flight), so save it now on the new rev.
    if (e.dirty && !e.error && !e.conflict && !this.saveTimers.has(routeId)) this.startSave(routeId);
    // D7: the draft names a step the route no longer has — read the route back (its steps, its
    // draft). Edits since the last save cannot be saved against those steps and are dropped.
    if (e.error?.kind === "rejected" && e.error.op === "put" && e.error.code === STEP_UNKNOWN) void this.reloadRoute(routeId);
    if (!this.model.order.includes(routeId)) this.dispatch({ type: "evict", routeId });
  }

  private scheduleRetry(routeId: number): void {
    if (this.retryTimers.has(routeId)) return;
    const attempt = this.retryAttempts.get(routeId) ?? 0;
    if (attempt >= this.retryDelays.length) return;
    this.retryAttempts.set(routeId, attempt + 1);
    this.retryTimers.set(routeId, this.timers.setTimeout(() => {
      this.retryTimers.delete(routeId);
      this.startSave(routeId);
    }, this.retryDelays[attempt]));
  }
}

// ---- React -----------------------------------------------------------------------------------------
const DraftStoreContext = React.createContext<DraftStore | null>(null);

export type DraftStoreProviderProps = {
  /** The context on screen (useFieldsContext "ready" data); null while none. Each new answer is
   *  merged into the store. */
  context: FieldsContextJson | null;
  /** For tests; read once. */
  options?: DraftStoreOptions;
  children?: React.ReactNode;
};

/** One store for the page: mount it above the header, the map and the dialogs. Unmounting starts
 *  every pending save at once. */
export function DraftStoreProvider({ context, options, children }: DraftStoreProviderProps): React.ReactElement {
  const [store] = React.useState(() => {
    const s = new DraftStore(options);
    if (context) s.load(context);
    return s;
  });
  React.useEffect(() => {
    if (context) store.load(context);
  }, [store, context]);
  React.useEffect(() => () => store.flushPending(), [store]);
  return React.createElement(DraftStoreContext.Provider, { value: store }, children);
}

/** The page's store (edit, flushAll, discardAll, retry, reloadRoute). */
export function useDraftStore(): DraftStore {
  const store = React.useContext(DraftStoreContext);
  if (!store) throw new Error("useDraftStore needs a <DraftStoreProvider> above it");
  return store;
}

/** The whole state and its summary; re-renders on every change. */
export function useDraftSnapshot(): DraftSnapshot {
  const store = useDraftStore();
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** DraftStore.onContextStale for as long as the component is mounted. */
export function useOnContextStale(onStale: (() => void) | null): void {
  const store = useDraftStore();
  React.useEffect(() => (onStale ? store.onContextStale(onStale) : undefined), [store, onStale]);
}
