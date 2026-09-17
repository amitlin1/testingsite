import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFileManagerKey,
  buildItemObjectKey,
  buildReferenceObjectKey,
  contentTypeOf,
  isReferenceObjectKey,
  isValidFileManagerName,
  keyBelongsToItem,
  MAX_UPLOAD_BATCH,
  normalizeFolderPath,
  parseUploadDescriptors,
  sanitizeFilename,
} from "../shared";

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

test("item keys are namespaced per item and sanitised", () => {
  const key = buildItemObjectKey("42", 'my photo:1?.jpg', "0000-uuid");
  assert.equal(key, "items/42/0000-uuid_my_photo_1_.jpg");
  assert.equal(sanitizeFilename("a b\\c/d"), "a_b_c_d");
  assert.equal(keyBelongsToItem(key, "42"), true);
  assert.equal(keyBelongsToItem(key, "4"), false);
  assert.equal(keyBelongsToItem("items/42/../41/x", "42"), false);
});

test("file-manager folder paths are normalised and traversal is refused", () => {
  assert.deepEqual(normalizeFolderPath(""), { ok: true, path: "" });
  assert.deepEqual(normalizeFolderPath(undefined), { ok: true, path: "" });
  assert.deepEqual(normalizeFolderPath("docs"), { ok: true, path: "docs/" });
  assert.deepEqual(normalizeFolderPath("/docs/2026/"), { ok: true, path: "docs/2026/" });
  assert.deepEqual(normalizeFolderPath("docs\\sub"), { ok: true, path: "docs/sub/" });
  assert.equal(normalizeFolderPath("docs/../etc/").ok, false);
  assert.equal(normalizeFolderPath(12).ok, false);
  assert.equal(buildFileManagerKey("docs/", "r.pdf"), "docs/r.pdf");
});

test("file-manager names must be a single segment", () => {
  assert.equal(isValidFileManagerName("report.pdf"), true);
  assert.equal(isValidFileManagerName("a/b.pdf"), false);
  assert.equal(isValidFileManagerName("a\\b.pdf"), false);
  assert.equal(isValidFileManagerName(".."), false);
  assert.equal(isValidFileManagerName("  "), false);
});

test("reference-image keys land under the item, or under 'new' before it exists", () => {
  assert.equal(
    buildReferenceObjectKey(7, "Front View.PNG", "abcdefgh-rest", 1700000000000),
    "reference-items/7/1700000000000-abcdefgh-Front_View.PNG",
  );
  assert.equal(
    buildReferenceObjectKey(null, "x.jpg", "12345678-rest", 1),
    "reference-items/new/1-12345678-x.jpg",
  );
  assert.equal(isReferenceObjectKey("reference-items/new/1-x.jpg"), true);
  assert.equal(isReferenceObjectKey("items/1/x.jpg"), false);
  assert.equal(isReferenceObjectKey("reference-items/../x.jpg"), false);
});
