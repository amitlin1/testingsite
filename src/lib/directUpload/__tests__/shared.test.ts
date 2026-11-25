import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeOf, MAX_UPLOAD_BATCH, parseUploadDescriptors } from "../shared";

const MB = 1024 * 1024;

test("parseUploadDescriptors accepts a well-formed batch and normalises empty types", () => {
  const r = parseUploadDescriptors(
    [{ name: "a.jpg", type: "image/jpeg", size: 10 }, { name: "b.bin", type: "", size: 0 }],
    100 * MB,
    100,
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.files, [
      { name: "a.jpg", type: "image/jpeg", size: 10 },
      { name: "b.bin", type: null, size: 0 },
    ]);
  }
});

test("parseUploadDescriptors refuses empty, oversize, nameless and malformed entries", () => {
  assert.deepEqual(parseUploadDescriptors([], 100 * MB, 100), { ok: false, error: "לא נבחרו קבצים" });
  assert.deepEqual(parseUploadDescriptors(undefined, 100 * MB, 100), { ok: false, error: "לא נבחרו קבצים" });

  const big = parseUploadDescriptors([{ name: "huge.mov", size: 101 * MB }], 100 * MB, 100);
  assert.deepEqual(big, { ok: false, error: "הקובץ huge.mov חורג מהגודל המרבי (100MB)" });

  assert.equal(parseUploadDescriptors([{ name: "", size: 1 }], 100 * MB, 100).ok, false);
  assert.equal(parseUploadDescriptors([{ name: "x", size: -1 }], 100 * MB, 100).ok, false);
  assert.equal(parseUploadDescriptors([{ name: "x", size: "12" }], 100 * MB, 100).ok, false);
  assert.equal(parseUploadDescriptors(["nope"], 100 * MB, 100).ok, false);

  const tooMany = Array.from({ length: MAX_UPLOAD_BATCH + 1 }, (_, i) => ({ name: `f${i}`, size: 1 }));
  assert.equal(parseUploadDescriptors(tooMany, 100 * MB, 100).ok, false);
});

test("contentTypeOf falls back to octet-stream", () => {
  assert.equal(contentTypeOf({ type: "image/png" }), "image/png");
  assert.equal(contentTypeOf({ type: "" }), "application/octet-stream");
  assert.equal(contentTypeOf({ type: null }), "application/octet-stream");
});
