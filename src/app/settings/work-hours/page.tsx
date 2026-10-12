"use client";
import * as React from "react";
import { ChevronRight, ChevronLeft, Pencil, Trash2, Plus } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";
import DataTable, { RowActions, IconAction, type Column } from "@/components/DataTable";
import { Snackbar, Alert, ConfirmDialog, Button, IconButton } from "@/components/ui";
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
  Bdi, timeRange, dayNum, dayDotMonth, monthTitle, recordDetail,
  BLUE, INK, MUTED, FAINT, WEEKDAY_HEADERS, EM_DASH,
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
  // One confirmation for every delete / reset on this page — the app's own
  // dialog, like the rest of the system, not the browser's window.confirm.
  const [confirm, setConfirm] = React.useState<{ title: string; message: string; confirmText: string; run: () => Promise<void> } | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  async function runConfirmed() {
    if (!confirm) return;
    setConfirmBusy(true);
    try { await confirm.run(); } finally { setConfirmBusy(false); setConfirm(null); }
  }

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

  function deleteHoliday(h: DepartmentHoliday) {
    setConfirm({
      title: "מחיקת חופשה", confirmText: "מחק",
      message: `למחוק את "${h.name}"? פעולה זו אינה ניתנת לביטול.`,
      run: async () => {
        const res = await apiFetch(`/api/settings/work-hours/holidays/${h.id}`, { method: "DELETE" });
        if (res.ok) { ok("החופשה נמחקה"); afterSave(); }
        else fail((await res.json().catch(() => null))?.error || "מחיקת החופשה נכשלה");
      },
    });
  }
  function deleteOverride(o: WorkdayOverride) {
    setConfirm({
      title: "איפוס חריגה", confirmText: "אפס",
      message: `לאפס את ${OVERRIDE_LABELS[o.kind]} בתאריך ${o.date} לברירת המחדל?`,
      run: async () => {
        const res = await apiFetch(`/api/settings/work-hours/overrides/${o.id}`, { method: "DELETE" });
        if (res.ok) { ok("החריגה בוטלה"); afterSave(); }
        else fail((await res.json().catch(() => null))?.error || "ביטול החריגה נכשל");
      },
    });
  }
  function deleteType(t: HolidayType) {
    setConfirm({
      title: "מחיקת סוג חופשה", confirmText: "מחק",
      message: `למחוק את סוג החופשה "${t.name}"? פעולה זו אינה ניתנת לביטול.`,
      run: async () => {
        const res = await apiFetch(`/api/settings/work-hours/holiday-types/${t.id}`, { method: "DELETE" });
        if (res.ok) { ok("הסוג נמחק"); void loadStatic(); }
        else fail((await res.json().catch(() => null))?.error || "מחיקת הסוג נכשלה");
      },
    });
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
          <IconAction title={`ערוך את ${r.desc}`} onClick={r.onEdit}><Pencil size={16} strokeWidth={1.75} /></IconAction>
          <IconAction title={`מחק את ${r.desc}`} danger onClick={r.onDelete}><Trash2 size={16} strokeWidth={1.75} /></IconAction>
        </RowActions>
      ),
    },
  ];

  const firstWeekday = weekdayOf(from); // 0..6 leading blanks

  // The settings layout owns the frame (scroll, padding, 1180 column). Hover /
  // press / focus of the tiles, cells and records live in settings.css (.wh-*).
  return (
    <div dir="rtl" style={{ color: INK }}>
      <SettingsToolbar
        title="שעות עבודה וחופשות"
        subtitle="שעות הפעילות של המחלקה וימי ההיעדרות המשותפים. עריכה: אדמין ועובד משאן."
        onAdd={() => setHolDlg({ open: true, editing: null })}
        addLabel="הוסף חופשה"
      >
        <Button variant="outlined" onClick={openTodayException} disabled={loading || monthDays.length === 0} startIcon={<Plus size={16} strokeWidth={2} aria-hidden />}>
          הזן חריגה ליום
        </Button>
      </SettingsToolbar>

      {/* ---------- weekly default card ---------- */}
      <div className="wh-card" style={{ padding: 24, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 700 }}>שעות ברירת מחדל</h2>
            <div style={{ fontSize: "var(--text-small)", color: MUTED, marginTop: 4 }}>חלות על כל יום שלא הוזנה לו חריגה.</div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: "var(--text-small)", color: FAINT }}>נטו ליום</span>
            <Bdi><span style={{ fontSize: "var(--text-title)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatNet(dailyNet)}</span></Bdi>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10, marginTop: 16 }}>
          {([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((wd) => {
            const d = defByWeekday.get(wd);
            const isSat = wd === 6;
            const isFri = wd === 5;
            const working = !!d?.isWorking && !!d.start && !!d.end;
            return (
              <button
                key={wd}
                type="button"
                // Shabbat is fixed: no editor, so not a control either.
                onClick={() => !isSat && setWdDlg({ open: true, weekday: wd })}
                disabled={isSat}
                aria-label={isSat ? undefined : `ערוך את ברירת המחדל של יום ${WEEKDAY_LABELS[wd]}`}
                className={"wh-tile" + (isSat ? " wh-tile--fixed" : isFri && !working ? " wh-tile--off" : "")}
              >
                <div style={{ fontSize: "var(--text-small)", fontWeight: 700, color: isSat ? MUTED : INK }}>{WEEKDAY_LABELS[wd]}</div>
                {working ? (
                  <>
                    <Bdi><span style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{timeRange(d!.start, d!.end)}</span></Bdi>
                    <div style={{ fontSize: "var(--text-fine)", color: FAINT }}>
                      {d!.breakStart && d!.breakEnd ? <>הפסקה <Bdi>{timeRange(d!.breakStart, d!.breakEnd)}</Bdi></> : "ללא הפסקה"}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: "var(--text-small)", color: MUTED, marginTop: 6 }}>לא עובדים</div>
                    {isFri ? (
                      <div style={{ fontSize: "var(--text-fine)", color: BLUE, display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE }} />ניתן להזין עבודה
                      </div>
                    ) : (
                      <div style={{ fontSize: "var(--text-fine)", color: FAINT }}>קבוע</div>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- calendar + aside ---------- */}
      <div className="wh-cols">
        {/* calendar */}
        <div className="wh-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: "var(--text-lead)", fontWeight: 700 }}>{monthTitle(view.y, view.m)}</h2>
            <div style={{ display: "flex", gap: 6 }}>
              {/* RTL: the first button sits on the right. Previous points right
                  (back in reading order), next points left, so they face outward. */}
              <IconButton size="small" className="wh-nav" aria-label="חודש קודם" onClick={() => stepMonth(-1)}><ChevronRight size={18} aria-hidden /></IconButton>
              <IconButton size="small" className="wh-nav" aria-label="חודש הבא" onClick={() => stepMonth(1)}><ChevronLeft size={18} aria-hidden /></IconButton>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginBottom: 6 }}>
            {WEEKDAY_HEADERS.map((h) => (
              <div key={h} style={{ textAlign: "center", fontSize: "var(--text-fine)", fontWeight: 600, color: FAINT }}>{h}</div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
            {Array.from({ length: firstWeekday }).map((_, i) => <div key={`b${i}`} />)}
            {monthDays.map((d) => <CalendarCell key={d.date} d={d} onClick={() => openDay(d)} />)}
          </div>

          {/* legend */}
          <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap", fontSize: "var(--text-fine)", color: MUTED }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-canvas-parchment)", border: "1px solid var(--color-hairline)" }} />יום ללא עבודה</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE }} />שעות שהוזנו ידנית</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-surface-pearl)", border: "1px dashed var(--color-border-strong)" }} />שישי / ערב חג — ניתן להזין עבודה</span>
          </div>
        </div>

        {/* aside */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="wh-card" style={{ padding: 20 }}>
            <h2 style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 700 }}>החודש</h2>
            <div style={{ fontSize: "var(--text-fine)", color: FAINT, marginTop: 4 }}>{records.length} רשומות ב{monthTitle(view.y, view.m).split(" ")[0]}.</div>
            <div style={{ marginTop: 12 }}>
              {records.length === 0 ? (
                <div style={{ fontSize: "var(--text-small)", color: FAINT }}>אין רשומות מיוחדות החודש.</div>
              ) : (
                records.map((r) => (
                  <button
                    key={r.startDate}
                    type="button"
                    onClick={() => openDay(r.day)}
                    className="wh-rec"
                  >
                    <Bdi><span style={{ fontSize: "var(--text-small)", fontWeight: 700, color: INK, minWidth: 46, display: "inline-block", fontVariantNumeric: "tabular-nums" }}>{recordDateLabel(r)}</span></Bdi>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "var(--text-body-sm)", fontWeight: 600 }}>{r.label}</span>
                      <span style={{ display: "block", fontSize: "var(--text-fine)", color: FAINT, marginTop: 2 }}>{recordDetail(r.day)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="wh-card" style={{ padding: 20 }}>
            <h2 style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 700 }}>סוגי חופשה</h2>
            <div style={{ fontSize: "var(--text-fine)", color: FAINT, marginTop: 4 }}>ניתן להוסיף סוג משלך.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
              {holidayTypes.map((t) => {
                const removable = !t.isSystem && (t.usageCount ?? 0) === 0;
                return (
                  <span key={t.id} className={"wh-type" + (removable ? "" : " wh-type--plain")}>
                    {t.name}
                    {removable && (
                      <IconButton size="small" aria-label={`מחק את הסוג ${t.name}`} onClick={() => deleteType(t)} style={{ color: FAINT }}>
                        <Trash2 size={13} strokeWidth={1.75} aria-hidden />
                      </IconButton>
                    )}
                  </span>
                );
              })}
              {addingType ? (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input
                    autoFocus
                    className="sh-input"
                    aria-label="שם סוג החופשה החדש"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void addType(); if (e.key === "Escape") setAddingType(false); }}
                    placeholder="שם הסוג"
                    style={{ height: 34, width: 150, fontSize: "var(--text-small)", padding: "0 10px" }}
                  />
                  <Button size="small" onClick={addType}>הוסף</Button>
                </span>
              ) : (
                <button type="button" className="wh-add-type" onClick={() => setAddingType(true)}>+ סוג חדש</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- holidays + single-day exceptions ---------- */}
      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: "var(--text-body)", fontWeight: 700 }}>חופשות וחריגות</h2>
        <div style={{ fontSize: "var(--text-fine)", color: FAINT, marginBottom: 12 }}>
          חופשות מרוכזות של המחלקה, וחריגות יומיות של {monthTitle(view.y, view.m)}. חגי ישראל נוספים אוטומטית ואינם מופיעים כאן.
        </div>
        <DataTable<EntryRow>
          columns={entryColumns}
          rows={entryRows}
          getRowKey={(r) => r.key}
          loading={loading && entryRows.length === 0}
          minWidth={720}
          empty={<div style={{ fontSize: "var(--text-body-sm)" }}>אין רשומות. הזן יום חופש בלחיצה על יום בלוח, או חופשה מרוכזת דרך &quot;הוסף חופשה&quot;.</div>}
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

      <ConfirmDialog
        draggable={false}
        open={confirm != null}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        destructive
        busy={confirmBusy}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />

      <Snackbar open={toast.open} autoHideDuration={4000} onClose={() => setToast((t) => ({ ...t, open: false }))} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Alert severity={toast.sev} onClose={() => setToast((t) => ({ ...t, open: false }))}>{toast.msg}</Alert>
      </Snackbar>

    </div>
  );
}

/* ---------- calendar cell ---------- */
function CalendarCell({ d, onClick }: { d: ResolvedDay; onClick: () => void }) {
  const isFriClosed = d.category === "friday" || (d.category === "eve" && !d.isWorking);
  const isOff = d.category === "full_off" || d.category === "vacation" || d.category === "shabbat";
  const manualWorking = d.isWorking && (d.source === "override" || (d.source === "holiday" && d.category === "half_day"));

  const muted = isOff || isFriClosed;

  return (
    <button
      type="button"
      onClick={onClick}
      className={"wh-cell" + (isOff ? " wh-cell--off" : isFriClosed ? " wh-cell--closed" : "")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {manualWorking && <span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE, flexShrink: 0 }} />}
        <span style={{ fontSize: "var(--text-small)", fontWeight: 600, color: muted ? FAINT : INK, fontVariantNumeric: "tabular-nums" }}>{dayNum(d.date)}</span>
      </div>
      {d.label && (
        <span style={{ fontSize: "var(--text-micro)", color: isOff ? MUTED : BLUE, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
      )}
      {/* Every working day shows its hours, so a plain weekday reads clearly as a
          work day (07:00–15:35) — not just a bare number. */}
      {d.isWorking && d.start && d.end && (
        <Bdi><span style={{ fontSize: "var(--text-micro)", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{timeRange(d.start, d.end)}</span></Bdi>
      )}
      {isOff && d.category !== "shabbat" && <span style={{ fontSize: "var(--text-micro)", color: FAINT }}>יום מלא</span>}
    </button>
  );
}
