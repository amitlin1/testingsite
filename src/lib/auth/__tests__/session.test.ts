// What "signed in" means, and the rotated-session-cookie forwarding the middleware relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";
import {
  TERMINAL_SESSION_ERROR,
  forwardRotatedSessionCookie,
  isDevAuthBypass,
  isLiveSession,
  isSessionCookieName,
  parseCookiePair,
} from "../session";

const session = (extra: Partial<Session> = {}) =>
  ({ user: { preferredUsername: "dana" }, roles: [], expires: "", ...extra }) as Session;

test("a session is live while it has a user and its refresh has not failed for good", () => {
  assert.equal(isLiveSession(session()), true);
  assert.equal(isLiveSession(session({ error: TERMINAL_SESSION_ERROR })), false);
  assert.equal(isLiveSession(null), false);
  assert.equal(isLiveSession(undefined), false);
  assert.equal(isLiveSession({ expires: "" } as unknown as Session), false);
});

test("the Keycloak bypass is on only for IS_DEV=1 outside a production build", () => {
  assert.equal(isDevAuthBypass({ IS_DEV: "1", NODE_ENV: "development" }), true);
  assert.equal(isDevAuthBypass({ IS_DEV: "1", NODE_ENV: "production" }), false);
  assert.equal(isDevAuthBypass({ NODE_ENV: "development" }), false);
  assert.equal(isDevAuthBypass({ IS_DEV: "true", NODE_ENV: "development" }), false);
});

test("the session cookie family: the plain and __Secure- names and their chunks, nothing else", () => {
  for (const name of ["authjs.session-token", "authjs.session-token.0", "__Secure-authjs.session-token.1"]) {
    assert.equal(isSessionCookieName(name), true, name);
  }
  for (const name of ["authjs.csrf-token", "authjs.session-tokenX", "other", "authjs.pkce.code_verifier"]) {
    assert.equal(isSessionCookieName(name), false, name);
  }
});

test("a Set-Cookie header's name and value", () => {
  assert.deepEqual(parseCookiePair("authjs.session-token=abc.def; Path=/; HttpOnly"), { name: "authjs.session-token", value: "abc.def" });
  assert.deepEqual(parseCookiePair("a=b=c"), { name: "a", value: "b=c" });
  assert.equal(parseCookiePair("no-equals-sign; Path=/"), null);
});

test("forwarding swaps the whole session family for the rotated one and keeps the other cookies", () => {
  const original = "theme=dark; authjs.session-token.0=old0; authjs.session-token.1=old1; lang=he";
  const out = forwardRotatedSessionCookie(original, [
    "authjs.session-token=new; Path=/; HttpOnly",
    "unrelated=x; Path=/",
  ]);
  assert.equal(out, "theme=dark; lang=he; authjs.session-token=new");
});

test("a rotation that clears the cookie (empty value) leaves no session cookie downstream", () => {
  assert.equal(forwardRotatedSessionCookie("authjs.session-token=old; a=1", ["authjs.session-token=; Max-Age=0"]), "a=1");
});
