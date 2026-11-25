import { test } from "node:test";
import assert from "node:assert/strict";
import { FileManagerKeys, ItemKeys, ReferenceKeys, ReportKeys, sanitizeFilename } from "../keys";

test("item keys are namespaced per item and sanitised", () => {
  const key = ItemKeys.build("42", 'my photo:1?.jpg', "0000-uuid");
  assert.equal(key, "items/42/0000-uuid_my_photo_1_.jpg");
  assert.equal(sanitizeFilename("a b\\c/d"), "a_b_c_d");
  assert.equal(ItemKeys.belongs(key, "42"), true);
  assert.equal(ItemKeys.belongs(key, "4"), false);
  assert.equal(ItemKeys.belongs("items/42/../41/x", "42"), false);
  assert.equal(ItemKeys.itemIdOf(key), "42");
  assert.equal(ItemKeys.itemIdOf("items/x/a.txt"), null);
  assert.equal(ItemKeys.itemIdOf("items/42/../41/a.txt"), null);
  assert.equal(ItemKeys.itemIdOf("reports/items/42/v1.pdf"), null);
});

test("report keys: one PDF per version, logos only under their prefix", () => {
  assert.equal(ReportKeys.pdf(BigInt(7), 2), "reports/items/7/v2.pdf");
  assert.match(ReportKeys.signature(BigInt(7)), /^reports\/items\/7\/signature-[0-9a-f-]{36}\.png$/);
  const logo = ReportKeys.logo("svg");
  assert.match(logo, /^reports\/logos\/[0-9a-f-]{36}\.svg$/);
  assert.equal(ReportKeys.isLogo(logo), true);
  assert.equal(ReportKeys.isLogo("reports/logos/../items/7/v2.pdf"), false);
  assert.equal(ReportKeys.isLogo("items/7/a.png"), false);
});

test("file-manager folder paths are normalised and traversal is refused", () => {
  const { normalizeFolder } = FileManagerKeys;
  assert.deepEqual(normalizeFolder(""), { ok: true, path: "" });
  assert.deepEqual(normalizeFolder(undefined), { ok: true, path: "" });
  assert.deepEqual(normalizeFolder("docs"), { ok: true, path: "docs/" });
  assert.deepEqual(normalizeFolder("/docs/2026/"), { ok: true, path: "docs/2026/" });
  assert.deepEqual(normalizeFolder("docs\\sub"), { ok: true, path: "docs/sub/" });
  assert.equal(normalizeFolder("docs/../etc/").ok, false);
  assert.equal(normalizeFolder(12).ok, false);
  assert.equal(FileManagerKeys.build("docs/", "r.pdf"), "docs/r.pdf");
});

test("file-manager names must be a single segment", () => {
  assert.equal(FileManagerKeys.validName("report.pdf"), true);
  assert.equal(FileManagerKeys.validName("a/b.pdf"), false);
  assert.equal(FileManagerKeys.validName("a\\b.pdf"), false);
  assert.equal(FileManagerKeys.validName(".."), false);
  assert.equal(FileManagerKeys.validName("  "), false);
});

test("a renamed entry stays in its folder; a folder keeps its trailing slash", () => {
  assert.equal(FileManagerKeys.renamed("docs/a.pdf", false, "b.pdf"), "docs/b.pdf");
  assert.equal(FileManagerKeys.renamed("a.pdf", false, "b.pdf"), "b.pdf");
  assert.equal(FileManagerKeys.renamed("docs/old/", true, "new"), "docs/new/");
  assert.equal(FileManagerKeys.renamed("old/", true, "new"), "new/");
});

test("reference-image keys land under the item, or under 'new' before it exists", () => {
  assert.equal(
    ReferenceKeys.build(7, "Front View.PNG", "abcdefgh-rest", 1700000000000),
    "reference-items/7/1700000000000-abcdefgh-Front_View.PNG",
  );
  assert.equal(
    ReferenceKeys.build(null, "x.jpg", "12345678-rest", 1),
    "reference-items/new/1-12345678-x.jpg",
  );
  assert.equal(ReferenceKeys.is("reference-items/new/1-x.jpg"), true);
  assert.equal(ReferenceKeys.is("items/1/x.jpg"), false);
  assert.equal(ReferenceKeys.is("reference-items/../x.jpg"), false);
});
