import { randomUUID } from "crypto";
import { HttpError } from "@/lib/http/errors";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who acts, and the action it is: snapshotted onto every ledger event of the request. The worker's
 * name travels with the id because the worker directory lives in Keycloak and its users get
 * deleted, so a bare id becomes unresolvable for old events (§3.3). The action id is one per human
 * action (a click, a wizard finish), shared by every event the request writes (§4.4).
 */
export type Actor = {
  workerId: number | null;
  workerName: string | null;
  actionId: string;
  /** The action id is the client's. Only such an id can recognise a retry: a minted one is new
   *  every request. */
  fromClient: boolean;
};

/** Each route's body field names (the wire's; one reading rule for all of them). */
const FIELDS = {
  /** POST /api/testing/results. */
  results: { workerId: "WorkerID", workerName: "WorkerName", actionId: "SubmitID" },
  /** POST /api/testing/start-test and release-test. */
  startRelease: { workerId: "workerId", workerName: "workerName", actionId: "actionUuid" },
  /** POST /api/testing/step-back. */
  stepBack: { workerId: "workerId", workerName: "workerName", actionId: "actionId" },
} as const;

export type ActorRoute = keyof typeof FIELDS;

/**
 * The actor of a request body. The worker fields are taken when typed (a number, a non-empty name),
 * else null. The action id: a UUID is the client's; a missing one is minted (that request loses
 * retry idempotency); anything else is a client bug, refused loudly rather than silently given a
 * new identity.
 */
export function parseActor(body: Record<string, unknown>, route: ActorRoute): Actor {
  const fields = FIELDS[route];
  const id = body[fields.workerId];
  const name = body[fields.workerName];
  const worker = { workerId: typeof id === "number" ? id : null, workerName: typeof name === "string" && name ? name : null };

  const action = body[fields.actionId];
  if (action === undefined) return { ...worker, actionId: randomUUID(), fromClient: false };
  if (typeof action !== "string" || !UUID_RE.test(action)) {
    throw new HttpError(400, `${fields.actionId} must be a UUID`);
  }
  return { ...worker, actionId: action, fromClient: true };
}
