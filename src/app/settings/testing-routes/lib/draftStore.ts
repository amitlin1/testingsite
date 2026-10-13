"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import type { DraftSavedJson, FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { ShapeError, parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { EMPTY_DRAFT_MODEL, currentConfigs, draftReducer, summarize } from "./draftModel";
import type { ConfigMutator, DraftAction, DraftConflict, DraftModel, DraftSummary, RouteDraft, SaveError, SaveOp } from "./draftModel";
import { buildFieldsMap } from "./mapModel";
import type { FieldsMapModel } from "./mapModel";
import { parseRouteFieldsJson } from "./useFieldsContext";

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
 *     the route has now.
 * A failed DELETE ("ביטול הטיוטה") is retried by retry() as a DELETE. Edits made while a discard
 * runs are saved once it is over.
 * Multi-route edits (bulk actions, apply set, paste) call edit() once per route; each route
 * autosaves on its own (spec §3.2: no endpoint of their own).
 *
 * The store is keyed by test_route_id, not by the map on screen: load() merges a new context, so
 * an item route shared by two kits keeps its working copy (and its pending save) when the admin
 * switches between them.
 */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

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
  /** Default the global timers (tests pass their own clock). */
  timers?: TimerApi;
};

export type DraftSnapshot = { model: DraftModel; summary: DraftSummary };

/** flushAll / discardAll: ok, or the routes that could not be written. */
export type FlushResult = { ok: true } | { ok: false; failed: number[]; conflicts: number[] };

const DEFAULT_DEBOUNCE_MS = 800;
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 15000];

const draftUrl = (routeId: number) => `/api/settings/testing-routes/${routeId}/fields/draft`;
const fieldsUrl = (routeId: number) => `/api/settings/testing-routes/${routeId}/fields`;

// ---- answers --------------------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isRev = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** What a write's answer means for the route (pure; the store dispatches it). */
export type WriteOutcome =
  | { type: "saved"; result: DraftSavedJson }
  | { type: "discarded"; rev: number }
  | { type: "conflict"; conflict: DraftConflict }
  | { type: "failed"; error: SaveError };

/** A 409 DRAFT_CONFLICT body: { draft, draft_rev, draft_updated_at, draft_updated_by } (admin.ts). */
function conflictOf(body: unknown): DraftConflict | null {
  if (!isObj(body) || body.code !== "DRAFT_CONFLICT" || !isRev(body.draft_rev)) return null;
  let draft: RouteFieldsConfig | null = null;
  if (body.draft != null) {
    try {
      draft = parseRouteFieldsConfig(body.draft);
    } catch (e) {
      if (e instanceof ShapeError) return null;
      throw e;
    }
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return { draft, rev: body.draft_rev, updatedAt: str(body.draft_updated_at), updatedBy: str(body.draft_updated_by) };
}

/** The answer of PUT (op "put") or DELETE (op "delete") …/fields/draft. */
export function writeOutcome(op: SaveOp, status: number, body: unknown): WriteOutcome {
  if (status === 200) {
    if (op === "put" && isObj(body) && isRev(body.draft_rev) && typeof body.draft_updated_at === "string" && Array.isArray(body.issues)) {
      return { type: "saved", result: { draft_rev: body.draft_rev, draft_updated_at: body.draft_updated_at, issues: body.issues as Issue[] } };
    }
    if (op === "delete" && isObj(body) && isRev(body.draft_rev)) return { type: "discarded", rev: body.draft_rev };
    return { type: "failed", error: { kind: "server", op, status } };
  }
  if (status === 409) {
    const conflict = conflictOf(body);
    if (conflict) return { type: "conflict", conflict };
  }
  if (status >= 500) return { type: "failed", error: { kind: "server", op, status } };
  const code = isObj(body) && typeof body.code === "string" ? body.code : null;
  return { type: "failed", error: { kind: "rejected", op, status, code } };
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---- the store ------------------------------------------------------------------------------------
export class DraftStore {
  private model: DraftModel = EMPTY_DRAFT_MODEL;
  private snapshot: DraftSnapshot = { model: EMPTY_DRAFT_MODEL, summary: summarize(EMPTY_DRAFT_MODEL) };
  private readonly listeners = new Set<() => void>();
  private readonly fetcher: Fetcher;
  private readonly debounceMs: number;
  private readonly retryDelays: readonly number[];
  private readonly timers: TimerApi;
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

  constructor(options: DraftStoreOptions = {}) {
    this.fetcher = options.fetch ?? apiFetch;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
    };
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

  private dispatch(action: DraftAction): void {
    const next = draftReducer(this.model, action);
    if (next === this.model) return;
    this.model = next;
    this.snapshot = { model: next, summary: summarize(next) };
    for (const l of [...this.listeners]) l();
    this.wake();
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
   *  or returns the next config; the route autosaves ~800 ms after its last edit. */
  edit(routeId: number, mutate: ConfigMutator): void {
    if (!this.entry(routeId)) return;
    this.dispatch({ type: "edit", routeId, mutate });
    const e = this.entry(routeId);
    if (e && e.dirty && !e.conflict) this.schedule(routeId);
    else this.cancelTimer(routeId);   // back to what the server holds: nothing to save
  }

  /** Write the routes in error (all, or one) again now: a failed PUT saves the working copy, a
   *  failed DELETE deletes the draft again. */
  retry(routeId?: number): void {
    const ids = routeId == null ? Object.keys(this.model.routes).map(Number) : [routeId];
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
      let parsed = null;
      try {
        const res = await this.fetcher(fieldsUrl(routeId), { cache: "no-store" });
        if (res.status === 200) parsed = parseRouteFieldsJson(await readBody(res));
      } catch {
        parsed = null;
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
      for (const id of Object.keys(this.model.routes).map(Number)) {
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
      for (const id of Object.keys(this.model.routes).map(Number)) {
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
    const failed = all.filter((e) => e.conflict == null && e.error != null && (e.dirty || e.error.op === "delete")).map((e) => e.routeId);
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
    let outcome: WriteOutcome;
    try {
      const res = await this.fetcher(draftUrl(routeId), {
        method: op === "put" ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      outcome = writeOutcome(op, res.status, await readBody(res));
    } catch {
      outcome = { type: "failed", error: { kind: "network", op } };
    }
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
    if (e.error?.kind === "rejected" && e.error.op === "put" && e.error.code === "STEP_UNKNOWN") void this.reloadRoute(routeId);
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

/** The header's and the publish dialog's numbers (changeCount, blockingErrorCount, hasDraft…). */
export function useDraftSummary(): DraftSummary {
  return useDraftSnapshot().summary;
}

/** One route's entry — the same object until that route changes. */
export function useRouteDraft(routeId: number | null): RouteDraft | null {
  const store = useDraftStore();
  const get = React.useCallback(
    () => (routeId == null ? null : store.getSnapshot().model.routes[routeId] ?? null),
    [store, routeId],
  );
  return React.useSyncExternalStore(store.subscribe, get, get);
}

/** The fields map of `context` with every route's working copy and issues (mapModel). */
export function useFieldsMap(context: FieldsContextJson | null, setVersions?: Readonly<Record<number, number>>): FieldsMapModel | null {
  const { model, summary } = useDraftSnapshot();
  return React.useMemo(
    () => (context ? buildFieldsMap({ context, configs: currentConfigs(model), issues: summary.issuesByRoute, setVersions }) : null),
    [context, model, summary, setVersions],
  );
}
