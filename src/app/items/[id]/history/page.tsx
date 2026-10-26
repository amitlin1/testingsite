"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BarChart3, Check, ChevronRight, Clock, FileText, FlaskConical, RefreshCw } from "lucide-react";
import { Alert, Button, Skeleton, Tag } from "@/components/ui";
import { formatDuration } from "@/app/lib/datetime";
import { STATUS_NAMES } from "@/app/lib/status-names";
import { toneOfStatus, type StatusTone } from "@/app/lib/status-tones";
import { formatFileSize } from "@/lib/minioFileUtils";
import { apiFetch } from "@/lib/api/client";
import { StatusPill } from "@/components/DataTable";
import { SummaryStrip, SummaryTile, SummaryStripSkeleton } from "@/components/SummaryStrip";
import MyPackageCard from "@/app/components/packages/MyPackageCard";
import type { PackageView } from "@/app/lib/packages/read";
import { formatDay, formatMoment } from "../../format";
import ItemReportControl from "./ItemReportControl";
import "@/components/items.css";

/*
 * היסטוריית פריט — the full-page reconstruction of a single item's path through
 * the testing route: every station it passed, who ran it, queue/processing
 * timestamps and net processing time, so a supervisor can see where a fault
 * was introduced and who is accountable.
 *
 * Read-only. Every value on screen is derived from live tables via the existing
 * endpoints (items / item_routes / item_route_history / test_stations /
 * file_objects) — deliberately no *_snapshots tables, which are being retired.
 *
 * One surface per section: the timeline entries, the item facts and the file
 * and connected-item lists are rows divided by hairlines inside their card,
 * never cards inside a card.
 */

type RouteStation = { id: number; desc: string };

type ItemData = {
  item_id: number;
  makat: number | null;
  serial_no: string | null;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_id: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  route_steps: number[] | null;
  route_stations: RouteStation[] | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  package_id: number | null;
  connected_items?: ConnectedItem[];
};

type ConnectedItem = {
  item_id: number;
  serial_no: string | null;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_desc: string | null;
  relation_type?: string;
};

type HistoryRow = {
  log_id: number;
  item_id: number;
  current_route_step: number;
  test_station_id: number | null;
  test_station_desc: string | null;
  test_station_type_id: number | null;
  test_station_type_desc: string | null;
  queue_start_time: string | null;
  processing_start_time: string | null;
  processing_end_time: string | null;
  /** Net work time of the step, from the DB's one work calendar. NULL while the
   *  step is open — "not finished" is not "took no time". */
  net_work_seconds: number | null;
  worker_id: number | null;
  worker_name: string | null;
};

type ItemFile = {
  objectKey: string;
  fileName: string;
  contentType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  stationTypeId: number | null;
  isGlobal: boolean;
  photoType: string | null;
};

type Worker = { worker_id: number; worker_name: string | null };
type StationType = { test_station_type_id: number; test_type_desc: string };
type PhotoType = { code: string; photo_type_desc: string };

/* ---------- tokens (design-system palette, single action blue) ---------- */
const INK = "var(--color-ink)";
const BODY = "var(--color-ink-muted-70)";
const MUTED = "var(--color-ink-muted-48)";
const HAIRLINE = "var(--color-hairline)";
const SOFT = "var(--color-divider-soft)";
const BLUE = "var(--color-primary)";

const card: React.CSSProperties = {
  background: "var(--color-canvas)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: HAIRLINE,
  borderRadius: "var(--r-card)",
};

/** A card's inline padding — rows that are links bleed by the same amount. */
const CARD_PAD_INLINE = "var(--space-lg)";

const EM_DASH = "—";

/* ---------- formatting (dates: the item screens' shared presets) ---------- */

const fmtDur = (ms: number | null) =>
  ms == null ? EM_DASH : formatDuration(ms, "short");

/**
 * Elapsed wall-clock in days/hours — used only for "זמן כולל במערכת", which
 * routinely spans days and would read as a meaningless HH:MM:SS through
 * formatDuration's long format.
 */
function fmtElapsedLong(ms: number | null): string {
  if (ms == null || isNaN(ms) || ms < 0) return EM_DASH;
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} ימים, ${hours} שעות`;
  if (hours > 0) return `${hours} שעות, ${mins} דק׳`;
  return `${mins} דק׳`;
}

/** Wall-clock difference in ms; null when either end is missing/invalid. */
function diff(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return b - a;
}

const trim = (v: string | null | undefined) => (v ? v.trim() : "");

/* ---------- small building blocks ---------- */

/** One section role on this page: 17/600 title, 13 muted subtitle. */
function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ ...card, padding: `var(--space-ml) ${CARD_PAD_INLINE}` }}>
      <h2 style={{ margin: 0, fontSize: "var(--text-lead)", fontWeight: 600, lineHeight: "var(--lh-snug)", color: INK }}>{title}</h2>
      {subtitle ? (
        <p style={{ margin: "var(--space-xxs) 0 0", fontSize: "var(--text-small)", color: MUTED, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      ) : null}
      <div style={{ marginTop: "var(--space-sm)" }}>{children}</div>
    </section>
  );
}

/** A row inside a card: divided from the one above by a hairline. */
const rowBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) 0",
  borderTop: `1px solid ${SOFT}`,
};

/** A row that is a link: bleeds to the card edge so its hover is the row. */
const linkRow: React.CSSProperties = {
  ...rowBase,
  marginInline: `calc(-1 * ${CARD_PAD_INLINE})`,
  paddingInline: CARD_PAD_INLINE,
};

/* ---------- page ---------- */

export default function ItemHistoryPage() {
  const params = useParams<{ id: string }>();
  const itemId = params?.id ?? "";

  const [item, setItem] = React.useState<ItemData | null>(null);
  const [history, setHistory] = React.useState<HistoryRow[]>([]);
  // The item's box (docs/packages/PLAN.md); null for a legacy loose item.
  const [pkg, setPkg] = React.useState<PackageView | null>(null);
  const [files, setFiles] = React.useState<ItemFile[]>([]);
  const [workers, setWorkers] = React.useState<Worker[]>([]);
  const [stationTypes, setStationTypes] = React.useState<StationType[]>([]);
  const [photoTypes, setPhotoTypes] = React.useState<PhotoType[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // "Not found" is an answer, not a failure — it gets no retry.
  const [notFound, setNotFound] = React.useState(false);
  // Bumped by "נסה שוב" to re-run the same load.
  const [reloadKey, setReloadKey] = React.useState(0);
  // "Now" reference for the still-running total, captured once data lands so the
  // number is stable while reading the page (and never differs across renders).
  const [nowRef, setNowRef] = React.useState<string | null>(null);

  const [fileTab, setFileTab] = React.useState<string>("all");

  React.useEffect(() => {
    if (!itemId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const [itemRes, filesRes, workersRes, typesRes, photoRes] = await Promise.all([
          apiFetch(`/api/items/${encodeURIComponent(itemId)}`),
          apiFetch(`/api/items/${encodeURIComponent(itemId)}/files`),
          apiFetch("/api/workers-directory"),
          apiFetch("/api/settings/test-stations-type"),
          // Inactive groups too: a photo taken under a group (or a template's photo component)
          // that was retired since still shows its name.
          apiFetch("/api/settings/photo-types?all=1"),
        ]);

        if (!itemRes.ok) throw new Error("שגיאה בטעינת הפריט");
        const itemJson = await itemRes.json();
        if (cancelled) return;

        if (!itemJson?.item) {
          setNotFound(true);
          setItem(null);
          setHistory([]);
          return;
        }

        setItem(itemJson.item as ItemData);
        setHistory(Array.isArray(itemJson.history) ? itemJson.history : []);
        setPkg((itemJson.package as PackageView | null) ?? null);
        setNowRef(new Date().toISOString());

        // Supporting lookups are best-effort: a failure here degrades a label,
        // it must not blank the screen.
        if (filesRes.ok) {
          const j = await filesRes.json();
          if (!cancelled) setFiles(Array.isArray(j.files) ? j.files : []);
        }
        if (workersRes.ok) {
          const j = await workersRes.json();
          if (!cancelled) setWorkers(Array.isArray(j) ? j : []);
        }
        if (typesRes.ok) {
          const j = await typesRes.json();
          if (!cancelled) setStationTypes(Array.isArray(j) ? j : []);
        }
        if (photoRes.ok) {
          const j = await photoRes.json();
          if (!cancelled) setPhotoTypes(Array.isArray(j) ? j : []);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "שגיאה בטעינת הנתונים");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId, reloadKey]);

  /* ----- derived ----- */

  const routeStations: RouteStation[] = React.useMemo(
    () => (item?.route_stations ?? []).map((s) => ({ id: s.id, desc: trim(s.desc) })),
    [item],
  );

  /** API returns log_id DESC; the screen reads chronologically. */
  const chron = React.useMemo(
    () => [...history].sort((a, b) => a.log_id - b.log_id),
    [history],
  );

  /**
   * Net processing time per entry, in ms — work hours only, computed by the
   * database's work calendar (work_seconds_between) and handed over by the API.
   * ItemDialog reads the same field, so the two screens never disagree, and
   * neither can disagree with the dashboard.
   */
  const nets = React.useMemo(
    () => chron.map((h) => (h.net_work_seconds === null ? null : h.net_work_seconds * 1000)),
    [chron],
  );

  const maxNet = React.useMemo(
    () => nets.reduce<number>((m, n) => (n != null && n > m ? n : m), 0),
    [nets],
  );

  /**
   * When the item was at each route step, keyed by step number — shown under the
   * stepper so the route reads as a timeline at a glance.
   *
   * `current_route_step` is the item's position in `route_steps`, so step N is
   * exactly `route_stations[N-1]`; no station-type matching needed. Prefer the
   * completion date, falling back to when processing (or the wait) started, so a
   * step in progress still carries a date. `chron` is ascending, so if a step was
   * run more than once the latest visit overwrites the earlier one.
   */
  const stepDates = React.useMemo(() => {
    const byStep = new Map<number, string>();
    chron.forEach((h) => {
      const when = h.processing_end_time || h.processing_start_time || h.queue_start_time;
      if (when) byStep.set(h.current_route_step, when);
    });
    return byStep;
  }, [chron]);

  const workerNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    workers.forEach((w) => {
      if (w.worker_name) m.set(String(w.worker_id), w.worker_name.trim());
    });
    return m;
  }, [workers]);

  const stationTypeNameById = React.useMemo(() => {
    const m = new Map<number, string>();
    // Global list first, then the item's own route — the route's labels win, so
    // a station shown in the stepper and in the files tabs reads identically.
    stationTypes.forEach((t) => m.set(t.test_station_type_id, trim(t.test_type_desc)));
    routeStations.forEach((s) => m.set(s.id, s.desc));
    return m;
  }, [stationTypes, routeStations]);

  const photoTypeLabel = React.useMemo(() => {
    const m = new Map<string, string>();
    photoTypes.forEach((p) => m.set(p.code, p.photo_type_desc));
    return m;
  }, [photoTypes]);

  const totalSteps = routeStations.length;
  const currentStep = item?.is_finished ? totalSteps : item?.current_route_step ?? 0;
  const statusId = item?.current_status ?? null;
  const statusLabel =
    trim(item?.item_status_desc) ||
    (statusId != null ? STATUS_NAMES[statusId] ?? `סטטוס ${statusId}` : EM_DASH);

  /** Station name for a history row: the actual station, else its type. */
  const stationNameOf = (h: HistoryRow) =>
    trim(h.test_station_desc) ||
    trim(h.test_station_type_desc) ||
    routeStations[h.current_route_step - 1]?.desc ||
    EM_DASH;

  const summary = React.useMemo(() => {
    const endRef = item?.finished_at || nowRef;
    const totalMs = diff(item?.created_at, endRef);
    const completedCount = chron.filter((h) => h.processing_end_time).length;
    // A step with no processing_start_time has no measurable duration. Summing
    // those as zero would report "0s" for an item nothing was ever timed on —
    // show "—" instead, so an unmeasured route never reads as an instant one.
    const measured = nets.filter((n): n is number => n != null);
    const cumNet = measured.reduce((sum, n) => sum + n, 0);

    let longestIdx = -1;
    nets.forEach((n, i) => {
      if (n != null && (longestIdx === -1 || (nets[longestIdx] ?? 0) < n)) longestIdx = i;
    });

    return [
      { icon: <Clock size={20} strokeWidth={1.75} />, value: fmtElapsedLong(totalMs), label: "זמן כולל במערכת" },
      // <bdi>: a spaced "a / b" in an RTL run is shown reversed ("5 / 3").
      { icon: <Check size={20} strokeWidth={1.75} />, value: <bdi dir="ltr">{completedCount} / {totalSteps}</bdi>, label: "תחנות שהושלמו" },
      { icon: <FlaskConical size={20} strokeWidth={1.75} />, value: measured.length ? fmtDur(cumNet) : EM_DASH, label: "זמן עיבוד מצטבר" },
      // The duration is the KPI; the station it belongs to rides in the label
      // so a long station name never wraps the value line.
      {
        icon: <BarChart3 size={20} strokeWidth={1.75} />,
        value: longestIdx === -1 ? EM_DASH : fmtDur(nets[longestIdx]),
        label: longestIdx === -1 ? "התחנה הארוכה ביותר" : `התחנה הארוכה ביותר · ${stationNameOf(chron[longestIdx])}`,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, nowRef, chron, nets, totalSteps]);

  /* ----- connected items -----
   * Package model: an item in a box gets the "המארז שלי" card (siblings and
   * where each one is). The connected-items list below only serves a legacy
   * loose item that still has children pointing at it. */
  const connectedAll = React.useMemo(() => item?.connected_items ?? [], [item]);
  const accessories = React.useMemo(
    () => connectedAll.filter((c) => c.item_id !== item?.package_id),
    [connectedAll, item],
  );

  /* ----- files, grouped by the station they were saved at ----- */
  const taggedFiles = React.useMemo(
    () =>
      files.map((f) => {
        const key = f.isGlobal
          ? "global"
          : f.stationTypeId != null
            ? String(f.stationTypeId)
            : "none";
        const label = f.isGlobal
          ? "כללי"
          : f.stationTypeId != null
            ? stationTypeNameById.get(f.stationTypeId) ?? `עמדה ${f.stationTypeId}`
            : "ללא עמדה";
        return { ...f, groupKey: key, groupLabel: label };
      }),
    [files, stationTypeNameById],
  );

  const fileTabs = React.useMemo(() => {
    const counts = new Map<string, number>();
    taggedFiles.forEach((f) => counts.set(f.groupKey, (counts.get(f.groupKey) ?? 0) + 1));

    const tabs: { key: string; label: string; count: number }[] = [
      { key: "all", label: "הכל", count: taggedFiles.length },
    ];
    // Route order first, so the tabs read like the item's journey.
    routeStations.forEach((s) => {
      const c = counts.get(String(s.id));
      if (c) tabs.push({ key: String(s.id), label: s.desc, count: c });
    });
    // Then any station type outside this item's route that still holds files —
    // dropping it would make the tab counts disagree with "הכל".
    taggedFiles.forEach((f) => {
      if (f.groupKey === "global" || f.groupKey === "none") return;
      if (tabs.some((t) => t.key === f.groupKey)) return;
      tabs.push({ key: f.groupKey, label: f.groupLabel, count: counts.get(f.groupKey) ?? 0 });
    });
    if (counts.get("none")) tabs.push({ key: "none", label: "ללא עמדה", count: counts.get("none")! });
    if (counts.get("global")) tabs.push({ key: "global", label: "כללי", count: counts.get("global")! });
    return tabs;
  }, [taggedFiles, routeStations]);

  const visibleFiles = React.useMemo(
    () => (fileTab === "all" ? taggedFiles : taggedFiles.filter((f) => f.groupKey === fileTab)),
    [taggedFiles, fileTab],
  );

  // A tab can disappear when files reload (e.g. its last file was removed).
  React.useEffect(() => {
    if (fileTab !== "all" && !fileTabs.some((t) => t.key === fileTab)) setFileTab("all");
  }, [fileTabs, fileTab]);

  /* ----- render ----- */

  const shell: React.CSSProperties = {
    maxWidth: 1240,
    margin: "0 auto",
    padding: "var(--space-lg) var(--space-lg) var(--space-xxl)",
    color: INK,
  };

  if (loading) {
    return (
      <div style={shell}>
        <BackLink />
        <HistorySkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div style={shell}>
        <BackLink />
        <Alert
          severity="error"
          action={
            <Button size="small" variant="outlined" color="inherit" onClick={() => setReloadKey((k) => k + 1)} startIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden />}>
              נסה שוב
            </Button>
          }
        >
          {/* Fixed Hebrew copy: the thrown message can be a browser's English
              network error. */}
          טעינת היסטוריית הפריט נכשלה. ייתכן שהשרת אינו זמין כרגע — נסה שוב בעוד רגע.
        </Alert>
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div style={shell}>
        <BackLink />
        <div style={{ ...card, padding: "var(--space-lg)", fontSize: "var(--text-body)", color: BODY }}>
          פריט #{itemId} לא נמצא. ייתכן שנמחק — חזור לרשימת הפריטים וחפש אותו שם.
        </div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <BackLink />

      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-ml)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-page)", fontWeight: 700, letterSpacing: "var(--ls-display)", lineHeight: 1.1 }}>
            היסטוריית פריט #{item.item_id}
          </h1>
          <p style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--text-body)", color: BODY, lineHeight: "var(--lh-body)", maxWidth: 640 }}>
            מעקב אחר כל שלב שהפריט עבר במערכת — מי ביצע, מתי וכמה זמן ארכה כל תחנה, לאיתור היכן נוצרה התקלה.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-xs)", flexShrink: 0 }}>
          {/* The one status palette (status-tones), as in the items table. */}
          <StatusPill label={statusLabel} tone={toneOfStatus(statusId)} />
          <span style={{ fontSize: "var(--text-small)", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
            {totalSteps > 0 ? `שלב ${currentStep} מתוך ${totalSteps}` : "ללא מסלול בדיקה"}
            {item.item_type_desc ? ` · ${trim(item.item_type_desc)}` : ""}
          </span>
          <ItemReportControl itemId={String(item.item_id)} />
        </div>
      </div>

      {/* summary strip — the shared KPI tiles */}
      <SummaryStrip style={{ marginTop: "var(--space-lg)" }}>
        {summary.map((s) => (
          <SummaryTile key={s.label} icon={s.icon} tone="neutral" value={s.value} label={s.label} />
        ))}
      </SummaryStrip>

      {/* route stepper */}
      {totalSteps > 0 && (
        <div style={{ marginTop: "var(--space-md)" }}>
          <SectionCard title="מסלול בדיקה">
            <ol style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", margin: 0, padding: "var(--space-xs) 0 var(--space-xxs)", listStyle: "none" }}>
              {routeStations.map((st, i) => {
                const done = !!item.is_finished || i < currentStep - 1;
                const current = !item.is_finished && i === currentStep - 1;
                return (
                  <React.Fragment key={`${st.id}-${i}`}>
                    {i > 0 && (
                      <li aria-hidden style={{ flex: 1, minWidth: 24, height: 2, background: i <= currentStep - 1 ? BLUE : HAIRLINE, marginTop: 15 }} />
                    )}
                    <li
                      aria-current={current ? "step" : undefined}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-xs)", minWidth: 92 }}
                    >
                      <div
                        style={{
                          width: 32, height: 32, borderRadius: "var(--r-pill)",
                          background: done ? BLUE : "var(--color-canvas)",
                          border: `2px solid ${done || current ? BLUE : "var(--color-border-strong)"}`,
                          color: done ? "var(--color-on-primary)" : current ? BLUE : MUTED,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "var(--text-small)", fontWeight: 700, flexShrink: 0,
                        }}
                      >
                        {done ? <Check size={15} strokeWidth={2.4} aria-label="הושלם" /> : i + 1}
                      </div>
                      <div style={{ fontSize: "var(--text-fine)", color: done || current ? INK : MUTED, textAlign: "center", lineHeight: 1.3, maxWidth: 96, fontWeight: current ? 700 : 400 }}>
                        {st.desc}
                      </div>
                      {/* Date the item was at this step. A step it hasn't reached
                          has none — the dash keeps the row heights even. */}
                      <div style={{ fontSize: "var(--text-micro)", color: MUTED, textAlign: "center", lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
                        {formatDay(stepDates.get(i + 1))}
                      </div>
                    </li>
                  </React.Fragment>
                );
              })}
            </ol>
          </SectionCard>
        </div>
      )}

      {/* two columns */}
      <div className="items-history-cols" style={{ marginTop: "var(--space-ml)" }}>
        {/* station history timeline — one surface, entries divided by hairlines */}
        <SectionCard
          title="היסטוריית תחנות"
          subtitle="לפי סדר כרונולוגי. משך העיבוד נטו של כל תחנה מוצג כפס להשוואה מהירה בין התחנות."
        >
          {chron.length === 0 ? (
            <div style={{ fontSize: "var(--text-small)", color: MUTED, paddingTop: "var(--space-xs)" }}>אין היסטוריה עדיין.</div>
          ) : (
            <ol style={{ margin: 0, padding: "var(--space-sm) 0 0", listStyle: "none" }}>
              {chron.map((h, i) => {
                const net = nets[i];
                const wait = diff(h.queue_start_time, h.processing_start_time);
                const inProgress = !!h.processing_start_time && !h.processing_end_time;
                const done = !!h.processing_end_time;
                const worker = trim(h.worker_name);
                const pct = net != null && maxNet > 0 ? Math.max(6, Math.round((net / maxNet) * 100)) : 0;
                const last = i === chron.length - 1;
                // The entry's state in the one status palette: waiting / in
                // test / done, the same tones as the items table.
                const tone: StatusTone = inProgress ? "active" : done ? "done" : "waiting";

                return (
                  <li key={h.log_id} style={{ display: "flex", gap: "var(--space-md)", alignItems: "stretch" }}>
                    <div style={{ flexShrink: 0, width: 32, display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div
                        style={{
                          width: 32, height: 32, borderRadius: "var(--r-pill)",
                          background: done ? BLUE : "var(--color-canvas)",
                          border: `2px solid ${BLUE}`,
                          color: done ? "var(--color-on-primary)" : BLUE,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "var(--text-small)", fontWeight: 700, flexShrink: 0,
                        }}
                      >
                        {done ? <Check size={15} strokeWidth={2.4} aria-label="הושלם" /> : h.current_route_step}
                      </div>
                      {!last && <div aria-hidden style={{ flex: 1, width: 2, background: HAIRLINE, margin: "var(--space-xxs) 0" }} />}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        paddingBottom: last ? 0 : "var(--space-lg)",
                        marginBottom: last ? 0 : "var(--space-lg)",
                        borderBottom: last ? undefined : `1px solid ${SOFT}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <h3 style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 600, lineHeight: "var(--lh-snug)" }}>{stationNameOf(h)}</h3>
                          <div style={{ fontSize: "var(--text-fine)", color: MUTED, marginTop: 2 }}>שלב {h.current_route_step}</div>
                        </div>
                        <StatusPill label={inProgress ? "בעיבוד" : done ? "הושלם" : "בתור"} tone={tone} />
                      </div>

                      {/* who ran it — the accountability signal */}
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", marginTop: "var(--space-sm)" }}>
                        <span
                          aria-hidden
                          style={{
                            width: 28, height: 28, borderRadius: "var(--r-pill)",
                            background: "var(--color-canvas-parchment)",
                            color: worker ? "var(--color-ink-muted-80)" : MUTED,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "var(--text-fine)", fontWeight: 700, flexShrink: 0,
                          }}
                        >
                          {worker ? worker.charAt(0) : "?"}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "var(--text-micro)", color: MUTED, lineHeight: 1.2 }}>בוצע על ידי</div>
                          <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, marginTop: 2, color: worker ? INK : MUTED }}>
                            {worker || "לא תועד"}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", marginTop: "var(--space-md)" }}>
                        <Timing label="התחלת תור" value={formatMoment(h.queue_start_time)} />
                        <Timing label="התחלת עיבוד" value={formatMoment(h.processing_start_time)} />
                        <Timing
                          label="סיום עיבוד"
                          value={inProgress ? "בתהליך" : formatMoment(h.processing_end_time)}
                          color={inProgress ? BLUE : INK}
                        />
                        <Timing label="המתנה בתור" value={fmtDur(wait)} color={BODY} />
                      </div>

                      <div style={{ marginTop: "var(--space-md)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: "var(--text-fine)", color: MUTED }}>משך עיבוד נטו</span>
                          <span style={{ fontSize: "var(--text-small)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtDur(net)}</span>
                        </div>
                        <div aria-hidden style={{ height: 6, borderRadius: "var(--r-pill)", background: SOFT, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: BLUE, borderRadius: "var(--r-pill)" }} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </SectionCard>

        {/* aside */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-ml)", minWidth: 0 }}>
          <SectionCard title="פרטי הפריט">
            <dl style={{ margin: 0 }}>
              {[
                { k: "מספר סריאלי", v: trim(item.serial_no) || EM_DASH },
                { k: "מק״ט", v: item.makat != null ? String(item.makat) : EM_DASH },
                { k: "סוג פריט", v: trim(item.item_type_desc) || EM_DASH },
                { k: "סטטוס", v: statusLabel },
                { k: "עמדה נוכחית", v: trim(item.test_station_desc) || EM_DASH },
                { k: "תאריך קליטה", v: formatMoment(item.created_at) },
                ...(item.finished_at ? [{ k: "תאריך סיום", v: formatMoment(item.finished_at) }] : []),
                { k: "מארז", v: pkg ? `${pkg.item_type_desc} · ${pkg.item_id}` : EM_DASH },
              ].map((r) => (
                <div key={r.k} style={rowBase}>
                  <dt style={{ fontSize: "var(--text-small)", color: MUTED, flexShrink: 0 }}>{r.k}</dt>
                  <dd style={{ margin: 0, marginInlineStart: "auto", fontSize: "var(--text-body-sm)", fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "end", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.v}
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          {/* Package model: the box this item is in (or is). It is its own
              card, so it sits here directly — not wrapped in a second card —
              and carries the section title itself, like the cards around it.
              A loose legacy item keeps the connected-items list. */}
          {pkg ? (
            <MyPackageCard pkg={pkg} currentItemId={item.item_id} title="היסטוריית המארז" />
          ) : (
            <SectionCard title="פריטים מחוברים">
              {accessories.length > 0 ? (
                <div>
                  {accessories.map((c) => (
                    <ConnectedRow key={c.item_id} c={c} relationLabel="אביזר" />
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "var(--text-small)", color: MUTED }}>אין פריטים מחוברים.</div>
              )}
            </SectionCard>
          )}

          <SectionCard
            title="קבצים מצורפים"
            subtitle="הקבצים מקובצים לפי העמדה שבה נשמרו. בחר עמדה לצפייה בקבצים שלה."
          >
            {taggedFiles.length === 0 ? (
              <div style={{ fontSize: "var(--text-small)", color: MUTED }}>אין קבצים מצורפים.</div>
            ) : (
              <>
                <div role="group" aria-label="סינון קבצים לפי עמדה" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
                  {fileTabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setFileTab(t.key)}
                      aria-pressed={fileTab === t.key}
                      className="items-file-tab"
                    >
                      {t.label}
                      <span className="items-file-tab-count">{t.count}</span>
                    </button>
                  ))}
                </div>

                {visibleFiles.length === 0 ? (
                  <div style={{ fontSize: "var(--text-small)", color: MUTED }}>אין קבצים בעמדה זו.</div>
                ) : (
                  <div>
                    {visibleFiles.map((f) => {
                      // created_by stores the worker id; resolve it to a name and
                      // fall back to the raw value rather than inventing one.
                      const by = f.createdBy ? workerNameById.get(String(f.createdBy)) ?? f.createdBy : null;
                      const meta = [formatMoment(f.createdAt), by ?? EM_DASH];
                      const pt = f.photoType ? photoTypeLabel.get(f.photoType) : null;
                      if (pt) meta.push(pt);
                      return (
                        <a
                          key={f.objectKey}
                          href={downloadUrl(f.objectKey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="items-row-link"
                          style={linkRow}
                        >
                          <span aria-hidden style={{ display: "flex", color: MUTED, flexShrink: 0 }}>
                            <FileText size={18} strokeWidth={1.75} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.fileName}>
                              {f.fileName}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 }}>
                              {fileTab === "all" && (
                                <Tag tone="neutral" style={{ flexShrink: 0 }}>{f.groupLabel}</Tag>
                              )}
                              <span style={{ fontSize: "var(--text-fine)", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {meta.join(" · ")}
                              </span>
                            </div>
                          </div>
                          <div style={{ fontSize: "var(--text-fine)", color: MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                            {formatFileSize(f.size)}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function BackLink() {
  return (
    <Link
      href="/"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, fontSize: "var(--text-body-sm)", fontWeight: 600, color: BLUE, textDecoration: "none", marginBottom: "var(--space-sm)" }}
    >
      <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      חזרה לרשימת הפריטים
    </Link>
  );
}

function Timing({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-fine)", color: MUTED }}>{label}</div>
      <div style={{ fontSize: "var(--text-small)", fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums", color }}>
        {value}
      </div>
    </div>
  );
}

function ConnectedRow({ c, relationLabel }: { c: ConnectedItem; relationLabel: string }) {
  const status =
    trim(c.item_status_desc) ||
    (c.current_status != null ? STATUS_NAMES[c.current_status] ?? "" : "") ||
    EM_DASH;
  return (
    <Link href={`/items/${c.item_id}/history`} className="items-row-link" style={linkRow}>
      <Tag tone="neutral" style={{ flexShrink: 0 }}>{relationLabel}</Tag>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>#{c.item_id}</div>
        <div style={{ fontSize: "var(--text-fine)", color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trim(c.item_type_desc) || EM_DASH}
        </div>
      </div>
      <div style={{ textAlign: "end", flexShrink: 0 }}>
        <div style={{ fontSize: "var(--text-fine)", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{trim(c.serial_no) || EM_DASH}</div>
        <div style={{ fontSize: "var(--text-fine)", color: MUTED, marginTop: 1 }}>{status}</div>
      </div>
    </Link>
  );
}

/** The page's shape while it loads: header, KPI strip, timeline and aside. */
function HistorySkeleton() {
  return (
    <div aria-busy="true" aria-label="טוען את היסטוריית הפריט">
      <Skeleton width={320} height={30} />
      <Skeleton width="min(560px, 80%)" height={14} style={{ marginTop: "var(--space-sm)" }} />
      <SummaryStripSkeleton count={4} style={{ marginTop: "var(--space-lg)" }} />
      <div className="items-history-cols" style={{ marginTop: "var(--space-ml)" }}>
        <div style={{ ...card, padding: `var(--space-ml) ${CARD_PAD_INLINE}` }}>
          <Skeleton width={160} height={16} />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-lg)" }}>
              <Skeleton variant="circular" width={32} height={32} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton width="40%" height={14} />
                <Skeleton width="25%" height={11} style={{ marginTop: 6 }} />
                <Skeleton width="85%" height={11} style={{ marginTop: "var(--space-md)" }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ ...card, padding: `var(--space-ml) ${CARD_PAD_INLINE}` }}>
          <Skeleton width={120} height={16} />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={12} style={{ marginTop: "var(--space-md)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Same download route ItemFilesPanel uses — one URL builder, one behaviour. */
function downloadUrl(objectKey: string): string {
  return (
    "/api/files/download/" +
    objectKey.split("/").map((s) => encodeURIComponent(s)).join("/")
  );
}
