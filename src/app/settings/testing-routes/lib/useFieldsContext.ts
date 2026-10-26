"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import { ShapeError, parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import type {
  ContextLineJson, FieldsContextJson, RouteFieldsJson, SharedKitJson, StationTypeJson,
} from "@/app/lib/station-fields/admin-types";

/**
 * The one read of the fields map (route-fields spec §3.2, §5.4.6, D6):
 * GET /api/settings/testing-routes/fields-context?packageTypeId=&routeNumber= for a kit,
 * ?itemTypeId=&routeNumber= for an item route.
 *
 * | status  | when                                    | the screen shows                             |
 * |---------|-----------------------------------------|----------------------------------------------|
 * | idle    | no route chosen                         | "בחר סוג מארז ומספר מסלול"                   |
 * | loading | the first answer for this route pending | the map's skeleton — never "ללא שדות"        |
 * | error   | non-200, network, or a body that is not | "טעינת הגדרות השדות נכשלה" + "נסה שוב"       |
 * |         | a context (`retrying` while retry runs) | ("טוען…", disabled) — never an empty route   |
 * | ready   | the context (`reloading` while reload   | the map; a reload keeps it on screen         |
 * |         | asks again)                             |                                              |
 *
 * An error is never shown as an empty route (artboard 11: "המסלול לא מוצג כריק כדי לא לאבד
 * נתונים"). Each answer is checked before the screen builds on it, the configs through
 * parseRouteFieldsConfig — a body that does not parse is the error state. A route change aborts the
 * request in flight; an answer to anything but the current request is dropped.
 */

export type FieldsContextSubject = {
  /** item_type_id of the kit (isPackage) or of the item. */
  itemTypeId: number;
  isPackage: boolean;
  routeNumber: number;
};

export type FieldsContextState =
  | { status: "idle" }
  | { status: "loading"; reload: () => void }
  | { status: "error"; retrying: boolean; retry: () => void; reload: () => void }
  | { status: "ready"; data: FieldsContextJson; reloading: boolean; reload: () => void };

// ---- the response, checked ----------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isRev = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;

class BadBody extends Error {}

/** A config from the wire, through the same structural parse as the server's (a sanitized copy). */
function configOf(v: unknown): RouteFieldsConfig | null {
  if (v === null) return null;
  try {
    return parseRouteFieldsConfig(v);
  } catch (e) {
    if (e instanceof ShapeError) throw new BadBody(e.message);
    throw e;
  }
}

function issuesOf(v: unknown): Issue[] {
  if (!Array.isArray(v)) throw new BadBody("issues");
  for (const i of v) {
    if (!isObj(i) || (i.level !== "error" && i.level !== "warning") || typeof i.code !== "string" || typeof i.message !== "string") {
      throw new BadBody("issue");
    }
  }
  return v as Issue[];
}

function kitsOf(v: unknown): SharedKitJson[] {
  if (!Array.isArray(v)) throw new BadBody("shared_with");
  return v.map((k) => {
    if (!isObj(k) || !isId(k.package_type_id) || typeof k.desc !== "string") throw new BadBody("shared_with");
    return { package_type_id: k.package_type_id, desc: k.desc };
  });
}

function routeFieldsOf(v: unknown): RouteFieldsJson {
  if (!isObj(v) || !isObj(v.route)) throw new BadBody("route");
  const r = v.route;
  if (!isId(r.test_route_id) || !isId(r.item_type_id) || !isInt(r.route_number)) throw new BadBody("route ids");
  if (!Array.isArray(r.route_steps) || !r.route_steps.every(isInt)) throw new BadBody("route_steps");
  if (!Array.isArray(r.step_uids) || !r.step_uids.every((u) => typeof u === "string")) throw new BadBody("step_uids");
  if (!isRev(v.draft_rev) || !isRev(v.published_version)) throw new BadBody("revs");
  if (!isStrOrNull(v.draft_updated_at) || !isStrOrNull(v.draft_updated_by)) throw new BadBody("draft_updated");
  return {
    route: {
      test_route_id: r.test_route_id,
      item_type_id: r.item_type_id,
      route_number: r.route_number,
      route_steps: r.route_steps as number[],
      step_uids: r.step_uids as string[],
    },
    draft: configOf(v.draft ?? null),
    draft_rev: v.draft_rev,
    draft_updated_at: v.draft_updated_at,
    draft_updated_by: v.draft_updated_by,
    published_version: v.published_version,
    published: configOf(v.published ?? null),
    issues: issuesOf(v.issues),
    shared_with: kitsOf(v.shared_with),
  };
}

const optionalReason = (v: unknown): { ok: boolean; value?: string } =>
  v === undefined || v === null ? { ok: true } : typeof v === "string" ? { ok: true, value: v } : { ok: false };

function lineOf(v: unknown): ContextLineJson {
  if (!isObj(v)) throw new BadBody("line");
  const ints = [v.line_id, v.item_type_id, v.quantity, v.sort_order, v.seq_from, v.seq_to, v.route_number];
  if (!ints.every(isInt) || typeof v.item_type_desc !== "string") throw new BadBody("line");
  const missing = optionalReason(v.missing);
  if (!missing.ok) throw new BadBody("line.missing");
  const line: ContextLineJson = {
    line_id: v.line_id as number,
    item_type_id: v.item_type_id as number,
    item_type_desc: v.item_type_desc,
    quantity: v.quantity as number,
    sort_order: v.sort_order as number,
    seq_from: v.seq_from as number,
    seq_to: v.seq_to as number,
    route_number: v.route_number as number,
    route: v.route == null ? null : routeFieldsOf(v.route),
  };
  if (missing.value !== undefined) line.missing = missing.value;
  return line;
}

/** GET …/[id]/fields — one route; null when the body is not one. */
export function parseRouteFieldsJson(raw: unknown): RouteFieldsJson | null {
  try {
    return routeFieldsOf(raw);
  } catch (e) {
    if (e instanceof BadBody) return null;
    throw e;
  }
}

/** GET …/fields-context — the context; null when the body is not one (→ the error state). */
export function parseFieldsContext(raw: unknown): FieldsContextJson | null {
  try {
    if (!isObj(raw) || (raw.kind !== "package" && raw.kind !== "item")) return null;
    const s = raw.subject;
    if (!isObj(s) || !isId(s.item_type_id) || typeof s.desc !== "string" || typeof s.is_package !== "boolean" || !isInt(s.route_number)) {
      return null;
    }
    if (!isObj(raw.stations)) return null;
    const stations: Record<number, StationTypeJson> = {};
    for (const [k, st] of Object.entries(raw.stations)) {
      if (!/^[0-9]{1,10}$/.test(k) || !isObj(st) || typeof st.label !== "string" || typeof st.package_level !== "boolean") return null;
      stations[Number(k)] = { label: st.label, package_level: st.package_level };
    }
    if (!Array.isArray(raw.lines)) return null;
    const kitMissing = optionalReason(raw.kit_missing);
    const itemMissing = optionalReason(raw.item_missing);
    if (!kitMissing.ok || !itemMissing.ok) return null;
    const out: FieldsContextJson = {
      kind: raw.kind,
      subject: { item_type_id: s.item_type_id, desc: s.desc, is_package: s.is_package, route_number: s.route_number },
      stations,
      kit: raw.kit == null ? null : routeFieldsOf(raw.kit),
      item: raw.item == null ? null : routeFieldsOf(raw.item),
      lines: raw.lines.map(lineOf),
    };
    if (kitMissing.value !== undefined) out.kit_missing = kitMissing.value;
    if (itemMissing.value !== undefined) out.item_missing = itemMissing.value;
    return out;
  } catch (e) {
    if (e instanceof BadBody) return null;
    throw e;
  }
}

/** The query string of the request, or null when the subject names no valid route. */
export function fieldsContextQuery(subject: FieldsContextSubject): string | null {
  if (!isId(subject.itemTypeId) || !isId(subject.routeNumber)) return null;
  const qs = new URLSearchParams();
  qs.set(subject.isPackage ? "packageTypeId" : "itemTypeId", String(subject.itemTypeId));
  qs.set("routeNumber", String(subject.routeNumber));
  return qs.toString();
}

/** One request: the context, or null for anything that is not a 200 with a valid body. */
export async function fetchFieldsContext(
  query: string,
  signal?: AbortSignal,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = apiFetch,
): Promise<FieldsContextJson | null> {
  try {
    const res = await fetcher(`/api/settings/testing-routes/fields-context?${query}`, { signal, cache: "no-store" });
    if (res.status !== 200) return null;
    return parseFieldsContext(await res.json());
  } catch {
    return null;   // network failure, aborted, or a body that is not JSON
  }
}

// ---- the hook ---------------------------------------------------------------------------------------
type Answer = { key: string; query: string; data: FieldsContextJson | null };

const IDLE: FieldsContextState = { status: "idle" };

/** subject null (no route chosen) → idle. The subject is compared by value: a new object for the
 *  same route does not ask again. */
export function useFieldsContext(subject: FieldsContextSubject | null): FieldsContextState {
  const query = subject ? fieldsContextQuery(subject) : null;
  const [attempt, setAttempt] = React.useState(0);
  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  const key = query ? `${attempt}:${query}` : "";
  const [answer, setAnswer] = React.useState<Answer | null>(null);

  React.useEffect(() => {
    if (!key || !query) return;
    const ctrl = new AbortController();
    fetchFieldsContext(query, ctrl.signal).then((data) => {
      if (!ctrl.signal.aborted) setAnswer({ key, query, data });
    });
    return () => ctrl.abort();
  }, [key, query]);

  return React.useMemo((): FieldsContextState => {
    if (!query) return IDLE;
    // The last answer for THIS route — current, or the one before a reload / retry that is pending.
    if (answer && answer.query === query) {
      const pending = answer.key !== key;
      if (answer.data) return { status: "ready", data: answer.data, reloading: pending, reload };
      return { status: "error", retrying: pending, retry: reload, reload };
    }
    return { status: "loading", reload };
  }, [query, key, answer, reload]);
}
