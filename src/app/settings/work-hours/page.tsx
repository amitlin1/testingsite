"use client";
import * as React from "react";
import { ChevronRight, ChevronLeft, Pencil, Trash2, Plus } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";
import DataTable, { RowActions, IconAction, type Column } from "@/components/DataTable";
import { Snackbar, Alert } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import {
  WEEKDAY_LABELS,
  OVERRIDE_LABELS,
  type DepartmentHoliday,
  type HolidayType,
  type IsraeliHolidayCategory,
  type IsraeliHolidayInfo,
  type ResolvedDay,
  type Weekday,
  type WeekdayDefault,
  type WorkdayOverride,
} from "@/lib/workHours/types";
import {
  netMinutes, formatNet, weekdayOf, toDateString, addDays, monthStartISO, monthEndISO,
} from "@/lib/workHours/time";
import WeekdayEditorDialog from "./WeekdayEditorDialog";
import DayEditorDialog from "./DayEditorDialog";
import HolidayDialog from "./HolidayDialog";
import {
  Bdi, card, timeRange, dayNum, dayDotMonth, monthTitle, recordDetail,
  BLUE, INK, MUTED, FAINT, HAIRLINE, SOFT, WEEKDAY_HEADERS, EM_DASH,
} from "./ui";

type Toast = { open: boolean; sev: "success" | "error"; msg: string };

/** Merge consecutive same-label days into one "record" for the month list. */
type MonthRecord = { startDate: string; endDate: string; label: string; day: ResolvedDay };
function buildRecords(days: ResolvedDay[]): MonthRecord[] {
  const notable = days.filter((d) => d.label && d.category !== "shabbat" && d.category !== "friday");
  const out: MonthRecord[] = [];
  for (const d of notable) {
    const prev = out[out.length - 1];
    // addDays, not `new Date(iso) + 86400000`: that parses as UTC midnight and
    // then reads LOCAL components, so west of Greenwich the "next day" comes
    // back as the SAME date and consecutive days never merge into one record.
    const nextOfPrev = prev ? addDays(prev.endDate, 1) : null;
    if (prev && prev.label === d.label && prev.day.category === d.category && nextOfPrev === d.date) {
      prev.endDate = d.date;
    } else {
      out.push({ startDate: d.date, endDate: d.date, label: d.label!, day: d });
    }
  }
  return out;
}
function recordDateLabel(r: MonthRecord): string {
  if (r.startDate === r.endDate) return dayDotMonth(r.startDate);
  const [, sm, sd] = r.startDate.split("-").map(Number);
  const [, em, ed] = r.endDate.split("-").map(Number);
  return sm === em ? `${sd}–${ed}.${sm}` : `${sd}.${sm}–${ed}.${em}`;
}

export default function WorkHoursPage() {
  const now = React.useMemo(() => new Date(), []);
  const [view, setView] = React.useState({ y: now.getFullYear(), m: now.getMonth() });

  const [defaults, setDefaults] = React.useState<WeekdayDefault[]>([]);
  const [holidayTypes, setHolidayTypes] = React.useState<HolidayType[]>([]);
  const [holidays, setHolidays] = React.useState<DepartmentHoliday[]>([]);
  const [monthDays, setMonthDays] = React.useState<ResolvedDay[]>([]);
  const [monthOverrides, setMonthOverrides] = React.useState<WorkdayOverride[]>([]);
  const [israeliCat, setIsraeliCat] = React.useState<Map<string, IsraeliHolidayCategory>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [toast, setToast] = React.useState<Toast>({ open: false, sev: "success", msg: "" });

  const [dayDlg, setDayDlg] = React.useState<{ open: boolean; day: ResolvedDay | null }>({ open: false, day: null });
  const [wdDlg, setWdDlg] = React.useState<{ open: boolean; weekday: Weekday | null }>({ open: false, weekday: null });
  const [holDlg, setHolDlg] = React.useState<{ open: boolean; editing: DepartmentHoliday | null }>({ open: false, editing: null });
  const [addingType, setAddingType] = React.useState(false);
  const [newType, setNewType] = React.useState("");

  const ok = (msg: string) => setToast({ open: true, sev: "success", msg });
  const fail = (msg: string) => setToast({ open: true, sev: "error", msg });

  const from = monthStartISO(view.y, view.m);
  const to = monthEndISO(view.y, view.m);

  const loadStatic = React.useCallback(async () => {
    try {
      const [d, t, h] = await Promise.all([
        apiFetch("/api/settings/work-hours/defaults"),
        apiFetch("/api/settings/work-hours/holiday-types"),
        apiFetch("/api/settings/work-hours/holidays"),
      ]);
      if (d.ok) setDefaults(await d.json());
      if (t.ok) setHolidayTypes(await t.json());
      if (h.ok) setHolidays(await h.json());
    } catch {
      fail("שגיאה בטעינת נתונים");
    }
  }, []);

  const loadMonth = React.useCallback(async () => {
    setLoading(true);
    try {
      const [cal, ov] = await Promise.all([
        apiFetch(`/api/settings/work-hours/calendar?from=${from}&to=${to}`),
        apiFetch(`/api/settings/work-hours/overrides?from=${from}&to=${to}`),
      ]);
      if (cal.ok) {
        const j = (await cal.json()) as { days: ResolvedDay[]; israeli: IsraeliHolidayInfo[] };
        setMonthDays(j.days ?? []);
        setIsraeliCat(new Map((j.israeli ?? []).map((h) => [h.date, h.category])));
      } else {
        fail("שגיאה בטעינת הלוח");
      }
      if (ov.ok) setMonthOverrides(await ov.json());
    } catch {
      fail("שגיאה בטעינת הלוח");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  React.useEffect(() => { void loadStatic(); }, [loadStatic]);
  React.useEffect(() => { void loadMonth(); }, [loadMonth]);

  const defByWeekday = React.useMemo(() => {
    const m = new Map<Weekday, WeekdayDefault>();
    for (const d of defaults) m.set(d.weekday, d);
    return m;
  }, [defaults]);

  const daysByDate = React.useMemo(() => {
    const m = new Map<string, ResolvedDay>();
    for (const d of monthDays) m.set(d.date, d);
    return m;
  }, [monthDays]);

  const dailyNet = React.useMemo(() => {
    const w = defByWeekday.get(0 as Weekday);
    return w?.isWorking ? netMinutes(w.start, w.end, w.breakStart, w.breakEnd) : 0;
  }, [defByWeekday]);

  const records = React.useMemo(() => buildRecords(monthDays), [monthDays]);

  const afterSave = () => { setDayDlg({ open: false, day: null }); setWdDlg({ open: false, weekday: null }); setHolDlg({ open: false, editing: null }); void loadMonth(); void loadStatic(); };

  function stepMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  function openDay(day: ResolvedDay) { setDayDlg({ open: true, day }); }
  function openTodayException() {
    const today = toDateString(now);
    openDay(daysByDate.get(today) ?? monthDays[0] ?? ({} as ResolvedDay));
  }

  async function deleteHoliday(h: DepartmentHoliday) {
    if (!window.confirm(`למחוק את "${h.name}"?`)) return;
    const res = await apiFetch(`/api/settings/work-hours/holidays/${h.id}`, { method: "DELETE" });
    if (res.ok) { ok("החופשה נמחקה"); afterSave(); }
    else fail((await res.json().catch(() => null))?.error || "מחיקת החופשה נכשלה");
  }
  async function deleteOverride(o: WorkdayOverride) {
    if (!window.confirm(`לאפס את ${OVERRIDE_LABELS[o.kind]} בתאריך ${o.date} לברירת המחדל?`)) return;
    const res = await apiFetch(`/api/settings/work-hours/overrides/${o.id}`, { method: "DELETE" });
    if (res.ok) { ok("החריגה בוטלה"); afterSave(); }
    else fail((await res.json().catch(() => null))?.error || "ביטול החריגה נכשל");
  }
  async function deleteType(t: HolidayType) {
    const res = await apiFetch(`/api/settings/work-hours/holiday-types/${t.id}`, { method: "DELETE" });
    if (res.ok) { ok("הסוג נמחק"); void loadStatic(); }
    else fail((await res.json().catch(() => null))?.error || "מחיקת הסוג נכשלה");
  }
  async function addType() {
    const n = newType.trim();
    if (!n) return;
    const res = await apiFetch("/api/settings/work-hours/holiday-types", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }),
    });
    if (res.ok) { setAddingType(false); setNewType(""); ok("הסוג נוסף"); void loadStatic(); }
    else fail((await res.json().catch(() => null))?.error || "יצירת הסוג נכשלה");
  }

  // Unified management table: department holidays (all) + the shown month's
  // single-day exceptions, so an entered "יום חופש" is visible where expected.
  type EntryRow = {
    key: string; sort: string; when: React.ReactNode; desc: string;
    source: string; details: React.ReactNode; onEdit: () => void; onDelete: () => void;
  };
  const entryRows: EntryRow[] = React.useMemo(() => {
    const rows: EntryRow[] = [];
    for (const h of holidays) {
      rows.push({
        key: `h${h.id}`, sort: h.startDate,
        when: <Bdi>{h.startDate === h.endDate ? dayDotMonth(h.startDate) : `${dayDotMonth(h.startDate)}–${dayDotMonth(h.endDate)}`}</Bdi>,
        desc: h.name,
        source: `חופשת מחלקה · ${h.typeName || EM_DASH}`,
        details: h.isHalfDay ? `חצי יום · עד ${h.halfDayEndTime}` : "יום מלא",
        onEdit: () => setHolDlg({ open: true, editing: h }),
        onDelete: () => deleteHoliday(h),
      });
    }
    for (const o of monthOverrides) {
      const d = daysByDate.get(o.date);
      rows.push({
        key: `o${o.id}`, sort: o.date,
        when: <Bdi>{dayDotMonth(o.date)}</Bdi>,
        desc: OVERRIDE_LABELS[o.kind],
        source: "חריגה יומית",
        details: o.kind === "vacation" ? "יום מלא" : o.start && o.end ? <Bdi>{`${o.start}–${o.end}`}</Bdi> : EM_DASH,
        onEdit: () => { if (d) openDay(d); },
        onDelete: () => deleteOverride(o),
      });
    }
    return rows.sort((a, b) => a.sort.localeCompare(b.sort));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidays, monthOverrides, daysByDate]);

  const entryColumns: Column<EntryRow>[] = [
    { key: "when", header: "תאריך", nums: true, cell: (r) => r.when },
    { key: "desc", header: "תיאור", bold: true, cell: (r) => r.desc },
    { key: "source", header: "מקור", muted: true, cell: (r) => r.source },
    { key: "details", header: "פרטים", cell: (r) => r.details },
    {
      key: "__a", header: "פעולות", align: "center", width: 120,
      cell: (r) => (
        <RowActions>
          <IconAction title="ערוך" onClick={r.onEdit}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title="מחק" danger onClick={r.onDelete}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  const firstWeekday = weekdayOf(from); // 0..6 leading blanks

  return (
    <div dir="rtl" style={{ height: "100%", overflow: "auto", padding: 24, color: INK }}>
      <SettingsToolbar
        title="שעות עבודה וחופשות"
        subtitle="שעות הפעילות של המחלקה וימי ההיעדרות המשותפים. עריכה: אדמין ועובד משאן."
        onAdd={() => setHolDlg({ open: true, editing: null })}
        addLabel="הוסף חופשה"
      >
        <button className="shx-btn" onClick={openTodayException} disabled={loading || monthDays.length === 0}>
          <Plus size={16} strokeWidth={2} />
          הזן חריגה ליום
        </button>
      </SettingsToolbar>

      {/* ---------- weekly default card ---------- */}
      <div style={{ ...card, padding: 24, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>שעות ברירת מחדל</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>חלות על כל יום שלא הוזנה לו חריגה.</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 13, color: FAINT }}>נטו ליום</span>
            <Bdi><span style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatNet(dailyNet)}</span></Bdi>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10, marginTop: 16 }}>
          {([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((wd) => {
            const d = defByWeekday.get(wd);
            const isSat = wd === 6;
            const isFri = wd === 5;
            const working = !!d?.isWorking && !!d.start && !!d.end;
            return (
              <button
                key={wd}
                type="button"
                onClick={() => !isSat && setWdDlg({ open: true, weekday: wd })}
                className="wh-tile"
                style={{
                  textAlign: "center", minHeight: 108, borderRadius: 8, padding: "14px 12px",
                  cursor: isSat ? "default" : "pointer",
                  background: isSat ? SOFT : isFri && !working ? "#fafafa" : "#fff",
                  border: isFri && !working ? `1px dashed #d4d4dc` : `1px solid ${HAIRLINE}`,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  font: "inherit", color: "inherit",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: isSat ? MUTED : INK }}>{WEEKDAY_LABELS[wd]}</div>
                {working ? (
                  <>
                    <Bdi><span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{timeRange(d!.start, d!.end)}</span></Bdi>
                    <div style={{ fontSize: 11.5, color: FAINT }}>
                      {d!.breakStart && d!.breakEnd ? <>הפסקה <Bdi>{timeRange(d!.breakStart, d!.breakEnd)}</Bdi></> : "ללא הפסקה"}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>לא עובדים</div>
                    {isFri ? (
                      <div style={{ fontSize: 11.5, color: BLUE, display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE }} />ניתן להזין עבודה
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: FAINT }}>קבוע</div>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- calendar + aside ---------- */}
      <div className="wh-cols" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 18, marginTop: 18, alignItems: "start" }}>
        {/* calendar */}
        <div style={{ ...card, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{monthTitle(view.y, view.m)}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="wh-nav" type="button" aria-label="חודש הבא" onClick={() => stepMonth(1)}><ChevronLeft size={18} /></button>
              <button className="wh-nav" type="button" aria-label="חודש קודם" onClick={() => stepMonth(-1)}><ChevronRight size={18} /></button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
            {WEEKDAY_HEADERS.map((h) => (
              <div key={h} style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: FAINT }}>{h}</div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {Array.from({ length: firstWeekday }).map((_, i) => <div key={`b${i}`} />)}
            {monthDays.map((d) => <CalendarCell key={d.date} d={d} onClick={() => openDay(d)} />)}
          </div>

          {/* legend */}
          <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap", fontSize: 11.5, color: MUTED }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: SOFT, border: `1px solid ${HAIRLINE}` }} />יום ללא עבודה</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE }} />שעות שהוזנו ידנית</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "#fafafa", border: `1px dashed #d4d4dc` }} />שישי / ערב חג — ניתן להזין עבודה</span>
          </div>
        </div>

        {/* aside */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>החודש</div>
            <div style={{ fontSize: 12.5, color: FAINT, marginTop: 4 }}>{records.length} רשומות ב{monthTitle(view.y, view.m).split(" ")[0]}.</div>
            <div style={{ marginTop: 12 }}>
              {records.length === 0 ? (
                <div style={{ fontSize: 13, color: FAINT }}>אין רשומות מיוחדות החודש.</div>
              ) : (
                records.map((r) => (
                  <button
                    key={r.startDate}
                    type="button"
                    onClick={() => openDay(r.day)}
                    className="wh-rec"
                    style={{ display: "flex", gap: 12, width: "100%", textAlign: "right", padding: "10px 8px", borderTop: `1px solid ${SOFT}`, background: "none", border: "none", borderTopStyle: "solid", cursor: "pointer", font: "inherit", color: "inherit" }}
                  >
                    <Bdi><span style={{ fontSize: 13, fontWeight: 700, color: INK, minWidth: 46, display: "inline-block", fontVariantNumeric: "tabular-nums" }}>{recordDateLabel(r)}</span></Bdi>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{r.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: FAINT, marginTop: 2 }}>{recordDetail(r.day)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>סוגי חופשה</div>
            <div style={{ fontSize: 12.5, color: FAINT, marginTop: 4 }}>ניתן להוסיף סוג משלך.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {holidayTypes.map((t) => (
                <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 5, padding: "6px 11px", fontSize: 13, color: INK }}>
                  {t.name}
                  {!t.isSystem && (t.usageCount ?? 0) === 0 && (
                    <button type="button" aria-label="מחק סוג" onClick={() => deleteType(t)} style={{ background: "none", border: "none", color: FAINT, cursor: "pointer", padding: 0, display: "flex" }}>
                      <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                  )}
                </span>
              ))}
              {addingType ? (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <input autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addType(); if (e.key === "Escape") setAddingType(false); }} placeholder="שם הסוג" style={{ height: 34, borderRadius: 5, border: `1px solid ${HAIRLINE}`, padding: "0 10px", fontSize: 13, fontFamily: "inherit" }} />
                  <button className="shx-btn shx-btn-primary" onClick={addType} style={{ height: 34 }}>הוסף</button>
                </span>
              ) : (
                <button type="button" onClick={() => setAddingType(true)} style={{ borderRadius: 5, padding: "6px 11px", fontSize: 13, fontWeight: 600, background: "#fff", color: BLUE, border: `1px dashed ${HAIRLINE}`, cursor: "pointer", fontFamily: "inherit" }}>+ סוג חדש</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- holidays + single-day exceptions ---------- */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>חופשות וחריגות</div>
        <div style={{ fontSize: 12.5, color: FAINT, marginBottom: 12 }}>
          חופשות מרוכזות של המחלקה, וחריגות יומיות של {monthTitle(view.y, view.m)}. חגי ישראל נוספים אוטומטית ואינם מופיעים כאן.
        </div>
        <DataTable<EntryRow>
          columns={entryColumns}
          rows={entryRows}
          getRowKey={(r) => r.key}
          loading={loading && entryRows.length === 0}
          minWidth={720}
          empty={<div style={{ padding: 24, textAlign: "center", color: FAINT }}>אין רשומות. הזן יום חופש בלחיצה על יום בלוח, או חופשה מרוכזת דרך "הוסף חופשה".</div>}
        />
      </div>

      {/* ---------- dialogs ---------- */}
      {wdDlg.open && wdDlg.weekday != null && (
        <WeekdayEditorDialog
          open={wdDlg.open}
          weekday={wdDlg.weekday}
          value={defByWeekday.get(wdDlg.weekday) ?? { weekday: wdDlg.weekday, isWorking: false, start: null, end: null, breakStart: null, breakEnd: null }}
          onClose={() => setWdDlg({ open: false, weekday: null })}
          onSaved={(_u, label) => { ok(`${label} עודכן בהצלחה`); afterSave(); }}
          onError={fail}
        />
      )}

      {dayDlg.open && dayDlg.day && (
        <DayEditorDialog
          open={dayDlg.open}
          day={dayDlg.day}
          override={monthOverrides.find((o) => o.date === dayDlg.day!.date) ?? null}
          weekdayDefault={defByWeekday.get(dayDlg.day.weekday) ?? { weekday: dayDlg.day.weekday, isWorking: false, start: null, end: null, breakStart: null, breakEnd: null }}
          israeliCategory={israeliCat.get(dayDlg.day.date) ?? null}
          onClose={() => setDayDlg({ open: false, day: null })}
          onSaved={(msg) => { ok(msg); afterSave(); }}
          onError={fail}
          onEditHoliday={(id) => {
            const h = holidays.find((x) => x.id === id) ?? null;
            setDayDlg({ open: false, day: null });
            if (h) setHolDlg({ open: true, editing: h });
          }}
        />
      )}

      {holDlg.open && (
        <HolidayDialog
          open={holDlg.open}
          editing={holDlg.editing}
          holidayTypes={holidayTypes}
          onClose={() => setHolDlg({ open: false, editing: null })}
          onSaved={(msg) => { ok(msg); afterSave(); }}
          onError={fail}
          onTypeAdded={(t) => setHolidayTypes((prev) => [...prev, t])}
        />
      )}

      <Snackbar open={toast.open} autoHideDuration={4000} onClose={() => setToast((t) => ({ ...t, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Alert severity={toast.sev} onClose={() => setToast((t) => ({ ...t, open: false }))}>{toast.msg}</Alert>
      </Snackbar>

      <style>{`
        @media (max-width: 900px){ .wh-cols{ grid-template-columns:1fr !important; } }
        .wh-tile:hover{ border-color:#cfe0f5; }
        .wh-tile:active{ transform:scale(0.98); }
        .wh-nav{ width:32px;height:32px;border-radius:8px;background:${SOFT};border:none;color:${INK};cursor:pointer;display:flex;align-items:center;justify-content:center; }
        .wh-nav:hover{ background:#e6efff;color:${BLUE}; }
        .wh-rec:hover{ background:#fafafc; }
        .wh-cell:hover{ border-color:#cfe0f5 !important; }
      `}</style>
    </div>
  );
}

/* ---------- calendar cell ---------- */
function CalendarCell({ d, onClick }: { d: ResolvedDay; onClick: () => void }) {
  const isFriClosed = d.category === "friday" || (d.category === "eve" && !d.isWorking);
  const isOff = d.category === "full_off" || d.category === "vacation" || d.category === "shabbat";
  const manualWorking = d.isWorking && (d.source === "override" || (d.source === "holiday" && d.category === "half_day"));

  const bg = isOff ? SOFT : isFriClosed ? "#fafafa" : "#fff";
  const border = isFriClosed ? "1px dashed #d4d4dc" : `1px solid ${HAIRLINE}`;
  const muted = isOff || isFriClosed;

  return (
    <button
      type="button"
      onClick={onClick}
      className="wh-cell"
      style={{
        textAlign: "start", minHeight: 76, borderRadius: 8, padding: "7px 8px", cursor: "pointer",
        background: bg, border, display: "flex", flexDirection: "column", gap: 3, font: "inherit", color: "inherit", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {manualWorking && <span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE, flexShrink: 0 }} />}
        <span style={{ fontSize: 13, fontWeight: 600, color: muted ? FAINT : INK, fontVariantNumeric: "tabular-nums" }}>{dayNum(d.date)}</span>
      </div>
      {d.label && (
        <span style={{ fontSize: 10.5, color: isOff ? MUTED : BLUE, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
      )}
      {/* Every working day shows its hours, so a plain weekday reads clearly as a
          work day (07:00–15:35) — not just a bare number. */}
      {d.isWorking && d.start && d.end && (
        <Bdi><span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{timeRange(d.start, d.end)}</span></Bdi>
      )}
      {isOff && d.category !== "shabbat" && <span style={{ fontSize: 10, color: FAINT }}>יום מלא</span>}
    </button>
  );
}
