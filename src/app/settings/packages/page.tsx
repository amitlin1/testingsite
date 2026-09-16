"use client";
import React from "react";
import Link from "next/link";
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, CircleCheck, CircleAlert, Minus,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Alert, ConfirmDialog, Snackbar } from "@/components/ui";

/**
 * הגדרות → מארזים — docs/packages/PLAN.md §3, design
 * claude-code-handoff/packages/design/Package Types Settings.dc.html.
 *
 * Top: every package type (an item type flagged is_package) with the size of
 * its template and whether the routes fit the package rules. Below: the
 * contents editor of the selected type. The screen sets DEFAULT ROUTE NUMBERS
 * only; the routes themselves live in /settings/testing-routes.
 */

type PackageTypeSummary = {
  item_type_id: number;
  item_type_desc: string;
  default_route_number: number | null;
  kinds: number;
  total_items: number;
  health: "ok" | "warn" | "none";
  warning: string | null;
  package_count: number;
};

type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };

type ServerLine = {
  id: number;
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  manufacturer_sku: string | null;
  route_number: number;
  sort_order: number;
  route_warning: string | null;
};

type Contents = {
  package_type_id: number;
  item_type_desc: string;
  default_route_number: number | null;
  total_items: number;
  package_route_warnings: string[];
  lines: ServerLine[];
};

/** One editable row. Strings, because every field is an <input>. */
type DraftLine = {
  key: number;
  item_type_id: number | "";
  quantity: string;
  makat: string;
  model: string;
  manufacturer_name: string;
  manufacturer_no: string;
  manufacturer_sku: string;
  route_number: string;
  route_warning: string | null;
};

const BLUE = "#0066cc";
const INK = "#1d1d1f";
const MUTED = "#7a7a7a";
const MUTED_LT = "#9a9aa0";
const HAIR = "#e0e0e0";
const AMBER_INK = "#a86a1a";
const AMBER_BG = "#fdf3e6";
const AMBER_BORDER = "#f0e2cc";
const GREEN = "#1f8a5b";

let keySeq = 1;
const toDraft = (l: ServerLine): DraftLine => ({
  key: keySeq++,
  item_type_id: l.item_type_id,
  quantity: String(l.quantity),
  makat: l.makat ?? "",
  model: l.model ?? "",
  manufacturer_name: l.manufacturer_name ?? "",
  manufacturer_no: l.manufacturer_no ?? "",
  manufacturer_sku: l.manufacturer_sku ?? "",
  route_number: l.route_number === 1 ? "" : String(l.route_number),
  route_warning: l.route_warning,
});

const digits = (s: string) => s.replace(/[^0-9]/g, "");

const th = (align: "right" | "center", extra?: React.CSSProperties): React.CSSProperties => ({
  textAlign: align, fontSize: 12, fontWeight: 600, color: MUTED, padding: "13px 14px", borderBottom: `1px solid ${HAIR}`, whiteSpace: "nowrap", ...extra,
});
const eth = (align: "right" | "center", extra?: React.CSSProperties): React.CSSProperties => ({
  textAlign: align, fontSize: 11.5, fontWeight: 600, color: MUTED, padding: "11px 12px", borderBottom: `1px solid ${HAIR}`, whiteSpace: "nowrap", ...extra,
});
const input: React.CSSProperties = {
  width: "100%", height: 38, border: `1px solid ${HAIR}`, borderRadius: 9, padding: "0 10px", fontSize: 13.5, outline: "none", background: "#fff", fontFamily: "inherit", color: INK,
};
const iconBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, background: "#f5f5f7", color: INK, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", border: 0, padding: 0,
};
const pill: React.CSSProperties = {
  background: BLUE, color: "#fff", border: 0, borderRadius: 9999, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const pillGhost: React.CSSProperties = {
  background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 9999, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", color: INK,
};

export default function PackagesSettingsPage() {
  const [types, setTypes] = React.useState<PackageTypeSummary[]>([]);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [contents, setContents] = React.useState<Contents | null>(null);
  const [draft, setDraft] = React.useState<DraftLine[]>([]);
  const [draftRoute, setDraftRoute] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newRoute, setNewRoute] = React.useState("");
  const [newBusy, setNewBusy] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<PackageTypeSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [toast, setToast] = React.useState<{ open: boolean; message: string; severity: "success" | "error" }>({ open: false, message: "", severity: "success" });
  const say = (message: string, severity: "success" | "error" = "success") => setToast({ open: true, message, severity });

  const loadTypes = React.useCallback(async (): Promise<PackageTypeSummary[]> => {
    const res = await apiFetch("/api/settings/package-types");
    const data = res.ok ? await res.json() : [];
    const list: PackageTypeSummary[] = Array.isArray(data) ? data : [];
    setTypes(list);
    return list;
  }, []);

  const loadContents = React.useCallback(async (typeId: number) => {
    const res = await apiFetch(`/api/settings/item-types/${typeId}/contents`);
    if (!res.ok) { setContents(null); setDraft([]); setDraftRoute(""); return; }
    const c: Contents = await res.json();
    setContents(c);
    setDraft(c.lines.map(toDraft));
    setDraftRoute(c.default_route_number == null ? "" : String(c.default_route_number));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, typesRes] = await Promise.all([loadTypes(), apiFetch("/api/settings/item-types")]);
        const all = typesRes.ok ? await typesRes.json() : [];
        if (cancelled) return;
        setItemTypes(Array.isArray(all) ? all : []);
        if (list.length > 0) setSelectedId(list[0].item_type_id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadTypes]);

  React.useEffect(() => {
    if (selectedId == null) { setContents(null); setDraft([]); return; }
    loadContents(selectedId);
  }, [selectedId, loadContents]);

  const selected = types.find((t) => t.item_type_id === selectedId) ?? null;
  const memberTypes = itemTypes.filter((t) => !t.is_package);
  const total = draft.reduce((n, r) => n + (Number(r.quantity) || 0), 0);
  const dirty = contents != null && (
    draftRoute !== (contents.default_route_number == null ? "" : String(contents.default_route_number)) ||
    JSON.stringify(draft.map(({ key: _k, route_warning: _w, ...rest }) => rest)) !==
      JSON.stringify(contents.lines.map(toDraft).map(({ key: _k, route_warning: _w, ...rest }) => rest))
  );
  const badIndex = draft.findIndex((r) => r.route_warning);
  const warningTitle = contents?.package_route_warnings[0] ?? (badIndex >= 0 ? draft[badIndex].route_warning : null);

  const patchRow = (i: number, patch: Partial<DraftLine>) =>
    setDraft((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveRow = (i: number, dir: -1 | 1) =>
    setDraft((rows) => {
      const to = i + dir;
      if (to < 0 || to >= rows.length) return rows;
      const next = rows.slice();
      const [row] = next.splice(i, 1);
      next.splice(to, 0, row);
      return next;
    });
  const addRow = () =>
    setDraft((rows) => rows.concat([{
      key: keySeq++, item_type_id: "", quantity: "1", makat: "", model: "", manufacturer_name: "", manufacturer_no: "", manufacturer_sku: "", route_number: "", route_warning: null,
    }]));
  const revert = () => {
    if (!contents) return;
    setDraft(contents.lines.map(toDraft));
    setDraftRoute(contents.default_route_number == null ? "" : String(contents.default_route_number));
  };

  const save = async () => {
    if (selectedId == null) return;
    for (let i = 0; i < draft.length; i++) {
      if (draft[i].item_type_id === "") { say(`שורה ${i + 1}: יש לבחור סוג פריט`, "error"); return; }
      if (!Number(draft[i].quantity)) { say(`שורה ${i + 1}: הכמות חייבת להיות 1 או יותר`, "error"); return; }
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/settings/item-types/${selectedId}/contents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_route_number: draftRoute === "" ? null : Number(draftRoute),
          lines: draft.map((r, i) => ({
            item_type_id: r.item_type_id,
            quantity: Number(r.quantity),
            makat: r.makat || null,
            model: r.model || null,
            manufacturer_name: r.manufacturer_name || null,
            manufacturer_no: r.manufacturer_no || null,
            manufacturer_sku: r.manufacturer_sku || null,
            route_number: r.route_number === "" ? 1 : Number(r.route_number),
            sort_order: i,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data?.error || "שמירת התכולה נכשלה", "error"); return; }
      setContents(data);
      setDraft((data.lines as ServerLine[]).map(toDraft));
      setDraftRoute(data.default_route_number == null ? "" : String(data.default_route_number));
      await loadTypes();
      say("התכולה נשמרה");
    } catch {
      say("שגיאה בתקשורת", "error");
    } finally {
      setSaving(false);
    }
  };

  const createType = async () => {
    if (!newName.trim()) { say("יש להזין שם לסוג המארז", "error"); return; }
    setNewBusy(true);
    try {
      const res = await apiFetch("/api/settings/item-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_type_desc: newName.trim(), is_package: true, default_route_number: newRoute === "" ? null : Number(newRoute) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data?.error || "יצירת סוג המארז נכשלה", "error"); return; }
      setNewOpen(false); setNewName(""); setNewRoute("");
      const list = await loadTypes();
      const all = await apiFetch("/api/settings/item-types").then((r) => (r.ok ? r.json() : []));
      setItemTypes(Array.isArray(all) ? all : []);
      setSelectedId(list.find((t) => t.item_type_id === data.item_type_id)?.item_type_id ?? data.item_type_id);
      say("סוג המארז נוצר");
    } catch {
      say("שגיאה בתקשורת", "error");
    } finally {
      setNewBusy(false);
    }
  };

  const deleteType = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/settings/item-types/${deleteTarget.item_type_id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        say(res.status === 409 ? "לא ניתן למחוק: קיימים מארזים או פריטים מסוג זה" : data?.error || "המחיקה נכשלה", "error");
        return;
      }
      const list = await loadTypes();
      if (selectedId === deleteTarget.item_type_id) setSelectedId(list[0]?.item_type_id ?? null);
      say("סוג המארז נמחק");
    } catch {
      say("שגיאה בתקשורת", "error");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const health = (t: PackageTypeSummary) => {
    const empty = t.health === "none";
    const bad = t.health === "warn";
    return {
      label: empty ? "אין תכולה" : bad ? "מסלול לא תקין" : "תקין",
      tone: empty ? MUTED : bad ? AMBER_INK : GREEN,
      bg: empty ? "#f5f5f7" : bad ? AMBER_BG : "rgba(31,138,91,0.07)",
      border: empty ? HAIR : bad ? AMBER_BORDER : "rgba(31,138,91,0.22)",
      icon: empty ? <Minus size={13} strokeWidth={1.75} /> : bad ? <CircleAlert size={13} strokeWidth={1.75} /> : <CircleCheck size={13} strokeWidth={1.75} />,
    };
  };

  return (
    <div dir="rtl" style={{ height: "100%", overflowY: "auto", color: INK }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 8px 64px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.5px", lineHeight: 1.1 }}>מארזים</h1>
            <p style={{ margin: "8px 0 0", fontSize: 15, color: MUTED, lineHeight: 1.5 }}>
              סוגי המארז והתכולה שנפרשת מהם בקליטה. מספר מסלול ברירת המחדל נקבע כאן; המסלולים עצמם מוגדרים במסך מסלולי הבדיקה.
            </p>
          </div>
          <button type="button" onClick={() => setNewOpen(true)} style={{ ...pill, display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 20px", fontSize: 15, whiteSpace: "nowrap" }}>
            <Plus size={18} strokeWidth={2} />סוג מארז חדש
          </button>
        </div>

        {/* Package types */}
        <div style={{ marginTop: 22, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f5f5f7" }}>
                  <th style={th("right", { padding: "13px 18px" })}>סוג מארז</th>
                  <th style={th("center")}>סוגי פריטים בתכולה</th>
                  <th style={th("center")}>סה״כ פריטים</th>
                  <th style={th("center")}>מסלול ברירת מחדל</th>
                  <th style={th("right")}>תקינות התכולה</th>
                  <th style={th("center", { padding: "13px 18px", width: 120 })}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} style={{ padding: "28px 18px", color: MUTED, fontSize: 14 }}>טוען…</td></tr>
                )}
                {!loading && types.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: "40px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>עדיין אין סוגי מארז.</div>
                    <div style={{ fontSize: 13.5, color: MUTED, marginTop: 4 }}>צור סוג מארז ראשון כדי להגדיר לו תכולה.</div>
                  </td></tr>
                )}
                {types.map((t) => {
                  const h = health(t);
                  const isSel = t.item_type_id === selectedId;
                  return (
                    <tr key={t.item_type_id} onClick={() => setSelectedId(t.item_type_id)} style={{ borderTop: "1px solid #f0f0f0", cursor: "pointer", background: isSel ? "#f7fbff" : "#fff" }}>
                      <td style={{ padding: "13px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ fontSize: 15, fontWeight: 600 }}>{t.item_type_desc}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 600, color: BLUE, background: "#e6efff", borderRadius: 9999, padding: "2px 8px" }}>מארז</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>מזהה סוג {t.item_type_id}</div>
                      </td>
                      <td style={{ padding: "13px 14px", textAlign: "center", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{t.kinds}</td>
                      <td style={{ padding: "13px 14px", textAlign: "center", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{t.total_items}</td>
                      <td style={{ padding: "13px 14px", textAlign: "center", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.default_route_number ?? 1}</td>
                      <td style={{ padding: "13px 14px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: h.tone, background: h.bg, border: `1px solid ${h.border}`, borderRadius: 9999, padding: "4px 11px", whiteSpace: "nowrap" }}>
                          {h.icon}{h.label}
                        </span>
                      </td>
                      <td style={{ padding: "13px 18px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <button type="button" title="עריכת תכולה" style={iconBtn} onClick={(e) => { e.stopPropagation(); setSelectedId(t.item_type_id); }}>
                            <Pencil size={15} strokeWidth={1.75} />
                          </button>
                          <button type="button" title="מחיקה" style={iconBtn} onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}>
                            <Trash2 size={15} strokeWidth={1.75} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Contents editor */}
        {selected && contents && (
          <div style={{ marginTop: 26, background: "#fff", border: `1px solid ${HAIR}`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, padding: "18px 20px", borderBottom: `1px solid ${HAIR}`, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: ".6px", textTransform: "uppercase" }}>תכולת מארז</div>
                <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.3px", marginTop: 5 }}>{contents.item_type_desc || selected.item_type_desc}</div>
                <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{draft.length} סוגי פריטים · {total} פריטים בקופסה · השורות האלה נפרשות אוטומטית בטופס הקליטה</div>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>מסלול ברירת מחדל למארז</div>
                  <input value={draftRoute} onChange={(e) => setDraftRoute(digits(e.target.value))} placeholder="1" inputMode="numeric"
                    style={{ width: 110, height: 40, border: `1px solid ${HAIR}`, borderRadius: 10, padding: "0 12px", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "center", background: "#fff", outline: "none", fontFamily: "inherit" }} />
                </div>
                <div style={{ fontSize: 12, color: MUTED_LT, maxWidth: 210, lineHeight: 1.45, paddingBottom: 10 }}>ריק פירושו מסלול 1. המסלול עצמו נקבע במסך מסלולי הבדיקה.</div>
              </div>
            </div>

            {warningTitle && (
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start", background: AMBER_BG, borderBottom: `1px solid ${AMBER_BORDER}`, padding: "12px 20px" }}>
                <span style={{ color: AMBER_INK, marginTop: 1, display: "inline-flex" }}><CircleAlert size={17} strokeWidth={2} /></span>
                <div style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600, color: AMBER_INK }}>{warningTitle}</span> · <Link href="/settings/testing-routes" style={{ color: BLUE }}>פתח את מסלולי הבדיקה</Link>
                </div>
              </div>
            )}

            {draft.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 1020, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f5f5f7" }}>
                      <th style={eth("center", { width: 64 })}>סדר</th>
                      <th style={eth("right")}>סוג פריט</th>
                      <th style={eth("center", { width: 84 })}>כמות</th>
                      <th style={eth("right")}>מק״ט</th>
                      <th style={eth("right")}>דגם</th>
                      <th style={eth("right")}>יצרן</th>
                      <th style={eth("right")}>מספר יצרן</th>
                      <th style={eth("right")}>מק״ט יצרן <span style={{ fontWeight: 400, color: MUTED_LT }}>(פריט ייחוס)</span></th>
                      <th style={eth("center", { width: 120 })}>מסלול ברירת מחדל</th>
                      <th style={{ padding: "11px 16px", borderBottom: `1px solid ${HAIR}`, width: 56 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((r, i) => (
                      <tr key={r.key} style={{ borderTop: "1px solid #f0f0f0", background: r.route_warning ? "#fffdf9" : "#fff" }}>
                        <td style={{ padding: "9px 12px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                            <button type="button" title="העלה" onClick={() => moveRow(i, -1)} style={{ ...iconBtn, width: 24, height: 24, borderRadius: 7, background: "transparent", color: i === 0 ? "#d4d4dc" : MUTED }}>
                              <ChevronUp size={14} strokeWidth={2} />
                            </button>
                            <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums", minWidth: 12, textAlign: "center" }}>{i + 1}</span>
                            <button type="button" title="הורד" onClick={() => moveRow(i, 1)} style={{ ...iconBtn, width: 24, height: 24, borderRadius: 7, background: "transparent", color: i === draft.length - 1 ? "#d4d4dc" : MUTED }}>
                              <ChevronDown size={14} strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <select value={r.item_type_id} onChange={(e) => patchRow(i, { item_type_id: e.target.value === "" ? "" : Number(e.target.value), route_warning: null })}
                            style={{ ...input, minWidth: 150, cursor: "pointer", fontSize: 14 }}>
                            <option value="">בחר סוג פריט…</option>
                            {memberTypes.map((t) => (
                              <option key={t.item_type_id} value={t.item_type_id}>{t.item_type_desc}</option>
                            ))}
                          </select>
                          {r.route_warning && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11.5, color: AMBER_INK }}>
                              <CircleAlert size={13} strokeWidth={2} />המסלול לא עומד בכללי המארז
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "9px 12px" }}>
                          <input value={r.quantity} onChange={(e) => patchRow(i, { quantity: digits(e.target.value) })} inputMode="numeric" style={{ ...input, minWidth: 56, textAlign: "center", fontVariantNumeric: "tabular-nums", fontSize: 14 }} />
                        </td>
                        <td style={{ padding: "9px 12px" }}><input value={r.makat} onChange={(e) => patchRow(i, { makat: e.target.value })} style={{ ...input, fontVariantNumeric: "tabular-nums" }} /></td>
                        <td style={{ padding: "9px 12px" }}><input value={r.model} onChange={(e) => patchRow(i, { model: e.target.value })} style={input} /></td>
                        <td style={{ padding: "9px 12px" }}><input value={r.manufacturer_name} onChange={(e) => patchRow(i, { manufacturer_name: e.target.value })} style={input} /></td>
                        <td style={{ padding: "9px 12px" }}><input value={r.manufacturer_no} onChange={(e) => patchRow(i, { manufacturer_no: e.target.value })} style={{ ...input, fontVariantNumeric: "tabular-nums" }} /></td>
                        <td style={{ padding: "9px 12px" }}><input value={r.manufacturer_sku} onChange={(e) => patchRow(i, { manufacturer_sku: e.target.value })} placeholder="אופציונלי" style={{ ...input, fontVariantNumeric: "tabular-nums" }} /></td>
                        <td style={{ padding: "9px 12px" }}>
                          <input value={r.route_number} onChange={(e) => patchRow(i, { route_number: digits(e.target.value), route_warning: null })} placeholder="1" inputMode="numeric"
                            style={{ ...input, minWidth: 76, fontSize: 14, fontWeight: 600, textAlign: "center", fontVariantNumeric: "tabular-nums", borderColor: r.route_number === "" ? HAIR : "#0071e3", color: r.route_number === "" ? MUTED_LT : BLUE }} />
                          <div style={{ fontSize: 11, color: MUTED_LT, marginTop: 5, textAlign: "center" }}>{r.route_number === "" ? "ברירת מחדל 1" : `מסלול ${r.route_number}`}</div>
                        </td>
                        <td style={{ padding: "9px 16px", textAlign: "center" }}>
                          <button type="button" title="מחיקת שורה" onClick={() => setDraft((rows) => rows.filter((_, j) => j !== i))} style={{ ...iconBtn, color: MUTED }}>
                            <Trash2 size={15} strokeWidth={1.75} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {draft.length === 0 && (
              <div style={{ textAlign: "center", padding: "48px 24px" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>לסוג המארז הזה אין תכולה מוגדרת.</div>
                <div style={{ fontSize: 13.5, color: MUTED, marginTop: 4 }}>בלי תכולה, טופס הקליטה יפתח מארז ריק והעובד יזין כל פריט ידנית.</div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 20px", borderTop: "1px solid #f0f0f0", flexWrap: "wrap" }}>
              <button type="button" onClick={addRow} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 600, color: BLUE, background: "transparent", border: 0, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                <Plus size={16} strokeWidth={2} />הוסף סוג פריט לתכולה
              </button>
              <div style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{draft.length} שורות · {total} פריטים במארז</div>
              <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" onClick={revert} disabled={!dirty || saving} style={{ ...pillGhost, opacity: dirty ? 1 : 0.6 }}>בטל שינויים</button>
                <button type="button" onClick={save} disabled={saving} style={{ ...pill, opacity: saving ? 0.7 : 1 }}>{saving ? "שומר…" : "שמור תכולה"}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New package type */}
      {newOpen && (
        <div onClick={() => !newBusy && setNewOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} dir="rtl" style={{ width: "min(520px, 94vw)", background: "#fff", borderRadius: 18, boxShadow: "rgba(0,0,0,0.22) 3px 5px 30px 0", overflow: "hidden" }}>
            <div style={{ padding: "22px 24px 0" }}>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>סוג מארז חדש</div>
              <div style={{ fontSize: 13.5, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>נוצר סוג פריט חדש המסומן כמארז. אחרי היצירה אפשר להגדיר לו תכולה.</div>
            </div>
            <div style={{ padding: "18px 24px 0", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>שם סוג המארז</div>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="לדוגמה: מארז מחשב HP"
                  style={{ ...input, height: 44, borderRadius: 10, padding: "0 13px", fontSize: 14.5 }} />
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <div style={{ width: 130 }}>
                  <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>מסלול ברירת מחדל</div>
                  <input value={newRoute} onChange={(e) => setNewRoute(digits(e.target.value))} placeholder="1" inputMode="numeric"
                    style={{ ...input, height: 44, borderRadius: 10, padding: "0 13px", fontSize: 14.5, textAlign: "center", fontVariantNumeric: "tabular-nums" }} />
                </div>
                <div style={{ flex: 1, fontSize: 12, color: MUTED_LT, lineHeight: 1.45, alignSelf: "flex-end", paddingBottom: 12 }}>אם לא תוזן מספר, המארז ישויך למסלול 1.</div>
              </div>
            </div>
            <div style={{ padding: "20px 24px 22px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setNewOpen(false)} disabled={newBusy} style={pillGhost}>ביטול</button>
              <button type="button" onClick={createType} disabled={newBusy} style={{ ...pill, opacity: newBusy ? 0.7 : 1 }}>צור סוג מארז</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        title="מחיקת סוג מארז"
        message={deleteTarget ? `למחוק את סוג המארז "${deleteTarget.item_type_desc}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק"
        cancelText="ביטול"
        destructive
        busy={deleting}
        onConfirm={deleteType}
        onCancel={() => setDeleteTarget(null)}
      />

      <Snackbar open={toast.open} autoHideDuration={5000} onClose={() => setToast({ ...toast, open: false })} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Alert onClose={() => setToast({ ...toast, open: false })} severity={toast.severity}>{toast.message}</Alert>
      </Snackbar>
    </div>
  );
}
