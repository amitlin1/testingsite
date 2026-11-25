import { before, test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

// jwt.ts reads the secret when it is first imported.
process.env.ONLYOFFICE_JWT_SECRET = "suite-secret";
let T: typeof import("../tokens");
before(async () => {
  T = await import("../tokens");
});

const sign = (payload: Record<string, unknown>, secret = "suite-secret") =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(secret));
const post = (headers: Record<string, string> = {}) => new Request("http://app/api/onlyoffice/callback/items/1/a.docx", { method: "POST", headers });

test("a download token opens its own key only", async () => {
  const token = await T.signDownloadToken("items/1/a.docx");
  assert.equal(await T.verifyDownloadToken(token, "items/1/a.docx"), true);
  assert.equal(await T.verifyDownloadToken(token, "items/2/a.docx"), false);
  assert.equal(await T.verifyDownloadToken(null, "items/1/a.docx"), false);
  assert.equal(await T.verifyDownloadToken(await sign({ key: "items/1/a.docx", purpose: "download" }, "other"), "items/1/a.docx"), false);
  assert.equal(await T.verifyDownloadToken(await sign({ key: "items/1/a.docx", purpose: "edit" }), "items/1/a.docx"), false);
});

test("a callback body: the token's payload when it verifies, in the body or the Authorization header", async () => {
  const inline = await T.verifyCallback(post(), { status: 1, token: await sign({ status: 2, url: "http://oo/x" }) });
  assert.deepEqual([inline.signed, inline.verified?.status], [true, 2]);
  const header = await T.verifyCallback(post({ authorization: `Bearer ${await sign({ payload: { status: 6 } })}` }), { status: 1 });
  assert.deepEqual([header.signed, header.verified?.status], [true, 6]);
});

test("a callback body that is not signed, or not by us, does not verify", async () => {
  assert.deepEqual(await T.verifyCallback(post(), { status: 2 }), { verified: null, signed: false });
  const forged = await T.verifyCallback(post(), { status: 2, token: await sign({ status: 2 }, "other") });
  assert.deepEqual(forged, { verified: null, signed: true });
});
