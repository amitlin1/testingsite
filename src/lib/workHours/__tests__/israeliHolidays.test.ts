import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getIsraeliHolidays,
  getIsraeliHolidayForDate,
  getIsraeliHolidayMap,
} from "../israeliHolidays";

// Ground truth captured empirically from @hebcal/core 6.x for Israel, 2026.
// (Verified stable across 2025–2028 during development.)

const FULL_OFF_2026 = [
  "2026-04-02", // Pesach I
  "2026-04-08", // Pesach VII
  "2026-04-22", // Yom HaAtzmaut
  "2026-05-22", // Shavuot
  "2026-09-12", // Rosh Hashana I
  "2026-09-13", // Rosh Hashana II
  "2026-09-21", // Yom Kippur
  "2026-09-26", // Sukkot I
  "2026-10-03", // Shmini Atzeret
];
const HALF_DAY_2026 = ["2026-04-14" /* Yom HaShoah */, "2026-04-21" /* Yom HaZikaron */];
const EVE_2026 = [
  "2026-04-01", // Erev Pesach
  "2026-05-21", // Erev Shavuot
  "2026-09-11", // Erev Rosh Hashana
  "2026-09-20", // Erev Yom Kippur
  "2026-09-25", // Erev Sukkot
];

test("2026 classification matches the empirical ground truth", () => {
  const map = getIsraeliHolidayMap("2026-01-01", "2026-12-31");

  assert.equal(map.size, FULL_OFF_2026.length + HALF_DAY_2026.length + EVE_2026.length, "16 total");

  for (const d of FULL_OFF_2026) assert.equal(map.get(d)?.category, "full_off", `${d} full_off`);
  for (const d of HALF_DAY_2026) assert.equal(map.get(d)?.category, "half_day", `${d} half_day`);
  for (const d of EVE_2026) assert.equal(map.get(d)?.category, "eve", `${d} eve`);
});

test("normal-economy days are NOT classified as holidays", () => {
  const notHolidays = [
    "2026-03-03", // Purim
    "2026-05-05", // Lag BaOmer
    "2026-05-15", // Yom Yerushalayim
    "2026-04-03", // Pesach II (Chol HaMoed)
    "2026-07-23", // Tish'a B'Av
    "2026-12-07", // Chanukah
  ];
  for (const d of notHolidays) assert.equal(getIsraeliHolidayForDate(d), null, `${d} not a holiday`);
});

test("labels are clean Hebrew with the Hebrew year stripped", () => {
  assert.equal(getIsraeliHolidayForDate("2026-09-12")?.label, "ראש השנה"); // no "5787"
  assert.equal(getIsraeliHolidayForDate("2026-04-01")?.label, "ערב פסח");
  assert.equal(getIsraeliHolidayForDate("2026-04-21")?.label, "יום הזכרון");
  assert.equal(getIsraeliHolidayForDate("2026-04-22")?.label, "יום העצמאות");
  assert.match(getIsraeliHolidayForDate("2026-09-12")?.label ?? "", /^[^0-9]+$/); // never a digit
});

test("range query spans a year boundary", () => {
  // Erev RH is the first classified day of Hebrew year cycles; test a cross-year window.
  const list = getIsraeliHolidays("2026-12-01", "2027-05-31");
  // Yom HaShoah 2027 (2027-05-04) and Yom HaZikaron 2027 (2027-05-11) must appear.
  assert.ok(list.some((h) => h.date === "2027-05-04" && h.category === "half_day"));
  assert.ok(list.some((h) => h.date === "2027-05-11" && h.category === "half_day"));
  // Every returned date is inside the window and ascending.
  const dates = list.map((h) => h.date);
  assert.deepEqual(dates, [...dates].sort());
  for (const d of dates) assert.ok(d >= "2026-12-01" && d <= "2027-05-31");
});
