"use client";
import * as React from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import {
  ERR_HOLIDAY_RANGE,
  type DepartmentHoliday,
  type HolidayType,
} from "@/lib/workHours/types";
import { DialogShell, Chip, TimeField } from "./fields";
import { DANGER, HAIRLINE, INK, MUTED } from "./ui";

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

  const fieldLabel = { fontSize: 12, color: MUTED, marginBottom: 6 } as React.CSSProperties;
  const textInput: React.CSSProperties = {
    width: "100%", height: 44, borderRadius: 8, border: `1px solid ${HAIRLINE}`,
    padding: "0 12px", fontSize: 15, fontFamily: "inherit", color: INK, outline: "none",
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={editing ? "עריכת חופשה" : "הוסף חופשה"}
      subtitle="חופשה פנימית של המחלקה (חגי ישראל נוספים אוטומטית)."
      footer={
        <>
          <Button variant="contained" onClick={save} disabled={!canSave || saving}>שמור</Button>
          <Button variant="outlined" onClick={onClose}>ביטול</Button>
        </>
      }
    >
      <label style={{ display: "block", marginBottom: 14 }}>
        <div style={fieldLabel}>שם</div>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} style={textInput} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <label style={{ display: "block" }}>
          <div style={fieldLabel}>מתאריך</div>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={textInput} />
        </label>
        <label style={{ display: "block" }}>
          <div style={fieldLabel}>עד תאריך</div>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ ...textInput, borderColor: rangeErr ? DANGER : HAIRLINE }}
          />
        </label>
      </div>
      {rangeErr && <div style={{ color: DANGER, fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>{ERR_HOLIDAY_RANGE}</div>}

      <div style={fieldLabel}>סוג</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {holidayTypes.map((t) => (
          <Chip key={t.id} active={typeId === t.id} onClick={() => setTypeId(t.id)}>{t.name}</Chip>
        ))}
        {addingType ? (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <input
              autoFocus
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void createType(); }}
              placeholder="שם הסוג"
              style={{ height: 36, borderRadius: 8, border: `1px solid ${HAIRLINE}`, padding: "0 10px", fontSize: 13, fontFamily: "inherit" }}
            />
            <Button variant="contained" onClick={createType}>הוסף</Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAddingType(true)}
            style={{ borderRadius: 9999, padding: "8px 15px", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", background: "#fff", color: INK, border: `1px dashed ${HAIRLINE}` }}
          >
            + סוג חדש
          </button>
        )}
      </div>

      <div style={fieldLabel}>היקף</div>
      <div style={{ display: "flex", gap: 8, marginBottom: isHalf ? 16 : 4 }}>
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
