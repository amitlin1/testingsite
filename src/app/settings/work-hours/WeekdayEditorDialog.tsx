"use client";
import * as React from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { WEEKDAY_LABELS, ERR_END_BEFORE_START, ERR_HALF_DAY_MAX, type Weekday, type WeekdayDefault } from "@/lib/workHours/types";
import { isEndBeforeStart, netMinutes, toMinutes } from "@/lib/workHours/time";
import { DialogShell, Chip, TimeField, NetRow } from "./fields";
import { DANGER, MUTED } from "./ui";

const HALF_DAY_CAP = toMinutes("12:00");

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
  const [start, setStart] = React.useState(value.start ?? "07:00");
  const [end, setEnd] = React.useState(value.end ?? "15:35");
  const [bStart, setBStart] = React.useState(value.breakStart ?? "12:00");
  const [bEnd, setBEnd] = React.useState(value.breakEnd ?? "13:00");
  const [saving, setSaving] = React.useState(false);

  // Reseed from the row whenever the dialog (re)opens for a weekday.
  React.useEffect(() => {
    if (!open) return;
    setWorking(value.isWorking);
    setStart(value.start ?? "07:00");
    setEnd(value.end ?? (weekday === 5 ? "12:00" : "15:35"));
    setBStart(value.breakStart ?? "12:00");
    setBEnd(value.breakEnd ?? "13:00");
  }, [open, value, weekday]);

  const isFriday = weekday === 5;
  const endErr = working && isEndBeforeStart(start, end);
  const capErr = working && isFriday && toMinutes(end) > HALF_DAY_CAP;
  const canSave = !working || (!!start && !!end && !endErr && !capErr);
  const net = working ? netMinutes(start, end, isFriday ? null : bStart, isFriday ? null : bEnd) : 0;

  async function save() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/settings/work-hours/defaults/${weekday}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          working
            ? { isWorking: true, start, end, breakStart: isFriday ? null : bStart, breakEnd: isFriday ? null : bEnd }
            : { isWorking: false },
        ),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error || "שמירת היום נכשלה");
      }
      const saved = (await res.json()) as WeekdayDefault;
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
          ? "שישי אינו יום עבודה. ניתן לפתוח אותו להזנת שעות (עד 12:00)."
          : `חל על כל יום ${WEEKDAY_LABELS[weekday]} שלא הוזנה לו חריגה.`
      }
      footer={
        <>
          <Button variant="contained" onClick={save} disabled={!canSave || saving}>
            שמור
          </Button>
          <Button variant="outlined" onClick={onClose}>ביטול</Button>
        </>
      }
    >
      <div style={{ marginBottom: 4, fontSize: 13, color: MUTED }}>המחלקה עובדת ביום זה</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <Chip active={working} onClick={() => setWorking(true)}>כן</Chip>
        <Chip active={!working} onClick={() => setWorking(false)}>לא</Chip>
      </div>

      {working ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <TimeField label="שעת התחלה" value={start} onChange={setStart} />
            <TimeField label="שעת סיום" value={end} onChange={setEnd} error={endErr || capErr} />
            {!isFriday && <TimeField label="תחילת הפסקה" value={bStart} onChange={setBStart} />}
            {!isFriday && <TimeField label="סיום הפסקה" value={bEnd} onChange={setBEnd} />}
          </div>
          {(endErr || capErr) && (
            <div style={{ color: DANGER, fontSize: 12.5, marginTop: 8 }}>
              {endErr ? ERR_END_BEFORE_START : ERR_HALF_DAY_MAX}
            </div>
          )}
        </>
      ) : null}

      <NetRow minutes={net} />
    </DialogShell>
  );
}
