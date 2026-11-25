import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentTypeFromName,
  encodeKeyPath,
  extOf,
  fileKind,
  isImage,
  isOfficeEditable,
  isTextEditable,
  officeDocTypeOf,
} from "../file-types";

test("the extension is the last one, lower-case; none without a dot", () => {
  assert.equal(extOf("items/5/a.b/Report.PDF"), "pdf");
  assert.equal(extOf("README"), "");
  assert.equal(fileKind("scan.JPG"), "image");
  assert.equal(fileKind("data.csv"), "sheet");
  assert.equal(fileKind("archive.tar.gz"), "archive");
  assert.equal(fileKind("x.constructor"), "other");
  assert.equal(isImage("logo.svg"), true);
});

test("a text file goes to the text editor, an office document to OnlyOffice, a pdf to neither", () => {
  assert.equal(isTextEditable("notes.txt"), true, "txt goes to the text editor");
  assert.equal(officeDocTypeOf("notes.txt"), "word", "though OnlyOffice would open it");
  assert.equal(isOfficeEditable("notes.txt"), false, "so the panel does not send it there");
  assert.equal(isOfficeEditable("sheet.xlsx"), true);
  assert.equal(isOfficeEditable("x.pdf"), false);
  assert.equal(officeDocTypeOf("x.constructor"), null);
});

test("content type by name, svg included; anything unknown is octet-stream", () => {
  assert.equal(contentTypeFromName("a.svg"), "image/svg+xml");
  assert.equal(contentTypeFromName("a.JPEG"), "image/jpeg");
  assert.equal(contentTypeFromName("a.bin"), "application/octet-stream");
  assert.equal(contentTypeFromName("noext"), "application/octet-stream");
});

test("a key's segments are encoded, its slashes kept", () => {
  assert.equal(encodeKeyPath("items/5/דוח #1.pdf"), "items/5/%D7%93%D7%95%D7%97%20%231.pdf");
});
