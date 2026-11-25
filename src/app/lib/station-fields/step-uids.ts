import { HttpError } from "@/lib/http/errors";
import { isRecord } from "@/lib/json-guards";
import { mintFree, newPrefixedId, type RandomSource } from "@/lib/random-id";
import type { StationTypeJson } from "./admin-types";
import { alignedStepUids } from "./schema";
import type { ChecklistItemId, FieldId, OptionId, RouteFieldsConfig, StepConfig, StepUid } from "./schema";

/**
 * Ids, and keeping step uids attached to their steps (route-fields spec §3.5, decision D2).
 *
 * A step uid moves with its step when steps are reordered and disappears with it when the step is
 * removed. It is never derived from an index, and a removed uid is never minted again — a version
 * that still holds its config must not come back to life on some other step.
 */

/** A new step uid that is in none of `taken` (the route's current uids AND every uid in any
 *  published version of the route). */
export function newStepUid(taken: ReadonlySet<string>, random?: RandomSource): StepUid {
  return mintFree(() => newPrefixedId("s_", random), taken, "step uid");
}

/** Minted in the browser, so autosave never waits for the server; the shape check enforces
 *  format and uniqueness. */
export const newFieldId = (random?: RandomSource): FieldId => newPrefixedId("f_", random);
export const newOptionId = (random?: RandomSource): OptionId => newPrefixedId("o_", random);
export const newChecklistItemId = (random?: RandomSource): ChecklistItemId => newPrefixedId("c_", random);

type StepUidErrorCode = "STEP_UID_UNKNOWN" | "STEP_UID_DUPLICATE";

/** A route save that names a uid the route does not have, or one uid twice → HTTP 400 `code`
 *  (the routes API answers it as it is, spec §3.5). */
const uidRefusal = (code: StepUidErrorCode, uid: string) => new HttpError(400, `${code}: ${uid}`, { code });

/**
 * The step_uids to store next to the incoming route_steps (same length as `incoming`).
 * Every non-null uid must be one of the route's current uids, at most once — so a client can never
 * invent a uid, or pin one step's config onto another. Every null (a new step) gets a fresh uid that
 * is neither current nor in any published version.
 */
export function assignStepUids(
  current: readonly string[],
  incoming: readonly (string | null)[],
  publishedUids: ReadonlySet<string>,
  random?: RandomSource,
): StepUid[] {
  const known = new Set(current);
  const seen = new Set<string>();
  for (const uid of incoming) {
    if (uid == null) continue;
    if (!known.has(uid)) throw uidRefusal("STEP_UID_UNKNOWN", String(uid));
    if (seen.has(uid)) throw uidRefusal("STEP_UID_DUPLICATE", uid);
    seen.add(uid);
  }
  const taken = new Set<string>([...current, ...publishedUids]);
  return incoming.map((uid) => {
    if (uid != null) return uid;
    const fresh = newStepUid(taken, random);
    taken.add(fresh);
    return fresh;
  });
}

/**
 * For a caller that sends route_steps without step_uids (the seed scripts): each new step takes the
 * uid of the current step with the same (station type, occurrence) — the 2nd time a type appears
 * takes the uid of its 2nd current occurrence. Unmatched steps get null (→ a fresh uid). A repeated
 * PUT with the same steps therefore keeps every uid. Current steps / uids of different lengths have
 * no usable pairing: all null.
 */
export function inferUidsByOccurrence(
  curSteps: readonly number[],
  curUids: readonly string[],
  nextSteps: readonly number[],
): (StepUid | null)[] {
  const byType = new Map<number, string[]>();
  alignedStepUids({ route_steps: curSteps, step_uids: curUids }).forEach((uid, i) => {
    const list = byType.get(curSteps[i]) ?? [];
    list.push(uid);
    byType.set(curSteps[i], list);
  });
  const used = new Map<number, number>();
  return nextSteps.map((typeId) => {
    const k = used.get(typeId) ?? 0;
    used.set(typeId, k + 1);
    return byType.get(typeId)?.[k] || null;
  });
}

export type PruneResult = {
  /** The pruned draft — the same object when nothing changed; null when there was no draft. */
  config: RouteFieldsConfig | null;
  /** Uids dropped because their step left the route (each becomes a step_removed change). */
  removed: StepUid[];
  changed: boolean;
  /** Steps whose station type's level (package / item) no longer matches their scope. They are
   *  KEPT with the old scope — checkConfigAgainstRoute reports them, nothing is deleted silently. */
  scopeChanged: StepUid[];
};

/**
 * After the route's steps were saved: drop configs whose uid left the route, and refresh each
 * remaining step's informational station_type_id / station_label from its (possibly new) position.
 * `stationTypes` maps test_station_type_id → { label (test_type_desc), package_level }.
 */
export function pruneDraft(
  draft: RouteFieldsConfig | null,
  stepUids: readonly string[],
  routeSteps: readonly number[],
  stationTypes: ReadonlyMap<number, StationTypeJson>,
): PruneResult {
  if (!draft) return { config: null, removed: [], changed: false, scopeChanged: [] };
  const position = new Map<string, number>();
  stepUids.forEach((uid, i) => {
    if (!position.has(uid)) position.set(uid, i);
  });
  const steps: Record<StepUid, StepConfig> = {};
  const removed: StepUid[] = [];
  const scopeChanged: StepUid[] = [];
  let changed = false;
  for (const uid of Object.keys(draft.steps)) {
    const step = draft.steps[uid];
    const i = position.get(uid);
    if (i === undefined) {
      removed.push(uid);
      changed = true;
      continue;
    }
    let next = step;
    if (i < routeSteps.length) {
      const typeId = routeSteps[i];
      const info = stationTypes.get(typeId);
      const label = info ? info.label.trim() : step.station_label;   // test_type_desc is CHAR(50): padded
      if (typeId !== step.station_type_id || label !== step.station_label) {
        next = { ...step, station_type_id: typeId, station_label: label };
        changed = true;
      }
      if (info && (info.package_level ? "package" : "item") !== step.scope) scopeChanged.push(uid);
    }
    steps[uid] = next;
  }
  return { config: changed ? { schema: 1, steps } : draft, removed, changed, scopeChanged };
}

/**
 * A station type's id was edited (spec §3.6): point the draft's informational station_type_id at
 * the new id. Works on the raw fields_draft JSON and touches nothing else; anything that does not
 * look like a config is left alone. null when nothing changed (no write needed). Published
 * versions are history and are never passed here.
 */
export function renameStationTypeInConfig(cfg: unknown, oldId: number, newId: number): RouteFieldsConfig | null {
  if (oldId === newId || !isRecord(cfg) || !isRecord(cfg.steps)) return null;
  let changed = false;
  const steps = Object.fromEntries(
    Object.entries(cfg.steps).map(([uid, step]) => {
      if (!isRecord(step) || step.station_type_id !== oldId) return [uid, step];
      changed = true;
      return [uid, { ...step, station_type_id: newId }];
    }),
  );
  return changed ? ({ ...cfg, steps } as unknown as RouteFieldsConfig) : null;
}
