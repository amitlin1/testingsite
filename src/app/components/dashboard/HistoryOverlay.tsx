"use client";

// §16.5 — ONE dialog for all four entity histories.
//
// The old dashboard had a separate history screen per entity, each with its own
// fetch, its own chart and its own idea of what "finished" meant. Here a row
// click opens this overlay and the KIND drives everything: which endpoint, what
// the ink line means, what the queue band is called, what the footnote has to
// warn about.
//
// A PRESET IS ONLY A WINDOW, never a table. `3 שנים` is requested, capped to 13
// months by the server and REPORTED as capped — so when the header comes back
// the dialog renders the amber notice with the window actually served rather
// than pretending it drew three years. The grid stays daily at every preset;
// above 30 points this component folds to weeks itself instead of asking the
// server for a second definition of the same series.
//
// A CELL EXISTS ONLY IF THIS DIALOG'S OWN ENDPOINT ANSWERS IT. The three entity
// histories return COUNTS — Q2א's active population per day and Q2ב's closures —
// and no durations at all, so no duration cell is built out of a figure borrowed
// from the row that was clicked. A borrowed number is not a historical number:
// it describes right now, it does not move with the preset, and a reader who
// changes `12 חודשים` to `3 שנים` and watches it sit still learns the wrong
// thing about it. The station dialog gets four cells because its endpoint really
// does carry the clock pair; the other three get two.
//
// Closes on the scrim, on the ×, and on Escape. It owns no filters of its own
// beyond the preset — the footer's one blue pill hands the entity to the
// dashboard's filter state and gets out of the way.

import * as React from "react";

import { apiFetch } from "@/lib/api/client";
import { Skeleton } from "@/components/ui";
import { Close, FilterList, Info } from "@/components/ui/icons";
import {
  entityHistoryPoints,
  stationHistoryPoints,
  type CompletionHistoryWire,
  type CompletionPoint,
  type EntityHistoryWire,
  type HistoryPoint,
  type StationHistoryWire,
} from "@/app/lib/dashboard/api-types";
import {
  DASH_COLORS,
  EM_DASH,
  formatCount,
  formatDayTick,
  formatMinutes,
  isNil,
  queueAgeTone,
} from "@/app/lib/dashboard/format";
import { Legend } from "./DataCard";
import Segmented from "./Segmented";
import { ChartBody } from "./charts/chartConfig";
import HistoryDurationChart from "./charts/HistoryDurationChart";
import HistoryStateChart from "./charts/HistoryStateChart";
import ShipmentCompletionChart from "./charts/ShipmentCompletionChart";

export type HistoryKind = "station" | "shipment" | "customer" | "type";

export interface HistoryTarget {
  kind: HistoryKind;
  id: number;
  title: string;
  /** The middot line under the title — type, customer code, whatever the row has. */
  meta?: string;
  /**
   * The ONE live figure a dialog may borrow from the row that opened it: the
   * standing queue age, on the station dialog, which has no historical form at
   * all (it is `now() - entry` over what is waiting at this instant) and which is
   * the number a manager opens a station to see. It is labelled as "now" on
   * screen. Nothing else is borrowed — see the note at the top of this file.
   */
  live?: { oldestQueueAgeMinutes?: number | null };
}

export type HistoryPreset = "alldays" | "12months" | "3years";

const PRESETS: Array<{ key: HistoryPreset; label: string }> = [
  { key: "alldays", label: "כל הימים" },
  { key: "12months", label: "12 חודשים" },
  { key: "3years", label: "3 שנים" },
];

const KIND_CONFIG: Record<
  HistoryKind,
  {
    label: string;
    path: string;
    queueLabel: string;
    lineLabel: string;
    stateTitle: string;
    footnote: string;
    cta: string;
  }
> = {
  station: {
    label: "עמדה",
    path: "/api/dashboard/stations",
    queueLabel: "בתור של סוג העמדה",
    lineLabel: "טופל ביום · צעדים (סקאלה נפרדת)",
    stateTitle: "מצב העמדה לאורך זמן · תמונה יומית ב-12:00",
    footnote:
      "יום ללא סגירה מוצג כפער בגרף, לא כאפס. התור שייך לסוג העמדה ומשותף לכל עמדות הסוג.",
    cta: "פתח פריטים איטיים בעמדה",
  },
  shipment: {
    label: "משלוח",
    path: "/api/dashboard/shipments",
    queueLabel: "בתור",
    lineLabel: "מסלולים שנסגרו · מצטבר",
    stateTitle: "התקדמות המשלוח לאורך זמן",
    footnote:
      "אחוז ההשלמה מחושב מול הפריטים שנפתח להם מסלול עד אותו יום — לא מול כמות המשלוח. פתיחת מסלול חדש מגדילה את המכנה, ולכן העקומה יכולה לרדת.",
    cta: "סנן את הלוח למשלוח",
  },
  customer: {
    label: "לקוח",
    path: "/api/dashboard/customers",
    queueLabel: "בתור",
    lineLabel: "מסלולים שנסגרו · מצטבר",
    stateTitle: "מצב הפריטים של הלקוח לאורך זמן",
    footnote: "יום ללא סגירה מוצג כפער בגרף, לא כאפס.",
    cta: "סנן את הלוח ללקוח",
  },
  type: {
    label: "סוג פריט",
    path: "/api/dashboard/item-types",
    queueLabel: "בתור",
    lineLabel: "מסלולים שנסגרו · מצטבר",
    stateTitle: "מצב סוג הפריט לאורך זמן",
    footnote: "יום ללא סגירה מוצג כפער בגרף, לא כאפס.",
    cta: "סנן את הלוח לסוג הפריט",
  },
};

/** The window a preset asks for. The server applies the 13-month cap. */
function presetRange(preset: HistoryPreset): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  if (preset === "12months") start.setMonth(start.getMonth() - 12);
  else if (preset === "3years") start.setFullYear(start.getFullYear() - 3);
  else start.setMonth(start.getMonth() - 13);
  start.setHours(0, 0, 0, 0);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

/**
 * Above 30 points the daily grid folds to weeks HERE, not on the server (§16.5).
 * The fold is not one operation: a state count is a snapshot, so the week takes
 * its LAST day; a station's steps are additive, so they sum; a cumulative line
 * takes its last value; a duration averages the days that actually measured
 * something and stays null when none of them did — the gap has to survive.
 */
function foldWeekly(points: HistoryPoint[], additiveLine: boolean): HistoryPoint[] {
  if (points.length <= 30) return points;
  const weeks: HistoryPoint[][] = [];
  for (let i = 0; i < points.length; i += 7) weeks.push(points.slice(i, i + 7));

  const mean = (values: Array<number | null>) => {
    const real = values.filter((v): v is number => !isNil(v));
    return real.length === 0 ? null : real.reduce((a, b) => a + b, 0) / real.length;
  };

  return weeks.map((week) => {
    const last = week[week.length - 1];
    return {
      date: last.date,
      isToday: week.some((p) => p.isToday),
      queue: last.queue,
      test: last.test,
      research: last.research,
      unmapped: last.unmapped,
      line: additiveLine
        ? week.reduce((sum, p) => sum + (p.line ?? 0), 0)
        : last.line,
      wait: { wall: mean(week.map((p) => p.wait.wall)), work: mean(week.map((p) => p.wait.work)) },
      handle: {
        wall: mean(week.map((p) => p.handle.wall)),
        work: mean(week.map((p) => p.handle.work)),
      },
    };
  });
}

export interface HistoryOverlayProps {
  target: HistoryTarget;
  onClose: () => void;
  /** The footer CTA: apply this entity as a dashboard filter, then close. */
  onApplyFilter: (target: HistoryTarget) => void;
}

export default function HistoryOverlay({ target, onClose, onApplyFilter }: HistoryOverlayProps) {
  const config = KIND_CONFIG[target.kind];
  const [preset, setPreset] = React.useState<HistoryPreset>("alldays");
  const [points, setPoints] = React.useState<HistoryPoint[] | null>(null);
  const [completion, setCompletion] = React.useState<CompletionPoint[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Bumped by `נסה שוב`. The preset alone cannot drive a retry: re-selecting the
  // same preset is not a state change, so the effect would never re-run.
  const [attempt, setAttempt] = React.useState(0);
  const [served, setServed] = React.useState<{ capped: boolean; from: string | null; to: string | null }>(
    { capped: false, from: null, to: null },
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await apiFetch(`${config.path}/${target.id}/history?period=${preset}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          let message = `שגיאה בטעינת ההיסטוריה (${res.status})`;
          try {
            const body = await res.json();
            if (body?.error) message = `${body.error} (${res.status})`;
          } catch {
            /* an error body that is not JSON is still an error */
          }
          if (!cancelled) {
            setError(message);
            setPoints(null);
            setLoading(false);
          }
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        setServed({
          // The cap is REPORTED, never applied in silence — so the notice below
          // is driven by the header and not by comparing dates ourselves.
          capped: res.headers.get("X-Metrics-Period-Capped") === "true",
          from: res.headers.get("X-Metrics-Period-From"),
          to: res.headers.get("X-Metrics-Period-To"),
        });
        setPoints(
          target.kind === "station"
            ? stationHistoryPoints(body as StationHistoryWire[])
            : entityHistoryPoints(body as EntityHistoryWire[]),
        );
        setLoading(false);
      } catch (err) {
        if ((err as Error)?.name === "AbortError" || cancelled) return;
        setError("אין תקשורת עם שרת המדדים");
        setLoading(false);
      }
    }

    async function loadCompletion() {
      if (target.kind !== "shipment") {
        setCompletion(null);
        return;
      }
      // §8.5.1 — the completion CURVE has one definition and it lives in one
      // place. It is never recomputed here, and never against shipments.amount.
      const range = presetRange(preset);
      const params = new URLSearchParams({
        startDate: range.startDate,
        endDate: range.endDate,
        shipmentId: String(target.id),
      });
      try {
        const res = await apiFetch(`/api/dashboard/stats/completion-history?${params}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          setCompletion([]);
          return;
        }
        const rows = (await res.json()) as CompletionHistoryWire[];
        if (cancelled) return;
        setCompletion(
          rows
            .map((row): CompletionPoint | null => {
              // Every key that is not `date`/`formattedDate` and is not `_new_`
              // metadata is a shipment code. The request is pinned to one
              // shipment, so the first such key is its series.
              const key = Object.keys(row).find(
                (k) => k !== "date" && k !== "formattedDate" && !k.startsWith("_new_"),
              );
              if (!key) return null;
              const pct = Number(row[key]);
              if (Number.isNaN(pct)) return null;
              const counts = row._new_counts?.[key];
              return {
                date: row.date,
                pct,
                routed: counts?.routed ?? null,
                finished: counts?.finished ?? null,
              };
            })
            .filter((v): v is CompletionPoint => v !== null),
        );
      } catch {
        // The curve is supporting detail — its absence must not blank the
        // dialog. An empty array (rather than the null "still loading") lets the
        // chart say so instead of spinning forever.
        if (!cancelled) setCompletion([]);
      }
    }

    load();
    loadCompletion();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [config.path, target.id, target.kind, preset, attempt]);

  const folded = React.useMemo(
    () => (points ? foldWeekly(points, target.kind === "station") : null),
    [points, target.kind],
  );

  const stats = useStatCells(target, points);

  return (
    <div
      dir="rtl"
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        background: "var(--dash-scrim, rgba(0,0,0,.28))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 26,
        fontFamily: "var(--font-text)",
        color: "var(--color-ink)",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${config.label} ${target.title}`}
        style={{
          width: "min(1120px, 100%)",
          maxHeight: "100%",
          background: "var(--color-canvas)",
          border: "1px solid var(--color-hairline)",
          borderRadius: 18,
          boxShadow: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
            padding: "16px 20px 13px",
            borderBottom: "1px solid var(--color-hairline)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)", fontWeight: 600 }}>
              {config.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px", marginTop: 1 }}>
              {target.title}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-muted-48)", marginTop: 2 }}>
              {[target.meta, "תמונת מצב יומית", "אזור זמן ירושלים"].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Segmented
              options={PRESETS.map((p) => ({ value: p.key, label: p.label }))}
              value={preset}
              onChange={(value) => setPreset(value as HistoryPreset)}
              padding="5px 13px"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="סגירה"
              className="dash-press dash-icon"
              style={{
                width: 32,
                height: 32,
                border: "1px solid var(--color-hairline)",
                borderRadius: 9999,
                background: "var(--color-canvas)",
                color: "var(--color-ink)",
                cursor: "pointer",
              }}
            >
              <Close fontSize={15} />
            </button>
          </div>
        </div>

        {/* §16.5: the cap is shown as the window ACTUALLY served. */}
        {served.capped && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 20px",
              background: "var(--dash-amber-tint)",
              borderBottom: "1px solid var(--dash-amber-hairline)",
              fontSize: 11.5,
              color: "var(--dash-amber-ink)",
              flexShrink: 0,
            }}
          >
            <span className="dash-icon">
              <Info fontSize={13} strokeWidth={2} />
            </span>
            התקופה קוצרה ל-13 חודשים · הוצג {formatDayTick(served.from ?? "")} –{" "}
            {formatDayTick(served.to ?? "")} במקום הטווח שהתבקש
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 20px",
              background: "rgba(191,53,53,.06)",
              borderBottom: "1px solid var(--color-hairline)",
              fontSize: 12.5,
              color: "var(--color-destructive)",
              flexShrink: 0,
            }}
          >
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="dash-press"
              style={{
                border: "1px solid var(--color-destructive)",
                background: "transparent",
                color: "var(--color-destructive)",
                borderRadius: 8,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              נסה שוב
            </button>
          </div>
        )}

        {/* body — the only scrolling element in the panel */}
        <div
          className="dash-scroll"
          style={{ padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
              gap: 10,
              flexShrink: 0,
            }}
          >
            {stats.map((cell) => (
              <div
                key={cell.label}
                style={{
                  border: "1px solid var(--color-hairline)",
                  borderRadius: 14,
                  padding: "11px 14px",
                }}
              >
                <div style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)", fontWeight: 600 }}>
                  {cell.label}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: "-0.6px",
                    lineHeight: 1.15,
                    marginTop: 2,
                  }}
                >
                  {loading ? <Skeleton variant="text" width="60%" height={24} /> : cell.value}
                  {cell.unit && (
                    <span style={{ fontSize: 12.5, fontWeight: 400, color: "var(--color-ink-muted-48)" }}>
                      {" "}
                      {cell.unit}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: cell.tone ?? "var(--color-ink-muted-48)", marginTop: 1 }}>
                  {cell.note}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              border: "1px solid var(--color-hairline)",
              borderRadius: 14,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{config.stateTitle}</div>
              <Legend
                items={[
                  { color: "var(--dash-ramp-4)", label: config.queueLabel },
                  { color: "var(--dash-ramp-1)", label: "בבדיקה" },
                  { color: "var(--dash-ramp-5)", label: "במחקר" },
                  { color: "var(--color-ink)", label: config.lineLabel, line: true },
                ]}
              />
            </div>
            <ChartBody height={196}>
              {loading || !folded ? (
                <Skeleton variant="rectangular" height={196} />
              ) : folded.length === 0 ? (
                <EmptyHistory />
              ) : (
                <HistoryStateChart
                  points={folded}
                  queueLabel={config.queueLabel}
                  lineLabel={config.lineLabel}
                />
              )}
            </ChartBody>
          </div>

          {target.kind === "station" && (
            <div
              style={{
                border: "1px solid var(--color-hairline)",
                borderRadius: 14,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>זמנים שנסגרו באותו יום · שני שעונים</div>
                <Legend
                  items={[
                    { color: "var(--dash-ramp-1)", label: "המתנה · ברוטו", line: true },
                    { color: "var(--dash-ramp-1)", label: "המתנה · נטו", line: true, dashed: true },
                    { color: "var(--color-ink-muted-48)", label: "ביצוע · ברוטו", line: true },
                    { color: "var(--color-ink-muted-48)", label: "ביצוע · נטו", line: true, dashed: true },
                  ]}
                />
              </div>
              <ChartBody height={132}>
                {loading || !folded ? (
                  <Skeleton variant="rectangular" height={132} />
                ) : folded.length === 0 ? (
                  <EmptyHistory />
                ) : (
                  <HistoryDurationChart points={folded} />
                )}
              </ChartBody>
            </div>
          )}

          {target.kind === "shipment" && (
            <div
              style={{
                border: "1px solid var(--color-hairline)",
                borderRadius: 14,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>אחוז השלמה לאורך זמן</div>
                  {/* The denominator MOVES with the day, so a dip is a real
                      event and not a glitch — it is said next to the chart and
                      not only in the footnote, because the footnote is a screen
                      away at the bottom of the dialog. */}
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>
                    מסלול שנפתח מאוחר יותר מוריד את האחוז
                  </div>
                </div>
                <Legend
                  items={[
                    { color: "var(--dash-ramp-1)", label: "השלמה", line: true },
                    { color: "var(--color-ink-muted-48)", label: "מסלולים שנפתחו · מצטבר", line: true },
                  ]}
                />
              </div>
              <ChartBody height={132}>
                {completion === null ? (
                  <Skeleton variant="rectangular" height={132} />
                ) : (
                  <ShipmentCompletionChart points={completion} />
                )}
              </ChartBody>
            </div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "11px 20px",
            borderTop: "1px solid var(--color-hairline)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--color-ink-muted-48)" }}>{config.footnote}</div>
          <button
            type="button"
            className="dash-press"
            onClick={() => {
              onApplyFilter(target);
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: "var(--color-primary)",
              color: "var(--color-on-primary)",
              border: "none",
              borderRadius: 9999,
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <span className="dash-icon">
              <FilterList fontSize={14} />
            </span>
            {config.cta}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyHistory() {
  return (
    <div
      dir="rtl"
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12.5,
        color: "var(--color-ink-muted-48)",
      }}
    >
      אין נתונים בתקופה שנבחרה.
    </div>
  );
}

interface StatCell {
  label: string;
  value: string;
  unit?: string;
  note: string;
  tone?: string;
}

/**
 * The four cells above the charts. A station and the other three entities do
 * not measure the same things, so they do not get the same cells — and neither
 * set borrows a number from the other's vocabulary.
 */
function useStatCells(target: HistoryTarget, points: HistoryPoint[] | null): StatCell[] {
  return React.useMemo(() => {
    const last = points && points.length > 0 ? points[points.length - 1] : null;
    const lastMeasured = points
      ? [...points].reverse().find((p) => !isNil(p.wait.wall)) ?? null
      : null;

    if (target.kind === "station") {
      const steps = (points ?? []).reduce((sum, p) => sum + (p.line ?? 0), 0);
      const wall = lastMeasured?.wait.wall ?? null;
      const work = lastMeasured?.wait.work ?? null;
      const age = target.live?.oldestQueueAgeMinutes ?? null;
      return [
        {
          label: "טופל בתקופה",
          value: formatCount(steps),
          unit: "צעדים",
          note: "כולל חזרות ממחקר",
        },
        {
          label: "המתנה · ברוטו",
          value: formatMinutes(wall),
          note: isNil(work)
            ? "התור של סוג העמדה"
            : `נטו ${formatMinutes(work)} · התור של סוג העמדה`,
        },
        {
          // Q2א probes at 12:00 Asia/Jerusalem, so this is the last grid day's
          // sample and not this instant. Research is a SEPARATE state the
          // station holds, so here `ועוד` is right — unlike the KPI card, whose
          // field already counts it in.
          label: "בבדיקה ביום האחרון",
          value: formatCount(last?.test ?? null),
          note: `ועוד ${formatCount(last?.research ?? 0)} במחקר · תמונה ב-12:00`,
        },
        {
          // The one borrowed figure in the whole overlay, and the exception is
          // deliberate: the standing age has no historical form at all — it is
          // `now() - entry` over whoever is waiting at this instant — and it is
          // the number a manager opens a station to see. It is the OLDEST item,
          // matching the board column that was just clicked, and it says "now"
          // on its face so nobody reads it as part of the series.
          label: "הוותיק בתור · כרגע",
          value: isNil(age) ? EM_DASH : formatMinutes(age),
          note: "מי שממתין עכשיו",
          tone: queueAgeTone(age),
        },
      ];
    }

    // Two cells, because Q2א and Q2ב answer two things. `השלמה` and the route
    // turnaround used to sit here, borrowed from the clicked row — both are real
    // numbers, neither is a HISTORICAL one, and a cell that ignores the preset
    // beside three that obey it is a cell that will be misread. Completion still
    // has a historical form for a shipment, and it is drawn as the curve below
    // rather than frozen into a tile.
    const open = last ? last.queue + last.test + last.research : null;
    return [
      {
        label: "מסלולים שנסגרו",
        value: formatCount(last?.line ?? null),
        note: "מצטבר עד סוף התקופה · סגירת מסלול בלבד",
      },
      {
        // The last grid day's sample, NOT this instant: Q2א probes at 12:00
        // Asia/Jerusalem on each civil day, so calling it "כרגע" would promise a
        // liveness the series does not have.
        label: "פתוחים ביום האחרון",
        value: formatCount(open),
        note: `${formatCount(last?.queue ?? 0)} ממתינים · תמונה ב-12:00`,
        tone: DASH_COLORS.amber,
      },
    ];
  }, [target, points]);
}
