import { requestCalendarRebuild } from "@/app/lib/metrics/ledger/work-calendar";
import { errorCode } from "@/lib/errors";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { weekdayOf } from "@/lib/time/civil";
import { getIsraeliHolidayForDate } from "@/lib/workHours/israeliHolidays";
import { stringToDbDate } from "@/lib/workHours/serialize";
import type { DateString, DepartmentHolidayInput, OverrideKind, WorkdayOverrideInput } from "@/lib/workHours/types";
import { validateHoliday, validateOverride, type ValidationResult } from "@/lib/workHours/validate";

/** The answer to a work-hours request: a refusal (HttpError) as its body, anything else a 500 with
 *  `fallback`. */
export async function answer(fallback: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    return errorResponse(e, fallback);
  }
}

/** A write that moves the work calendar (defaults, overrides, holidays): answered like `answer`,
 *  and when it succeeded the ledger's calendar is rebuilt (fire-and-forget, work-calendar.ts). */
export async function calendarWrite(fallback: string, write: () => Promise<Response>): Promise<Response> {
  const res = await answer(fallback, write);
  if (res.ok) requestCalendarRebuild();
  return res;
}

/** A Prisma rejection the route answers in words: its code → the refusal thrown instead. */
export const refusing = (refusals: Record<string, HttpError>) => (e: unknown): never => {
  throw refusals[errorCode(e) ?? ""] ?? e;
};

const BAD_INPUT = "קלט לא תקין";
const checked = (check: ValidationResult): void => {
  if (!check.ok) throw new HttpError(400, check.error);
};
const noteOf = (body: Record<string, unknown>) => (typeof body.note === "string" ? body.note.slice(0, 500) : null);
const timeOf = (v: unknown) => (v as string | null | undefined) ?? null;

/** A holiday type's name: trimmed, required, at most 100 characters. */
export function holidayTypeNameOf(body: Record<string, unknown>): string {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new HttpError(400, "יש להזין שם לסוג");
  if (name.length > 100) throw new HttpError(400, "שם ארוך מדי");
  return name;
}

/** An internal holiday as POST and PUT take it, validated. */
export function holidayInputOf(body: Record<string, unknown>): DepartmentHolidayInput {
  if (typeof body.name !== "string") throw new HttpError(400, BAD_INPUT);
  const input: DepartmentHolidayInput = {
    name: body.name.trim(),
    typeId: Number(body.typeId),
    startDate: String(body.startDate ?? ""),
    endDate: String(body.endDate ?? ""),
    isHalfDay: !!body.isHalfDay,
    halfDayEndTime: body.isHalfDay ? timeOf(body.halfDayEndTime) : null,
    note: noteOf(body),
  };
  checked(validateHoliday(input));
  return input;
}

export const holidayColumns = (input: DepartmentHolidayInput) => ({
  name: input.name,
  type_id: input.typeId,
  start_date: stringToDbDate(input.startDate),
  end_date: stringToDbDate(input.endDate),
  is_half_day: input.isHalfDay,
  half_day_end_time: input.halfDayEndTime,
  note: input.note,
});

/** An override for `date` (POST: the body's, PUT: the stored row's), validated against the date. */
export function overrideInputOf(body: Record<string, unknown>, date: DateString): WorkdayOverrideInput {
  if (typeof body.kind !== "string") throw new HttpError(400, BAD_INPUT);
  const input: WorkdayOverrideInput = {
    date,
    kind: body.kind as OverrideKind,
    start: timeOf(body.start),
    end: timeOf(body.end),
    breakStart: timeOf(body.breakStart),
    breakEnd: timeOf(body.breakEnd),
    note: noteOf(body),
  };
  checked(validateOverride(input, { weekday: weekdayOf(date), israeli: getIsraeliHolidayForDate(date) }));
  return input;
}

export const overrideColumns = (input: WorkdayOverrideInput) => ({
  kind: input.kind,
  start_time: input.start,
  end_time: input.end,
  break_start: input.breakStart,
  break_end: input.breakEnd,
  note: input.note,
});
