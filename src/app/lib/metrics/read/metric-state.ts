import type { MetricsClient } from "./sql";

export interface MetricStateInfo {
  legacyStatusId: number | null;
  labelHe: string;
}

/**
 * metric_state, keyed by state_key: the Hebrew labels (§5.10) and the legacy
 * numeric status the status charts still key their colours off. Read from the
 * table, never retyped — a state added to the vocabulary needs no second edit.
 *
 * Cached for the life of the process: metric_state is seed data written by the
 * migrations. A failed load is not cached.
 */
let cache: Promise<Record<string, MetricStateInfo>> | null = null;

export function metricStates(client: MetricsClient): Promise<Record<string, MetricStateInfo>> {
  if (!cache) {
    cache = client
      .$queryRawUnsafe<Array<{ state_key: string; legacy_status_id: number | null; label_he: string }>>(
        "SELECT state_key, legacy_status_id, label_he FROM metric_state",
      )
      .then((rows) =>
        Object.fromEntries(
          (rows ?? []).map((r) => [
            String(r.state_key),
            {
              legacyStatusId: r.legacy_status_id == null ? null : Number(r.legacy_status_id),
              labelHe: String(r.label_he),
            },
          ]),
        ),
      )
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

/** The legacy status id as a string, or the state key itself for a state that has none (`unmapped`). */
export function legacyStatusOf(map: Record<string, MetricStateInfo>, stateKey: string): string {
  const id = map[stateKey]?.legacyStatusId;
  return id == null ? stateKey : String(id);
}

export function labelOf(map: Record<string, MetricStateInfo>, stateKey: string): string {
  return map[stateKey]?.labelHe ?? stateKey;
}
