"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BarChart3, Check, ChevronRight, Clock, FileText, FlaskConical } from "lucide-react";
import {
  calculateWorkDuration,
  formatDuration,
  formatUtcToLocal,
} from "@/app/lib/datetime";
import { STATUS_NAMES } from "@/app/lib/status-names";
import { formatFileSize } from "@/lib/minioFileUtils";
import { apiFetch } from "@/lib/api/client";

/*
 * היסטוריית פריט — the full-page reconstruction of a single item's path through
 * the testing route: every station it passed, who ran it, queue/processing
 * timestamps and net processing time, so a supervisor can see where a fault
 * was introduced and who is accountable.
 *
 * Read-only. Every value on screen is derived from live tables via the existing
 * endpoints (items / item_routes / item_route_history / test_stations /
 * file_objects) — deliberately no *_snapshots tables, which are being retired.
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
  parent_item_id: number | null;
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
const INK = "#1d1d1f";
const BODY = "#444";
const MUTED = "#7a7a7a";
const FAINT = "#9a9aa0";
const HAIRLINE = "#e0e0e0";
const SOFT = "#f0f0f0";
const BLUE = "#0066cc";
const TINT = "rgba(0,102,204,0.09)";

const card: React.CSSProperties = {
  background: "#fff",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: HAIRLINE,
  borderRadius: 18,
};

const EM_DASH = "—";

/* ---------- formatting ---------- */

/** Date + time without seconds — the timeline compares moments, not ticks. */
const fmtDT = (iso: string | null | undefined) =>
  iso
    ? formatUtcToLocal(iso, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: undefined,
        hour12: false,
      })
    : EM_DASH;

/** Date only — used under the route stepper, where there's no room for a time. */
const fmtDate = (iso: string | null | undefined) =>
  iso
    ? formatUtcToLocal(iso, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: undefined,
        minute: undefined,
        second: undefined,
      })
    : EM_DASH;

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

function SectionCard({
  title,
  subtitle,
  children,
  titleSize = 13,
  padding = "22px 24px",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  titleSize?: number;
  padding?: string;
}) {
  return (
    <div style={{ ...card, padding }}>
      <div style={{ fontSize: titleSize, fontWeight: 700, color: INK }}>{title}</div>
      {subtitle ? (
        <p style={{ margin: "6px 0 0", fontSize: titleSize > 14 ? 13.5 : 12, color: titleSize > 14 ? MUTED : FAINT, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      ) : null}
      <div style={{ marginTop: 14 }}>{children}</div>
    </div>
  );
}

/** Bordered vertical list — the aside's shared container look. */
function BorderedList({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, borderRadius: 12, overflow: "hidden" }}>
      {children}
    </div>
  );
}

const rowBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px",
  borderTop: `1px solid ${SOFT}`,
};

/* ---------- page ---------- */

export default function ItemHistoryPage() {
  const params = useParams<{ id: string }>();
  const itemId = params?.id ?? "";

  const [item, setItem] = React.useState<ItemData | null>(null);
  const [history, setHistory] = React.useState<HistoryRow[]>([]);
  const [files, setFiles] = React.useState<ItemFile[]>([]);
  const [workers, setWorkers] = React.useState<Worker[]>([]);
  const [stationTypes, setStationTypes] = React.useState<StationType[]>([]);
  const [photoTypes, setPhotoTypes] = React.useState<PhotoType[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
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
      try {
        const [itemRes, filesRes, workersRes, typesRes, photoRes] = await Promise.all([
          apiFetch(`/api/items/${encodeURIComponent(itemId)}`),
          apiFetch(`/api/items/${encodeURIComponent(itemId)}/files`),
          apiFetch("/api/workers"),
          apiFetch("/api/settings/test-stations-type"),
          apiFetch("/api/settings/photo-types"),
        ]);

        if (!itemRes.ok) throw new Error("שגיאה בטעינת הפריט");
        const itemJson = await itemRes.json();
        if (cancelled) return;

        if (!itemJson?.item) {
          setError("הפריט לא נמצא");
          setItem(null);
          setHistory([]);
          return;
        }

        setItem(itemJson.item as ItemData);
        setHistory(Array.isArray(itemJson.history) ? itemJson.history : []);
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
  }, [itemId]);

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
   * Net processing time per entry — work hours only (07:00–15:30), the same
   * measure ItemDialog reports, so the two screens never disagree.
   */
  const nets = React.useMemo(
    () =>
      chron.map((h) =>
        h.processing_start_time && h.processing_end_time
          ? calculateWorkDuration(h.processing_start_time, h.processing_end_time)
          : null,
      ),
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
  const statusActive = statusId === 1 || statusId === 5;

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
    const longest =
      longestIdx === -1
        ? EM_DASH
        : `${stationNameOf(chron[longestIdx])} · ${fmtDur(nets[longestIdx])}`;

    return [
      { icon: <Clock size={20} strokeWidth={1.75} />, value: fmtElapsedLong(totalMs), label: "זמן כולל במערכת" },
      { icon: <Check size={20} strokeWidth={1.75} />, value: `${completedCount} / ${totalSteps}`, label: "תחנות שהושלמו" },
      { icon: <FlaskConical size={20} strokeWidth={1.75} />, value: measured.length ? fmtDur(cumNet) : EM_DASH, label: "זמן עיבוד מצטבר" },
      { icon: <BarChart3 size={20} strokeWidth={1.75} />, value: longest, label: "התחנה הארוכה ביותר" },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, nowRef, chron, nets, totalSteps]);

  /* ----- connected items -----
   * An accessory's siblings are noise on this screen: what matters is the parent
   * it belongs to. So an accessory shows only its parent item, and the full
   * "פריטים מחוברים" card appears only for a parent item (listing its accessories). */
  const isAccessory = item?.parent_item_id != null;
  const connectedAll = item?.connected_items ?? [];
  const parentItem = React.useMemo(
    () =>
      connectedAll.find(
        (c) => c.relation_type === "Parent" || c.item_id === item?.parent_item_id,
      ) ?? null,
    [connectedAll, item],
  );
  const accessories = React.useMemo(
    () => connectedAll.filter((c) => c.item_id !== item?.parent_item_id),
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

  if (loading) {
    return (
      <div style={{ padding: "28px 24px", fontSize: 15, color: MUTED }}>טוען…</div>
    );
  }

  if (error || !item) {
    return (
      <div style={{ padding: "28px 24px" }}>
        <BackLink />
        <div style={{ ...card, padding: 24, marginTop: 16, fontSize: 15, color: BODY }}>
          {error ?? "הפריט לא נמצא"}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 24px 72px", color: INK }}>
      <BackLink />

      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1 }}>
            היסטוריית פריט #{item.item_id}
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: 16, color: BODY, lineHeight: 1.5, maxWidth: 640 }}>
            מעקב אחר כל שלב שהפריט עבר במערכת — מי ביצע, מתי וכמה זמן ארכה כל תחנה, לאיתור היכן נוצרה התקלה.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, background: "#fff", border: `1px solid ${HAIRLINE}`, borderRadius: 9999, padding: "6px 13px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusActive ? BLUE : MUTED }} />
            {statusLabel}
          </span>
          <span style={{ fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
            {totalSteps > 0 ? `שלב ${currentStep} מתוך ${totalSteps}` : "ללא מסלול בדיקה"}
            {item.item_type_desc ? ` · ${trim(item.item_type_desc)}` : ""}
          </span>
        </div>
      </div>

      {/* summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginTop: 22 }}>
        {summary.map((s) => (
          <div key={s.label} style={{ ...card, borderRadius: 16, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 11, background: TINT, color: BLUE, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {s.icon}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.4px", lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>
                {s.value}
              </div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* route stepper */}
      {totalSteps > 0 && (
        <div style={{ ...card, marginTop: 16, padding: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 20 }}>מסלול בדיקה</div>
          <div className="shx-scroll" style={{ display: "flex", alignItems: "flex-start", overflowX: "auto", paddingBottom: 4 }}>
            {routeStations.map((st, i) => {
              const done = !!item.is_finished || i < currentStep - 1;
              const current = !item.is_finished && i === currentStep - 1;
              return (
                <React.Fragment key={`${st.id}-${i}`}>
                  {i > 0 && (
                    <div style={{ flex: 1, minWidth: 24, height: 2, background: i <= currentStep - 1 ? BLUE : HAIRLINE, marginTop: 15 }} />
                  )}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 92 }}>
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: 9999,
                        background: done ? BLUE : "#fff",
                        border: `2px solid ${done || current ? BLUE : "#d0d0d6"}`,
                        color: done ? "#fff" : current ? BLUE : FAINT,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                      }}
                    >
                      {done ? <Check size={15} strokeWidth={2.4} /> : i + 1}
                    </div>
                    <div style={{ fontSize: 12, color: done || current ? INK : FAINT, textAlign: "center", lineHeight: 1.3, maxWidth: 96, fontWeight: current ? 700 : 400 }}>
                      {st.desc}
                    </div>
                    {/* Date the item was at this step. A step it hasn't reached
                        has none — the dash keeps the row heights even. */}
                    <div style={{ fontSize: 11, color: FAINT, textAlign: "center", lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
                      {fmtDate(stepDates.get(i + 1))}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* two columns */}
      <div className="ir-cols" style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, marginTop: 18, alignItems: "start" }}>
        {/* station history timeline */}
        <div style={{ ...card, padding: "24px 26px" }}>
          <div style={{ marginBottom: 6, fontSize: 17, fontWeight: 700 }}>היסטוריית תחנות</div>
          <p style={{ margin: "0 0 22px", fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>
            לפי סדר כרונולוגי. משך העיבוד נטו של כל תחנה מוצג כפס להשוואה מהירה בין התחנות.
          </p>

          {chron.length === 0 ? (
            <div style={{ fontSize: 13.5, color: FAINT }}>אין היסטוריה עדיין.</div>
          ) : (
            chron.map((h, i) => {
              const net = nets[i];
              const wait = diff(h.queue_start_time, h.processing_start_time);
              const inProgress = !!h.processing_start_time && !h.processing_end_time;
              const done = !!h.processing_end_time;
              const worker = trim(h.worker_name);
              const pct = net != null && maxNet > 0 ? Math.max(6, Math.round((net / maxNet) * 100)) : 0;

              return (
                <div key={h.log_id} style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
                  <div style={{ flexShrink: 0, width: 34, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: 9999,
                        background: done ? BLUE : "#fff",
                        border: `2px solid ${BLUE}`,
                        color: done ? "#fff" : BLUE,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, flexShrink: 0,
                      }}
                    >
                      {done ? <Check size={15} strokeWidth={2.4} /> : h.current_route_step}
                    </div>
                    {i < chron.length - 1 && <div style={{ flex: 1, width: 2, background: HAIRLINE, margin: "4px 0" }} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, paddingBottom: 22 }}>
                    <div
                      style={{
                        border: `1px solid ${inProgress ? "#cfe2fb" : HAIRLINE}`,
                        borderRadius: 14,
                        padding: "16px 18px",
                        background: inProgress ? "#f5f9ff" : "#fff",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.2px" }}>{stationNameOf(h)}</div>
                          <div style={{ fontSize: 12.5, color: FAINT, marginTop: 2 }}>שלב {h.current_route_step}</div>
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, background: "#f5f5f7", border: `1px solid ${HAIRLINE}`, borderRadius: 9999, padding: "4px 10px", flexShrink: 0 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: inProgress ? BLUE : "#c4c4cc" }} />
                          {inProgress ? "בעיבוד" : done ? "הושלם" : "בתור"}
                        </span>
                      </div>

                      {/* who ran it — the accountability signal */}
                      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}>
                        <span
                          style={{
                            width: 28, height: 28, borderRadius: 9999,
                            background: worker ? "rgba(0,102,204,0.1)" : SOFT,
                            color: worker ? BLUE : FAINT,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 700, flexShrink: 0,
                          }}
                        >
                          {worker ? worker.charAt(0) : "?"}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: FAINT, lineHeight: 1 }}>בוצע על ידי</div>
                          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: worker ? INK : FAINT }}>
                            {worker || "לא תועד"}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginTop: 16 }}>
                        <Timing label="התחלת תור" value={fmtDT(h.queue_start_time)} />
                        <Timing label="התחלת עיבוד" value={fmtDT(h.processing_start_time)} />
                        <Timing
                          label="סיום עיבוד"
                          value={inProgress ? "בתהליך" : fmtDT(h.processing_end_time)}
                          color={inProgress ? BLUE : INK}
                        />
                        <Timing label="המתנה בתור" value={fmtDur(wait)} color="#5a5a5f" />
                      </div>

                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${SOFT}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                          <span style={{ fontSize: 12, color: MUTED }}>משך עיבוד נטו</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtDur(net)}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 9999, background: SOFT, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: BLUE, borderRadius: 9999 }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* aside */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <SectionCard title="פרטי הפריט">
            <BorderedList>
              {[
                { k: "מספר סריאלי", v: trim(item.serial_no) || EM_DASH },
                { k: "מק״ט", v: item.makat != null ? String(item.makat) : EM_DASH },
                { k: "סוג פריט", v: trim(item.item_type_desc) || EM_DASH },
                { k: "סטטוס", v: statusLabel },
                { k: "עמדה נוכחית", v: trim(item.test_station_desc) || EM_DASH },
                { k: "תאריך קליטה", v: fmtDT(item.created_at) },
                ...(item.finished_at ? [{ k: "תאריך סיום", v: fmtDT(item.finished_at) }] : []),
                { k: "פריט אב", v: item.parent_item_id ? `#${item.parent_item_id}` : EM_DASH },
              ].map((r) => (
                <div key={r.k} style={rowBase}>
                  <span style={{ fontSize: 12.5, color: MUTED, flexShrink: 0 }}>{r.k}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginInlineStart: "auto" }}>
                    {r.v}
                  </span>
                </div>
              ))}
            </BorderedList>
          </SectionCard>

          {/* Accessory → just its parent. Parent item → the accessories hanging off it. */}
          {isAccessory ? (
            <SectionCard title="פריט אב">
              {parentItem ? (
                <BorderedList>
                  <ConnectedRow c={parentItem} relationLabel="אב" />
                </BorderedList>
              ) : (
                <div style={{ fontSize: 13, color: FAINT }}>
                  {item.parent_item_id ? `פריט אב #${item.parent_item_id}` : "לא נמצא פריט אב."}
                </div>
              )}
            </SectionCard>
          ) : (
            <SectionCard title="פריטים מחוברים">
              {accessories.length > 0 ? (
                <BorderedList>
                  {accessories.map((c) => (
                    <ConnectedRow key={c.item_id} c={c} relationLabel="אביזר" />
                  ))}
                </BorderedList>
              ) : (
                <div style={{ fontSize: 13, color: FAINT }}>אין פריטים מחוברים.</div>
              )}
            </SectionCard>
          )}

          <SectionCard
            title="קבצים מצורפים"
            subtitle="הקבצים מקובצים לפי העמדה שבה נשמרו. בחר עמדה לצפייה בקבצים שלה."
          >
            {taggedFiles.length === 0 ? (
              <div style={{ fontSize: 13, color: FAINT }}>אין קבצים מצורפים.</div>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {fileTabs.map((t) => {
                    const on = fileTab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setFileTab(t.key)}
                        aria-pressed={on}
                        className="shx-file-tab"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 7,
                          background: on ? BLUE : "#fff",
                          color: on ? "#fff" : INK,
                          border: `1px solid ${on ? BLUE : HAIRLINE}`,
                          borderRadius: 9999, padding: "6px 12px",
                          fontSize: 12.5, fontWeight: 600, font: "inherit",
                          fontFamily: "inherit", cursor: "pointer",
                        }}
                      >
                        {t.label}
                        <span style={{ fontSize: 11, fontWeight: 600, color: on ? "#fff" : MUTED, background: on ? "rgba(255,255,255,0.22)" : SOFT, borderRadius: 9999, padding: "1px 7px", fontVariantNumeric: "tabular-nums" }}>
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {visibleFiles.length === 0 ? (
                  <div style={{ fontSize: 13, color: FAINT }}>אין קבצים בעמדה זו.</div>
                ) : (
                  <BorderedList>
                    {visibleFiles.map((f) => {
                      // created_by stores the worker id; resolve it to a name and
                      // fall back to the raw value rather than inventing one.
                      const by = f.createdBy ? workerNameById.get(String(f.createdBy)) ?? f.createdBy : null;
                      const meta = [fmtDT(f.createdAt), by ?? EM_DASH];
                      const pt = f.photoType ? photoTypeLabel.get(f.photoType) : null;
                      if (pt) meta.push(pt);
                      return (
                        <a
                          key={f.objectKey}
                          href={downloadUrl(f.objectKey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shx-file-row"
                          style={{ ...rowBase, gap: 11, padding: "11px 14px", color: "inherit", textDecoration: "none" }}
                        >
                          <span style={{ display: "flex", color: MUTED, flexShrink: 0 }}>
                            <FileText size={18} strokeWidth={1.6} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.fileName}>
                              {f.fileName}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, minWidth: 0 }}>
                              {fileTab === "all" && (
                                <span style={{ fontSize: 10.5, fontWeight: 600, color: BLUE, background: "rgba(0,102,204,0.08)", borderRadius: 9999, padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
                                  {f.groupLabel}
                                </span>
                              )}
                              <span style={{ fontSize: 11.5, color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {meta.join(" · ")}
                              </span>
                            </div>
                          </div>
                          <div style={{ fontSize: 11.5, color: FAINT, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                            {formatFileSize(f.size)}
                          </div>
                        </a>
                      );
                    })}
                  </BorderedList>
                )}
              </>
            )}
          </SectionCard>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) { .ir-cols { grid-template-columns: 1fr !important; } }
        .shx-file-tab:active { transform: scale(0.96); }
        .shx-file-row:hover { background: #fafafc; }
        .shx-connected-row:hover { background: #fafafc; }
      `}</style>
    </div>
  );
}

/* ---------- pieces ---------- */

function BackLink() {
  return (
    <Link
      href="/"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: BLUE, textDecoration: "none", marginBottom: 16 }}
    >
      <ChevronRight size={16} strokeWidth={1.9} />
      חזרה לרשימת הפריטים
    </Link>
  );
}

function Timing({ label, value, color = INK }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: FAINT }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, fontVariantNumeric: "tabular-nums", color }}>
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
    <Link
      href={`/items/${c.item_id}/history`}
      className="shx-connected-row"
      style={{ ...rowBase, gap: 10, padding: "11px 14px", color: "inherit", textDecoration: "none" }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, background: "#f5f5f7", border: `1px solid ${HAIRLINE}`, borderRadius: 9999, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0 }}>
        {relationLabel}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>#{c.item_id}</div>
        <div style={{ fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {trim(c.item_type_desc) || EM_DASH}
        </div>
      </div>
      <div style={{ textAlign: "left", flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: FAINT, fontVariantNumeric: "tabular-nums" }}>{trim(c.serial_no) || EM_DASH}</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{status}</div>
      </div>
    </Link>
  );
}

/** Same download route ItemFilesPanel uses — one URL builder, one behaviour. */
function downloadUrl(objectKey: string): string {
  return (
    "/api/files/download/" +
    objectKey.split("/").map((s) => encodeURIComponent(s)).join("/")
  );
}
