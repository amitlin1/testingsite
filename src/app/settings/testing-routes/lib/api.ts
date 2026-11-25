import { apiFetch } from "@/lib/api/client";

/**
 * One request to the settings API: the status and the JSON body, never a throw — the screen's
 * writes tell a refusal (its status and `code`) from no answer at all, and its reads never trust a
 * cached copy. `fetcher` is apiFetch (401 → refresh → retry once); tests pass their own.
 */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** status null = no answer (network, aborted). body null = none, or not JSON. */
export type Answer = { status: number | null; body: unknown };

export type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal; fetcher?: Fetcher };

export async function request(url: string, { method = "GET", body, signal, fetcher = apiFetch }: RequestOptions = {}): Promise<Answer> {
  let res: Response;
  try {
    res = await fetcher(url, {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      cache: "no-store",
      signal,
    });
  } catch {
    return { status: null, body: null };
  }
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: res.status, body: null };
  }
}

/** A 200 (or a POST's 201). */
export const isOk = (a: Answer): boolean => a.status === 200 || a.status === 201;
