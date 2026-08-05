import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOverride, validateWeekdayDefault, validateHoliday } from "../validate";
import {
  ERR_END_BEFORE_START,
  ERR_EVE_ONLY,
  ERR_FRIDAY_ONLY,
  ERR_HALF_DAY_MAX,
  ERR_HOLIDAY_RANGE,
  ERR_LOCKED_DAY,
  type IsraeliHolidayInfo,
  type WorkdayOverrideInput,
} from "../types";

const eve: IsraeliHolidayInfo = { date: "2026-09-20", category: "eve", label: "ערב יום כיפור", desc: "Erev Yom Kippur" };
const full: IsraeliHolidayInfo = { date: "2026-04-22", category: "full_off", label: "יום העצמאות", desc: "Yom HaAtzma'ut" };

function ov(o: Partial<WorkdayOverrideInput> & { kind: WorkdayOverrideInput["kind"]; date: string }): WorkdayOverrideInput {
  return { start: null, end: null, breakStart: null, breakEnd: null, note: null, ...o };
}

test("vacation is always valid on a non-locked day", () => {
  assert.deepEqual(validateOverride(ov({ date: "2026-09-15", kind: "vacation" }), { weekday: 2, israeli: null }), { ok: true });
});

test("no override may be entered on a full holiday or on Shabbat", () => {
  assert.deepEqual(validateOverride(ov({ date: "2026-04-22", kind: "vacation" }), { weekday: 3, israeli: full }), { ok: false, error: ERR_LOCKED_DAY });
  assert.deepEqual(validateOverride(ov({ date: "2026-09-12", kind: "vacation" }), { weekday: 6, israeli: null }), { ok: false, error: ERR_LOCKED_DAY });
});

test("short_hours requires end strictly after start", () => {
  assert.deepEqual(validateOverride(ov({ date: "2026-09-15", kind: "short_hours", start: "10:00", end: "08:00" }), { weekday: 2, israeli: null }), { ok: false, error: ERR_END_BEFORE_START });
  assert.equal(validateOverride(ov({ date: "2026-09-15", kind: "short_hours", start: "07:00", end: "10:00" }), { weekday: 2, israeli: null }).ok, true);
});

test("friday_work only on a Friday and only until 12:00", () => {
  assert.deepEqual(validateOverride(ov({ date: "2026-09-15", kind: "friday_work", start: "07:00", end: "12:00" }), { weekday: 2, israeli: null }), { ok: false, error: ERR_FRIDAY_ONLY });
  assert.deepEqual(validateOverride(ov({ date: "2026-09-18", kind: "friday_work", start: "07:00", end: "13:00" }), { weekday: 5, israeli: null }), { ok: false, error: ERR_HALF_DAY_MAX });
  assert.equal(validateOverride(ov({ date: "2026-09-18", kind: "friday_work", start: "07:00", end: "12:00" }), { weekday: 5, israeli: null }).ok, true);
});

test("eve_work only on an erev chag and only until 12:00", () => {
  assert.deepEqual(validateOverride(ov({ date: "2026-09-15", kind: "eve_work", start: "07:00", end: "12:00" }), { weekday: 2, israeli: null }), { ok: false, error: ERR_EVE_ONLY });
  assert.deepEqual(validateOverride(ov({ date: "2026-09-20", kind: "eve_work", start: "07:00", end: "12:30" }), { weekday: 0, israeli: eve }), { ok: false, error: ERR_HALF_DAY_MAX });
  assert.equal(validateOverride(ov({ date: "2026-09-20", kind: "eve_work", start: "07:00", end: "12:00" }), { weekday: 0, israeli: eve }).ok, true);
});

test("weekday default: Saturday can never be opened; Friday capped at 12:00", () => {
  assert.equal(validateWeekdayDefault({ weekday: 6, isWorking: true, start: "07:00", end: "12:00", breakStart: null, breakEnd: null }).ok, false);
  assert.deepEqual(
    validateWeekdayDefault({ weekday: 5, isWorking: true, start: "07:00", end: "14:00", breakStart: null, breakEnd: null }),
    { ok: false, error: ERR_HALF_DAY_MAX },
  );
  assert.equal(validateWeekdayDefault({ weekday: 1, isWorking: true, start: "07:00", end: "15:35", breakStart: "12:00", breakEnd: "13:00" }).ok, true);
});

test("holiday range validation", () => {
  assert.deepEqual(
    validateHoliday({ name: "גיבוש", typeId: 3, startDate: "2026-09-20", endDate: "2026-09-19", isHalfDay: false, halfDayEndTime: null, note: null }),
    { ok: false, error: ERR_HOLIDAY_RANGE },
  );
  assert.equal(
    validateHoliday({ name: "גיבוש", typeId: 3, startDate: "2026-09-19", endDate: "2026-09-20", isHalfDay: false, halfDayEndTime: null, note: null }).ok,
    true,
  );
  assert.equal(
    validateHoliday({ name: "חצי", typeId: 3, startDate: "2026-09-19", endDate: "2026-09-19", isHalfDay: true, halfDayEndTime: null, note: null }).ok,
    false,
  );
});
