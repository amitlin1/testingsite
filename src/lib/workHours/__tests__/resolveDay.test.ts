import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDay, resolveRange, type ResolveDayInput } from "../resolveDay";
import type {
  DepartmentHoliday,
  IsraeliHolidayInfo,
  Weekday,
  WeekdayDefault,
  WorkdayOverride,
  WorkHoursContext,
} from "../types";
import { weekdayOf } from "../time";

const WORK = { start: "07:00", end: "15:35", breakStart: "12:00", breakEnd: "13:00" };
function seededDefaults(): WeekdayDefault[] {
  return [0, 1, 2, 3, 4, 5, 6].map((w) => {
    const weekday = w as Weekday;
    if (weekday <= 4) return { weekday, isWorking: true, ...WORK };
    return { weekday, isWorking: false, start: null, end: null, breakStart: null, breakEnd: null };
  });
}
const defByWeekday = (wd: Weekday) => seededDefaults()[wd];

function input(over: Partial<ResolveDayInput> & { date: string }): ResolveDayInput {
  const weekday = over.weekday ?? weekdayOf(over.date);
  return {
    date: over.date,
    weekday,
    weekdayDefault: over.weekdayDefault ?? defByWeekday(weekday),
    israeli: over.israeli ?? null,
    override: over.override ?? null,
    departmentHoliday: over.departmentHoliday ?? null,
  };
}

const israeli = (category: IsraeliHolidayInfo["category"], date: string, label = "X"): IsraeliHolidayInfo => ({
  date,
  category,
  label,
  desc: "test",
});
const override = (o: Partial<WorkdayOverride> & { date: string; kind: WorkdayOverride["kind"] }): WorkdayOverride => ({
  id: 1,
  start: null,
  end: null,
  breakStart: null,
  breakEnd: null,
  note: null,
  ...o,
});

test("regular weekday follows the template (net 7h35m)", () => {
  const r = resolveDay(input({ date: "2026-09-15" })); // Tuesday
  assert.equal(r.isWorking, true);
  assert.equal(r.category, "working");
  assert.equal(r.netMinutes, 455);
  assert.equal(r.locked, false);
});

test("Saturday is a locked shabbat", () => {
  const r = resolveDay(input({ date: "2026-09-12", weekday: 6 }));
  assert.equal(r.category, "shabbat");
  assert.equal(r.locked, true);
  assert.equal(r.isWorking, false);
  assert.equal(r.netMinutes, 0);
});

test("full national holiday is locked and non-working", () => {
  const r = resolveDay(input({ date: "2026-04-22", israeli: israeli("full_off", "2026-04-22", "יום העצמאות") }));
  assert.equal(r.category, "full_off");
  assert.equal(r.locked, true);
  assert.equal(r.isWorking, false);
  assert.equal(r.label, "יום העצמאות");
});

test("Yom HaZikaron / HaShoah default to a half working day 07:00–12:00", () => {
  const r = resolveDay(input({ date: "2026-04-21", israeli: israeli("half_day", "2026-04-21", "יום הזכרון") }));
  assert.equal(r.category, "half_day");
  assert.equal(r.isWorking, true);
  assert.equal(r.start, "07:00");
  assert.equal(r.end, "12:00");
  assert.equal(r.netMinutes, 300);
  assert.equal(r.locked, false);
});

test("Erev chag is closed by default but may be opened to 12:00", () => {
  const r = resolveDay(input({ date: "2026-09-20", israeli: israeli("eve", "2026-09-20", "ערב יום כיפור") }));
  assert.equal(r.category, "eve");
  assert.equal(r.isWorking, false);
  assert.equal(r.canOpenHalfDay, true);
  assert.equal(r.halfDayMaxEnd, "12:00");
});

test("Friday is closed by default but may be opened to 12:00", () => {
  const r = resolveDay(input({ date: "2026-09-18", weekday: 5 }));
  assert.equal(r.category, "friday");
  assert.equal(r.isWorking, false);
  assert.equal(r.canOpenHalfDay, true);
  assert.equal(r.halfDayMaxEnd, "12:00");
});

test("friday_work override opens a Friday; ignored on a non-Friday", () => {
  const good = resolveDay(
    input({ date: "2026-09-18", weekday: 5, override: override({ date: "2026-09-18", kind: "friday_work", start: "07:00", end: "12:00" }) }),
  );
  assert.equal(good.isWorking, true);
  assert.equal(good.category, "working");
  assert.equal(good.netMinutes, 300);
  assert.equal(good.source, "override");

  const stale = resolveDay(
    input({ date: "2026-09-15", weekday: 2, override: override({ date: "2026-09-15", kind: "friday_work", start: "07:00", end: "12:00" }) }),
  );
  assert.equal(stale.source, "default"); // override ignored, falls back to template
  assert.equal(stale.netMinutes, 455);
});

test("eve_work override opens an erev chag; ignored when the date is not an eve", () => {
  const good = resolveDay(
    input({
      date: "2026-09-20",
      israeli: israeli("eve", "2026-09-20", "ערב יום כיפור"),
      override: override({ date: "2026-09-20", kind: "eve_work", start: "07:00", end: "11:00" }),
    }),
  );
  assert.equal(good.isWorking, true);
  assert.equal(good.netMinutes, 240);
  assert.equal(good.label, "ערב יום כיפור");

  const stale = resolveDay(
    input({ date: "2026-09-15", weekday: 2, override: override({ date: "2026-09-15", kind: "eve_work", start: "07:00", end: "11:00" }) }),
  );
  assert.equal(stale.source, "default");
});

test("vacation and short_hours overrides", () => {
  const vac = resolveDay(input({ date: "2026-09-15", override: override({ date: "2026-09-15", kind: "vacation" }) }));
  assert.equal(vac.isWorking, false);
  assert.equal(vac.category, "vacation");
  assert.equal(vac.netMinutes, 0);

  const short = resolveDay(
    input({ date: "2026-09-15", override: override({ date: "2026-09-15", kind: "short_hours", start: "07:00", end: "10:30", breakStart: "10:00", breakEnd: "10:15" }) }),
  );
  assert.equal(short.isWorking, true);
  assert.equal(short.netMinutes, 195); // 3h30 minus 15m break
});

test("department holiday: full off and half day", () => {
  const full: DepartmentHoliday = { id: 9, name: "יום גיבוש", typeId: 3, typeName: "יום גיבוש", startDate: "2026-09-15", endDate: "2026-09-15", isHalfDay: false, halfDayEndTime: null, note: null };
  const rFull = resolveDay(input({ date: "2026-09-15", departmentHoliday: full }));
  assert.equal(rFull.category, "vacation");
  assert.equal(rFull.isWorking, false);
  assert.equal(rFull.holidayId, 9);

  const half: DepartmentHoliday = { ...full, id: 10, isHalfDay: true, halfDayEndTime: "11:30" };
  const rHalf = resolveDay(input({ date: "2026-09-15", departmentHoliday: half }));
  assert.equal(rHalf.category, "half_day");
  assert.equal(rHalf.isWorking, true);
  assert.equal(rHalf.end, "11:30");
  assert.equal(rHalf.netMinutes, 270); // 07:00–11:30
});

test("precedence: locked national day beats override & department holiday", () => {
  const r = resolveDay(
    input({
      date: "2026-04-22",
      israeli: israeli("full_off", "2026-04-22", "יום העצמאות"),
      override: override({ date: "2026-04-22", kind: "short_hours", start: "07:00", end: "10:00" }),
      departmentHoliday: { id: 1, name: "x", typeId: 1, typeName: "x", startDate: "2026-04-22", endDate: "2026-04-22", isHalfDay: false, halfDayEndTime: null, note: null },
    }),
  );
  assert.equal(r.category, "full_off");
  assert.equal(r.locked, true);
});

test("precedence: override beats the national half-day default", () => {
  const r = resolveDay(
    input({ date: "2026-04-21", israeli: israeli("half_day", "2026-04-21", "יום הזכרון"), override: override({ date: "2026-04-21", kind: "vacation" }) }),
  );
  assert.equal(r.category, "vacation");
  assert.equal(r.isWorking, false);
});

test("resolveRange integrates all layers over a window", () => {
  const ctx: WorkHoursContext = {
    defaults: seededDefaults(),
    overrides: [override({ date: "2026-09-25", kind: "eve_work", start: "07:00", end: "12:00" })],
    holidays: [],
    israeli: [
      israeli("full_off", "2026-09-26", "סוכות"),
      israeli("eve", "2026-09-25", "ערב סוכות"),
    ],
  };
  const days = resolveRange("2026-09-24", "2026-09-27", ctx);
  assert.equal(days.length, 4);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(byDate["2026-09-24"].category, "working"); // Thursday
  assert.equal(byDate["2026-09-25"].category, "working"); // Erev Sukkot opened via eve_work
  assert.equal(byDate["2026-09-25"].netMinutes, 300);
  assert.equal(byDate["2026-09-26"].category, "full_off"); // Sukkot I (also Saturday, but chag wins)
  assert.equal(byDate["2026-09-26"].locked, true);
  assert.equal(byDate["2026-09-27"].category, "working"); // Sunday
});
