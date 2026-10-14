"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import type { ForkResultJson } from "@/app/lib/station-fields/admin-types";
import { useDraftStore } from "./draftStore";
import type { Fetcher, FlushResult } from "./draftStore";

/**
 * "צור מסלול נפרד למארז הזה" on the client (route-fields spec §3.2.1; artboard 2's shared notice):
 * POST /api/settings/testing-routes/[id]/fork { package_type_id } → { test_route_id, route_number }.
 *
 * The fork copies the route's draft AS THE SERVER HOLDS IT, so every pending autosave is written
 * first (DraftStore.flushAll): an edit still in its debounce would otherwise land on the old,
 * shared route after the fork, and the new route would miss it. When the source route's edits
 * cannot be saved (a failed write, a conflict) nothing is asked of the server.
 *
 * The answer, as the dialog words it (forkLabels.forkErrorText):
 *   201 / 200                                  → the new route (the host reloads the fields context)
 *   409 ITEM_ROUTE_SHAPE / PACKAGE_ROUTE_SHAPE → "shape", with the server's Hebrew `reason`
 *   409 LINE_NOT_ON_ROUTE, 400 KIT_LINE_NOT_FOUND, 404 → "stale": the screen is behind the server
 *   anything else (network, 5xx, 409 ROUTE_NUMBER_TAKEN, …) → "failed" (asking again may work)
 * The calls never throw.
 */

export type ForkError =
  | { kind: "unsaved" }
  | { kind: "shape"; reason: string | null }
  | { kind: "stale" }
  | { kind: "failed" };

export type ForkOutcome = { ok: true; data: ForkResultJson } | { ok: false; error: ForkError };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;

export const forkUrl = (routeId: number) => `/api/settings/testing-routes/${routeId}/fork`;

/** The success body, or null when it is not one. */
export function parseForkResult(body: unknown): ForkResultJson | null {
  if (!isObj(body) || !isId(body.test_route_id) || !isId(body.route_number)) return null;
  return { test_route_id: body.test_route_id, route_number: body.route_number };
}

const SHAPE_CODES = new Set(["ITEM_ROUTE_SHAPE", "PACKAGE_ROUTE_SHAPE"]);
const STALE_CODES = new Set(["LINE_NOT_ON_ROUTE", "KIT_LINE_NOT_FOUND", "ROUTE_NOT_FOUND", "ITEM_TYPE_NOT_FOUND"]);

/** What the fork's answer means (pure). `status` null = no answer (network). */
export function forkOutcome(status: number | null, body: unknown): ForkOutcome {
  if (status === 200 || status === 201) {
    const data = parseForkResult(body);
    return data ? { ok: true, data } : { ok: false, error: { kind: "failed" } };
  }
  const code = isObj(body) && typeof body.code === "string" ? body.code : null;
  if (status === 409 && code !== null && SHAPE_CODES.has(code)) {
    const reason = isObj(body) && typeof body.reason === "string" && body.reason.trim() ? body.reason : null;
    return { ok: false, error: { kind: "shape", reason } };
  }
  if (status !== null && status < 500 && code !== null && STALE_CODES.has(code)) return { ok: false, error: { kind: "stale" } };
  return { ok: false, error: { kind: "failed" } };
}

/** The source route could not be saved: a failed write or a conflict on it. */
function sourceUnsaved(flushed: FlushResult, routeId: number): boolean {
  return !flushed.ok && (flushed.failed.includes(routeId) || flushed.conflicts.includes(routeId));
}

export type ForkDeps = {
  /** DraftStore.flushAll — every pending autosave written before the server copies the draft. */
  flushAll: () => Promise<FlushResult>;
  /** Default apiFetch (401 → refresh → retry once). */
  fetch?: Fetcher;
};

/** Flush, then POST …/[routeId]/fork { package_type_id }. */
export async function forkRoute(deps: ForkDeps, routeId: number, packageTypeId: number): Promise<ForkOutcome> {
  let flushed: FlushResult;
  try {
    flushed = await deps.flushAll();
  } catch {
    return { ok: false, error: { kind: "unsaved" } };
  }
  if (sourceUnsaved(flushed, routeId)) return { ok: false, error: { kind: "unsaved" } };
  const fetcher = deps.fetch ?? apiFetch;
  let res: Response;
  try {
    res = await fetcher(forkUrl(routeId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_type_id: packageTypeId }),
      cache: "no-store",
    });
  } catch {
    return forkOutcome(null, null);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return forkOutcome(res.status, body);
}

export type ForkRunner = {
  /** A fork is being asked (the flush included). */
  running: boolean;
  /** Why the last run did not fork; null after a success or reset(). */
  error: ForkError | null;
  /** One fork at a time: a call while one runs resolves null at once. Resolves the new route, or
   *  null with `error` set. */
  run: (routeId: number, packageTypeId: number) => Promise<ForkResultJson | null>;
  /** Clears `error` (the dialog opens anew). */
  reset: () => void;
};

/** The fork for the page's draft store (needs the DraftStoreProvider above it). */
export function useFork(): ForkRunner {
  const store = useDraftStore();
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<ForkError | null>(null);
  const busy = React.useRef(false);

  const run = React.useCallback(async (routeId: number, packageTypeId: number): Promise<ForkResultJson | null> => {
    if (busy.current) return null;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      const outcome = await forkRoute({ flushAll: () => store.flushAll() }, routeId, packageTypeId);
      if (outcome.ok) return outcome.data;
      setError(outcome.error);
      return null;
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [store]);

  const reset = React.useCallback(() => setError(null), []);
  return React.useMemo(() => ({ running, error, run, reset }), [running, error, run, reset]);
}
