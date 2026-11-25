// Who acts on a testing-station write: each route's own body field names, one reading rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "@/lib/http/errors";
import { UUID_RE, parseActor } from "../actor";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

test("a UUID action id is the client's, read from each route's own field", () => {
  assert.deepEqual(parseActor({ WorkerID: 42, WorkerName: "דנה", SubmitID: ID }, "results"),
    { workerId: 42, workerName: "דנה", actionId: ID, fromClient: true });
  assert.deepEqual(parseActor({ workerId: 42, workerName: "דנה", actionUuid: ID }, "startRelease"),
    { workerId: 42, workerName: "דנה", actionId: ID, fromClient: true });
  assert.equal(parseActor({ actionId: ID }, "stepBack").actionId, ID);
});

test("a missing action id is minted, and is not the client's", () => {
  for (const [body, route] of [[{ WorkerID: 42 }, "results"], [{}, "startRelease"], [{}, "stepBack"]] as const) {
    const a = parseActor(body, route);
    assert.equal(a.fromClient, false);
    assert.match(a.actionId, UUID_RE);
  }
});

test("an action id that is not a UUID is a 400 on every route", () => {
  for (const [field, route] of [["SubmitID", "results"], ["actionUuid", "startRelease"], ["actionId", "stepBack"]] as const) {
    for (const bad of ["nope", null, 7, ""]) {
      assert.throws(() => parseActor({ [field]: bad }, route), (e: unknown) =>
        e instanceof HttpError && e.status === 400 && e.message === `${field} must be a UUID`);
    }
  }
});

test("worker fields of another type are dropped", () => {
  const a = parseActor({ workerId: "42", workerName: "" }, "startRelease");
  assert.equal(a.workerId, null);
  assert.equal(a.workerName, null);
  assert.equal(parseActor({ WorkerID: "42", WorkerName: "" }, "results").workerId, null);
});
