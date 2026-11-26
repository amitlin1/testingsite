"use client";

// §16.5 — ONE dialog for all four entity histories. A row click opens it and
// the KIND drives everything: which endpoint, what the ink line means, what the
// queue band is called, what the footnote has to warn about.
//
// A PRESET IS ONLY A WINDOW, never a table. `3 שנים` is requested, capped to 13
// months by the server and REPORTED as capped — so when the header comes back
// the dialog renders the amber notice with the window actually served rather
// than pretending it drew three years. The grid stays daily at every preset;
// above 30 points it is folded to weeks here (history-fold) instead of asking
// the server for a second definition of the same series.
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
// It is the app's Dialog: it closes on the scrim, on the ×, and on Escape,
// keeps focus inside while open and hands it back on close. It owns no filters
// of its own beyond the preset — the footer's one blue pill hands the entity
// to the dashboard's filter state and gets out of the way.

import * as React from "react";

import { apiFetch } from "@/lib/api/client";
import { Dialog, DialogTitle, IconButton, Skeleton } from "@/components/ui";
import { Close, FilterList } from "@/components/ui/icons";
import {
  FILTER_PARAM,
  completionPoints,
  entityHistoryPoints,
  isHistoryPreset,
  stationHistoryPoints,
  type CompletionHistoryWire,
  type CompletionPoint,
  type EntityHistoryWire,
  type HistoryPoint,
  type HistoryPreset,
  type StationHistoryWire,
} from "@/app/lib/dashboard/contract";
import {
  EM_DASH,
  formatCount,
  formatMinutes,
  isNil,
  queueAgeTone,
  toneText,
  workTwin,
  type DashTone,
} from "../_lib/format";
import { CLOCK_TEXT } from "@/app/lib/dashboard/work-clock";
import { foldWeekly } from "../_lib/history-fold";
import { completionCurveRange } from "../_lib/query";
import { failureMessage, metaOf } from "../_lib/useDashboardData";
import { CappedPeriodNotice } from "./AmberNotice";
import { Legend } from "./DataCard";
import Segmented from "./Segmented";
import { ChartBody } from "./charts/chartConfig";
import HistoryDurationChart from "./charts/HistoryDurationChart";
import HistoryStateChart from "./charts/HistoryStateChart";
import ShipmentCompletionChart from "./charts/ShipmentCompletionChart";
import { STATE_COLOR } from "./charts/palette";

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

const PRESET_LABEL: Record<HistoryPreset, string> = {
  alldays: "כל הימים",
  "12months": "12 חודשים",
  "3years": "3 שנים",
};

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

  // Each load starts during render, when what the effect below reads changes;
  // the effect only sets state from the replies. Only a shipment has a curve.
  const loadKey = `${config.path}|${target.id}|${target.kind}|${preset}|${attempt}`;
  const [seenLoadKey, setSeenLoadKey] = React.useState(loadKey);
  if (seenLoadKey !== loadKey) {
    setSeenLoadKey(loadKey);
    setLoading(true);
    setError(null);
    if (target.kind !== "shipment") setCompletion(null);
  }

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      try {
        const res = await apiFetch(`${config.path}/${target.id}/history?period=${preset}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const message = await failureMessage(res, "שגיאה בטעינת ההיסטוריה");
          if (!cancelled) {
            setError(message);
            setPoints(null);
            setLoading(false);
          }
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        const meta = metaOf(res);
        setServed({ capped: meta.capped, from: meta.periodFrom, to: meta.periodTo });
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
      if (target.kind !== "shipment") return;
      // §8.5.1 — the completion CURVE has one definition and it lives in one
      // place. It is never recomputed here, and never against shipments.amount.
      const range = completionCurveRange(preset);
      const params = new URLSearchParams({
        startDate: range.startDate,
        endDate: range.endDate,
        [FILTER_PARAM.shipmentId]: String(target.id),
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
        setCompletion(completionPoints(rows));
      } catch {
        // The curve must not blank the dialog, and an empty array (rather than
        // the null "still loading") stops the skeleton. A failed request
        // therefore reads as an empty curve, not as an error — a known bug,
        // left for the owner.
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
    // The app's Dialog: focus moves in and comes back, Tab stays inside,
    // Escape and the scrim close it, the page behind does not scroll, and the
    // header still drags it.
    // `dash-overlay` carries the dashboard palette into the portal.
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ className: "dash-overlay", style: { maxWidth: 1120 } }}
    >
      {/* header — the drag handle. The kind (עמדה / משלוח …) is part of the
          meta line under the title, not an eyebrow above it. */}
      <div
        data-drag-handle=""
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
          <DialogTitle style={{ padding: 0 }}>{target.title}</DialogTitle>
          <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", marginTop: 2 }}>
            {[config.label, target.meta, "תמונת מצב יומית", "אזור זמן ירושלים"].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <Segmented
            options={(Object.keys(PRESET_LABEL) as HistoryPreset[]).map((key) => ({
              value: key,
              label: PRESET_LABEL[key],
            }))}
            value={preset}
            onChange={(value) => {
              if (isHistoryPreset(value)) setPreset(value);
            }}
            padding="5px 13px"
            ariaLabel="תקופת ההיסטוריה"
          />
          <IconButton
            size="small"
            aria-label="סגירה"
            onClick={onClose}
            style={{ color: "var(--color-ink-muted-48)" }}
          >
            <Close fontSize={18} aria-hidden />
          </IconButton>
        </div>
      </div>

      {served.capped && (
        <CappedPeriodNotice band lead="התקופה קוצרה ל-13 חודשים" from={served.from} to={served.to} />
      )}

      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 20px",
            background: "var(--color-danger-bg)",
            borderBottom: "1px solid var(--color-hairline)",
            fontSize: "var(--text-small)",
            color: "var(--color-destructive)",
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="dash-btn dash-btn--danger">
            נסה שוב
          </button>
        </div>
      )}

      {/* body — the only scrolling element in the panel. One surface: the
          stat cells are split by hairlines and the charts by dividers, not
          boxed inside the dialog's own box. */}
      <div
        className="dash-scroll"
        style={{ padding: "14px 20px 16px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
            flexShrink: 0,
          }}
        >
          {stats.map((cell, index) => (
            <div
              key={cell.label}
              style={{
                padding: "2px 16px",
                paddingInlineStart: index === 0 ? 0 : 16,
                borderInlineStart: index === 0 ? undefined : "1px solid var(--color-hairline)",
              }}
            >
              <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", fontWeight: 600 }}>
                {cell.label}
              </div>
              <div
                style={{
                  fontSize: "var(--text-kpi)",
                  fontWeight: 700,
                  letterSpacing: "var(--ls-display)",
                  lineHeight: 1.15,
                  marginTop: 2,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {loading ? <Skeleton variant="text" width="60%" height={26} /> : cell.value}
                {cell.unit && (
                  <span style={{ fontSize: "var(--text-small)", fontWeight: 400, color: "var(--color-ink-muted-48)" }}>
                    {" "}
                    {cell.unit}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "var(--text-fine)", color: toneText(cell.tone ?? "muted"), marginTop: 1 }}>
                {cell.note}
              </div>
            </div>
          ))}
        </div>

        <section style={sectionStyle}>
          <div style={sectionHeadStyle}>
            <h3 style={sectionTitleStyle}>{config.stateTitle}</h3>
            <Legend
              items={[
                { color: STATE_COLOR.queued, label: config.queueLabel },
                { color: STATE_COLOR.testing, label: "בבדיקה" },
                { color: STATE_COLOR.in_research, label: "במחקר" },
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
        </section>

        {target.kind === "station" && (
          <section style={sectionStyle}>
            <div style={sectionHeadStyle}>
              <h3 style={sectionTitleStyle}>זמנים שנסגרו באותו יום · שני שעונים</h3>
              <Legend
                items={[
                  { color: "var(--dash-ramp-1)", label: "המתנה · ברוטו", line: true },
                  { color: "var(--dash-ramp-1)", label: "המתנה · נטו", line: true, dashed: true },
                  { color: "var(--color-ink-muted-48)", label: "ביצוע · ברוטו", line: true },
                  { color: "var(--color-ink-muted-48)", label: "ביצוע · נטו", line: true, dashed: true },
                ]}
              />
            </div>
            {/* Inside a modal Dialog the side panel cannot open, so the
                definitions are said here, in one line. */}
            <p style={{ margin: "0 0 6px", fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
              <b>{CLOCK_TEXT.wall.label}</b> = {CLOCK_TEXT.wall.short} · <b>{CLOCK_TEXT.work.label}</b> ={" "}
              {CLOCK_TEXT.work.short} (לפי מסך שעות עבודה)
            </p>
            <ChartBody height={132}>
              {loading || !folded ? (
                <Skeleton variant="rectangular" height={132} />
              ) : folded.length === 0 ? (
                <EmptyHistory />
              ) : (
                <HistoryDurationChart points={folded} />
              )}
            </ChartBody>
          </section>
        )}

        {target.kind === "shipment" && (
          <section style={sectionStyle}>
            <div style={sectionHeadStyle}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
                <h3 style={sectionTitleStyle}>אחוז השלמה לאורך זמן</h3>
                {/* The denominator MOVES with the day, so a dip is a real
                    event and not a glitch — it is said next to the chart and
                    not only in the footnote, because the footnote is a screen
                    away at the bottom of the dialog. */}
                <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>
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
          </section>
        )}
      </div>

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
        <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>{config.footnote}</div>
        <button
          type="button"
          className="dash-btn dash-btn--primary"
          onClick={() => {
            onApplyFilter(target);
            onClose();
          }}
        >
          <span className="dash-icon">
            <FilterList fontSize={14} aria-hidden />
          </span>
          {config.cta}
        </button>
      </div>
    </Dialog>
  );
}

const sectionStyle: React.CSSProperties = {
  borderTop: "1px solid var(--color-hairline)",
  paddingTop: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const sectionHeadStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-body-sm)",
  fontWeight: 600,
};

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
        fontSize: "var(--text-small)",
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
  tone?: DashTone;
}

/**
 * The cells above the charts. A station and the other three entities do
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
          note: isNil(wall)
            ? "התור של סוג העמדה"
            : `${workTwin(wall, work)} · התור של סוג העמדה`,
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

    // Two cells, because Q2א and Q2ב answer two things. Completion and the route
    // turnaround of the clicked row are not tiles here: neither is a HISTORICAL
    // number, and a cell that ignores the preset beside cells that obey it will
    // be misread. A shipment's completion is drawn as the curve below instead.
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
        // Neutral: no threshold says this many open items is a warning.
      },
    ];
  }, [target, points]);
}
