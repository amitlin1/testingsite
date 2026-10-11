"use client";
import * as React from "react";
import { Button, TextField } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import {
  ERR_HOLIDAY_RANGE,
  type DepartmentHoliday,
  type HolidayType,
} from "@/lib/workHours/types";
import { DialogShell, Chip, TimeField } from "./fields";


export default function HolidayDialog({
  open,
  editing,
  holidayTypes,
  onClose,
  onSaved,
  onError,
  onTypeAdded,
}: {
  open: boolean;
  editing: DepartmentHoliday | null;
  holidayTypes: HolidayType[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  onTypeAdded: (t: HolidayType) => void;
}) {
  const [name, setName] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [typeId, setTypeId] = React.useState<number | null>(null);
  const [isHalf, setIsHalf] = React.useState(false);
  const [halfEnd, setHalfEnd] = React.useState("12:00");
  const [saving, setSaving] = React.useState(false);
  const [addingType, setAddingType] = React.useState(false);
  const [newType, setNewType] = React.useState("");

  // Read through a ref, NOT a dependency: "+ סוג חדש" appends to holidayTypes in
  // the parent, and a new array identity in the dep list would re-run this
  // seeding effect mid-edit — blanking every field the user already filled in
  // and overwriting the type just created with holidayTypes[0].
  const typesRef = React.useRef(holidayTypes);
  typesRef.current = holidayTypes;

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setStartDate(editing?.startDate ?? "");
    setEndDate(editing?.endDate ?? "");
    setTypeId(editing?.typeId ?? typesRef.current[0]?.id ?? null);
    setIsHalf(editing?.isHalfDay ?? false);
    setHalfEnd(editing?.halfDayEndTime ?? "12:00");
    setAddingType(false);
    setNewType("");
  }, [open, editing]);

  const rangeErr = !!startDate && !!endDate && endDate < startDate;
  const canSave = !!name.trim() && !!startDate && !!endDate && !rangeErr && typeId != null && (!isHalf || !!halfEnd);

  async function createType() {
    const n = newType.trim();
    if (!n) return;
    try {
      const res = await apiFetch(`/api/settings/work-hours/holiday-types`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "יצירת הסוג נכשלה");
      const t = (await res.json()) as HolidayType;
      onTypeAdded(t);
      setTypeId(t.id);
      setAddingType(false);
      setNewType("");
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        typeId,
        startDate,
        endDate,
        isHalfDay: isHalf,
        halfDayEndTime: isHalf ? halfEnd : null,
      };
      const url = editing
        ? `/api/settings/work-hours/holidays/${editing.id}`
        : `/api/settings/work-hours/holidays`;
      const res = await apiFetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "שמירת החופשה נכשלה");
      onSaved(editing ? "החופשה עודכנה בהצלחה" : "החופשה נוספה בהצלחה");
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
      title={editing ? "עריכת חופשה" : "הוסף חופשה"}
      subtitle="חופשה פנימית של המחלקה (חגי ישראל נוספים אוטומטית)."
      footer={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose}>ביטול</Button>
          <Button variant="contained" onClick={save} disabled={!canSave} loading={saving}>שמור</Button>
        </>
      }
    >
      <div style={{ marginBottom: 14 }}>
        <TextField label="שם" required fullWidth value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 200 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 14 }}>
        <TextField label="מתאריך" type="date" required fullWidth value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <TextField
          label="עד תאריך"
          type="date"
          required
          fullWidth
          value={endDate}
          inputProps={{ min: startDate || undefined }}
          onChange={(e) => setEndDate(e.target.value)}
          error={rangeErr}
          helperText={rangeErr ? ERR_HOLIDAY_RANGE : undefined}
        />
      </div>

      <div id="holiday-type-label" className="sh-field-label">סוג</div>
      <div role="group" aria-labelledby="holiday-type-label" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {holidayTypes.map((t) => (
          <Chip key={t.id} active={typeId === t.id} onClick={() => setTypeId(t.id)}>{t.name}</Chip>
        ))}
        {addingType ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              autoFocus
              className="sh-input"
              aria-label="שם סוג החופשה החדש"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void createType(); }}
              placeholder="שם הסוג"
              style={{ height: 34, width: 160, fontSize: "var(--text-small)", padding: "0 10px" }}
            />
            <Button size="small" onClick={createType}>הוסף</Button>
          </span>
        ) : (
          <button type="button" className="wh-add-type" onClick={() => setAddingType(true)}>
            + סוג חדש
          </button>
        )}
      </div>

      <div id="holiday-scope-label" className="sh-field-label">היקף</div>
      <div role="group" aria-labelledby="holiday-scope-label" style={{ display: "flex", gap: 8, marginBottom: isHalf ? 16 : 4 }}>
        <Chip active={!isHalf} onClick={() => setIsHalf(false)}>יום מלא</Chip>
        <Chip active={isHalf} onClick={() => setIsHalf(true)}>חצי יום</Chip>
      </div>
      {isHalf && (
        <div style={{ maxWidth: 200 }}>
          <TimeField label="עובדים עד שעה" value={halfEnd} onChange={setHalfEnd} />
        </div>
      )}
    </DialogShell>
  );
}
