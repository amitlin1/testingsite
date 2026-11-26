"use client";

// The managers' summary (/dashboard): the whole picture in numbers, one screen,
// no charts. The top band answers "what happened in the window"; the black band
// answers "what is on the floor now" and ignores the window. Every number's
// definition is in lib/metrics/read/summary.ts; this file only lays them out.
//
// A refresh never blanks a number: while a new window loads, the previous
// figures stay, dimmed, and the `now` band keeps its last reading.

import * as React from "react";
import Link from "next/link";
import { CircleCheck, Layers, Package, Timer, Truck, type LucideIcon } from "lucide-react";

import { ClockInfoIcon } from "@/app/components/ClockInfo/ClockInfo";
import { apiFetch } from "@/lib/api/client";
import { useNow } from "@/lib/hooks/useNow";
import { localCivilDate } from "@/lib/time/civil";
import { METRICS_HEADER, type SummaryWire } from "@/app/lib/dashboard/contract";
import type { ClockMetricKey } from "@/app/lib/dashboard/work-clock";
import { EM_DASH, formatClock, formatCount } from "./tests/_lib/format";
import {
  SUMMARY_PRESETS,
  SUMMARY_PRESET_LABEL,
  durationParts,
  formatCivilRange,
  presetRange,
  type CivilRange,
  type SummaryPreset,
} from "./_lib/summary-range";
import "./summary.css";

const REFRESH_MS = 60_000;
const DETAIL_HREF = "/dashboard/tests";

interface Loaded {
  url: string;
  data: SummaryWire | null;
  error: string | null;
  /** The window the server actually served (the 13-month cap can move its start). */
  served: CivilRange | null;
  capped: boolean;
}

function useSummary(url: string | null) {
  const [tick, setTick] = React.useState(0);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);

  React.useEffect(() => {
    if (!url) return;
    let live = true;
    const failed = (error: string) =>
      setLoaded((prev) => ({ url, data: prev?.data ?? null, error, served: null, capped: false }));
    apiFetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (SummaryWire & { error?: string }) | null;
        if (!live) return;
        if (!res.ok || !body) {
          failed(body?.error || "הנתונים לא נטענו · נסה שוב בעוד רגע");
          return;
        }
        const from = res.headers.get(METRICS_HEADER.periodFrom);
        const to = res.headers.get(METRICS_HEADER.periodTo);
        setLoaded({
          url,
          data: body,
          error: null,
          served: from && to ? { from, to } : null,
          capped: res.headers.get(METRICS_HEADER.capped) === "true",
        });
      })
      .catch(() => {
        if (live) failed("אין חיבור לשרת · הנתונים יתעדכנו כשיחזור");
      });
    return () => {
      live = false;
    };
  }, [url, tick]);

  // Every minute while the tab is visible, and at once when it comes back.
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return loaded;
}

export default function SummaryScreen() {
  const [preset, setPreset] = React.useState<SummaryPreset>("week");
  const [custom, setCustom] = React.useState<Partial<CivilRange>>({});

  // 0 on the server: no window, no request, until the browser knows its date.
  const now = useNow(60_000);
  const today = now ? localCivilDate(new Date(now)) : null;
  const range = today ? presetRange(preset, today, custom) : null;
  const url = range ? `/api/dashboard/summary?startDate=${range.from}&endDate=${range.to}` : null;

  const loaded = useSummary(url);
  const data = loaded?.data ?? null;
  const stale = !loaded || loaded.url !== url;
  const p = data?.period;
  const n = data?.now;

  const choose = (next: SummaryPreset) => {
    // The picker opens on the window that was showing, not on an empty field.
    if (next === "custom" && !(custom.from && custom.to) && range) setCustom(range);
    setPreset(next);
  };

  const shown = (!stale && loaded?.served) || range;
  const judged = p ? p.itemsPassed + p.itemsFailed : null;

  return (
    // sum-root is the size container every length on the page is measured
    // against (summary.css); sum-page is the page inside it.
    <div className="sum-root" dir="rtl">
      <div className="sum-page">
        <h1 className="sh-visually-hidden">לוח ניהול · תמונת מצב</h1>

        <section className="sum-band" aria-labelledby="sum-period-title">
          <div className="sum-wrap">
            <div className="sum-head">
              <div className="sum-head__text">
                <h2 id="sum-period-title" className="sum-title">מה עבר במעבדה בתקופה שבחרת.</h2>
                <p className="sum-sub">המספרים בחלק הזה משתנים לפי הטווח שנבחר.</p>
              </div>
              <div className="sum-head__side">
                <div className="sum-seg" role="group" aria-label="טווח תאריכים">
                  {SUMMARY_PRESETS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="sum-seg__btn"
                      aria-pressed={key === preset}
                      onClick={() => choose(key)}
                    >
                      {SUMMARY_PRESET_LABEL[key]}
                    </button>
                  ))}
                </div>
                {preset === "custom" ? (
                  <div className="sum-dates">
                    <label className="sum-date">
                      מתאריך
                      <input
                        type="date"
                        className="sum-date__input"
                        value={custom.from ?? ""}
                        max={custom.to || today || undefined}
                        onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                      />
                    </label>
                    <label className="sum-date">
                      עד
                      <input
                        type="date"
                        className="sum-date__input"
                        value={custom.to ?? ""}
                        min={custom.from || undefined}
                        max={today || undefined}
                        onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="sum-fine" aria-live="polite">
                    {shown ? formatCivilRange(shown) : " "}
                  </p>
                )}
                {preset === "custom" && !range && <p className="sum-fine">בחר תאריך התחלה ותאריך סיום</p>}
                {!stale && loaded?.capped && shown && (
                  <p className="sum-fine">התקופה קוצרה ל־13 החודשים האחרונים · {formatCivilRange(shown)}</p>
                )}
                {loaded?.error && (
                  <p className="sum-fine sum-alert" role="alert">
                    {loaded.error}
                  </p>
                )}
              </div>
            </div>

            <div className="sum-row sum-row--period" aria-busy={stale} style={{ opacity: stale && data ? 0.55 : 1, transition: "opacity .2s" }}>
              <Card size="count" icon={Truck} title="משלוחים">
                <Metric value={<Count value={p?.shipmentsIn} />} label="נכנסו" />
                <Metric value={<Count value={p?.shipmentsOut} />} label="יצאו" />
              </Card>

              <Card size="count" icon={Package} title="מארזים">
                <Metric value={<Count value={p?.boxesIn} />} label="נכנסו" />
                <Metric value={<Count value={p?.boxesOut} />} label="יצאו" />
              </Card>

              <Card
                size="pct"
                icon={CircleCheck}
                title="תקינות"
                foot={
                  !p || judged === null
                    ? " "
                    : judged === 0
                      ? "אין פריטים שסיימו בדיקה בטווח"
                      : `מתוך ${formatCount(judged)} פריטים שסיימו בדיקה${
                          p.itemsUndecided > 0 ? ` · ${formatCount(p.itemsUndecided)} בלי תוצאה` : ""
                        }`
                }
              >
                <Metric value={<Percent value={p?.passPct} />} label="תקינים" />
                <Metric value={<Percent value={p?.failPct} />} label="לא תקינים" />
              </Card>

              <Card
                size="time"
                icon={Timer}
                title="זמן מסלול למארז"
                info="boxRoute"
                foot={
                  !p
                    ? " "
                    : p.boxesFinished === 0
                      ? "אין מארזים שסיימו מסלול בטווח"
                      : `ממוצע למארז מעמדה 1 ועד סוף המסלול · ${formatCount(p.boxesTimed)} מארזים${
                          p.boxesFinished > p.boxesTimed
                            ? ` · ${formatCount(p.boxesFinished - p.boxesTimed)} מחוץ ללוח שעות העבודה`
                            : ""
                        }`
                }
              >
                <Metric value={<Duration seconds={p?.routeTime.wall} largest="day" />} label="ברוטו · כל השעות" />
                <Metric value={<Duration seconds={p?.routeTime.work} largest="hour" />} label="נטו · שעות עבודה בלבד" />
              </Card>
            </div>
          </div>
        </section>

        <section className="sum-band sum-band--now" aria-labelledby="sum-now-title">
          <div className="sum-wrap">
            <div className="sum-head">
              <div className="sum-head__text">
                <h2 id="sum-now-title" className="sum-title">מה נמצא במעבדה עכשיו.</h2>
                <p className="sum-sub">מצב נוכחי. לא מושפע מבחירת הטווח.</p>
              </div>
              <div className="sum-head__side sum-head__side--row">
                <p className="sum-fine sum-label">
                  <span className="sum-dot" aria-hidden />
                  {n ? `מתעדכן כל דקה · עודכן ${formatClock(n.asOf)}` : "מתעדכן כל דקה"}
                </p>
                <Link href={DETAIL_HREF} className="sum-link">
                  ללוח המפורט
                </Link>
              </div>
            </div>

            <div className="sum-row sum-row--now">
              <Card size="ship" icon={Truck} title="משלוחים" spread foot="משלוחים שעוד לא יצאו ללקוח">
                <Metric value={<Count value={n?.shipmentsInWork} />} label="בעבודה" active />
                <Metric value={<Count value={n?.shipmentsReady} />} label="מוכנים לחזרה ללקוח" muted />
              </Card>

              <Card size="items" icon={Layers} title="פריטים" spread foot="נספרים מקליטת המארז ועד שהמשלוח יוצא ללקוח">
                <Metric value={<Count value={n?.itemsTotal} />} label="סה״כ במערכת" />
                <span className="sum-vrule" aria-hidden />
                <Metric value={<Count value={n?.itemsWaiting} />} label="ממתינים" muted />
                <Metric value={<Count value={n?.itemsInWork} />} label="בעבודה" active />
                <Metric value={<Count value={n?.itemsInResearch} />} label="במחקר" muted />
                <Metric value={<Count value={n?.itemsReady} />} label="מוכנים לחזרה ללקוח" muted />
              </Card>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Card({
  size,
  icon: Icon,
  title,
  info,
  foot,
  spread = false,
  children,
}: {
  size: "count" | "pct" | "time" | "ship" | "items";
  icon: LucideIcon;
  title: string;
  /** The ⓘ that opens the ברוטו / נטו panel on this card's metric. */
  info?: ClockMetricKey;
  foot?: string;
  /** Metrics at their own width, wrapping (the black band), rather than equal halves. */
  spread?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className={`sum-card sum-card--${size}`}>
      <div className="sum-card__head">
        <Icon size={24} strokeWidth={1.75} aria-hidden />
        <h3 className="sum-card__title">{title}</h3>
        {info && <ClockInfoIcon metric={info} />}
      </div>
      <div className={spread ? "sum-metrics sum-metrics--spread" : "sum-metrics"}>{children}</div>
      {foot !== undefined && <p className="sum-card__foot">{foot}</p>}
    </article>
  );
}

function Metric({
  value,
  label,
  active = false,
  muted = false,
}: {
  value: React.ReactNode;
  label: string;
  /** "In work": the blue dot, the one live state on the board. */
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="sum-metric">
      {value}
      <div className={muted || active ? "sum-label sum-label--muted" : "sum-label"}>
        {active && <span className="sum-dot" aria-hidden />}
        {label}
      </div>
    </div>
  );
}

function Count({ value }: { value: number | null | undefined }) {
  return <div className="sum-num">{formatCount(value)}</div>;
}

function Percent({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <div className="sum-num">{EM_DASH}</div>;
  return (
    <div className="sum-num">
      {value.toFixed(1)}
      <span className="sum-unit sum-unit--pct">%</span>
    </div>
  );
}

function Duration({ seconds, largest }: { seconds: number | null | undefined; largest: "day" | "hour" }) {
  const parts = durationParts(seconds, largest);
  if (!parts) return <div className="sum-num">{EM_DASH}</div>;
  return (
    <div className="sum-num">
      {parts.map((part) => (
        <React.Fragment key={part.unit}>
          {part.n}
          <span className="sum-unit">{part.unit}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
