import { getWorkersDirectory } from "@/lib/keycloak-admin";

/**
 * Worker names by worker id, for history rows that store only the id (a Keycloak employeeNumber —
 * there is no local workers table). Without the directory (Keycloak down) the names stay blank:
 * an empty map, the failure logged under `what`.
 */
export async function loadWorkerNames(what: string): Promise<Map<number, string>> {
  try {
    return new Map((await getWorkersDirectory()).map((w) => [w.worker_id, w.worker_name]));
  } catch (e) {
    console.error(`${what}: the workers directory failed:`, e);
    return new Map();
  }
}
