"use client";
import * as React from "react";
import { isDbId } from "@/lib/http/request";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { request } from "./api";
import type { Fetcher } from "./api";
import { API, BadBody, parseFieldsContext } from "./wire";

/**
 * The one read of the fields map (route-fields spec §3.2, §5.4.6, D6): GET …/fields-context of the
 * kit route on screen.
 *
 *   idle     no route chosen
 *   loading  the first answer for this route pending — the map's skeleton, never an empty route
 *   error    non-200, network, or a body that is not a context (`retrying` while retry runs)
 *   ready    the context (`reloading` while reload asks again; the map stays on screen)
 *
 * An error is never shown as an empty route (artboard 11: "המסלול לא מוצג כריק כדי לא לאבד
 * נתונים"). A route change aborts the request in flight; an answer to anything but the current
 * request is dropped.
 */

/** The kit route on screen. */
export type FieldsContextSubject = { packageTypeId: number; routeNumber: number };

export type FieldsContextState =
  | { status: "idle" }
  | { status: "loading"; reload: () => void }
  | { status: "error"; retrying: boolean; retry: () => void; reload: () => void }
  | { status: "ready"; data: FieldsContextJson; reloading: boolean; reload: () => void };

/** One request: the context, or null for anything that is not a 200 with a valid body. */
export async function fetchFieldsContext(url: string, signal?: AbortSignal, fetcher?: Fetcher): Promise<FieldsContextJson | null> {
  const answer = await request(url, { signal, fetcher });
  if (signal?.aborted) return null;
  try {
    if (answer.status !== 200) throw new BadBody("HTTP " + answer.status);
    return parseFieldsContext(answer.body);
  } catch (e) {
    console.error("Fields context failed: " + url, e);
    return null;
  }
}

type Answer = { key: string; url: string; data: FieldsContextJson | null };

const IDLE: FieldsContextState = { status: "idle" };

/** subject null (no route chosen, or not a valid one) → idle. The subject is compared by value: a new
 *  object for the same route does not ask again. */
export function useFieldsContext(subject: FieldsContextSubject | null): FieldsContextState {
  const url = subject && isDbId(subject.packageTypeId) && isDbId(subject.routeNumber)
    ? API.fieldsContext(subject.packageTypeId, subject.routeNumber)
    : null;
  const [attempt, setAttempt] = React.useState(0);
  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  const key = url ? `${attempt}:${url}` : "";
  const [answer, setAnswer] = React.useState<Answer | null>(null);

  React.useEffect(() => {
    if (!key || !url) return;
    const ctrl = new AbortController();
    fetchFieldsContext(url, ctrl.signal).then((data) => {
      if (!ctrl.signal.aborted) setAnswer({ key, url, data });
    });
    return () => ctrl.abort();
  }, [key, url]);

  return React.useMemo((): FieldsContextState => {
    if (!url) return IDLE;
    // The last answer for THIS route — current, or the one before a reload / retry that is pending.
    if (answer && answer.url === url) {
      const pending = answer.key !== key;
      if (answer.data) return { status: "ready", data: answer.data, reloading: pending, reload };
      return { status: "error", retrying: pending, retry: reload, reload };
    }
    return { status: "loading", reload };
  }, [url, key, answer, reload]);
}
