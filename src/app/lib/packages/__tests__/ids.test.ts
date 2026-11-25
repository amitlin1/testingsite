// The box / item id: 15 digits from the customer's code (CCC ddMMyy NNNN SS),
// and the 16-digit ids minted before it ("1" + customer id + the same tail),
// which every reader still takes as new-format.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barcodeOf,
  baseOfId,
  boxLabelKind,
  formatId,
  formatIdText,
  idOfLabel,
  scannedLabelId,
  seq2,
  idCustomerCode,
  isNewFormatId,
  itemIdFromBase,
  mintOrderKey,
  packageIdBase,
  packageIdFromBase,
} from "../ids";

test("packageIdBase: the customer's code, the date, the day's counter", () => {
  const base = packageIdBase("323", "011126", 1);
  assert.equal(base, "3230111260001");
  assert.equal(packageIdFromBase(base), BigInt("323011126000100"));
  assert.equal(itemIdFromBase(base, 2), BigInt("323011126000102"));
});

test("idCustomerCode: three digits, the first not 0", () => {
  assert.equal(idCustomerCode("323"), "323");
  assert.equal(idCustomerCode(" 701 "), "701");
  for (const bad of ["1", "12", "012", "1234", "32a", "", null, undefined]) {
    assert.equal(idCustomerCode(bad), null, String(bad));
  }
  assert.throws(() => packageIdBase("12", "011126", 1), RangeError);
});

test("isNewFormatId / baseOfId: today's 15 digits and the previous 16", () => {
  assert.ok(isNewFormatId(BigInt("323011126000100")));
  assert.ok(isNewFormatId("1005291026002001"));
  assert.ok(!isNewFormatId(12345678));
  assert.ok(!isNewFormatId("2005291026002001"));
  assert.equal(baseOfId(BigInt("323011126000102")), "3230111260001");
  assert.equal(baseOfId("1005291026002001"), "10052910260020");
});

test("mintOrderKey: both widths sort by date and counter together, legacy first", () => {
  const ids = ["701011126000300", "1005291026002000", "323011126000100", "12345678", "1004311026000500"];
  const sorted = [...ids].sort((a, b) => mintOrderKey(a).localeCompare(mintOrderKey(b)));
  assert.deepEqual(sorted, ["12345678", "1005291026002000", "1004311026000500", "323011126000100", "701011126000300"]);
});

test("mintOrderKey: minting order, not the id's own order (ddMMyy, customer first)", () => {
  const oct31 = "1007311026000500"; // 31/10/26, counter 5
  const nov1 = "1007011126000100"; // 01/11/26, counter 1
  assert.ok(BigInt(nov1) < BigInt(oct31), "the id alone puts November first");
  assert.ok(mintOrderKey(nov1) > mintOrderKey(oct31), "minting order puts it last");
  assert.ok(mintOrderKey("1007311026000600") > mintOrderKey(oct31), "same day: by the counter");
});

test("formatId: the head apart from the position, for both widths; a legacy id has no position", () => {
  assert.deepEqual(formatId("323011126000100"), { head: "323 011126 0001", suffix: "00" });
  assert.deepEqual(formatId(BigInt("323011126000102")), { head: "323 011126 0001", suffix: "02" });
  assert.deepEqual(formatId("1005150926000300"), { head: "1005 1509 2600 03", suffix: "00" });
  assert.deepEqual(formatId(12345678), { head: "1234 5678", suffix: "" });
  assert.equal(formatIdText("323011126000100"), "323 011126 0001 00");
  assert.equal(formatIdText(123), "123");
});

test("seq2 and barcodeOf: two-digit positions; the label carries the id alone", () => {
  assert.equal(seq2(1), "01");
  assert.equal(seq2(12), "12");
  assert.equal(seq2(null), "—");
  assert.equal(barcodeOf(BigInt("323011126000100")), "323011126000100");
});

test("idOfLabel: the id, with an older label's -sourceId read past", () => {
  assert.equal(idOfLabel("323011126000102-3"), BigInt("323011126000102"));
  assert.equal(idOfLabel("323011126000102-"), BigInt("323011126000102"));
  assert.equal(idOfLabel("not a label"), null);
  assert.equal(idOfLabel("1.5"), null);
});

test("idOfLabel: every digit kept past 2^53, and nothing that names no row", () => {
  assert.equal(idOfLabel("9007199254740993"), BigInt("9007199254740993"));
  assert.equal(idOfLabel("9223372036854775807"), BigInt("9223372036854775807"));
  for (const raw of ["", "0", "-5", " 12", "12 ", "1e3", "12-a", "9223372036854775808", "12345678901234567890"]) {
    assert.equal(idOfLabel(raw), null, JSON.stringify(raw));
  }
});

test("scannedLabelId: a label of six digits or more, with or without its source", () => {
  assert.equal(scannedLabelId(" 323011126000100-2 "), "323011126000100");
  assert.equal(scannedLabelId("12345"), null);
  assert.equal(scannedLabelId("SH-2041"), null);
});

test("boxLabelKind: a box at position 00, an item elsewhere, anything else is no box label", () => {
  assert.equal(boxLabelKind("323011126000100"), "box");
  assert.equal(boxLabelKind("1005150926000300-4"), "box");
  assert.equal(boxLabelKind("323011126000101"), "item");
  assert.equal(boxLabelKind("12345678"), null);
  assert.equal(boxLabelKind("SH-2041"), null);
});
