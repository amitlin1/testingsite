"use client";
import * as React from "react";
import { apiFetch } from "@/lib/api/client";
import type { Field, FieldsSchemaRef, KitItemFields, KitItemTarget, StationFieldsResponse } from "@/app/lib/station-fields/schema";

/**
 * The fields of the step a popup opens on (route-fields spec §4.2):
 * GET /api/testing/station-fields?itemId=&stationId= (D5). In the package wizards itemId is the
 * BOX row's item_id, so the answer is mode "package".
 *
 * | status  | the popup shows                                   | finish / next              |
 * |---------|---------------------------------------------------|----------------------------|
 * | loading | today's popup; skeleton rows where the block goes | blocked                    |
 * | legacy  | today's popup, exactly — nothing from fields/     | as today                   |
 * | error   | an error in place of the block, with retry        | blocked                    |
 * | ready   | the block, the suggestion line, NotesField        | as today + the fields gate |
 *
 * "error" is any non-200 answer, a network failure, or a body that is not a StationFieldsResponse —
 * never "legacy": a passing glitch must not save a result without the fields it should carry (the
 * server would refuse it anyway, 409).
 *
 * Loads once per opening (open false → true), again when itemId or stationId change, and on
 * reload() / retry(). Closing or unmounting aborts the request; an answer to anything but the
 * current request is dropped.
 *
 * Every state can reload(): back to "loading", and ask again. A popup does after a 409
 * FIELDS_SCHEMA_MISMATCH, and the package-open wizard after it adds a kit item (spec §4.11.3,
 * §8.6) — whatever the answer was: an added item can give a kit that answered "legacy" fields of
 * its own. retry() is the same call, under the name spec §4.2 gives the error state.
 */
export type StationFieldsState =
  | { status: "loading"; reload: () => void }
  | { status: "legacy"; reload: () => void }               // no published config → today's popup
  | { status: "error"; retry: () => void; reload: () => void }
  | ({ status: "ready"; reload: () => void } & Exclude<StationFieldsResponse, { mode: "legacy" }>);

// ---- the response, checked before a popup builds on it ----------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** Every entry an object with the keys every field type has (the server parsed the config). */
function isFieldList(v: unknown): v is Field[] {
  return Array.isArray(v) && v.every((f) => isObj(f) && typeof f.id === "string" && typeof f.type === "string" && typeof f.label === "string");
}

/** The schema reference, rebuilt from its own keys — what the popup sends back in Details.schema. */
function schemaRefOf(v: unknown): Omit<FieldsSchemaRef, "target"> | null {
  if (!isObj(v) || !isInt(v.route_id) || !isInt(v.v) || typeof v.step_uid !== "string") return null;
  return { route_id: v.route_id, v: v.v, step_uid: v.step_uid };
}

function kitTargetOf(v: unknown): KitItemTarget | null {
  if (v === "each_item") return v;
  return isObj(v) && isInt(v.item_type_id) ? { item_type_id: v.item_type_id } : null;
}

function parseKitItem(v: unknown): KitItemFields | null {
  if (!isObj(v) || typeof v.item_id !== "string" || !isInt(v.package_seq) || !isInt(v.item_type_id)
    || typeof v.item_type_desc !== "string" || !Array.isArray(v.groups)) return null;
  const groups: KitItemFields["groups"] = [];
  for (const g of v.groups) {
    const target = isObj(g) ? kitTargetOf(g.target) : null;
    if (!target || !isFieldList(g.fields)) return null;
    groups.push({ target, fields: g.fields });
  }
  return { item_id: v.item_id, package_seq: v.package_seq, item_type_id: v.item_type_id, item_type_desc: v.item_type_desc, groups };
}

/** The GET body as a StationFieldsResponse, or null when it is not one (→ "error"). */
export function parseStationFieldsResponse(raw: unknown): StationFieldsResponse | null {
  if (!isObj(raw)) return null;
  if (raw.mode === "legacy") return { mode: "legacy" };
  if (typeof raw.gate !== "boolean") return null;
  const ref = schemaRefOf(raw.schema);
  if (!ref) return null;
  if (raw.mode === "item") {
    if (!isObj(raw.schema) || raw.schema.target !== "item" || !isFieldList(raw.fields)) return null;
    return { mode: "item", schema: { ...ref, target: "item" }, fields: raw.fields, gate: raw.gate };
  }
  if (raw.mode === "package") {
    if (!isFieldList(raw.box) || !Array.isArray(raw.items)) return null;
    const items: KitItemFields[] = [];
    for (const it of raw.items) {
      const item = parseKitItem(it);
      if (!item) return null;
      items.push(item);
    }
    return { mode: "package", schema: ref, box: raw.box, items, gate: raw.gate };
  }
  return null;
}

/** A kit item's entry in a "package" answer (by item_id), or undefined. */
export function findKitItem(sf: StationFieldsState, itemId: string | number): KitItemFields | undefined {
  if (sf.status !== "ready" || sf.mode !== "package") return undefined;
  const id = String(itemId);
  return sf.items.find((it) => it.item_id === id);
}

/** Every field a kit item answers, its groups in order ("לכל פריט" first, then its type's) — the
 *  definitions its drafts are evaluated and saved against (target "kit_item"). */
export function kitItemDefs(item: KitItemFields | undefined): Field[] {
  return item ? item.groups.flatMap((g) => g.fields) : [];
}

/** The query string of the request: itemId, and stationId when it is a station id. */
export function stationFieldsQuery(itemId: string | number, stationId?: number | null): string {
  const qs = new URLSearchParams({ itemId: String(itemId) });
  if (stationId != null && Number.isSafeInteger(stationId) && stationId > 0) qs.set("stationId", String(stationId));
  return qs.toString();
}

/** One request: the response, or null for anything that is not a 200 with a valid body. */
async function fetchStationFields(query: string, signal: AbortSignal): Promise<StationFieldsResponse | null> {
  try {
    const res = await apiFetch(`/api/testing/station-fields?${query}`, { signal, cache: "no-store" });
    if (res.status !== 200) return null;
    return parseStationFieldsResponse(await res.json());
  } catch {
    return null;   // network failure, aborted, or a body that is not JSON
  }
}

type Answer = { key: string; response: StationFieldsResponse | null };

/**
 * itemId: item.item_id — in the package wizards the box row's. open: the popup's `open`; each
 * opening loads afresh (the item may be at another step by now). stationId: the popup's station
 * (station.test_station_id) — the server answers "legacy" for a research station.
 */
export function useStationFields(itemId: string | number, open: boolean, stationId?: number | null): StationFieldsState {
  // Every opening is a session of its own, so reopening never shows the previous opening's answer
  // (React's "adjusting state when a prop changes", during render — no effect round-trip).
  const [opening, setOpening] = React.useState(() => ({ open, session: open ? 1 : 0 }));
  if (opening.open !== open) setOpening({ open, session: open ? opening.session + 1 : opening.session });

  const [attempt, setAttempt] = React.useState(0);
  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);

  const query = stationFieldsQuery(itemId, stationId);
  // "" while closed: nothing is loaded, and the cleanup below aborts what was in flight.
  const key = open ? `${opening.session}:${attempt}:${query}` : "";
  const [answer, setAnswer] = React.useState<Answer | null>(null);

  React.useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    fetchStationFields(query, ctrl.signal).then((response) => {
      if (!ctrl.signal.aborted) setAnswer({ key, response });
    });
    return () => ctrl.abort();
  }, [key, query]);

  // One object per state for this popup, so a state that holds keeps its identity.
  const loading = React.useMemo((): StationFieldsState => ({ status: "loading", reload }), [reload]);
  const legacy = React.useMemo((): StationFieldsState => ({ status: "legacy", reload }), [reload]);

  return React.useMemo((): StationFieldsState => {
    if (!key || answer?.key !== key) return loading;
    const response = answer.response;
    if (response == null) return { status: "error", retry: reload, reload };
    if (response.mode === "legacy") return legacy;
    return { status: "ready", reload, ...response };
  }, [key, answer, reload, loading, legacy]);
}
