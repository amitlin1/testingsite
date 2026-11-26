"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { localCivilDate } from "@/lib/time/civil";
import { AnchoredPopover } from "./AnchoredPopover";
import { Button } from "./Button";
import FieldLabel from "./FieldLabel";
import { IconButton } from "./IconButton";
import { ToggleButton, ToggleButtonGroup } from "./Segmented";
import { cn } from "./utils";

/*
 * A Hebrew date field (DD/MM/YYYY) with a calendar, in place of the browser's
 * <input type="date">, which looks different in every browser. Taken from the
 * ExtraHours system's DatePicker (its look and its behaviour), on this app's
 * tokens (ui.css "Date picker"). Values are always ISO ("2026-11-17"), or
 * { from, to } with mode="range": one field for a range, "01/12/2026 – 05/12/2026".
 *
 * Type 17/11/2026, 17.11.26, 17-11-2026 or 17112026 — taken on leaving the
 * field or on Enter — or pick from the calendar. A range is two clicks (the
 * days between are previewed under the mouse); the same day twice is one day.
 * Keys: arrows move by day (right = back, in Hebrew), up/down by week, Page
 * Up/Down by month (Shift: year), Home/End to the week's ends, Enter picks,
 * Escape closes (focus back on the field); Arrow Down in the field opens it.
 *
 * The calendar is an AnchoredPopover (Radix): placed at the field, flipped when
 * there is no room, above the popup dialogs and working inside them.
 * The Israeli holidays (lib/workHours/israeliHolidays — the same days the work
 * calendar treats specially) get a dot and their name under the grid; they are
 * loaded only when a calendar first opens. Friday and Saturday are a lighter
 * shade. `openEnded` (a range): one date alone is "from it on", and a switch
 * beside the field turns it into "up to it".
 */

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const DOW = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const DOW_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
/** an open end, for the range's shading */
const NO_START = "0000-01-01";
const NO_END = "9999-12-31";

type Day = { y: number; m: number; d: number };
const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const valid = (v: Day) => v.y >= 1900 && v.y <= 2100 && v.m >= 0 && v.m < 12 && v.d >= 1 && v.d <= daysIn(v.y, v.m);
const isoOf = (v: Day) => `${v.y}-${pad(v.m + 1)}-${pad(v.d)}`;
const sameMonth = (a: Day, b: Day) => a.y === b.y && a.m === b.m;
const weekdayOf = (v: Day) => new Date(Date.UTC(v.y, v.m, v.d)).getUTCDay();
const shift = (v: Day, days: number): Day => {
  const t = new Date(Date.UTC(v.y, v.m, v.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};
const shiftMonths = (v: Day, n: number): Day => {
  const t = new Date(Date.UTC(v.y, v.m + n, 1));
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  return { y, m, d: Math.min(v.d, daysIn(y, m)) };
};
function dayOf(iso: string): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return null;
  const v = { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  return valid(v) ? v : null;
}

/** "2026-11-17" → "17/11/2026" ("" when it is not a date) */
export function formatIsoDate(iso: string): string {
  const v = dayOf(iso);
  return v ? `${pad(v.d)}/${pad(v.m + 1)}/${v.y}` : "";
}

/** "17/11/2026", "17.11.26", "17-11-2026", "17112026" → "2026-11-17"; null when it is not a date */
export function parseHebrewDate(text: string): string | null {
  const t = (text || "").trim();
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (!m) return null;
  const v = { y: m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), m: Number(m[2]) - 1, d: Number(m[1]) };
  return valid(v) ? isoOf(v) : null;
}

/**
 * A typed range → its two sides as typed: "A – B", "A - B", "A –" (from A on),
 * "– B" (up to B), or "A" alone (no separator). A date's own hyphens
 * (17-11-2026) are not a separator: a hyphen separates only between spaces,
 * or at the very start or end.
 */
function splitRange(text: string): { a: string; b: string; separated: boolean } {
  const t = text.trim();
  const i = t.search(/[–—]| - /);
  if (i >= 0) return { a: t.slice(0, i).trim(), b: t.slice(i + (t[i] === " " ? 3 : 1)).trim(), separated: true };
  if (t.startsWith("-")) return { a: "", b: t.slice(1).trim(), separated: true };
  if (t.endsWith("-")) return { a: t.slice(0, -1).trim(), b: "", separated: true };
  return { a: t, b: "", separated: false };
}

/** The Israeli holidays by year — the module (and @hebcal/core) loaded once, when a calendar first opens. */
type HolidaysOf = (year: number) => ReadonlyMap<string, string>;
let holidaysLoad: Promise<HolidaysOf> | null = null;
function loadHolidays(): Promise<HolidaysOf> {
  holidaysLoad ??= import("@/lib/workHours/israeliHolidays").then(
    (m) => {
      const byYear = new Map<number, ReadonlyMap<string, string>>();
      return (year: number) => {
        let days = byYear.get(year);
        if (!days) {
          days = new Map(m.getIsraeliHolidays(`${year}-01-01`, `${year}-12-31`).map((h) => [h.date, h.label]));
          byYear.set(year, days);
        }
        return days;
      };
    },
    (err) => {
      holidaysLoad = null;
      throw err;
    },
  );
  return holidaysLoad;
}

export type DateRange = { from: string; to: string };
export type DateHoliday = { date: string; name: string };

type Common = {
  label?: React.ReactNode;
  /** the field's name when it has no visible label */
  ariaLabel?: string;
  hint?: React.ReactNode;
  error?: string;
  /** an asterisk on the label */
  required?: boolean;
  /** "ניקוי" in the calendar, and an emptied field is taken as no date (default: true) */
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  /** ISO; days outside min–max are disabled */
  min?: string;
  max?: string;
  /** more days to mark, besides the Israeli holidays: a dot under the day, its name under the calendar */
  holidays?: DateHoliday[];
  /** the Israeli holidays from the Hebrew calendar (default: true) */
  israeliHolidays?: boolean;
  /** a lighter shade (0 = Sunday); default Friday and Saturday */
  weekendDays?: number[];
  /** a darker band, for days a screen is about; default none */
  strongDays?: number[];
  placeholder?: string;
  /** the 34px field of the dense filter rails */
  dense?: boolean;
  className?: string;
  /** on the field's frame (the bordered box) */
  wrapClassName?: string;
};
export type DatePickerProps = Common &
  (
    | { mode?: "single"; value: string; onChange: (iso: string) => void }
    | {
        mode: "range";
        value: DateRange;
        onChange: (range: DateRange) => void;
        /** one side may stay empty: a date alone is "from it on", and a switch beside the field makes it "up to it" */
        openEnded?: boolean;
      }
  );

export function DatePicker(props: DatePickerProps) {
  const {
    label,
    ariaLabel,
    hint,
    error,
    required,
    clearable = true,
    disabled,
    min,
    max,
    holidays = [],
    israeliHolidays = true,
    weekendDays = [5, 6],
    strongDays = [],
    placeholder,
    dense,
    className,
    wrapClassName,
  } = props;
  const isRange = props.mode === "range";
  const openEnded = props.mode === "range" && !!props.openEnded;
  const from = props.mode === "range" ? props.value.from : props.value;
  const to = props.mode === "range" ? props.value.to : props.value;
  // one side of an open-ended range: from it on, or up to it
  const oneSide = openEnded && !!from !== !!to ? (from ? "from" : "until") : null;
  const autoId = React.useId();
  const id = props.id ?? autoId;
  const [today, setToday] = React.useState<Day | null>(null);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<Day>({ y: 2000, m: 0, d: 1 });
  const [focus, setFocus] = React.useState<Day>({ y: 2000, m: 0, d: 1 });
  const [draft, setDraft] = React.useState<string | null>(null);
  const [invalid, setInvalid] = React.useState(false);
  // a range's first click, waiting for its second; the day under the mouse (the range's preview)
  const [anchor, setAnchor] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [calendarHolidays, setCalendarHolidays] = React.useState<HolidaysOf | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const moveFocus = React.useRef(false);

  const inBounds = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const shown = !isRange
    ? formatIsoDate(from)
    : from && to
      ? `${formatIsoDate(from)} – ${formatIsoDate(to)}`
      : from
        ? `${formatIsoDate(from)} –`
        : to
          ? `– ${formatIsoDate(to)}`
          : "";
  const text = draft ?? shown;
  const fieldError = error || (invalid ? "תאריך לא תקין – הקלידו DD/MM/YYYY" : undefined);
  const emitSingle = (iso: string) => {
    if (props.mode !== "range") props.onChange(iso);
  };
  const emitRange = (r: DateRange) => {
    if (props.mode === "range") props.onChange(r);
  };
  const openCalendar = () => {
    // today by the browser's calendar, read on opening (never during render)
    const now = dayOf(localCivilDate(new Date()))!;
    const start = dayOf(from) ?? dayOf(to) ?? now;
    setToday(now);
    setView({ ...start, d: 1 });
    setFocus(start);
    setAnchor(null);
    setHover(null);
    setOpen(true);
    if (israeliHolidays && !calendarHolidays) loadHolidays().then((f) => setCalendarHolidays(() => f), () => {});
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    setAnchor(null);
    setHover(null);
    if (refocus) inputRef.current?.focus();
  };
  const settle = () => {
    setDraft(null);
    setInvalid(false);
  };
  const pick = (v: Day) => {
    const iso = isoOf(v);
    if (!inBounds(iso)) return;
    settle();
    if (!isRange) {
      emitSingle(iso);
      close(true);
      return;
    }
    if (!anchor) {
      setAnchor(iso);
      return;
    }
    emitRange(anchor <= iso ? { from: anchor, to: iso } : { from: iso, to: anchor });
    close(true);
  };
  /** an open-ended range from the one day picked: from it on, or up to it */
  const pickOneSide = (side: "from" | "until") => {
    if (!anchor) return;
    emitRange(side === "from" ? { from: anchor, to: "" } : { from: "", to: anchor });
    settle();
    close(true);
  };
  // what was typed, on leaving the field or on Enter
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    if (!t) {
      // emptied: no date, or back to the value when the field must have one
      if (clearable) {
        if (isRange) emitRange({ from: "", to: "" });
        else emitSingle("");
      }
      settle();
      return;
    }
    if (isRange) {
      const { a: ta, b: tb, separated } = splitRange(t);
      const a = ta ? parseHebrewDate(ta) : "";
      const b = tb ? parseHebrewDate(tb) : "";
      if (a === null || b === null || (!a && !b) || (a && !inBounds(a)) || (b && !inBounds(b))) return setInvalid(true);
      if (a && b) emitRange(a <= b ? { from: a, to: b } : { from: b, to: a });
      else if (!openEnded) emitRange({ from: a || b, to: a || b }); // one date: that day
      else if (separated) emitRange({ from: a, to: b }); // "A –" / "– B": as typed
      else emitRange(oneSide === "until" ? { from: "", to: a } : { from: a, to: "" }); // a date alone keeps the side shown, else "from it on"
    } else {
      const iso = parseHebrewDate(t);
      if (!iso || !inBounds(iso)) return setInvalid(true);
      emitSingle(iso);
    }
    settle();
  };

  // the keyboard's day takes the focus after each move (on opening: onOpenAutoFocus below)
  React.useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
  });

  const goTo = (next: Day) => {
    moveFocus.current = true;
    setFocus(next);
    if (!sameMonth(next, view)) setView({ ...next, d: 1 });
  };
  const onGridKey = (e: React.KeyboardEvent) => {
    const steps: Record<string, () => Day> = {
      ArrowRight: () => shift(focus, -1),
      ArrowLeft: () => shift(focus, 1),
      ArrowUp: () => shift(focus, -7),
      ArrowDown: () => shift(focus, 7),
      PageUp: () => shiftMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => shiftMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => shift(focus, -weekdayOf(focus)),
      End: () => shift(focus, 6 - weekdayOf(focus)),
    };
    const step = steps[e.key];
    if (step) {
      e.preventDefault();
      goTo(step());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focus);
    }
  };

  const first = { ...view, d: 1 };
  const start = shift(first, -weekdayOf(first));
  const cells = Array.from({ length: 42 }, (_, i) => shift(start, i));
  // the holidays on the grid: the Hebrew calendar's (each year the grid shows), then any passed in
  const holidayOf = new Map<string, string>();
  if (calendarHolidays) for (const y of new Set(cells.map((c) => c.y))) for (const [d, name] of calendarHolidays(y)) holidayOf.set(d, name);
  for (const h of holidays) holidayOf.set(h.date.slice(0, 10), h.name);
  const span = anchor
    ? [anchor, hover ?? anchor].sort()
    : isRange && from && to
      ? [from, to]
      : oneSide === "from"
        ? [from, NO_END]
        : oneSide === "until"
          ? [NO_START, to]
          : ["", ""];
  const focusIso = isoOf(focus);
  const todayIso = today ? isoOf(today) : "";
  const noteIso = hover ?? focusIso;
  const note = holidayOf.get(noteIso);
  const monthHasHoliday = cells.some((c) => sameMonth(c, view) && holidayOf.has(isoOf(c)));
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;

  return (
    <div className={cn("sh-date-field", className)}>
      {label != null && label !== "" && (
        <FieldLabel htmlFor={id} required={required}>
          {label}
        </FieldLabel>
      )}
      {/* always this row, so the field is never remounted when the switch comes and goes */}
      <div className="sh-date-row">
        <div
          ref={wrapRef}
          className={cn(
            "sh-input-wrap sh-date",
            dense && "sh-date--dense",
            fieldError && "sh-input--error",
            disabled && "sh-input--disabled",
            wrapClassName,
          )}
        >
          <input
            ref={inputRef}
            id={id}
            value={text}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? (isRange ? "DD/MM/YYYY – DD/MM/YYYY" : "DD/MM/YYYY")}
            aria-label={label ? undefined : ariaLabel}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errId : hint ? hintId : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "ArrowDown" && !open) {
                e.preventDefault();
                openCalendar();
              }
            }}
          />
          <button
            type="button"
            className="sh-date-toggle"
            aria-label={open ? "סגירת לוח השנה" : "פתיחת לוח השנה"}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => (open ? close(true) : openCalendar())}
          >
            <CalendarDays size={dense ? 16 : 18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        {oneSide && (
          // one date: which side of it the range runs
          <ToggleButtonGroup
            exclusive
            size="small"
            value={oneSide}
            aria-label="כיוון הטווח"
            onChange={(_, side) => {
              if (side !== "from" && side !== "until") return;
              const day = from || to;
              emitRange(side === "from" ? { from: day, to: "" } : { from: "", to: day });
            }}
          >
            <ToggleButton value="from">מהתאריך והלאה</ToggleButton>
            <ToggleButton value="until">עד התאריך</ToggleButton>
          </ToggleButtonGroup>
        )}
      </div>
      {fieldError ? (
        <div className="sh-field-helper sh-field-helper--error" id={errId}>
          {fieldError}
        </div>
      ) : (
        hint && (
          <div className="sh-field-helper" id={hintId}>
            {hint}
          </div>
        )
      )}

      <AnchoredPopover
        open={open}
        onOpenChange={(o) => {
          if (!o) close(false);
        }}
        anchorRef={wrapRef}
        side="bottom"
        align="start"
        sideOffset={6}
        className="sh-cal"
        aria-label={isRange ? "בחירת טווח תאריכים" : "בחירת תאריך"}
        // the chosen day (or today) takes the focus, not the first button
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          gridRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // the field and its button are part of the picker: pressing them does not dismiss it
        onInteractOutside={(e) => {
          if (wrapRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          close(true);
        }}
      >
        <div className="sh-cal-head">
          <div className="sh-cal-title" aria-live="polite">
            {MONTHS[view.m]} {view.y}
          </div>
          <div className="sh-cal-nav">
            <IconButton size="small" aria-label="החודש הקודם" onClick={() => goTo(shiftMonths(focus, -1))}>
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
            <IconButton size="small" aria-label="החודש הבא" onClick={() => goTo(shiftMonths(focus, 1))}>
              <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </div>
        </div>
        <div className="sh-cal-grid" ref={gridRef} role="grid" onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
          {DOW.map((d, i) => (
            <div
              key={d}
              className="sh-cal-dow"
              role="columnheader"
              aria-label={DOW_NAMES[i]}
              data-weekend={weekendDays.includes(i) ? "" : undefined}
              data-strong={strongDays.includes(i) ? "" : undefined}
            >
              {d}
            </div>
          ))}
          {cells.map((c) => {
            const iso = isoOf(c);
            const wd = weekdayOf(c);
            const holiday = holidayOf.get(iso);
            const selected = anchor ? iso === anchor : iso === from || iso === to;
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                className="sh-cal-day"
                tabIndex={iso === focusIso ? 0 : -1}
                disabled={!inBounds(iso)}
                aria-selected={selected}
                aria-label={`יום ${DOW_NAMES[wd]}, ${c.d} ב${MONTHS[c.m]} ${c.y}${holiday ? ` – ${holiday}` : ""}`}
                title={holiday}
                data-focus={iso === focusIso ? "" : undefined}
                data-outside={sameMonth(c, view) ? undefined : ""}
                data-weekend={weekendDays.includes(wd) ? "" : undefined}
                data-strong={strongDays.includes(wd) ? "" : undefined}
                data-today={iso === todayIso ? "" : undefined}
                data-holiday={holiday ? "" : undefined}
                data-selected={selected ? "" : undefined}
                data-inrange={span[0] && iso > span[0] && iso < span[1] ? "" : undefined}
                onClick={() => pick(c)}
                onMouseEnter={() => setHover(iso)}
              >
                {c.d}
              </button>
            );
          })}
        </div>
        {anchor && openEnded ? (
          // one day picked: a second one ends the range, or the range stays open on one side
          <div className="sh-cal-foot sh-cal-foot--stack">
            <span className="sh-cal-hint">בחרו יום נוסף לסוף הטווח, או:</span>
            <div className="sh-cal-actions">
              <Button size="small" variant="outlined" onClick={() => pickOneSide("from")}>
                מתאריך זה והלאה
              </Button>
              <Button size="small" variant="text" color="inherit" onClick={() => pickOneSide("until")}>
                עד תאריך זה
              </Button>
            </div>
          </div>
        ) : (
          <div className="sh-cal-foot">
            {note ? (
              <div className="sh-cal-note">
                <span>
                  {formatIsoDate(noteIso)} · {note}
                </span>
              </div>
            ) : monthHasHoliday ? (
              <div className="sh-cal-note">
                <span>חג או ערב חג</span>
              </div>
            ) : (
              <span />
            )}
            <div className="sh-cal-actions">
              {clearable && (from || to) && (
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={() => {
                    if (isRange) emitRange({ from: "", to: "" });
                    else emitSingle("");
                    settle();
                    close(true);
                  }}
                >
                  ניקוי
                </Button>
              )}
              {todayIso && inBounds(todayIso) && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    if (!isRange) return pick(today!);
                    emitRange({ from: todayIso, to: todayIso });
                    settle();
                    close(true);
                  }}
                >
                  היום
                </Button>
              )}
            </div>
          </div>
        )}
      </AnchoredPopover>
    </div>
  );
}

export default DatePicker;
