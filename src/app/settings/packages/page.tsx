"use client";
import React from "react";
import Link from "next/link";
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, CircleCheck, CircleAlert, Minus,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import {
  Alert, Button, ConfirmDialog, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Skeleton, Snackbar, Tag, TextField, type TagTone,
} from "@/components/ui";
import DataTable, { type Column } from "@/components/DataTable";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import SettingsToolbar from "../components/SettingsToolbar";

/**
 * הגדרות → מארזים — docs/packages/PLAN.md §3, design
 * claude-code-handoff/packages/design/Package Types Settings.dc.html.
 *
 * Top: every package type (an item type flagged is_package) with the size of
 * its template and whether the routes fit the package rules. Below: the
 * contents editor of the selected type. The screen sets DEFAULT ROUTE NUMBERS
 * only; the routes themselves live in /settings/testing-routes.
 *
 * The artboard's hover / press / focus states live in settings.css (`.stp-*`):
 * inline styles cannot express them.
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
  route_number: string;
  route_warning: string | null;
};

/** Which fields of a row failed the save check (shown on the field). */
type RowError = { type?: boolean; qty?: boolean };

const MUTED = "var(--color-ink-muted-48)";
const AMBER_INK = "var(--color-warning-ink)";

let keySeq = 1;
const toDraft = (l: ServerLine): DraftLine => ({
  key: keySeq++,
  item_type_id: l.item_type_id,
  quantity: String(l.quantity),
  makat: l.makat ?? "",
  model: l.model ?? "",
  manufacturer_name: l.manufacturer_name ?? "",
  manufacturer_no: l.manufacturer_no ?? "",
  route_number: l.route_number === 1 ? "" : String(l.route_number),
  route_warning: l.route_warning,
});

const digits = (s: string) => s.replace(/[^0-9]/g, "");

const td: React.CSSProperties = { padding: "9px 12px" };

export default function PackagesSettingsPage() {
  const [types, setTypes] = React.useState<PackageTypeSummary[]>([]);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [contents, setContents] = React.useState<Contents | null>(null);
  const [draft, setDraft] = React.useState<DraftLine[]>([]);
  const [draftRoute, setDraftRoute] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  // A failed load is not "no package types" / "no contents": each gets its
  // own error band with a retry.
  const [typesFailed, setTypesFailed] = React.useState(false);
  const [contentsFailed, setContentsFailed] = React.useState(false);
  const [rowErrors, setRowErrors] = React.useState<Record<number, RowError>>({});
  const [saving, setSaving] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newNameError, setNewNameError] = React.useState("");
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
    setTypesFailed(!res.ok);
    setTypes(list);
    return list;
  }, []);

  // The type whose contents the editor is meant to show. A response for any
  // other type (the user switched while it was in flight) is dropped, so a
  // late reply can never land under the wrong selection and be saved to it.
  const requestedTypeRef = React.useRef<number | null>(null);

  const loadContents = React.useCallback(async (typeId: number) => {
    requestedTypeRef.current = typeId;
    let res: Response;
    try {
      res = await apiFetch(`/api/settings/item-types/${typeId}/contents`);
    } catch {
      if (requestedTypeRef.current === typeId) setContentsFailed(true);
      return;
    }
    if (requestedTypeRef.current !== typeId) return;
    if (!res.ok) { setContents(null); setDraft([]); setDraftRoute(""); setContentsFailed(true); return; }
    const c: Contents = await res.json();
    if (requestedTypeRef.current !== typeId) return;
    setContents(c);
    setDraft(c.lines.map(toDraft));
    setDraftRoute(c.default_route_number == null ? "" : String(c.default_route_number));
  }, []);

  const loadAll = React.useCallback(async () => {
    try {
      const [list, typesRes] = await Promise.all([loadTypes(), apiFetch("/api/settings/item-types")]);
      const all = typesRes.ok ? await typesRes.json() : [];
      if (!typesRes.ok) setTypesFailed(true);
      setItemTypes(Array.isArray(all) ? all : []);
      // ?type={id} (the testing-routes screen's "פתח במסך המארזים") opens that package type.
      const wanted = Number(new URLSearchParams(window.location.search).get("type"));
      const first = list.find((t) => t.item_type_id === wanted) ?? list[0];
      if (first) setSelectedId((cur) => cur ?? first.item_type_id);
    } catch {
      setTypesFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadTypes]);

  React.useEffect(() => { void loadAll(); }, [loadAll]);
  const retryAll = () => { setLoading(true); setTypesFailed(false); void loadAll(); };

  React.useEffect(() => {
    // Drop the previous type's contents straight away: the editor (and its
    // Save) only renders with `contents`, so nothing of the old type can be
    // edited or PUT to the newly selected one while its own contents load.
    setContents(null);
    setDraft([]);
    setContentsFailed(false);
    setRowErrors({});
    if (selectedId == null) { requestedTypeRef.current = null; return; }
    loadContents(selectedId);
  }, [selectedId, loadContents]);
  const retryContents = () => { if (selectedId == null) return; setContentsFailed(false); void loadContents(selectedId); };

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
  const clearRowError = (key: number, field: keyof RowError) =>
    setRowErrors((errs) => (errs[key]?.[field] ? { ...errs, [key]: { ...errs[key], [field]: false } } : errs));
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
      key: keySeq++, item_type_id: "", quantity: "1", makat: "", model: "", manufacturer_name: "", manufacturer_no: "", route_number: "", route_warning: null,
    }]));
  const revert = () => {
    if (!contents) return;
    setDraft(contents.lines.map(toDraft));
    setDraftRoute(contents.default_route_number == null ? "" : String(contents.default_route_number));
    setRowErrors({});
  };

  const save = async () => {
    if (selectedId == null) return;
    // Mark every row that fails on its own field; the toast names the first.
    const errs: Record<number, RowError> = {};
    let firstMsg: string | null = null;
    for (let i = 0; i < draft.length; i++) {
      const e: RowError = { type: draft[i].item_type_id === "", qty: !Number(draft[i].quantity) };
      if (e.type || e.qty) {
        errs[draft[i].key] = e;
        firstMsg ??= e.type ? `שורה ${i + 1}: יש לבחור סוג פריט` : `שורה ${i + 1}: הכמות חייבת להיות 1 או יותר`;
      }
    }
    setRowErrors(errs);
    if (firstMsg) { say(firstMsg, "error"); return; }
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
            route_number: r.route_number === "" ? 1 : Number(r.route_number),
            sort_order: i,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data?.error || "שמירת התכולה נכשלה. נסה שוב.", "error"); return; }
      setContents(data);
      setDraft((data.lines as ServerLine[]).map(toDraft));
      setDraftRoute(data.default_route_number == null ? "" : String(data.default_route_number));
      await loadTypes();
      say("התכולה נשמרה");
    } catch {
      say("שמירת התכולה נכשלה: אין חיבור לשרת. בדוק את הרשת ונסה שוב.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openNew = () => { setNewNameError(""); setNewOpen(true); };

  const createType = async () => {
    if (!newName.trim()) { setNewNameError("יש להזין שם לסוג המארז"); return; }
    setNewBusy(true);
    try {
      const res = await apiFetch("/api/settings/item-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_type_desc: newName.trim(), is_package: true, default_route_number: newRoute === "" ? null : Number(newRoute) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { say(data?.error || "יצירת סוג המארז נכשלה. נסה שוב.", "error"); return; }
      setNewOpen(false); setNewName(""); setNewRoute("");
      const list = await loadTypes();
      // A failed re-read keeps the list we have: it is not "no item types" (the new type is a
      // package type, which the contents editor does not list anyway).
      const all = await apiFetch("/api/settings/item-types").then((r) => (r.ok ? r.json() : null));
      if (Array.isArray(all)) setItemTypes(all);
      setSelectedId(list.find((t) => t.item_type_id === data.item_type_id)?.item_type_id ?? data.item_type_id);
      say("סוג המארז נוצר");
    } catch {
      say("יצירת סוג המארז נכשלה: אין חיבור לשרת. בדוק את הרשת ונסה שוב.", "error");
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
        say(res.status === 409 ? "לא ניתן למחוק: קיימים מארזים או פריטים מסוג זה" : data?.error || "המחיקה נכשלה. נסה שוב.", "error");
        return;
      }
      const list = await loadTypes();
      if (selectedId === deleteTarget.item_type_id) setSelectedId(list[0]?.item_type_id ?? null);
      say("סוג המארז נמחק");
    } catch {
      say("המחיקה נכשלה: אין חיבור לשרת. בדוק את הרשת ונסה שוב.", "error");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const health = (t: PackageTypeSummary): { label: string; tone: TagTone; icon: React.ReactNode } => {
    const empty = t.health === "none";
    const bad = t.health === "warn";
    return {
      label: empty ? "אין תכולה" : bad ? "מסלול לא תקין" : "תקין",
      tone: empty ? "neutral" : bad ? "warning" : "success",
      icon: empty ? <Minus size={13} strokeWidth={1.75} aria-hidden /> : bad ? <CircleAlert size={13} strokeWidth={1.75} aria-hidden /> : <CircleCheck size={13} strokeWidth={1.75} aria-hidden />,
    };
  };

  const typeColumns: Column<PackageTypeSummary>[] = [
    {
      key: "name", header: "סוג מארז",
      cell: (t) => (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: "var(--text-body)", fontWeight: 600 }}>{t.item_type_desc}</span>
            <Tag tone="primary">מארז</Tag>
          </div>
          <div style={{ fontSize: "var(--text-fine)", color: MUTED, marginTop: 3 }}>מזהה סוג {t.item_type_id}</div>
        </>
      ),
    },
    { key: "kinds", header: "סוגי פריטים בתכולה", align: "center", nums: true, cell: (t) => t.kinds },
    { key: "total", header: "סה״כ פריטים", align: "center", nums: true, cell: (t) => t.total_items },
    { key: "route", header: "מסלול ברירת מחדל", align: "center", nums: true, bold: true, cell: (t) => t.default_route_number ?? 1 },
    {
      key: "health", header: "תקינות התכולה",
      cell: (t) => { const h = health(t); return <Tag tone={h.tone} size="md" icon={h.icon}>{h.label}</Tag>; },
    },
    {
      key: "actions", header: "פעולות", align: "center", width: 120,
      cell: (t) => (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <IconButton size="small" className="stp-act" title={`עריכת התכולה של ${t.item_type_desc}`} onClick={(e) => { e.stopPropagation(); setSelectedId(t.item_type_id); }}>
            <Pencil size={15} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton size="small" className="stp-act stp-act--danger" title={`מחיקת ${t.item_type_desc}`} onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); }}>
            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </div>
      ),
    },
  ];

  // The settings layout owns the frame (scroll, padding, 1180 column).
  return (
    <div dir="rtl" style={{ color: "var(--color-ink)" }}>
      <SettingsToolbar
        title="מארזים"
        subtitle="סוגי המארז והתכולה שנפרשת מהם בקליטה. מספר מסלול ברירת המחדל נקבע כאן; המסלולים עצמם מוגדרים במסך מסלולי הבדיקה."
        onAdd={openNew}
        addLabel="סוג מארז חדש"
      />

      {/* Package types — a row selects its contents below (Enter / Space too). */}
      <div style={{ marginTop: 22 }}>
        {typesFailed ? (
          <div className="settings-card settings-error">
            <Alert severity="error">טעינת סוגי המארז נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
            <Button variant="outlined" color="inherit" size="small" onClick={retryAll}>נסה שוב</Button>
          </div>
        ) : (
          <DataTable<PackageTypeSummary>
            columns={typeColumns}
            rows={types}
            getRowKey={(t) => t.item_type_id}
            onRowClick={(t) => setSelectedId(t.item_type_id)}
            rowSelected={(t) => t.item_type_id === selectedId}
            loading={loading}
            loadingRows={3}
            minWidth={760}
            empty={
              <div className="settings-empty settings-empty--bare">
                <div className="settings-empty__title">עדיין אין סוגי מארז.</div>
                <div>צור סוג מארז ראשון כדי להגדיר לו תכולה.</div>
                <Button size="small" onClick={openNew} startIcon={<Plus size={16} strokeWidth={2} aria-hidden />}>סוג מארז חדש</Button>
              </div>
            }
          />
        )}
      </div>

      {/* Contents editor: loading → skeleton, failure → error band. */}
      {selected && !contents && contentsFailed && (
        <div className="settings-card settings-error" style={{ marginTop: 26 }}>
          <Alert severity="error">טעינת התכולה של {selected.item_type_desc} נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={retryContents}>נסה שוב</Button>
        </div>
      )}
      {selected && !contents && !contentsFailed && (
        <div className="settings-card" style={{ marginTop: 26, padding: "18px 20px" }} aria-busy="true" aria-label="טוען תכולת מארז">
          <Skeleton width={110} height={12} />
          <Skeleton width={220} height={22} style={{ marginTop: 8 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={38} />)}
          </div>
        </div>
      )}

      {selected && contents && (
        <div className="settings-card" style={{ marginTop: 26 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, padding: "18px 20px", borderBottom: "1px solid var(--color-hairline)", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-micro)", fontWeight: 600, color: MUTED }}>תכולת מארז</div>
              <h2 style={{ margin: "5px 0 0", fontSize: "var(--text-title)", fontWeight: 700, letterSpacing: "var(--ls-display)" }}>{contents.item_type_desc || selected.item_type_desc}</h2>
              <div style={{ fontSize: "var(--text-small)", color: MUTED, marginTop: 4 }}>{draft.length} סוגי פריטים · {total} פריטים בקופסה · השורות האלה נפרשות אוטומטית בטופס הקליטה</div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
              <div>
                <label htmlFor="pkg-default-route" className="sh-field-label">מסלול ברירת מחדל למארז</label>
                <input id="pkg-default-route" className="stp-input stp-input--lg stp-input--num stp-input--route" value={draftRoute}
                  onChange={(e) => setDraftRoute(digits(e.target.value))} placeholder="1" inputMode="numeric" aria-describedby="pkg-default-route-help" />
              </div>
              <div id="pkg-default-route-help" style={{ fontSize: "var(--text-fine)", color: MUTED, maxWidth: 210, lineHeight: 1.45, paddingBottom: 10 }}>ריק פירושו מסלול 1. המסלול עצמו נקבע במסך מסלולי הבדיקה.</div>
            </div>
          </div>

          {warningTitle && (
            <div role="alert" style={{ display: "flex", gap: 11, alignItems: "flex-start", background: "var(--color-warning-bg)", borderBottom: "1px solid var(--color-warning-border)", padding: "12px 20px" }}>
              <span style={{ color: AMBER_INK, marginTop: 1, display: "inline-flex" }}><CircleAlert size={17} strokeWidth={2} aria-hidden /></span>
              <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-70)", lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: AMBER_INK }}>{warningTitle}</span> · <Link href="/settings/testing-routes" className="sh-link" style={{ color: "var(--color-primary)" }}>פתח את מסלולי הבדיקה</Link>
              </div>
            </div>
          )}

          {draft.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="sh-table sh-table--sm" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 64, textAlign: "center" }}>סדר</th>
                    <th>סוג פריט</th>
                    <th style={{ width: 84, textAlign: "center" }}>כמות</th>
                    <th>מק״ט</th>
                    <th>דגם</th>
                    <th>יצרן</th>
                    <th>מספר יצרן</th>
                    <th style={{ width: 120, textAlign: "center" }}>מסלול ברירת מחדל</th>
                    <th style={{ width: 56 }} aria-label="פעולות" />
                  </tr>
                </thead>
                <tbody>
                  {draft.map((r, i) => {
                    const err = rowErrors[r.key] ?? {};
                    const row = `שורה ${i + 1}`;
                    return (
                      <tr key={r.key} style={{ background: r.route_warning ? "color-mix(in srgb, var(--color-warning-bg) 45%, var(--color-canvas))" : undefined }}>
                        <td style={td}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                            <IconButton size="small" className="stp-chev" title={`העלה את ${row}`} disabled={i === 0} onClick={() => moveRow(i, -1)}>
                              <ChevronUp size={14} strokeWidth={2} aria-hidden />
                            </IconButton>
                            <span style={{ fontSize: "var(--text-fine)", color: MUTED, fontVariantNumeric: "tabular-nums", minWidth: 12, textAlign: "center" }}>{i + 1}</span>
                            <IconButton size="small" className="stp-chev" title={`הורד את ${row}`} disabled={i === draft.length - 1} onClick={() => moveRow(i, 1)}>
                              <ChevronDown size={14} strokeWidth={2} aria-hidden />
                            </IconButton>
                          </div>
                        </td>
                        {/* No overflow on this cell: the list is portaled and must open over the rows below. */}
                        <td style={{ ...td, minWidth: 186 }}>
                          <SearchableCombobox<ItemTypeOption>
                            dense
                            denseHeight={38}
                            options={memberTypes}
                            value={memberTypes.find((t) => t.item_type_id === r.item_type_id) ?? null}
                            onChange={(t) => { patchRow(i, { item_type_id: t ? t.item_type_id : "", route_warning: null }); clearRowError(r.key, "type"); }}
                            getOptionLabel={(t) => t.item_type_desc}
                            isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                            placeholder="בחר סוג פריט…"
                            error={!!err.type}
                            helperText={err.type ? "יש לבחור סוג פריט" : undefined}
                          />
                          {r.route_warning && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: "var(--text-fine)", color: AMBER_INK }}>
                              <CircleAlert size={13} strokeWidth={2} aria-hidden />המסלול לא עומד בכללי המארז
                            </div>
                          )}
                        </td>
                        <td style={td}>
                          <input aria-label={`כמות, ${row}`} aria-invalid={err.qty || undefined}
                            className={"stp-input stp-input--num" + (err.qty ? " stp-input--error" : "")}
                            value={r.quantity} onChange={(e) => { patchRow(i, { quantity: digits(e.target.value) }); clearRowError(r.key, "qty"); }}
                            inputMode="numeric" style={{ minWidth: 56 }} />
                        </td>
                        <td style={td}><input aria-label={`מק״ט, ${row}`} dir="ltr" className="stp-input stp-input--code" style={{ textAlign: "right" }} value={r.makat} onChange={(e) => patchRow(i, { makat: e.target.value })} /></td>
                        <td style={td}><input aria-label={`דגם, ${row}`} className="stp-input" value={r.model} onChange={(e) => patchRow(i, { model: e.target.value })} /></td>
                        <td style={td}><input aria-label={`יצרן, ${row}`} className="stp-input" value={r.manufacturer_name} onChange={(e) => patchRow(i, { manufacturer_name: e.target.value })} /></td>
                        <td style={td}><input aria-label={`מספר יצרן, ${row}`} dir="ltr" className="stp-input stp-input--code" style={{ textAlign: "right" }} value={r.manufacturer_no} onChange={(e) => patchRow(i, { manufacturer_no: e.target.value })} /></td>
                        <td style={td}>
                          <input aria-label={`מסלול ברירת מחדל, ${row}`} value={r.route_number} onChange={(e) => patchRow(i, { route_number: digits(e.target.value), route_warning: null })} placeholder="1" inputMode="numeric"
                            className={"stp-input stp-input--num stp-input--route" + (r.route_number === "" ? "" : " stp-input--route-set")} style={{ minWidth: 76 }} />
                          <div style={{ fontSize: "var(--text-micro)", color: MUTED, marginTop: 5, textAlign: "center" }}>{r.route_number === "" ? "ברירת מחדל 1" : `מסלול ${r.route_number}`}</div>
                        </td>
                        <td style={{ ...td, paddingInline: 16, textAlign: "center" }}>
                          <IconButton size="small" className="stp-act stp-act--muted stp-act--danger" title={`מחיקת ${row}`} onClick={() => setDraft((rows) => rows.filter((_, j) => j !== i))}>
                            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {draft.length === 0 && (
            <div className="settings-empty" style={{ padding: "48px var(--space-lg)" }}>
              <div className="settings-empty__title">לסוג המארז הזה אין תכולה מוגדרת.</div>
              <div>בלי תכולה, טופס הקליטה יפתח מארז ריק והעובד יזין כל פריט ידנית.</div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 20px", borderTop: "1px solid var(--color-divider-soft)", flexWrap: "wrap" }}>
            <Button variant="text" size="small" onClick={addRow} startIcon={<Plus size={16} strokeWidth={2} aria-hidden />}>
              הוסף סוג פריט לתכולה
            </Button>
            <div style={{ fontSize: "var(--text-fine)", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{draft.length} שורות · {total} פריטים במארז</div>
            <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <Button variant="outlined" color="inherit" className="stp-pill" onClick={revert} disabled={!dirty || saving}>בטל שינויים</Button>
              <Button className="stp-pill" onClick={save} loading={saving}>שמור תכולה</Button>
            </div>
          </div>
        </div>
      )}

      {/* New package type — the shared Dialog (focus trap, Escape, drag by the
          title) wearing the package artboard's sheet. */}
      <Dialog
        open={newOpen}
        onClose={() => { if (!newBusy) setNewOpen(false); }}
        maxWidth={false}
        fullWidth
        PaperProps={{ className: "stp-dialog", style: { maxWidth: 520 } }}
      >
        <DialogTitle>סוג מארז חדש</DialogTitle>
        <DialogContent>
          <p style={{ margin: "0 0 18px", fontSize: "var(--text-body-sm)", color: MUTED, lineHeight: 1.5 }}>
            נוצר סוג פריט חדש המסומן כמארז. אחרי היצירה אפשר להגדיר לו תכולה.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <TextField
              autoFocus
              fullWidth
              required
              label="שם סוג המארז"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); if (newNameError) setNewNameError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") void createType(); }}
              placeholder="לדוגמה: מארז מחשב HP"
              error={!!newNameError}
              helperText={newNameError}
            />
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{ width: 130, flexShrink: 0 }}>
                <TextField
                  fullWidth
                  label="מסלול ברירת מחדל"
                  value={newRoute}
                  onChange={(e) => setNewRoute(digits(e.target.value))}
                  placeholder="1"
                  inputMode="numeric"
                  inputProps={{ style: { textAlign: "center", fontVariantNumeric: "tabular-nums" } }}
                />
              </div>
              <div style={{ flex: 1, fontSize: "var(--text-fine)", color: MUTED, lineHeight: 1.45, alignSelf: "flex-end", paddingBottom: 10 }}>אם לא תוזן מספר, המארז ישויך למסלול 1.</div>
            </div>
          </div>
        </DialogContent>
        {/* Cancel first, the action last (DialogActions puts it at the end). */}
        <DialogActions>
          <Button variant="outlined" color="inherit" className="stp-pill" onClick={() => setNewOpen(false)} disabled={newBusy}>ביטול</Button>
          <Button className="stp-pill" onClick={createType} loading={newBusy}>צור סוג מארז</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        draggable={false}
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
