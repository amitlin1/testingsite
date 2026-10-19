"use client";
import React from "react";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Printer, Search } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import { Alert, Skeleton } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageIdText, { MiniItems, StatusPill } from "@/app/components/packages/PackageIdText";
import PackageIntakeDialog from "@/app/components/packages/PackageIntakeDialog";
import PackageDeleteDialog from "@/app/components/packages/PackageDeleteDialog";
import PackageEditDialog from "@/app/components/packages/PackageEditDialog";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import PackageRelabelDialog, { type RelabelPackage } from "@/app/components/packages/PackageRelabelDialog";
import {
  AMBER, AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, HAIR, HAIR_2, INK, INK_2, ITEM_STATES, LEGEND, MUTED, PKG_STATUS, RED,
  fmtDate, fmtDateTime, seq2,
} from "@/app/components/packages/packageUi";
import "./packages.css";

/**
 * ניהול מארזים — design/Packages.dc.html (list + side panel). Five columns,
 * a 340px panel with the selected box's contents, and the intake / labels /
 * edit / delete dialogs.
 *
 * Fixed-height screen: the page fills AppShell's content box (which already
 * sits beside the rail and under the top bar) and never scrolls itself — not
 * at any width. Header, stats and filters keep their height; the split below
 * absorbs the rest, and only the table body and the side panel scroll. Below
 * 1100px the panel drops under the table and the split becomes the scroller,
 * so the header and filters still stay put. The layout classes live in
 * packages.css (anything a media query must override cannot be inline).
 */

type Option = { value: string; label: string };

const chipBg = (s: PackageView["items"][number]["state"]) => (s === "done" ? "var(--color-success-bg)" : s === "missing" ? "var(--color-danger-bg)" : "var(--color-canvas-parchment)");
const chipTone = (s: PackageView["items"][number]["state"]) => (s === "done" ? GREEN : s === "missing" ? RED : MUTED);
const itemLine = (it: PackageView["items"][number]) => (it.serial_no ? `${it.serial_no} · ${it.makat ?? "—"}` : `${it.makat ?? "—"} · ללא סריאלי`);
const blockedNote = (p: PackageView) =>
  `${p.blocked_by.length} פריטים עדיין לא הגיעו לעמדת הסגירה · ${p.blocked_by.map((b) => b.station_name ?? "—").join(" · ")}`;

/** A list filter: empty = everything (the placeholder says so); × goes back to it. */
function FilterSelect({ value, onChange, options, allLabel }: { value: string; onChange: (v: string) => void; options: Option[]; allLabel: string }) {
  return (
    <SearchableCombobox<Option>
      dense
      width={190}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o ? o.value : "")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      placeholder={allLabel}
    />
  );
}

/** useSearchParams needs a Suspense boundary (deep links: ?shipment= / ?status= / ?q=). */
export default function PackagesPage() {
  return (
    <React.Suspense fallback={null}>
      <PackagesPageInner />
    </React.Suspense>
  );
}

function PackagesPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [all, setAll] = React.useState<PackageView[]>([]);
  const [loading, setLoading] = React.useState(true);
  // A failed load is not "no packages": it gets an error with a retry.
  const [loadError, setLoadError] = React.useState(false);
  const [q, setQ] = React.useState(sp.get("q") ?? "");
  const [customer, setCustomer] = React.useState("");
  const [shipment, setShipment] = React.useState(sp.get("shipment") ?? "");
  const [type, setType] = React.useState("");
  const [status, setStatus] = React.useState(sp.get("status") ?? "");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // ?new=1 (command palette "מארז חדש", items page) opens the intake directly.
  const [intakeOpen, setIntakeOpen] = React.useState(sp.get("new") === "1");
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [customers, setCustomers] = React.useState<Option[]>([]);
  const [shipments, setShipments] = React.useState<(Option & { source_id?: number | null })[]>([]);
  // Boxes the production upgrade converted from legacy items and that still
  // wear their old label (legacy_id_map.relabeled_at IS NULL). Empty where
  // the upgrade never ran, so the button below simply never shows.
  const [converted, setConverted] = React.useState<{ pkg: PackageView; legacyIds: string[] }[]>([]);
  const [relabelOpen, setRelabelOpen] = React.useState(false);
  const loadConverted = React.useCallback(() => {
    apiFetch("/api/packages/converted").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      const byPkg = new Map<string, string[]>();
      for (const l of (d.legacy ?? []) as { legacy_id: string; package_id: string | null }[]) {
        if (l.package_id) byPkg.set(l.package_id, [...(byPkg.get(l.package_id) ?? []), l.legacy_id]);
      }
      setConverted(((d.packages ?? []) as PackageView[]).map((pkg) => ({ pkg, legacyIds: byPkg.get(pkg.item_id) ?? [] })));
    }).catch(() => {});
  }, []);
  React.useEffect(() => { loadConverted(); }, [loadConverted]);
  const relabelPackages = React.useMemo<RelabelPackage[]>(
    () => converted.map((c) => ({ ...c, sourceId: shipments.find((s) => s.value === String(c.pkg.shipment_id))?.source_id ?? null })),
    [converted, shipments],
  );
  const markRelabeled = (packageIds: string[]) => {
    if (packageIds.length === 0) return;
    apiFetch("/api/packages/converted", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageIds }) }).catch(() => {}).finally(loadConverted);
  };
  const [types, setTypes] = React.useState<Option[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch("/api/packages");
      if (!res.ok) setLoadError(true);
      const data = res.ok ? await res.json() : [];
      setAll(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    apiFetch("/api/customers").then((r) => (r.ok ? r.json() : [])).then((d: any[]) => setCustomers((Array.isArray(d) ? d : []).map((c) => ({ value: String(c.id), label: c.customer_code ? `${c.name} (${c.customer_code})` : c.name })))).catch(() => {});
    apiFetch("/api/shipments").then((r) => (r.ok ? r.json() : [])).then((d: any[]) => setShipments((Array.isArray(d) ? d : []).map((s) => ({ value: String(s.id), label: s.shipment_code, source_id: s.source_id ?? null })))).catch(() => {});
    apiFetch("/api/settings/package-types").then((r) => (r.ok ? r.json() : [])).then((d: any[]) => setTypes((Array.isArray(d) ? d : []).map((t) => ({ value: String(t.item_type_id), label: t.item_type_desc })))).catch(() => {});
  }, []);

  const today = fmtDate(new Date().toISOString());
  // Before the first answer (or after a failed one) the counts are unknown:
  // they read "—", never a made-up 0.
  const known = all.length > 0 || (!loading && !loadError);
  const firstLoad = loading && all.length === 0;
  const stats = [
    { value: all.filter((p) => p.status === "test").length, label: "מארזים בבדיקה", tone: BLUE },
    { value: all.filter((p) => p.status === "queue").length, label: "ממתינים לפתיחה", tone: AMBER },
    { value: all.filter((p) => p.status === "waitItems").length, label: "ממתינים לפריטי המארז", tone: AMBER },
    { value: all.filter((p) => p.status === "done" && fmtDate(p.closed_at) === today).length, label: "נסגרו היום", tone: GREEN },
  ];

  const ql = q.trim().toLowerCase();
  const list = all.filter((p) =>
    (customer === "" || String(p.customer_id) === customer) &&
    (shipment === "" || String(p.shipment_id) === shipment) &&
    (type === "" || String(p.item_type_id) === type) &&
    (status === "" || p.status === status) &&
    (ql === "" || p.item_id.includes(ql) || p.item_type_desc.toLowerCase().includes(ql) || (p.makat ?? "").toLowerCase().includes(ql) ||
      (p.shipment_code ?? "").toLowerCase().includes(ql) || (p.customer_name ?? "").toLowerCase().includes(ql) ||
      p.items.some((it) => it.item_id.includes(ql) || (it.serial_no ?? "").toLowerCase().includes(ql) || (it.makat ?? "").toLowerCase().includes(ql))),
  );
  const sel = list.find((p) => p.item_id === selectedId) ?? null;
  const selSource = sel ? shipments.find((s) => s.value === String(sel.shipment_id))?.source_id ?? null : null;

  return (
    <div dir="rtl" className="pkg-page" style={{ color: INK }}>
      {/* Header */}
      <div className="pkg-fixed" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1 }}>ניהול מארזים</h1>
            {known && <span style={{ fontSize: 13, color: MUTED, background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "3px 11px", fontVariantNumeric: "tabular-nums" }}>{list.length} מארזים</span>}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 16, color: INK_2, lineHeight: 1.5 }}>כל המארזים שנקלטו במערכת, תכולתם ומצב הבדיקה של כל פריט.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {converted.length > 0 && (
            <button type="button" onClick={() => setRelabelOpen(true)} title="מארזים שהוסבו מהמערכת הישנה ועדיין נושאים מדבקה עם המזהה הישן" className="pkg-pill pkg-pill--ghost" style={{ padding: "12px 20px" }}>
              <Printer size={17} strokeWidth={1.75} aria-hidden />מדבקות למארזים שהוסבו ({converted.length})
            </button>
          )}
          <button type="button" onClick={() => setIntakeOpen(true)} className="pkg-pill pkg-pill--primary pkg-pill--lg">
            <Plus size={18} strokeWidth={2} aria-hidden />קליטת מארז
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="pkg-fixed pkg-stats">
        {stats.map((s) => (
          <div key={s.label} className="pkg-stat">
            <div className="pkg-stat-value" style={{ color: known ? s.tone : MUTED }}>{known ? s.value : "—"}</div>
            <div className="pkg-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + filters + legend */}
      <div className="pkg-fixed" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 360 }}>
          {/* 44px and the field radius, like the dense comboboxes beside it. */}
          <Search size={16} strokeWidth={1.75} color={MUTED} aria-hidden style={{ position: "absolute", insetInlineStart: 14, top: 14, pointerEvents: "none" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי מזהה, סריאלי, מק״ט או סוג מארז" aria-label="חיפוש מארזים"
            className="pkg-field pkg-field--search" />
        </div>
        <FilterSelect value={customer} onChange={setCustomer} options={customers} allLabel="כל הלקוחות" />
        <FilterSelect value={shipment} onChange={setShipment} options={shipments} allLabel="כל המשלוחים" />
        <FilterSelect value={type} onChange={setType} options={types} allLabel="כל סוגי המארז" />
        <FilterSelect value={status} onChange={setStatus} options={(Object.keys(PKG_STATUS) as (keyof typeof PKG_STATUS)[]).map((k) => ({ value: k, label: PKG_STATUS[k].label }))} allLabel="כל הסטטוסים" />
        <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: MUTED, flexWrap: "wrap" }}>
          {LEGEND.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}><span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, background: l.color }} />{l.label}</div>
          ))}
        </div>
      </div>

      {/* Table + panel */}
      <div className="pkg-split">
        <div className="pkg-table-wrap" style={{ background: "var(--color-canvas)", border: `1px solid ${HAIR}` }}>
          <div className="pkg-table-scroll">
            <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
              {/* The rule under the header is a box-shadow (in packages.css), not a
                  border: a collapsed border scrolls away from a sticky row. */}
              <thead>
                <tr>
                  <th className="pkg-th" style={{ padding: "13px 16px" }}>מזהה המארז</th>
                  <th className="pkg-th" style={{ padding: "13px 12px" }}>סוג מארז · לקוח</th>
                  <th className="pkg-th pkg-th--center" style={{ padding: "13px 12px" }}>פריטים</th>
                  <th className="pkg-th" style={{ padding: "13px 12px" }}>סטטוס המארז</th>
                  <th className="pkg-th" style={{ padding: "13px 16px", width: 190 }}>מצב הפריטים</th>
                </tr>
              </thead>
              <tbody>
                {/* First load: rows in the table's own shape, not a "טוען…" line. */}
                {firstLoad && Array.from({ length: 6 }, (_, i) => (
                  <tr key={`sk-${i}`} aria-hidden style={{ borderTop: `1px solid ${HAIR_2}` }}>
                    <td style={{ padding: "13px 16px" }}><Skeleton width={150} height={13} /><Skeleton width={80} height={11} style={{ marginTop: 6 }} /></td>
                    <td style={{ padding: "13px 12px" }}><Skeleton width={130} height={13} /><Skeleton width={110} height={11} style={{ marginTop: 6 }} /></td>
                    <td style={{ padding: "13px 12px" }}><Skeleton width={20} height={13} style={{ margin: "0 auto" }} /></td>
                    <td style={{ padding: "13px 12px" }}><Skeleton width={96} height={24} style={{ borderRadius: 9999 }} /></td>
                    <td style={{ padding: "13px 16px" }}><Skeleton width={110} height={9} /><Skeleton width={60} height={11} style={{ marginTop: 8 }} /></td>
                  </tr>
                ))}
                {!firstLoad && list.map((p) => {
                  const st = PKG_STATUS[p.status];
                  const isSel = p.item_id === selectedId;
                  return (
                    // A row is a keyboard stop too: Tab to it, Enter / Space selects it.
                    <tr key={p.item_id} className="pkg-row" tabIndex={0} aria-selected={isSel}
                      onClick={() => setSelectedId(p.item_id)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelectedId(p.item_id); } }}
                      style={{ borderTop: `1px solid ${HAIR_2}` }}>
                      <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                        <PackageIdText id={p.item_id} />
                        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>נקלט {fmtDate(p.created_at)}</div>
                      </td>
                      <td style={{ padding: "11px 12px", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{p.item_type_desc}</div>
                        <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{p.customer_name ?? p.customer_code ?? "—"} · {p.shipment_code ?? "—"}</div>
                      </td>
                      <td style={{ padding: "11px 12px", fontSize: 14, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{p.items.length}</td>
                      <td style={{ padding: "11px 12px" }}>
                        <StatusPill label={st.label} dot={st.dot} />
                        {p.status === "waitItems" && p.blocked_by.length > 0 && (
                          <div style={{ fontSize: 11.5, color: AMBER_INK, marginTop: 4, maxWidth: 200, lineHeight: 1.45 }}>{blockedNote(p)}</div>
                        )}
                      </td>
                      <td style={{ padding: "11px 16px" }}>
                        <MiniItems items={p.items.map((it) => ({ color: ITEM_STATES[it.state].color, title: `${seq2(it.package_seq)} · ${it.item_type_desc} · ${it.state_label}` }))} />
                        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{p.finished_count}/{p.items.length} סיימו</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {loadError && !loading && (
              <div style={{ padding: 16 }}>
                <Alert severity="error" action={<button type="button" onClick={load} className="pkg-pill pkg-pill--ghost pkg-pill--sm">נסה שוב</button>}>
                  טעינת המארזים נכשלה. בדוק את החיבור ונסה שוב.
                </Alert>
              </div>
            )}
            {!loading && !loadError && list.length === 0 && (
              <div style={{ textAlign: "center", padding: "64px 24px" }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>אין מארזים תואמים.</div>
                <div style={{ fontSize: 14, color: MUTED }}>שנה את הסינון, או קלוט מארז חדש מהמשלוח.</div>
                <button type="button" onClick={() => setIntakeOpen(true)} className="pkg-pill pkg-pill--primary" style={{ marginTop: 16, padding: "10px 20px" }}>קליטת מארז</button>
              </div>
            )}
          </div>
        </div>

        <div className="pkg-panel" style={{ background: "var(--color-canvas)", border: `1px solid ${HAIR}`, borderRadius: 16 }}>
          {!sel ? (
            <div style={{ padding: "40px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>בחר מארז</div>
              <div style={{ fontSize: 13.5, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>תכולת המארז, מצב כל פריט והפעולות יופיעו כאן.</div>
            </div>
          ) : (
            <>
              <div style={{ padding: "18px 20px", borderBottom: `1px solid ${HAIR}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>{sel.item_type_desc}</div>
                    <div style={{ marginTop: 3 }}><PackageIdText id={sel.item_id} size={17} headColor={INK} letterSpacing=".4px" /></div>
                    <div style={{ fontSize: 12.5, color: MUTED, marginTop: 5 }}>{sel.customer_name ?? sel.customer_code ?? "—"} · משלוח {sel.shipment_code ?? "—"} · נקלט {fmtDate(sel.created_at)}</div>
                  </div>
                  <StatusPill label={PKG_STATUS[sel.status].label} dot={PKG_STATUS[sel.status].dot} />
                </div>
                {sel.status === "waitItems" && sel.blocked_by.length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12.5, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 8, padding: "8px 11px", lineHeight: 1.5 }}>{blockedNote(sel)}</div>
                )}
              </div>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${HAIR}` }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>מסלול המארז</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  {[
                    { label: "נפתח", note: sel.opened_at ? fmtDateTime(sel.opened_at) : "ממתין בעמדת הפתיחה", bar: sel.opened_at ? GREEN : HAIR_2, tone: sel.opened_at ? INK : MUTED },
                    { label: "נסגר", note: sel.closed_at ? fmtDateTime(sel.closed_at) : sel.status === "waitItems" ? "ממתין לפריטי המארז" : "טרם נסגר", bar: sel.closed_at ? GREEN : sel.status === "waitItems" ? AMBER : HAIR_2, tone: sel.closed_at ? INK : MUTED },
                  ].map((ms) => (
                    <div key={ms.label} style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ height: 4, borderRadius: 9999, background: ms.bar }} />
                      <div style={{ fontSize: 12, fontWeight: 600, color: ms.tone, marginTop: 7 }}>{ms.label}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{ms.note}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>תכולת המארז</div>
                  <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{sel.finished_count}/{sel.items.length} סיימו</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {sel.items.map((it) => (
                    // A real link: keyboard, middle-click and "open in a new tab" work.
                    <NextLink key={it.item_id} href={`/items/${it.item_id}/history`} className="pkg-row" style={{ display: "flex", alignItems: "center", gap: 11, border: `1px solid ${HAIR}`, borderRadius: 12, padding: "10px 12px" }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: chipBg(it.state), color: chipTone(it.state), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{seq2(it.package_seq)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.item_type_desc}</div>
                        <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{itemLine(it)}</div>
                      </div>
                      <span title={it.state_label} role="img" aria-label={it.state_label} style={{ width: 8, height: 8, borderRadius: "50%", background: ITEM_STATES[it.state].color, flexShrink: 0 }} />
                    </NextLink>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={() => router.push(`/packages/${sel.item_id}`)} className="pkg-pill pkg-pill--primary pkg-pill--sm" style={{ flex: 1, minWidth: 130, paddingInline: 16 }}>עמוד המארז</button>
                  <button type="button" onClick={() => setLabelsOpen(true)} className="pkg-pill pkg-pill--ghost pkg-pill--sm">מדבקות</button>
                  <button type="button" onClick={() => setEditOpen(true)} className="pkg-pill pkg-pill--ghost pkg-pill--sm">עריכה</button>
                  <button type="button" onClick={() => setDeleteOpen(true)} className="pkg-pill pkg-pill--ghost pkg-pill--sm pkg-pill--danger-text">מחיקה</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <PackageIntakeDialog open={intakeOpen} onClose={() => setIntakeOpen(false)} onCreated={(id) => { load(); setSelectedId(String(id)); }} onDeleted={(id) => { load(); setSelectedId((s) => (s === String(id) ? null : s)); }} initialShipmentId={shipment ? Number(shipment) : null} />
      <PackageEditDialog open={editOpen} pkg={sel} onClose={() => setEditOpen(false)} onChanged={load} onDeleteRequest={() => { setEditOpen(false); setDeleteOpen(true); }} />
      <PackageDeleteDialog open={deleteOpen} pkg={sel} onClose={() => setDeleteOpen(false)} onDeleted={() => { setDeleteOpen(false); setSelectedId(null); load(); }} />
      {relabelOpen && (
        <PackageRelabelDialog open onClose={() => setRelabelOpen(false)} packages={relabelPackages} onPrinted={(ids) => { setRelabelOpen(false); markRelabeled(ids); }} />
      )}
      {sel && labelsOpen && (
        <PackageLabelsDialog
          open
          onClose={() => setLabelsOpen(false)}
          packageId={sel.item_id}
          packageType={sel.item_type_desc}
          customerLine={`${sel.customer_name ?? sel.customer_code ?? ""} · משלוח ${sel.shipment_code ?? ""}`}
          sourceId={selSource}
          items={sel.items.map((it) => ({ item_id: it.item_id, package_seq: it.package_seq, item_type_desc: it.item_type_desc, serial_no: it.serial_no }))}
        />
      )}
    </div>
  );
}
