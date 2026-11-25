"use client";
import * as React from "react";
import { RED } from "@/components/ui/colors";
import { Button } from "@/components/ui";
import { sendJson } from "@/lib/api/client";
import { FRIDAY, type Weekday } from "@/lib/time/civil";
import { WEEKDAY_LABELS, ERR_END_BEFORE_START, ERR_HALF_DAY_MAX, type WeekdayDefault } from "@/lib/workHours/types";
import {
  DEFAULT_BREAK_END,
  DEFAULT_BREAK_START,
  DEFAULT_END,
  DEFAULT_START,
  HALF_DAY_END,
  exceedsHalfDayCap,
  isEndBeforeStart,
  netMinutes,
} from "@/lib/workHours/time";
import { DialogShell, Chip, TimeField, NetRow } from "./fields";

export default function WeekdayEditorDialog({
  open,
  weekday,
  value,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  weekday: Weekday;
  value: WeekdayDefault;
  onClose: () => void;
  onSaved: (updated: WeekdayDefault, label: string) => void;
  onError: (msg: string) => void;
}) {
  const [working, setWorking] = React.useState(value.isWorking);
  const [start, setStart] = React.useState(value.start ?? DEFAULT_START);
  const [end, setEnd] = React.useState(value.end ?? DEFAULT_END);
  const [bStart, setBStart] = React.useState(value.breakStart ?? DEFAULT_BREAK_START);
  const [bEnd, setBEnd] = React.useState(value.breakEnd ?? DEFAULT_BREAK_END);
  const [saving, setSaving] = React.useState(false);

  // Reseed from the row whenever the dialog (re)opens for a weekday; done
  // during render, so the old values are never painted.
  const seedInputs = [open, value, weekday] as const;
  const [seededFor, setSeededFor] = React.useState<typeof seedInputs | null>(null);
  if (!seededFor || seedInputs.some((v, i) => v !== seededFor[i])) {
    setSeededFor(seedInputs);
    if (open) {
      setWorking(value.isWorking);
      setStart(value.start ?? DEFAULT_START);
      setEnd(value.end ?? (weekday === FRIDAY ? HALF_DAY_END : DEFAULT_END));
      setBStart(value.breakStart ?? DEFAULT_BREAK_START);
      setBEnd(value.breakEnd ?? DEFAULT_BREAK_END);
    }
  }

  const isFriday = weekday === FRIDAY;
  const endErr = working && isEndBeforeStart(start, end);
  const capErr = working && isFriday && exceedsHalfDayCap(end);
  const canSave = !working || (!!start && !!end && !endErr && !capErr);
  const net = working ? netMinutes(start, end, isFriday ? null : bStart, isFriday ? null : bEnd) : 0;

  async function save() {
    setSaving(true);
    try {
      const saved = await sendJson<WeekdayDefault>(
        `/api/settings/work-hours/defaults/${weekday}`,
        "PUT",
        working
          ? { isWorking: true, start, end, breakStart: isFriday ? null : bStart, breakEnd: isFriday ? null : bEnd }
          : { isWorking: false },
        "שמירת היום נכשלה",
      );
      onSaved(saved, `יום ${WEEKDAY_LABELS[weekday]}`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={`ברירת מחדל · יום ${WEEKDAY_LABELS[weekday]}`}
      subtitle={
        isFriday
          ? `שישי אינו יום עבודה. ניתן לפתוח אותו להזנת שעות (עד ${HALF_DAY_END}).`
          : `חל על כל יום ${WEEKDAY_LABELS[weekday]} שלא הוזנה לו חריגה.`
      }
      footer={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose}>ביטול</Button>
          <Button variant="contained" onClick={save} disabled={!canSave} loading={saving}>
            שמור
          </Button>
        </>
      }
    >
      <div id="weekday-working-label" className="sh-field-label">המחלקה עובדת ביום זה</div>
      <div role="group" aria-labelledby="weekday-working-label" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <Chip active={working} onClick={() => setWorking(true)}>כן</Chip>
        <Chip active={!working} onClick={() => setWorking(false)}>לא</Chip>
      </div>

      {working ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            <TimeField label="שעת התחלה" value={start} onChange={setStart} />
            <TimeField label="שעת סיום" value={end} onChange={setEnd} error={endErr || capErr} />
            {!isFriday && <TimeField label="תחילת הפסקה" value={bStart} onChange={setBStart} />}
            {!isFriday && <TimeField label="סיום הפסקה" value={bEnd} onChange={setBEnd} />}
          </div>
          {(endErr || capErr) && (
            <div role="alert" style={{ color: RED, fontSize: "var(--text-fine)", marginTop: 8 }}>
              {endErr ? ERR_END_BEFORE_START : ERR_HALF_DAY_MAX}
            </div>
          )}
        </>
      ) : null}

      <NetRow minutes={net} />
    </DialogShell>
  );
}
