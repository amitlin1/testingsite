"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import type { Data } from "@measured/puck";
import { FileText, Pencil, Undo2 } from "lucide-react";
import { Alert, Button, ConfirmDialog, Skeleton, Snackbar, Tag } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { ReportStepRef, ReportVar } from "@/app/lib/item-report/types";
import { formatMoment } from "@/app/items/format";

// Puck + the editor only load when the editor opens (it is a big chunk).
const ReportTemplateEditor = dynamic(() => import("./ReportTemplateEditor").then((m) => m.ReportTemplateEditor), {
  ssr: false,
});

/**
 * "דוח PDF" — the report templates of the item routes on screen (docs/ITEM_REPORTS.md).
 *
 * Every item gets a report: its route's own template ("מותאמת") when it has one, else the
 * general template ("כללית"), whose row leads the tab. A report is per ITEM, so the rows are item
 * routes: the route itself when an item type is chosen; every template line's route when a kit is
 * (the kit's box gets no report).
 */

type RouteRef = { test_route_id: number; label: string };

type TemplateJson = {
  route: { test_route_id: number; item_type_desc: string; route_number: number };
  template: Data | null;
  updated_at: string | null;
  updated_by_name: string | null;
  vars: ReportVar[];
  steps: ReportStepRef[];
};

type GeneralJson = {
  template: Data | null;
  updated_at: string | null;
  updated_by_name: string | null;
  vars: ReportVar[];
  steps: ReportStepRef[];
  /** Item routes that use it (no template of their own). */
  routes: number;
};

const hasContent = (t: Data | null | undefined): t is Data => !!t && Array.isArray(t.content) && t.content.length > 0;

function routesOf(context: FieldsContextJson): RouteRef[] {
  if (context.kind === "item") {
    return context.item
      ? [{ test_route_id: context.item.route.test_route_id, label: `מסלול ${context.subject.route_number} של ${context.subject.desc}` }]
      : [];
  }
  const seen = new Set<number>();
  const out: RouteRef[] = [];
  for (const line of context.lines) {
    if (!line.route || seen.has(line.route.route.test_route_id)) continue;
    seen.add(line.route.route.test_route_id);
    out.push({ test_route_id: line.route.route.test_route_id, label: `מסלול ${line.route_number} של ${line.item_type_desc}` });
  }
  return out;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await apiFetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default function RouteReportTab({ context, loading }: { context: FieldsContextJson | null; loading: boolean }) {
  const routes = React.useMemo(() => (context ? routesOf(context) : []), [context]);
  // A route moving between its own template and the general one changes the general row's count.
  const [revision, setRevision] = React.useState(0);
  const changed = React.useCallback(() => setRevision((n) => n + 1), []);

  if (loading) return <div className="settings-card"><Skeleton height={56} /><Skeleton height={56} /></div>;
  return (
    <div className="settings-card rf-report">
      <p className="rf-report__lead">
        בסוף המסלול מופק לכל פריט דוח PDF, עם התוצאות מכל עמדה שהפריט עבר. מסלול שאין לו תבנית משלו משתמש בתבנית
        הכללית. כל עוד הפריט במסלול, הדוח הוא טיוטה. כשהמסלול מסתיים והדוח נחתם, הוא ננעל ולא משתנה גם אם התבנית
        תשתנה.
      </p>
      <ul className="rf-report__list">
        <GeneralReportRow revision={revision} />
        {routes.map((r) => (
          <RouteReportRow key={r.test_route_id} route={r} onChanged={changed} />
        ))}
      </ul>
      {!context ? (
        <Alert severity="info">בחר סוג פריט או מארז ומספר מסלול כדי לראות את התבנית של המסלול.</Alert>
      ) : routes.length === 0 ? (
        <Alert severity="info">אין כאן מסלול פריט. דוח מופק לכל פריט, לפי התבנית של המסלול שהוא עובר.</Alert>
      ) : null}
    </div>
  );
}

/** The general template: edited here, saved after a confirmation that names its reach. */
function GeneralReportRow({ revision }: { revision: number }) {
  const [data, setData] = React.useState<GeneralJson | null>(null);
  const [error, setError] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [pending, setPending] = React.useState<Data | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const g = await fetchJson<GeneralJson>("/api/item-reports/templates/general");
    setData(g);
    setError(g == null);
  }, []);
  React.useEffect(() => {
    let alive = true;
    void fetchJson<GeneralJson>("/api/item-reports/templates/general").then((g) => {
      if (!alive) return;
      setData(g);
      setError(g == null);
    });
    return () => {
      alive = false;
    };
  }, [revision]);

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/item-reports/templates/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: pending }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setPending(null);
      setEditing(false);
      setNotice("התבנית הכללית נשמרה");
      await load();
    } catch {
      setPending(null);
      setNotice("שמירת התבנית הכללית נכשלה. השינויים עדיין בעורך — נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  const routes = data?.routes ?? 0;
  return (
    <li className="rf-report__row">
      <FileText size={20} strokeWidth={1.75} aria-hidden className="rf-report__icon" />
      <div className="rf-report__main">
        <div className="rf-report__title">התבנית הכללית{data ? ` · חלה על ${routes === 1 ? "מסלול אחד" : `${routes} מסלולים`}` : ""}</div>
        <div className="rf-report__meta">
          {error ? (
            <span className="rf-report__err">טעינת התבנית הכללית נכשלה</span>
          ) : !data ? (
            "טוען…"
          ) : (
            <>
              לכל מסלול שאין לו תבנית משלו
              {data.updated_at ? ` · עודכנה ${formatMoment(data.updated_at)}` : ""}
              {data.updated_by_name ? ` ע״י ${data.updated_by_name}` : ""}
            </>
          )}
        </div>
      </div>
      {error ? (
        <Button size="small" variant="outlined" onClick={load}>נסה שוב</Button>
      ) : (
        <Button size="small" variant="contained" startIcon={<Pencil size={14} />} disabled={!data} onClick={() => setEditing(true)}>
          עריכת התבנית הכללית
        </Button>
      )}

      {editing && data ? (
        <ReportTemplateEditor
          value={data.template}
          title="התבנית הכללית"
          routeId="general"
          vars={data.vars}
          steps={data.steps}
          saving={saving}
          onSave={(t) => setPending(t)}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <ConfirmDialog
        open={pending != null}
        draggable={false}
        busy={saving}
        title="לשמור את התבנית הכללית?"
        message={`השינוי יחול על הדוחות של כל הפריטים ב-${routes === 1 ? "מסלול אחד" : `${routes} מסלולים`} שמשתמשים בתבנית הכללית. דוחות שכבר ננעלו נשארים כמו שהם.`}
        confirmText="שמירת התבנית הכללית"
        onCancel={() => setPending(null)}
        onConfirm={save}
      />
      <Snackbar
        open={notice != null}
        message={notice ?? ""}
        autoHideDuration={4000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setNotice(null)}
      />
    </li>
  );
}

function RouteReportRow({ route, onChanged }: { route: RouteRef; onChanged: () => void }) {
  const [data, setData] = React.useState<TemplateJson | null>(null);
  const [error, setError] = React.useState(false);
  // The document the editor opens with: the route's own, or — "התאמה למסלול" — a copy of the general one.
  const [editing, setEditing] = React.useState<{ value: Data | null } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmRevert, setConfirmRevert] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const url = `/api/item-reports/templates/${route.test_route_id}`;
  const load = React.useCallback(async () => {
    setError(false);
    const t = await fetchJson<TemplateJson>(url);
    setData(t);
    setError(t == null);
  }, [url]);
  React.useEffect(() => {
    let alive = true;
    void fetchJson<TemplateJson>(url).then((t) => {
      if (!alive) return;
      setData(t);
      setError(t == null);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  const own = hasContent(data?.template);

  const customize = async () => {
    const g = await fetchJson<GeneralJson>("/api/item-reports/templates/general");
    if (!g) {
      setNotice("טעינת התבנית הכללית נכשלה. נסה שוב.");
      return;
    }
    setEditing({ value: g.template });
  };

  const save = async (template: Data) => {
    setSaving(true);
    try {
      const res = await apiFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEditing(null);
      setNotice("תבנית המסלול נשמרה");
      await load();
      onChanged();
    } catch {
      setNotice("שמירת התבנית נכשלה. השינויים עדיין בעורך — נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setConfirmRevert(false);
      setNotice("המסלול חזר לתבנית הכללית");
      await load();
      onChanged();
    } catch {
      setNotice("החזרה לתבנית הכללית נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rf-report__row">
      <FileText size={20} strokeWidth={1.75} aria-hidden className="rf-report__icon" />
      <div className="rf-report__main">
        <div className="rf-report__title">{route.label}</div>
        <div className="rf-report__meta">
          {error ? (
            <span className="rf-report__err">טעינת התבנית נכשלה</span>
          ) : !data ? (
            "טוען…"
          ) : own ? (
            <>
              תבנית משלו · {data.template!.content.length} רכיבים
              {data.updated_at ? ` · עודכנה ${formatMoment(data.updated_at)}` : ""}
              {data.updated_by_name ? ` ע״י ${data.updated_by_name}` : ""}
            </>
          ) : (
            "הפריטים במסלול מקבלים דוח לפי התבנית הכללית"
          )}
        </div>
      </div>
      {data ? <Tag tone={own ? "primary" : "neutral"}>{own ? "מותאמת" : "כללית"}</Tag> : null}
      {error ? (
        <Button size="small" variant="outlined" onClick={load}>נסה שוב</Button>
      ) : own ? (
        <>
          <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={() => setEditing({ value: data!.template })}>
            עריכת התבנית
          </Button>
          <Button size="small" variant="text" startIcon={<Undo2 size={14} />} onClick={() => setConfirmRevert(true)}>
            חזרה לתבנית הכללית
          </Button>
        </>
      ) : (
        <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} disabled={!data} onClick={customize}>
          התאמה למסלול
        </Button>
      )}

      {editing && data ? (
        <ReportTemplateEditor
          value={editing.value}
          title={route.label}
          routeId={route.test_route_id}
          vars={data.vars}
          steps={data.steps}
          saving={saving}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRevert}
        draggable={false}
        busy={saving}
        title={`להחזיר את ${route.label} לתבנית הכללית?`}
        message="התבנית של המסלול תימחק, והפריטים בו יקבלו דוח לפי התבנית הכללית. דוחות שכבר ננעלו נשארים כמו שהם."
        confirmText="חזרה לתבנית הכללית"
        onCancel={() => setConfirmRevert(false)}
        onConfirm={revert}
      />
      <Snackbar
        open={notice != null}
        message={notice ?? ""}
        autoHideDuration={4000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setNotice(null)}
      />
    </li>
  );
}
