"use client";
import * as React from "react";
import { INK, MUTED, PARCHMENT, RED } from "@/components/ui/colors";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/api/client";
import { FRIDAY } from "@/lib/time/civil";
import {
  WEEKDAY_LABELS,
  OVERRIDE_LABELS,
  ERR_END_BEFORE_START,
  ERR_HALF_DAY_MAX,
  type IsraeliHolidayCategory,
  type OverrideKind,
  type ResolvedDay,
  type WeekdayDefault,
  type WorkdayOverride,
} from "@/lib/workHours/types";
import {
  DEFAULT_BREAK_END,
  DEFAULT_BREAK_START,
  DEFAULT_END,
  DEFAULT_START,
  HALF_DAY_END,
  HALF_DAY_START,
  exceedsHalfDayCap,
  isEndBeforeStart,
  netMinutes,
} from "@/lib/workHours/time";
import { DialogShell, Chip, TimeField, NetRow } from "./fields";

/** The read-only explanation box of a locked / holiday-managed day. */
const infoBox: React.CSSProperties = { background: PARCHMENT, borderRadius: "var(--r-md)", padding: "14px 16px", fontSize: "var(--text-body-sm)", color: INK, lineHeight: 1.6 };

/** The end a new short day (שעות מקוצרות / יום קצר) starts from. */
const SHORT_DAY_END = "13:00";
type Selection = "default" | OverrideKind;

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export default function DayEditorDialog({
  open,
  day,
  override,
  weekdayDefault,
  israeliCategory,
  onClose,
  onSaved,
  onError,
  onEditHoliday,
}: {
  open: boolean;
  day: ResolvedDay;
  override: WorkdayOverride | null;
  weekdayDefault: WeekdayDefault;
  israeliCategory: IsraeliHolidayCategory | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  onEditHoliday: (holidayId: number) => void;
}) {
  // Underlying nature of the date, independent of any override that masks it.
  const underlyingEve = israeliCategory === "eve";
  const underlyingHalf = israeliCategory === "half_day";
  const underlyingFriday = day.weekday === FRIDAY && !underlyingEve;

  const kinds: Selection[] = underlyingEve
    ? ["default", "eve_work"]
    : underlyingFriday
      ? ["default", "friday_work"]
      : underlyingHalf
        ? ["default", "vacation", "short_hours"]
        : ["default", "vacation", "short_hours", "short_day"];

  const [sel, setSel] = React.useState<Selection>(override?.kind ?? "default");
  const [start, setStart] = React.useState(DEFAULT_START);
  const [end, setEnd] = React.useState(DEFAULT_END);
  const [bStart, setBStart] = React.useState(DEFAULT_BREAK_START);
  const [bEnd, setBEnd] = React.useState(DEFAULT_BREAK_END);
  const [saving, setSaving] = React.useState(false);

  // Seeded from the override whenever the dialog opens or what it edits
  // changes; done during render, so the old values are never painted.
  const seedInputs = [open, override, underlyingEve, underlyingFriday] as const;
  const [seededFor, setSeededFor] = React.useState<typeof seedInputs | null>(null);
  if (!seededFor || seedInputs.some((v, i) => v !== seededFor[i])) {
    setSeededFor(seedInputs);
    if (open) {
      setSel(override?.kind ?? "default");
      setStart(override?.start ?? DEFAULT_START);
      setEnd(override?.end ?? (underlyingEve || underlyingFriday ? HALF_DAY_END : SHORT_DAY_END));
      setBStart(override?.breakStart ?? DEFAULT_BREAK_START);
      setBEnd(override?.breakEnd ?? DEFAULT_BREAK_END);
    }
  }

  const needsHours = sel === "short_hours" || sel === "short_day" || sel === "friday_work" || sel === "eve_work";
  const halfKind = sel === "friday_work" || sel === "eve_work";
  const noBreak = halfKind; // half days have no break
  const endErr = needsHours && isEndBeforeStart(start, end);
  const capErr = needsHours && halfKind && exceedsHalfDayCap(end);
  const canSave = sel === "default" || sel === "vacation" || (!!start && !!end && !endErr && !capErr);

  const wdNet = weekdayDefault.isWorking
    ? netMinutes(weekdayDefault.start, weekdayDefault.end, weekdayDefault.breakStart, weekdayDefault.breakEnd)
    : 0;
  const defaultNet = underlyingHalf
    ? netMinutes(HALF_DAY_START, HALF_DAY_END, null, null)
    : underlyingEve || underlyingFriday ? 0 : override ? wdNet : day.netMinutes;
  const net =
    sel === "default" ? defaultNet : sel === "vacation" ? 0 : netMinutes(start, end, noBreak ? null : bStart, noBreak ? null : bEnd);

  const chipLabel = (k: Selection): string => {
    if (k === "default") {
      if (underlyingEve || underlyingFriday) return "סגור (רגיל)";
      if (underlyingHalf) return "חצי יום (רגיל)";
      return "רגיל";
    }
    return OVERRIDE_LABELS[k];
  };

  // `selection` is a PARAMETER, not read from state: the "אפס לברירת מחדל"
  // button calls setSel("default") and save() in the same handler, so the state
  // it just queued is not visible here yet. Passing the intent explicitly is the
  // only way that path reaches the delete branch.
  async function save(selection: Selection = sel) {
    setSaving(true);
    try {
      if (selection === "default") {
        if (override) {
          await sendJson(`/api/settings/work-hours/overrides/${override.id}`, "DELETE", undefined, "האיפוס נכשל");
        }
      } else {
        const payload =
          selection === "vacation"
            ? { date: day.date, kind: selection, start: null, end: null, breakStart: null, breakEnd: null }
            : {
                date: day.date,
                kind: selection,
                start,
                end,
                breakStart: noBreak ? null : bStart,
                breakEnd: noBreak ? null : bEnd,
              };
        await sendJson(`/api/settings/work-hours/overrides`, "POST", payload, "השמירה נכשלה");
      }
      onSaved(selection === "default" && override ? "היום אופס לברירת מחדל" : "היום עודכן בהצלחה");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const title = `${WEEKDAY_LABELS[day.weekday]} · ${ddmmyyyy(day.date)}`;

  /* --- locked national day: no editing --- */
  if (day.locked) {
    return (
      <DialogShell
        open={open}
        onClose={onClose}
        title={title}
        subtitle={day.label ?? undefined}
        footer={<Button variant="outlined" color="inherit" onClick={onClose}>סגור</Button>}
      >
        <div style={infoBox}>
          {day.category === "shabbat"
            ? "שבת — יום קבוע שאינו יום עבודה."
            : `${day.label ?? "חג"} — יום זה מנוהל אוטומטית לפי לוח החגים ואינו ניתן לעריכה.`}
        </div>
        <NetRow minutes={0} />
      </DialogShell>
    );
  }

  /* --- covered by a department holiday: manage it there --- */
  if (day.holidayId != null) {
    return (
      <DialogShell
        open={open}
        onClose={onClose}
        title={title}
        subtitle={day.label ?? undefined}
        footer={
          <>
            <Button variant="outlined" color="inherit" onClick={onClose}>סגור</Button>
            <Button variant="contained" onClick={() => onEditHoliday(day.holidayId!)}>ערוך חופשה</Button>
          </>
        }
      >
        <div style={infoBox}>
          {day.label ? `${day.label} — ` : ""}יום זה מנוהל דרך רשומת חופשה. כדי לשנות אותו ערוך את החופשה.
        </div>
        <NetRow minutes={day.netMinutes} />
      </DialogShell>
    );
  }

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={title}
      subtitle={
        underlyingEve
          ? `${day.label ?? "ערב חג"} — לא עובדים כברירת מחדל, ניתן לפתוח חצי יום עד ${HALF_DAY_END}.`
          : underlyingFriday
            ? `שישי אינו יום עבודה. ניתן לפתוח חצי יום עד ${HALF_DAY_END}.`
            : underlyingHalf
              ? `${day.label ?? ""} — חצי יום עבודה (${HALF_DAY_START}–${HALF_DAY_END}) כברירת מחדל.`
              : "בחר סוג יום להזנת חריגה, או השאר 'רגיל' כדי לעקוב אחר ברירת המחדל."
      }
      footer={
        <>
          {override ? (
            // The secondary destructive action sits apart, at the start.
            <Button
              variant="text"
              color="error"
              size="small"
              onClick={() => { setSel("default"); void save("default"); }}
              disabled={saving}
              style={{ order: -1, marginInlineEnd: "auto" }}
            >
              אפס לברירת מחדל
            </Button>
          ) : null}
          <Button variant="outlined" color="inherit" onClick={onClose}>ביטול</Button>
          <Button variant="contained" onClick={() => void save()} disabled={!canSave} loading={saving}>שמור</Button>
        </>
      }
    >
      <div id="day-kind-label" className="sh-field-label">סוג היום</div>
      <div role="group" aria-labelledby="day-kind-label" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: needsHours ? 18 : 4 }}>
        {kinds.map((k) => (
          <Chip key={k} active={sel === k} onClick={() => setSel(k)}>{chipLabel(k)}</Chip>
        ))}
      </div>

      {needsHours && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            <TimeField label="שעת התחלה" value={start} onChange={setStart} />
            <TimeField label="שעת סיום" value={end} onChange={setEnd} error={endErr || capErr} />
            {!noBreak && <TimeField label="תחילת הפסקה" value={bStart} onChange={setBStart} />}
            {!noBreak && <TimeField label="סיום הפסקה" value={bEnd} onChange={setBEnd} />}
          </div>
          {(endErr || capErr) && (
            <div role="alert" style={{ color: RED, fontSize: "var(--text-fine)", marginTop: 8 }}>
              {endErr ? ERR_END_BEFORE_START : ERR_HALF_DAY_MAX}
            </div>
          )}
          {halfKind && !endErr && !capErr && (
            <div style={{ color: MUTED, fontSize: "var(--text-fine)", marginTop: 8 }}>ניתן לעבוד עד השעה {HALF_DAY_END}.</div>
          )}
        </>
      )}

      <NetRow minutes={net} />
    </DialogShell>
  );
}
