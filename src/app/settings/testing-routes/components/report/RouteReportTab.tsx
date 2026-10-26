"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import type { Data } from "@measured/puck";
import { FileText, Pencil, Trash2 } from "lucide-react";
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
 * "דוח PDF" — the report template of each item route on screen (docs/ITEM_REPORTS.md).
 *
 * A report is per ITEM, so the rows are item routes: the route itself when an item type
 * is chosen; every template line's route when a kit is (the kit's box gets no report).
 * Each row says whether the route has a template and opens the full-screen editor.
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

export default function RouteReportTab({ context, loading }: { context: FieldsContextJson | null; loading: boolean }) {
  const routes = React.useMemo(() => (context ? routesOf(context) : []), [context]);

  if (loading) return <div className="settings-card"><Skeleton height={56} /><Skeleton height={56} /></div>;
  if (!context) {
    return (
      <div className="settings-card">
        <Alert severity="info">בחר סוג מארז ומספר מסלול כדי לערוך את תבנית הדוח.</Alert>
      </div>
    );
  }
  if (routes.length === 0) {
    return (
      <div className="settings-card">
        <Alert severity="info">אין כאן מסלול פריט. דוח מופק לכל פריט, לפי תבנית של המסלול שהוא עובר.</Alert>
      </div>
    );
  }
  return (
    <div className="settings-card rf-report">
      <p className="rf-report__lead">
        בסוף המסלול מופק לכל פריט דוח PDF לפי תבנית המסלול, עם התוצאות מכל עמדה שהפריט עבר. כל עוד הפריט במסלול, הדוח
        הוא טיוטה. כשהמסלול מסתיים (ואם בתבנית יש חתימה ידנית — אחרי החתימה), הדוח ננעל ולא משתנה גם אם התבנית תשתנה.
      </p>
      <ul className="rf-report__list">
        {routes.map((r) => (
          <RouteReportRow key={r.test_route_id} route={r} />
        ))}
      </ul>
    </div>
  );
}

function RouteReportRow({ route }: { route: RouteRef }) {
  const [data, setData] = React.useState<TemplateJson | null>(null);
  const [error, setError] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const fetchTemplate = React.useCallback(async (): Promise<TemplateJson | null> => {
    try {
      const res = await apiFetch(`/api/item-reports/templates/${route.test_route_id}`);
      return res.ok ? ((await res.json()) as TemplateJson) : null;
    } catch {
      return null;
    }
  }, [route.test_route_id]);
  const load = React.useCallback(async () => {
    setError(false);
    const t = await fetchTemplate();
    setData(t);
    setError(t == null);
  }, [fetchTemplate]);
  React.useEffect(() => {
    let alive = true;
    void fetchTemplate().then((t) => {
      if (!alive) return;
      setData(t);
      setError(t == null);
    });
    return () => {
      alive = false;
    };
  }, [fetchTemplate]);

  const save = async (template: Data) => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/item-reports/templates/${route.test_route_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setEditing(false);
      setNotice("תבנית הדוח נשמרה");
      await load();
    } catch {
      setNotice("שמירת התבנית נכשלה. השינויים עדיין בעורך — נסה שוב.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/item-reports/templates/${route.test_route_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setConfirmDelete(false);
      setNotice("תבנית הדוח נמחקה");
      await load();
    } catch {
      setNotice("מחיקת התבנית נכשלה");
    } finally {
      setSaving(false);
    }
  };

  const has = !!data?.template && Array.isArray(data.template.content) && data.template.content.length > 0;

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
          ) : has ? (
            <>
              {data.template!.content.length} רכיבים
              {data.updated_at ? ` · עודכנה ${formatMoment(data.updated_at)}` : ""}
              {data.updated_by_name ? ` ע״י ${data.updated_by_name}` : ""}
            </>
          ) : (
            "לפריטים במסלול הזה לא מופק דוח"
          )}
        </div>
      </div>
      {data ? <Tag tone={has ? "success" : "neutral"}>{has ? "יש תבנית" : "אין תבנית"}</Tag> : null}
      {error ? (
        <Button size="small" variant="outlined" onClick={load}>נסה שוב</Button>
      ) : (
        <>
          <Button size="small" variant={has ? "outlined" : "contained"} startIcon={<Pencil size={14} />} disabled={!data} onClick={() => setEditing(true)}>
            {has ? "עריכת התבנית" : "יצירת תבנית"}
          </Button>
          {has ? (
            <Button size="small" variant="text" color="error" startIcon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
              מחיקה
            </Button>
          ) : null}
        </>
      )}

      {editing && data ? (
        <ReportTemplateEditor
          value={data.template}
          title={route.label}
          routeId={route.test_route_id}
          vars={data.vars}
          steps={data.steps}
          saving={saving}
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        destructive
        draggable={false}
        busy={saving}
        title={`מחיקת תבנית הדוח של ${route.label}`}
        message="לפריטים במסלול לא יופק דוח מעכשיו. דוחות שכבר ננעלו נשארים כמו שהם."
        confirmText="מחיקת התבנית"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
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
