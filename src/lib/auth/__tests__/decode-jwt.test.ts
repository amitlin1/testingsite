// Reading a token's claims (no signature check): base64url, UTF-8 claims, anything malformed → null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwtPayload } from "../decode-jwt";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: unknown) => `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.sig`;

test("the payload's claims, including non-ASCII (Hebrew) ones and base64url characters", () => {
  const claims = { preferred_username: "dana", name: "דנה כהן", realm_access: { roles: ["tester"] }, note: "??>>" };
  assert.deepEqual(decodeJwtPayload(jwt(claims)), claims);
});

test("not three parts, an empty payload, or a payload that is not JSON → null", () => {
  assert.equal(decodeJwtPayload("a.b"), null);
  assert.equal(decodeJwtPayload("a..c"), null);
  assert.equal(decodeJwtPayload(`x.${b64url("not json")}.y`), null);
  assert.equal(decodeJwtPayload(""), null);
});
