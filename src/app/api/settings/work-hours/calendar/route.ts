import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { dayCountInclusive, isCivilDate } from "@/lib/time/civil";
import { getIsraeliHolidays } from "@/lib/workHours/israeliHolidays";
import { loadWorkHoursSources } from "@/lib/workHours/load";
import { resolveRange } from "@/lib/workHours/resolveDay";
import { answer } from "../_lib/write";

export const runtime = "nodejs";

// Resolving a range is O(days × holidays) and walks the Hebrew calendar once per
// YEAR it spans, so an unbounded range is a one-request DoS
// (?from=1900-01-01&to=2999-12-31 → ~400k days + 1100 years of hebcal). The UI
// never asks for more than one month; two years is generous headroom.
const MAX_RANGE_DAYS = 731;

/**
 * The resolved calendar for [from, to]: one `ResolvedDay` per date, folding the
 * weekly template, manual overrides, internal holidays and the national
 * (Hebrew-calendar) days through the single shared resolver — over the same
 * sources the ledger's work calendar is built from (lib/workHours/load.ts).
 */
export const GET = withAuth((req: NextRequest) => answer("שגיאה בטעינת הלוח", async () => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!isCivilDate(from) || !isCivilDate(to) || from > to) throw new HttpError(400, "טווח תאריכים לא תקין");
  if (dayCountInclusive(from, to) > MAX_RANGE_DAYS) throw new HttpError(400, "טווח התאריכים רחב מדי");

  const israeli = getIsraeliHolidays(from, to);
  const days = resolveRange(from, to, { ...(await loadWorkHoursSources(prisma, from, to)), israeli });

  // `israeli` is returned too so the day-editor knows a date's underlying
  // nature (חג-מלא / חצי-יום / ערב-חג) even when an override masks it.
  return NextResponse.json({ from, to, days, israeli });
}), { perm: ACCESS.workHours });
