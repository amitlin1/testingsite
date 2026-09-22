"use client";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Printer, Search } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import PackageIdText, { MiniItems, StatusPill } from "@/app/components/packages/PackageIdText";
import PackageIntakeDialog from "@/app/components/packages/PackageIntakeDialog";
import PackageDeleteDialog from "@/app/components/packages/PackageDeleteDialog";
import PackageEditDialog from "@/app/components/packages/PackageEditDialog";
import PackageLabelsDialog from "@/app/components/packages/PackageLabelsDialog";
import PackageRelabelDialog, { type RelabelPackage } from "@/app/components/packages/PackageRelabelDialog";
import {
  AMBER, AMBER_BG, AMBER_BORDER, AMBER_INK, BLUE, GREEN, HAIR, HAIR_2, INK, INK_2, ITEM_STATES, LEGEND, MUTED, MUTED_LT, PKG_STATUS, RED,
  fmtDate, fmtDateTime, pillGhost, pillPrimary, seq2,
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

const chipBg = (s: PackageView["items"][number]["state"]) => (s === "done" ? "#eaf5ef" : s === "missing" ? "rgba(191,53,53,.08)" : "#f5f5f7");
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
    try {
      const res = await apiFetch("/api/packages");
      const data = res.ok ? await res.json() : [];
      setAll(Array.isArray(data) ? data : []);
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
            <span style={{ fontSize: 13, color: MUTED, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "3px 11px", fontVariantNumeric: "tabular-nums" }}>{list.length} מארזים</span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 16, color: INK_2, lineHeight: 1.5 }}>כל המארזים שנקלטו במערכת, תכולתם ומצב הבדיקה של כל פריט.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {converted.length > 0 && (
            <button type="button" onClick={() => setRelabelOpen(true)} title="מארזים שהוסבו מהמערכת הישנה ועדיין נושאים מדבקה עם המזהה הישן" style={{ ...pillGhost, display: "inline-flex", alignItems: "center", gap: 7, padding: "12px 20px", fontSize: 14, whiteSpace: "nowrap" }}>
              <Printer size={17} strokeWidth={1.75} />מדבקות למארזים שהוסבו ({converted.length})
            </button>
          )}
          <button type="button" onClick={() => setIntakeOpen(true)} style={{ ...pillPrimary, display: "inline-flex", alignItems: "center", gap: 7, padding: "12px 22px", fontSize: 15, whiteSpace: "nowrap" }}>
            <Plus size={18} strokeWidth={2} />קליטת מארז
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="pkg-fixed pkg-stats">
        {stats.map((s) => (
          <div key={s.label} className="pkg-stat">
            <div className="pkg-stat-value" style={{ color: s.tone }}>{s.value}</div>
            <div className="pkg-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + filters + legend */}
      <div className="pkg-fixed" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 360 }}>
          <Search size={16} strokeWidth={1.75} color={MUTED} style={{ position: "absolute", insetInlineStart: 14, top: 13, pointerEvents: "none" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי מזהה, סריאלי, מק״ט או סוג מארז"
            style={{ width: "100%", height: 42, border: `1px solid ${HAIR}`, borderRadius: 10, paddingInlineStart: 40, paddingInlineEnd: 14, fontSize: 14, background: "#fff", outline: "none", fontFamily: "inherit" }} />
        </div>
        <FilterSelect value={customer} onChange={setCustomer} options={customers} allLabel="כל הלקוחות" />
        <FilterSelect value={shipment} onChange={setShipment} options={shipments} allLabel="כל המשלוחים" />
        <FilterSelect value={type} onChange={setType} options={types} allLabel="כל סוגי המארז" />
        <FilterSelect value={status} onChange={setStatus} options={(Object.keys(PKG_STATUS) as (keyof typeof PKG_STATUS)[]).map((k) => ({ value: k, label: PKG_STATUS[k].label }))} allLabel="כל הסטטוסים" />
        <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: MUTED, flexWrap: "wrap" }}>
          {LEGEND.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: l.color }} />{l.label}</div>
          ))}
        </div>
      </div>

      {/* Table + panel */}
      <div className="pkg-split">
        <div className="pkg-table-wrap" style={{ background: "#fff", border: `1px solid ${HAIR}` }}>
          <div className="pkg-table-scroll">
            <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse" }}>
              {/* The rule under the header is a box-shadow (in packages.css), not a
                  border: a collapsed border scrolls away from a sticky row. */}
              <thead>
                <tr>
                  <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "13px 16px" }}>מזהה המארז</th>
                  <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "13px 12px" }}>סוג מארז · לקוח</th>
                  <th style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "13px 12px" }}>פריטים</th>
                  <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "13px 12px" }}>סטטוס המארז</th>
                  <th style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "13px 16px", width: 190 }}>מצב הפריטים</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={5} style={{ padding: "28px 16px", color: MUTED, fontSize: 14 }}>טוען…</td></tr>}
                {!loading && list.map((p) => {
                  const st = PKG_STATUS[p.status];
                  const isSel = p.item_id === selectedId;
                  return (
                    <tr key={p.item_id} onClick={() => setSelectedId(p.item_id)} style={{ cursor: "pointer", borderTop: `1px solid ${HAIR_2}`, background: isSel ? "#f7fbff" : "#fff" }}>
                      <td style={{ padding: "11px 16px", whiteSpace: "nowrap" }}>
                        <PackageIdText id={p.item_id} />
                        <div style={{ fontSize: 11.5, color: MUTED_LT, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>נקלט {fmtDate(p.created_at)}</div>
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
            {!loading && list.length === 0 && (
              <div style={{ textAlign: "center", padding: "64px 24px" }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>אין מארזים תואמים.</div>
                <div style={{ fontSize: 14, color: MUTED }}>שנה את הסינון, או קלוט מארז חדש מהמשלוח.</div>
                <button type="button" onClick={() => setIntakeOpen(true)} style={{ ...pillPrimary, marginTop: 16, padding: "10px 20px" }}>קליטת מארז</button>
              </div>
            )}
          </div>
        </div>

        <div className="pkg-panel" style={{ background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 16 }}>
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
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>מסלול המארז</div>
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
                  <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>תכולת המארז</div>
                  <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{sel.finished_count}/{sel.items.length} סיימו</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {sel.items.map((it) => (
                    <div key={it.item_id} onClick={() => router.push(`/items/${it.item_id}/history`)} style={{ display: "flex", alignItems: "center", gap: 11, border: `1px solid ${HAIR}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer" }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: chipBg(it.state), color: chipTone(it.state), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{seq2(it.package_seq)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.item_type_desc}</div>
                        <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{itemLine(it)}</div>
                      </div>
                      <span title={it.state_label} style={{ width: 8, height: 8, borderRadius: "50%", background: ITEM_STATES[it.state].color, flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                  <button type="button" onClick={() => router.push(`/packages/${sel.item_id}`)} style={{ ...pillPrimary, flex: 1, minWidth: 130, padding: "9px 16px", fontSize: 13.5 }}>עמוד המארז</button>
                  <button type="button" onClick={() => setLabelsOpen(true)} style={{ ...pillGhost, padding: "9px 14px", fontSize: 13.5 }}>מדבקות</button>
                  <button type="button" onClick={() => setEditOpen(true)} style={{ ...pillGhost, padding: "9px 14px", fontSize: 13.5 }}>עריכה</button>
                  <button type="button" onClick={() => setDeleteOpen(true)} style={{ ...pillGhost, padding: "9px 14px", fontSize: 13.5, color: RED }}>מחיקה</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <PackageIntakeDialog open={intakeOpen} onClose={() => setIntakeOpen(false)} onCreated={(id) => { load(); setSelectedId(String(id)); }} initialShipmentId={shipment ? Number(shipment) : null} />
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
