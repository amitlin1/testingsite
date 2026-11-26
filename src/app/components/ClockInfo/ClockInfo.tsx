"use client";

// "מה זה ברוטו ונטו?" — the side panel that explains every duration on screen,
// built like the role panel on the users page (settings/users/RoleInfoDrawer):
// a text button opens it at the top of the dashboard, and a small info icon
// beside each duration opens it on that metric. It shows what the metric
// measures, what each clock means, the hours net time is counted by right now
// (GET /api/work-clock) and whether the work calendar is built.
// Texts: app/lib/dashboard/work-clock.ts.

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, HelpCircle, Info, X } from "lucide-react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { WEEKDAY_LABELS } from "@/lib/workHours/types";
import {
  CLOCK_METRICS,
  CLOCK_TEXT,
  clockMetric,
  type ClockMetric,
  type ClockMetricKey,
  type WorkClockWire,
} from "@/app/lib/dashboard/work-clock";
import "./clock-info.css";

// --------------------------------------------------------------- context ---

type Ctx = { open: (metric: ClockMetricKey) => void };
const ClockInfoContext = React.createContext<Ctx | null>(null);

/** One panel for a whole screen; the icons and the button inside it share it. */
export function ClockInfoProvider({ children }: { children: React.ReactNode }) {
  const [metric, setMetric] = React.useState<ClockMetricKey | null>(null);
  const ctx = React.useMemo<Ctx>(() => ({ open: setMetric }), []);
  return (
    <ClockInfoContext.Provider value={ctx}>
      {children}
      <ClockInfoDrawer metric={metric} onMetricChange={setMetric} onClose={() => setMetric(null)} />
    </ClockInfoContext.Provider>
  );
}

/** The screen's panel opener, or null outside a ClockInfoProvider (the
 *  dashboard's card explanations link to it — dashboard/tests/_components/CardInfo). */
export function useClockInfoOpen(): ((metric: ClockMetricKey) => void) | null {
  return React.useContext(ClockInfoContext)?.open ?? null;
}

/** Opens the panel on `metric`; outside a provider it brings its own panel. */
function useOpener(metric: ClockMetricKey) {
  const ctx = React.useContext(ClockInfoContext);
  const [local, setLocal] = React.useState<ClockMetricKey | null>(null);
  const open = () => (ctx ? ctx.open(metric) : setLocal(metric));
  const panel = ctx ? null : (
    <ClockInfoDrawer metric={local} onMetricChange={setLocal} onClose={() => setLocal(null)} />
  );
  return { open, panel };
}

/** The text button, like "מה כל תפקיד יכול לעשות?" on the users page. */
export function ClockInfoButton({ metric = "wait" }: { metric?: ClockMetricKey }) {
  const { open, panel } = useOpener(metric);
  return (
    <>
      <Button variant="text" startIcon={<HelpCircle size={18} strokeWidth={1.75} aria-hidden />} onClick={open}>
        מה זה ברוטו ונטו?
      </Button>
      {panel}
    </>
  );
}

/** The small "i" beside a duration's label. */
export function ClockInfoIcon({ metric }: { metric: ClockMetricKey }) {
  const { open, panel } = useOpener(metric);
  const m = clockMetric(metric);
  return (
    <>
      <button
        type="button"
        className="clock-info-icon"
        onClick={(e) => {
          e.stopPropagation(); // a column header sorts on click
          open();
        }}
        aria-label={`${m.title} — איך מחושב, ברוטו ונטו`}
        title="איך מחושב · ברוטו ונטו"
      >
        <Info size={13} strokeWidth={2} aria-hidden />
      </button>
      {panel}
    </>
  );
}

// ------------------------------------------------------------------ data ---

let cached: WorkClockWire | null = null;

function useWorkClock(enabled: boolean): { data: WorkClockWire | null; failed: boolean } {
  const [data, setData] = React.useState<WorkClockWire | null>(cached);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!enabled || (cached && cached.calendarHorizonTo)) return;
    let alive = true;
    apiFetch("/api/work-clock")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: WorkClockWire) => {
        cached = d;
        if (alive) setData(d);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return { data, failed };
}

const fmtNet = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

const fmtDate = (d: string) => {
  const [y, mo, da] = d.split("-");
  return `${da}/${mo}/${y}`;
};

// ----------------------------------------------------------------- panel ---

function ClocksOf({ m }: { m: ClockMetric }) {
  if (m.clocks === "work") return <span className="clock-info__shown">מוצג בנטו בלבד</span>;
  if (m.clocks === "wall") return <span className="clock-info__shown">מוצג בברוטו בלבד</span>;
  return <span className="clock-info__shown">מוצג בברוטו ובנטו</span>;
}

function ClockInfoDrawer({
  metric,
  onMetricChange,
  onClose,
}: {
  metric: ClockMetricKey | null;
  onMetricChange: (m: ClockMetricKey) => void;
  onClose: () => void;
}) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const open = metric != null;
  const { data, failed } = useWorkClock(open);

  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const m = clockMetric(metric);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const f = panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="clock-info" onKeyDown={onKeyDown}>
      <div className="clock-info__scrim" onClick={onClose} aria-hidden />
      <aside ref={panelRef} className="clock-info__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="clock-info__head">
          <div className="clock-info__bar">
            <span className="clock-info__eyebrow">איך הזמנים מחושבים</span>
            <button ref={closeRef} type="button" className="clock-info__close" onClick={onClose} aria-label="סגירה">
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div>
            <h2 id={titleId} className="clock-info__title">{m.title}</h2>
            <p className="clock-info__desc">{m.what}</p>
            <ClocksOf m={m} />
          </div>

          <div className="clock-info__clocks">
            {(["wall", "work"] as const).map((c) => (
              <div key={c} className="clock-info__clock">
                <span className={`clock-info__swatch clock-info__swatch--${c}`} aria-hidden />
                <b>{CLOCK_TEXT[c].label}</b>
                <p>{CLOCK_TEXT[c].long}</p>
              </div>
            ))}
          </div>
          <p className="clock-info__fine">
            <b>{CLOCK_TEXT.offhours.label}</b> = {CLOCK_TEXT.offhours.long}
          </p>
          <p className="clock-info__example">{CLOCK_TEXT.example}</p>
        </div>

        <div className="clock-info__body">
          <section className="clock-info__group">
            <h3 className="clock-info__group-title">
              <span>שעות העבודה שהנטו נספר לפיהן</span>
              {data && (
                <span className="clock-info__count">
                  {data.hoursCustomized ? "נקבעו במסך שעות עבודה" : "ברירת מחדל של המערכת"}
                </span>
              )}
            </h3>
            {data ? (
              <>
                <ul className="clock-info__week" aria-label="שעות עבודה לפי יום">
                  {data.week.map((d) => (
                    <li key={d.weekday} className={d.isWorking ? undefined : "clock-info__day--off"}>
                      <span>{WEEKDAY_LABELS[d.weekday]}</span>
                      {d.isWorking ? (
                        <span>
                          {/* <bdi dir="ltr">: in an RTL run "07:00–15:35" reads reversed. */}
                          <bdi dir="ltr">{d.start}–{d.end}</bdi>
                          {d.breakStart && d.breakEnd && (
                            <>
                              {" · הפסקה "}
                              <bdi dir="ltr">{d.breakStart}–{d.breakEnd}</bdi>
                            </>
                          )}
                        </span>
                      ) : (
                        <span>לא יום עבודה</span>
                      )}
                      <span className="clock-info__net">
                        {d.isWorking ? (
                          <>
                            <bdi dir="ltr">{fmtNet(d.netMinutes)}</bdi> נטו
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {!data.hoursCustomized && (
                  <p className="clock-info__fine">
                    אלה שעות ברירת המחדל של המערכת — עדיין לא נקבעו שעות במסך שעות עבודה. כשיוגדרו שם שעות, ימים
                    מיוחדים או חופשות, הנטו (גם של העבר) יחושב מחדש לפיהן. הברוטו לא משתנה.
                  </p>
                )}
                <p className="clock-info__fine">
                  חגי ישראל נספרים אוטומטית כימים שאינם ימי עבודה
                  {data.exceptions > 0
                    ? `, ובנוסף ${data.exceptions} ימים מיוחדים וחופשות שהוגדרו במסך שעות עבודה.`
                    : "."}
                </p>
                {data.calendarHorizonTo ? (
                  <p className="clock-info__fine">לוח העבודה מחושב עד {fmtDate(data.calendarHorizonTo)}.</p>
                ) : (
                  <p className="clock-info__warn">
                    <AlertTriangle size={14} strokeWidth={2} aria-hidden />
                    {CLOCK_TEXT.missingWorkWhy}
                  </p>
                )}
              </>
            ) : (
              <p className="clock-info__fine">{failed ? "לא ניתן לטעון את שעות העבודה כרגע." : "טוען…"}</p>
            )}
          </section>

          <section className="clock-info__group">
            <h3 className="clock-info__group-title">
              <span>כל מדדי הזמן</span>
              <span className="clock-info__count">{CLOCK_METRICS.length}</span>
            </h3>
            <ul className="clock-info__list">
              {CLOCK_METRICS.map((x) => (
                <li key={x.key}>
                  <button
                    type="button"
                    className="clock-info__item"
                    aria-current={x.key === m.key ? "true" : undefined}
                    onClick={() => onMetricChange(x.key)}
                  >
                    <b>{x.title}</b>
                    <span>{x.what}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
