"use client";
import React from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { PackageView, PackageTimelineEntry } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { Alert, Skeleton } from "@/components/ui";
import PackageIdText, { MiniItems, StatusPill } from "@/app/components/packages/PackageIdText";
import PackageDeleteDialog from "@/app/components/packages/PackageDeleteDialog";
import PackageEditDialog from "@/app/components/packages/PackageEditDialog";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import ItemFilesPanel from "@/app/components/ItemFilesPanel";
import {
  AMBER, AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, GREY, HAIR, HAIR_2, INK, INK_2, ITEM_STATES, MUTED, PKG_STATUS,
  fmtDate, fmtDateTime, seq2,
} from "@/app/components/packages/packageUi";
import "../packages.css";

/** עמוד מארז — design/Packages.dc.html (isPage). */
type Timeline = (PackageTimelineEntry & { worker_name: string | null })[];

const card: React.CSSProperties = { background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 16 };

export default function PackagePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [pkg, setPkg] = React.useState<PackageView | null>(null);
  const [timeline, setTimeline] = React.useState<Timeline>([]);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  // Any failure but a 404 is an error with a retry — not "the package doesn't exist".
  const [loadError, setLoadError] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [sourceId, setSourceId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    if (!params?.id) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch(`/api/packages/${params.id}`);
      if (res.status === 404) { setNotFound(true); setPkg(null); return; }
      if (!res.ok) { setLoadError(true); return; }
      const data = await res.json();
      setPkg(data.package ?? null);
      setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
      if (data.package?.shipment_id) {
        apiFetch("/api/shipments").then((r) => (r.ok ? r.json() : [])).then((d: any[]) => {
          const s = (Array.isArray(d) ? d : []).find((x) => x.id === data.package.shipment_id);
          setSourceId(s?.source_id ?? null);
        }).catch(() => {});
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [params?.id]);

  React.useEffect(() => { load(); }, [load]);

  const back = (
    <button type="button" onClick={() => router.push("/packages")} className="pkg-link" style={{ fontSize: 13.5 }}>
      <ChevronRight size={15} strokeWidth={2} aria-hidden />חזרה למארזים
    </button>
  );
  const retry = <button type="button" onClick={load} className="pkg-pill pkg-pill--ghost pkg-pill--sm">נסה שוב</button>;

  // First load: the page's own shape (header card, items table, timeline).
  if (loading && !pkg && !notFound) {
    return (
      <div dir="rtl" aria-busy="true" style={{ height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "28px 24px 64px" }}>
          {back}
          <div style={{ ...card, padding: 24, marginTop: 14 }}>
            <Skeleton width={110} height={13} />
            <Skeleton width={320} height={30} style={{ marginTop: 10 }} />
            <Skeleton width={260} height={13} style={{ marginTop: 12 }} />
            <Skeleton height={5} style={{ marginTop: 30, borderRadius: 9999 }} />
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 16, flexWrap: "wrap" }}>
            <div style={{ ...card, flex: 1, minWidth: 0, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <Skeleton width={120} height={16} />
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={14} />)}
            </div>
            <div style={{ ...card, width: 380, flexShrink: 0, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <Skeleton width={140} height={16} />
              {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={13} />)}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (notFound || !pkg) {
    return (
      <div dir="rtl" style={{ height: "100%", overflowY: "auto", padding: 32, boxSizing: "border-box" }}>
        {loadError && !notFound ? (
          <Alert severity="error" action={retry} style={{ maxWidth: 560 }}>טעינת המארז נכשלה. בדוק את החיבור ונסה שוב.</Alert>
        ) : (
          <div style={{ fontSize: 16, fontWeight: 600 }}>המארז לא נמצא.</div>
        )}
        <button type="button" onClick={() => router.push("/packages")} className="pkg-pill pkg-pill--ghost" style={{ marginTop: 14 }}>חזרה למארזים</button>
      </div>
    );
  }

  const st = PKG_STATUS[pkg.status];
  const blocked = pkg.status === "waitItems" && pkg.blocked_by.length > 0;
  const milestones = [
    { label: "נפתח", note: pkg.opened_at ? fmtDateTime(pkg.opened_at) : "ממתין בעמדת הפתיחה", bar: pkg.opened_at ? GREEN : HAIR_2, tone: pkg.opened_at ? INK : MUTED },
    { label: "נסגר", note: pkg.closed_at ? fmtDateTime(pkg.closed_at) : blocked ? "ממתין לפריטי המארז" : "טרם נסגר", bar: pkg.closed_at ? GREEN : blocked ? AMBER : HAIR_2, tone: pkg.closed_at ? INK : MUTED },
  ];
  const progress = (it: PackageView["items"][number]) => {
    const steps = it.route_length || 0;
    const step = it.state === "done" ? steps : it.state === "new" ? 0 : Math.min(steps, it.current_route_step ?? 0);
    return { pct: steps > 0 ? Math.round((step / steps) * 100) : 0, text: `${step}/${steps}` };
  };
  const dotOf = (t: Timeline[number]) => (t.state === "done" ? GREEN : t.state === "pending" || t.state === "queued" || t.state === "blocked" ? (t.state === "blocked" || t.state === "queued" ? AMBER : BLUE) : GREY);
  const openItem = (id: string) => router.push(`/items/${id}/history`);

  // The page scrolls its own wrapper, inside the fixed frame (same principle
  // as /packages), never the shell's content box.
  return (
    <div dir="rtl" style={{ height: "100%", overflowY: "auto", overscrollBehavior: "contain", color: INK }}>
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "28px 24px 64px" }}>
      {back}

      {loadError && (
        <Alert severity="error" action={retry} style={{ marginTop: 14 }}>רענון המארז נכשל — מוצגים הנתונים האחרונים שנטענו.</Alert>
      )}

      <div style={{ ...card, padding: 24, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: MUTED, fontWeight: 600 }}>{pkg.item_type_desc}</div>
            {/* The id is the page's heading (the artboard's h1). */}
            <h1 style={{ margin: "6px 0 0", fontSize: "inherit", fontWeight: "inherit" }}><PackageIdText id={pkg.item_id} size={30} headColor={INK} weight={700} letterSpacing="-0.4px" /></h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap", fontSize: 13.5, color: INK_2 }}>
              <span>{pkg.customer_name ?? pkg.customer_code ?? "—"}</span><span aria-hidden style={{ color: MUTED }}>·</span>
              <span>משלוח {pkg.shipment_code ?? "—"}</span><span aria-hidden style={{ color: MUTED }}>·</span>
              <span>נקלט {fmtDate(pkg.created_at)}</span><span aria-hidden style={{ color: MUTED }}>·</span>
              <span>{pkg.items.length} פריטים</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusPill label={st.label} dot={st.dot} size={13} />
            <button type="button" onClick={() => setLabelsOpen(true)} className="pkg-pill pkg-pill--ghost pkg-pill--sm" style={{ paddingInline: 16 }}>מדבקות</button>
            <button type="button" onClick={() => setEditOpen(true)} className="pkg-pill pkg-pill--primary pkg-pill--sm" style={{ paddingInline: 18 }}>עריכת מארז</button>
          </div>
        </div>

        {blocked && (
          <div style={{ marginTop: 18, fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "11px 14px", lineHeight: 1.5 }}>
            {pkg.blocked_by.length} פריטים עדיין לא הגיעו לעמדת הסגירה · {pkg.blocked_by.map((b) => `${seq2(b.package_seq)} ${b.item_type_desc} · ${b.station_name ?? "—"}`).join(" · ")}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 22, paddingTop: 20, borderTop: `1px solid ${HAIR_2}`, flexWrap: "wrap" }}>
          {milestones.map((ms) => (
            <div key={ms.label} style={{ flex: 1, minWidth: 160 }}>
              <div style={{ height: 5, borderRadius: 9999, background: ms.bar }} />
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 9 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: ms.tone }}>{ms.label}</div>
                <div style={{ fontSize: 12.5, color: MUTED }}>{ms.note}</div>
              </div>
            </div>
          ))}
          <div style={{ width: 1, height: 38, background: HAIR }} />
          <div style={{ flexShrink: 0 }}>
            <MiniItems width={26} height={10} items={pkg.items.map((it) => ({ color: ITEM_STATES[it.state].color, title: `${seq2(it.package_seq)} · ${it.item_type_desc} · ${it.state_label}` }))} />
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{pkg.finished_count}/{pkg.items.length} סיימו</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 16, flexWrap: "wrap" }}>
        <div style={{ ...card, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 20px", borderBottom: `1px solid ${HAIR}` }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>פריטים במארז</h2>
            <div style={{ fontSize: 12.5, color: MUTED }}>כל פריט מתקדם במסלול של הסוג שלו</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: "var(--color-canvas-parchment)" }}>
                  <th className="pkg-th" style={{ paddingInline: 20 }}>מזהה</th>
                  <th className="pkg-th">סוג פריט</th>
                  <th className="pkg-th">סריאלי</th>
                  <th className="pkg-th">מק״ט</th>
                  <th className="pkg-th">סטטוס</th>
                  <th className="pkg-th" style={{ width: 150 }}>התקדמות במסלול</th>
                  <th className="pkg-th" style={{ paddingInline: 20 }}>עמדה נוכחית</th>
                </tr>
              </thead>
              <tbody>
                {pkg.items.map((it) => {
                  const pr = progress(it);
                  const color = ITEM_STATES[it.state].color;
                  return (
                    // Opens the item's history; a keyboard stop like a link (Enter / Space).
                    <tr key={it.item_id} className="pkg-row" tabIndex={0} aria-label={`${seq2(it.package_seq)} · ${it.item_type_desc} — היסטוריית הפריט`}
                      onClick={() => openItem(it.item_id)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem(it.item_id); } }}
                      style={{ borderTop: `1px solid ${HAIR_2}` }}>
                      <td style={{ padding: "12px 20px", whiteSpace: "nowrap" }}><PackageIdText id={it.item_id} size={13} /></td>
                      <td style={{ padding: 12, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{it.item_type_desc}</td>
                      <td style={{ padding: 12, fontSize: 14, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{it.serial_no ?? "—"}</td>
                      <td style={{ padding: 12, fontSize: 14, color: INK_2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{it.makat ?? "—"}</td>
                      <td style={{ padding: 12, whiteSpace: "nowrap" }}><StatusPill label={it.state_label} dot={color} /></td>
                      <td style={{ padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{ flex: 1, height: 5, borderRadius: 9999, background: HAIR_2, overflow: "hidden", minWidth: 70 }}><div style={{ height: "100%", width: `${pr.pct}%`, background: color, borderRadius: 9999 }} /></div>
                          <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{pr.text}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 20px", fontSize: 13.5, color: INK_2, whiteSpace: "nowrap" }}>{it.station_name ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...card, padding: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>ציר זמן של המארז</h2>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>עמדות ברמת מארז בלבד</div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
              {timeline.map((t, i) => (
                <div key={t.key} style={{ display: "flex", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: dotOf(t), marginTop: 4 }} />
                    <span style={{ width: 1, flex: 1, background: i === timeline.length - 1 ? "transparent" : HAIR, minHeight: 26 }} />
                  </div>
                  <div style={{ paddingBottom: 16, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: t.state === "pending" && !t.at ? MUTED : INK }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                      {t.at ? `${fmtDateTime(t.at)}${t.worker_name ? ` · ${t.worker_name}` : ""}` : t.note ?? ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...card, padding: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>קבצים</h2>
            <ItemFilesPanel itemId={pkg.item_id} compact />
          </div>
        </div>
      </div>

      <PackageEditDialog open={editOpen} pkg={pkg} onClose={() => setEditOpen(false)} onChanged={load} onDeleteRequest={() => { setEditOpen(false); setDeleteOpen(true); }} />
      <PackageDeleteDialog open={deleteOpen} pkg={pkg} onClose={() => setDeleteOpen(false)} onDeleted={() => router.push("/packages")} />
      {labelsOpen && (
        <PackageLabelsDialog
          open
          onClose={() => setLabelsOpen(false)}
          packageId={pkg.item_id}
          packageType={pkg.item_type_desc}
          customerLine={`${pkg.customer_name ?? pkg.customer_code ?? ""} · משלוח ${pkg.shipment_code ?? ""}`}
          sourceId={sourceId}
          items={pkg.items.map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, serial_no: it.serial_no }))}
        />
      )}
    </div>
    </div>
  );
}
