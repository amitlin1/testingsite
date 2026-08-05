"use client";
import * as React from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import {
  WEEKDAY_LABELS,
  ERR_END_BEFORE_START,
  ERR_HALF_DAY_MAX,
  type IsraeliHolidayCategory,
  type OverrideKind,
  type ResolvedDay,
  type WeekdayDefault,
  type WorkdayOverride,
} from "@/lib/workHours/types";
import { isEndBeforeStart, netMinutes, toMinutes } from "@/lib/workHours/time";
import { DialogShell, Chip, TimeField, NetRow } from "./fields";
import { DANGER, MUTED, SOFT, INK } from "./ui";

const HALF_CAP = toMinutes("12:00");
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
  const underlyingFriday = day.weekday === 5 && !underlyingEve;

  const kinds: Selection[] = underlyingEve
    ? ["default", "eve_work"]
    : underlyingFriday
      ? ["default", "friday_work"]
      : underlyingHalf
        ? ["default", "vacation", "short_hours"]
        : ["default", "vacation", "short_hours", "short_day"];

  const [sel, setSel] = React.useState<Selection>(override?.kind ?? "default");
  const [start, setStart] = React.useState("07:00");
  const [end, setEnd] = React.useState("15:35");
  const [bStart, setBStart] = React.useState("12:00");
  const [bEnd, setBEnd] = React.useState("13:00");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSel(override?.kind ?? "default");
    setStart(override?.start ?? "07:00");
    setEnd(override?.end ?? (underlyingEve || underlyingFriday ? "12:00" : "13:00"));
    setBStart(override?.breakStart ?? "12:00");
    setBEnd(override?.breakEnd ?? "13:00");
  }, [open, override, underlyingEve, underlyingFriday]);

  const needsHours = sel === "short_hours" || sel === "short_day" || sel === "friday_work" || sel === "eve_work";
  const halfKind = sel === "friday_work" || sel === "eve_work";
  const noBreak = halfKind; // half days have no break
  const endErr = needsHours && isEndBeforeStart(start, end);
  const capErr = needsHours && halfKind && toMinutes(end) > HALF_CAP;
  const canSave = sel === "default" || sel === "vacation" || (!!start && !!end && !endErr && !capErr);

  // net preview for the current selection
  const wdNet = weekdayDefault.isWorking
    ? netMinutes(weekdayDefault.start, weekdayDefault.end, weekdayDefault.breakStart, weekdayDefault.breakEnd)
    : 0;
  const defaultNet = underlyingHalf ? 300 : underlyingEve || underlyingFriday ? 0 : override ? wdNet : day.netMinutes;
  const net =
    sel === "default" ? defaultNet : sel === "vacation" ? 0 : netMinutes(start, end, noBreak ? null : bStart, noBreak ? null : bEnd);

  const chipLabel = (k: Selection): string => {
    if (k === "default") {
      if (underlyingEve || underlyingFriday) return "סגור (רגיל)";
      if (underlyingHalf) return "חצי יום (רגיל)";
      return "רגיל";
    }
    return {
      vacation: "יום חופש",
      short_hours: "שעות מקוצרות",
      short_day: "יום קצר",
      friday_work: "עבודה בשישי",
      eve_work: "עבודה בערב חג",
    }[k];
  };

  // `selection` is a PARAMETER, not read from state: the "אפס לברירת מחדל"
  // button calls setSel("default") and save() in the same handler, so the state
  // it just queued is not visible here yet. Passing the intent explicitly is the
  // only way that path reaches the delete branch.
  async function save(selection: Selection = sel) {
    setSaving(true);
    try {
      if (selection === "default") {
        // Reset to default = remove any override for this date.
        if (override) {
          const res = await apiFetch(`/api/settings/work-hours/overrides/${override.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "האיפוס נכשל");
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
        const res = await apiFetch(`/api/settings/work-hours/overrides`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "השמירה נכשלה");
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
        footer={<Button variant="outlined" onClick={onClose}>סגור</Button>}
      >
        <div style={{ background: SOFT, borderRadius: 10, padding: "14px 16px", fontSize: 13.5, color: INK, lineHeight: 1.6 }}>
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
            <Button variant="contained" onClick={() => onEditHoliday(day.holidayId!)}>ערוך חופשה</Button>
            <Button variant="outlined" onClick={onClose}>סגור</Button>
          </>
        }
      >
        <div style={{ background: SOFT, borderRadius: 10, padding: "14px 16px", fontSize: 13.5, color: INK, lineHeight: 1.6 }}>
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
          ? `${day.label ?? "ערב חג"} — לא עובדים כברירת מחדל, ניתן לפתוח חצי יום עד 12:00.`
          : underlyingFriday
            ? "שישי אינו יום עבודה. ניתן לפתוח חצי יום עד 12:00."
            : underlyingHalf
              ? `${day.label ?? ""} — חצי יום עבודה (07:00–12:00) כברירת מחדל.`
              : "בחר סוג יום להזנת חריגה, או השאר 'רגיל' כדי לעקוב אחר ברירת המחדל."
      }
      footer={
        <>
          <Button variant="contained" onClick={() => void save()} disabled={!canSave || saving}>שמור</Button>
          <Button variant="outlined" onClick={onClose}>ביטול</Button>
          {override ? (
            <button
              type="button"
              onClick={() => { setSel("default"); void save("default"); }}
              disabled={saving}
              style={{ marginInlineStart: "auto", background: "none", border: "none", color: DANGER, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              אפס לברירת מחדל
            </button>
          ) : null}
        </>
      }
    >
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>סוג היום</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: needsHours ? 18 : 4 }}>
        {kinds.map((k) => (
          <Chip key={k} active={sel === k} onClick={() => setSel(k)}>{chipLabel(k)}</Chip>
        ))}
      </div>

      {needsHours && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <TimeField label="שעת התחלה" value={start} onChange={setStart} />
            <TimeField label="שעת סיום" value={end} onChange={setEnd} error={endErr || capErr} />
            {!noBreak && <TimeField label="תחילת הפסקה" value={bStart} onChange={setBStart} />}
            {!noBreak && <TimeField label="סיום הפסקה" value={bEnd} onChange={setBEnd} />}
          </div>
          {(endErr || capErr) && (
            <div style={{ color: DANGER, fontSize: 12.5, marginTop: 8 }}>
              {endErr ? ERR_END_BEFORE_START : ERR_HALF_DAY_MAX}
            </div>
          )}
          {halfKind && !endErr && !capErr && (
            <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>ניתן לעבוד עד השעה 12:00.</div>
          )}
        </>
      )}

      <NetRow minutes={net} />
    </DialogShell>
  );
}
