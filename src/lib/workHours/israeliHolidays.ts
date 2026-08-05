// National-holiday source of truth: the Israeli civil-calendar days that the
// department treats specially. Computed from @hebcal/core (arithmetic Hebrew
// calendar — no lookup table, no network), so it is correct for any year.
//
// Classification was verified empirically against 2025–2028 (see the feature's
// tests). The rules, decided with the customer:
//   • full_off — every יו"ט (@hebcal flag CHAG) + יום העצמאות → full day off, LOCKED.
//   • half_day — יום הזיכרון + יום השואה → half working day (07:00–12:00) by default.
//   • eve      — ערב חג (EREV together with LIGHT_CANDLES) → like Friday: closed
//                by default, may be opened for a half day until 12:00.
// Everything else the library emits (חוה"מ, פורים, חנוכה, ל"ג בעומר, צומות,
// ימים לאומיים אחרים) is a normal working day and is intentionally ignored.

import { HebrewCalendar, flags, type Event } from "@hebcal/core";
import type { DateString, IsraeliHolidayCategory, IsraeliHolidayInfo } from "./types";
import { toDateString } from "./time";

/** Precedence when two classified events land on the same civil date. */
const CATEGORY_RANK: Record<IsraeliHolidayCategory, number> = {
  full_off: 3,
  half_day: 2,
  eve: 1,
};

function classify(ev: Event): IsraeliHolidayCategory | null {
  const f = ev.getFlags();
  const desc = ev.getDesc();
  // יו"ט — the one flag that marks every work-forbidden holiday (incl. both days
  // of ראש השנה, which carry no IL_ONLY flag).
  if (f & flags.CHAG) return "full_off";
  // יום העצמאות — a modern holiday, matched by its stable descriptor.
  if (desc.startsWith("Yom HaAtzma")) return "full_off";
  // יום הזיכרון / יום השואה — half working days.
  if (desc === "Yom HaZikaron" || desc === "Yom HaShoah") return "half_day";
  // ערב יו"ט only: EREV is also set on ערב פורים / ערב ת"ב / נר ראשון של חנוכה,
  // but only ערב יו"ט additionally carries LIGHT_CANDLES.
  if (f & flags.EREV && f & flags.LIGHT_CANDLES) return "eve";
  return null;
}

/** Clean Hebrew label without nikud, with the trailing Hebrew year stripped. */
function hebrewLabel(ev: Event): string {
  let s: string;
  try {
    s = ev.render("he-x-NoNikud");
  } catch {
    s = ev.render("he");
  }
  // "ראש השנה 5787" → "ראש השנה"
  return s.replace(/\s+\d{3,4}\s*$/, "").trim();
}

const yearCache = new Map<number, IsraeliHolidayInfo[]>();

function computeYear(year: number): IsraeliHolidayInfo[] {
  const cached = yearCache.get(year);
  if (cached) return cached;

  const events = HebrewCalendar.calendar({
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
    il: true,
    sedrot: false,
    candlelighting: false,
    noRoshChodesh: true,
    noSpecialShabbat: true,
    noMinorFast: true,
    noModern: false,
  });

  // One entry per civil date; higher-ranked category wins a collision.
  const byDate = new Map<DateString, IsraeliHolidayInfo>();
  for (const ev of events) {
    const category = classify(ev);
    if (!category) continue;
    const date = toDateString(ev.getDate().greg());
    const existing = byDate.get(date);
    if (existing && CATEGORY_RANK[existing.category] >= CATEGORY_RANK[category]) continue;
    byDate.set(date, { date, category, label: hebrewLabel(ev), desc: ev.getDesc() });
  }

  const list = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  yearCache.set(year, list);
  return list;
}

/** All Israeli special days whose civil date is within [fromISO, toISO] inclusive. */
export function getIsraeliHolidays(fromISO: DateString, toISO: DateString): IsraeliHolidayInfo[] {
  const fromYear = Number(fromISO.slice(0, 4));
  const toYear = Number(toISO.slice(0, 4));
  const out: IsraeliHolidayInfo[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of computeYear(y)) {
      if (h.date >= fromISO && h.date <= toISO) out.push(h);
    }
  }
  return out;
}

/** Same data keyed by date, for O(1) lookup while resolving a range. */
export function getIsraeliHolidayMap(
  fromISO: DateString,
  toISO: DateString,
): Map<DateString, IsraeliHolidayInfo> {
  const map = new Map<DateString, IsraeliHolidayInfo>();
  for (const h of getIsraeliHolidays(fromISO, toISO)) map.set(h.date, h);
  return map;
}

/** The Israeli special-day info for a single civil date, or null. */
export function getIsraeliHolidayForDate(date: DateString): IsraeliHolidayInfo | null {
  const year = Number(date.slice(0, 4));
  return computeYear(year).find((h) => h.date === date) ?? null;
}

/** Test/maintenance hook — clears the per-year memoization. */
export function _clearIsraeliHolidayCache(): void {
  yearCache.clear();
}
