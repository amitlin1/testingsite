import { stepConfigOf, targetKey } from "@/app/lib/station-fields/schema";
import type { Field, FieldGroup, GroupTarget, RouteFieldsConfig, StepConfig, StepUid } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";

/**
 * A map cell's fields are one group of one step of one route's config: (route_id, step_uid, target)
 * — never a column index (spec §11.3). Pure: the map, the editor, the bulk actions and the apply-set
 * dialog read and write a cell's group through these.
 */

/** Where a cell's fields live: the group `target` of step `step_uid` of route `route_id`. */
export type CellBinding = { route_id: number; step_uid: StepUid; target: GroupTarget };

/** What a new StepConfig for the cell's step carries. */
export type StepMeta = { station_type_id: number; station_label: string; scope: "package" | "item" };

/** A config with no steps — a route that holds no fields yet. */
export const emptyConfig = (): RouteFieldsConfig => ({ schema: 1, steps: {} });

/** A cell's key: "{rowKey}|{columnKey}". */
export function cellKey(rowKey: string, columnKey: string): string {
  return rowKey + "|" + columnKey;
}

/** A binding's key: "{route_id}|{step_uid}|{targetKey}" — the same group whatever row shows it. */
export function bindingKey(b: Pick<CellBinding, "route_id" | "step_uid" | "target">): string {
  return b.route_id + "|" + b.step_uid + "|" + targetKey(b.target);
}

/** The fields of a group in a config, [] when the step or the group does not exist. */
export function groupFieldsOf(cfg: RouteFieldsConfig | null | undefined, stepUid: StepUid, target: GroupTarget): Field[] {
  const step = cfg ? stepConfigOf(cfg, stepUid) : undefined;
  if (!step) return [];
  const key = targetKey(target);
  return step.groups.find((g) => targetKey(g.target) === key)?.fields ?? [];
}

/**
 * The config with the group `binding.target` of step `binding.step_uid` holding `fields`. A missing
 * step is created from `meta`; an emptied group is removed. Mutates and returns `cfg` (pass the copy
 * draftStore.edit hands out).
 */
export function setGroupFields(cfg: RouteFieldsConfig, binding: Pick<CellBinding, "step_uid" | "target">, meta: StepMeta, fields: Field[]): RouteFieldsConfig {
  const uid = binding.step_uid;
  const key = targetKey(binding.target);
  const existing = stepConfigOf(cfg, uid);
  const step: StepConfig = existing ?? {
    uid,
    station_type_id: meta.station_type_id,
    station_label: meta.station_label.slice(0, LIMITS.stationLabel),
    scope: meta.scope,
    groups: [],
  };
  const groups: FieldGroup[] = step.groups.filter((g) => targetKey(g.target) !== key);
  if (fields.length > 0) {
    const at = step.groups.findIndex((g) => targetKey(g.target) === key);
    const group: FieldGroup = { target: binding.target, fields };
    if (at >= 0) groups.splice(Math.min(at, groups.length), 0, group);
    else groups.push(group);
  }
  if (!existing && fields.length === 0) return cfg;
  // An emptied step is KEPT (groups []), never deleted: deleting it would make the diff report a
  // step removal instead of the removed fields, and the publish dialog would lose their
  // filled-in-N-tests warning. An empty step resolves to the fixed popup like an absent one.
  cfg.steps[uid] = { ...step, groups };
  return cfg;
}

/** The fields the worker sees on the same card ahead of the cell's own: each_item's, for a kit
 *  item's group at a package-level step (the order of validate.lintRouteFieldsConfig). */
export function alongsideFields(cfg: RouteFieldsConfig | null | undefined, binding: Pick<CellBinding, "step_uid" | "target">): Field[] {
  if (!cfg || typeof binding.target !== "object") return [];
  const step = stepConfigOf(cfg, binding.step_uid);
  if (!step || step.scope !== "package") return [];
  return groupFieldsOf(cfg, binding.step_uid, "each_item");
}

/** Every field id of a step, across its groups (field ids are unique per step — validate.ts). */
export function stepFieldIds(cfg: RouteFieldsConfig | null | undefined, stepUid: StepUid): Set<string> {
  const step = cfg ? stepConfigOf(cfg, stepUid) : undefined;
  const out = new Set<string>();
  for (const g of step?.groups ?? []) for (const f of g.fields) out.add(f.id);
  return out;
}
