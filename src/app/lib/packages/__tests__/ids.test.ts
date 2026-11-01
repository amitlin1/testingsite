// The box / item id: 15 digits from the customer's code (CCC ddMMyy NNNN SS),
// and the 16-digit ids minted before it ("1" + customer id + the same tail),
// which every reader still takes as new-format.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseOfId,
  displayPackageIdOf,
  displaySeqOf,
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
  assert.equal(displayPackageIdOf(BigInt("323011126000102")), BigInt("323011126000100"));
  assert.equal(displaySeqOf(BigInt("323011126000102")), 2);
  assert.equal(displaySeqOf("1005291026002001"), 1);
});

test("mintOrderKey: both widths sort by date and counter together, legacy first", () => {
  const ids = ["701011126000300", "1005291026002000", "323011126000100", "12345678", "1004311026000500"];
  const sorted = [...ids].sort((a, b) => mintOrderKey(a).localeCompare(mintOrderKey(b)));
  assert.deepEqual(sorted, ["12345678", "1005291026002000", "1004311026000500", "323011126000100", "701011126000300"]);
});
