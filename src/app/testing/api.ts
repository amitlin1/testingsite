import { getArray, getJson, sendJson } from "@/lib/api/client";
import { newActionId } from "@/lib/action-id";
import type { PackageView } from "@/app/lib/packages/contract";
import type {
  CompletedTodayAnswer,
  LocateAnswer,
  QueueRow,
  ResultAnswer,
  ResultBody,
  StationHistoryRow,
  StartReleaseBody,
  StepBackAnswer,
  StepBackBody,
  TestStationType,
} from "@/app/lib/testing/contract";

/**
 * The testing screen's calls to /api/testing/* (the queue, start / release, results, step back,
 * locate): the screen, the station popups and the package wizards. Every failure is an ApiError
 * (`status`, the server's `error` as the message, and its body — a station-field refusal carries
 * `body.code`); what the worker reads of it is failureText's rule. The popups' own reads
 * (station-fields, reference lookups) sit with their hooks.
 */

/** Who acts: snapshotted onto every ledger event (Keycloak users get deleted, so a bare id
 *  becomes unresolvable for old events — §3.3). */
export type Actor = { workerId: number | null; workerName: string };

const actorBody = ({ workerId, workerName }: Actor) => ({
  workerId: workerId ?? undefined,
  workerName: workerName || undefined,
});

/** POST /api/testing/results. The body goes as given (its field names are the route's). */
export function postResult(body: ResultBody): Promise<ResultAnswer> {
  return sendJson<ResultAnswer>("/api/testing/results", "POST", body);
}

/** POST /api/testing/start-test: the item (a box: with its items) is in test at the station.
 *  One action id per click: a retry of the same call is a ledger no-op (§4.4). */
export async function startTest(itemId: number, stationId: number, actor: Actor): Promise<void> {
  const body: StartReleaseBody = { itemId, stationId, actionUuid: newActionId(), ...actorBody(actor) };
  await sendJson("/api/testing/start-test", "POST", body);
}

/** POST /api/testing/release-test: back to waiting, for a test window closed without a result. */
export async function releaseTest(itemId: number, stationId: number, actor: Actor): Promise<void> {
  const body: StartReleaseBody = { itemId, stationId, actionUuid: newActionId(), ...actorBody(actor) };
  await sendJson("/api/testing/release-test", "POST", body);
}

/** POST /api/testing/step-back. */
export function stepBack(itemId: string, currentRouteStep: number, reason: string, actor: Actor): Promise<StepBackAnswer> {
  const body: StepBackBody = { itemId, currentRouteStep, reason, ...actorBody(actor), actionId: newActionId() };
  return sendJson<StepBackAnswer>("/api/testing/step-back", "POST", body);
}

/** GET /api/testing/locate-by-barcode: where a scanned label's item is (or that it finished). */
export function locate(barcode: string): Promise<LocateAnswer> {
  return getJson<LocateAnswer>(`/api/testing/locate-by-barcode?barcode=${encodeURIComponent(barcode)}`);
}

export const loadStationTypes = () => getArray<TestStationType>("/api/testing/stations");
export const loadQueue = (stationId: number) => getArray<QueueRow>(`/api/testing/items?stationId=${stationId}`);
export const loadBlockedPackages = (stationId: number) => getArray<PackageView>(`/api/testing/blocked-packages?stationId=${stationId}`);
export const loadStationHistory = (stationId: number) => getArray<StationHistoryRow>(`/api/testing/station-history?stationId=${stationId}`);

/** Results at the station since `since`. */
export async function loadCompletedSince(stationId: number, since: Date): Promise<number> {
  return (await getJson<CompletedTodayAnswer>(`/api/testing/completed-today?stationId=${stationId}&since=${encodeURIComponent(since.toISOString())}`)).count;
}

