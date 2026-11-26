"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Data } from "@measured/puck";
import { FileText, Pencil, Undo2 } from "lucide-react";
import { Alert, Button, ConfirmDialog, Skeleton, Snackbar, Tag } from "@/components/ui";
import { getJson, sendJson } from "@/lib/api/client";
import type { GeneralTemplateJson, RouteTemplateJson } from "@/app/lib/item-report/contract";
import { formatMoment } from "@/app/lib/datetime";
import "./report-templates.css";

// Puck + the editor only load when the editor opens (it is a big chunk).
const ReportTemplateEditor = dynamic(() => import("./ReportTemplateEditor").then((m) => m.ReportTemplateEditor), {
  ssr: false,
});

/**
 * The report templates of a set of item routes (docs/features/ITEM_REPORTS.md): the general template's row,
 * then one row per route. Every item gets a report: its route's own template ("מותאמת") when it has
 * one, else the general template ("כללית").
 */

/** An item route the panel lists. */
export type ReportRoute = { test_route_id: number; label: string };

const hasContent = (t: Data | null | undefined): t is Data => !!t && Array.isArray(t.content) && t.content.length > 0;

const GENERAL_URL = "/api/item-reports/templates/general";
const templateUrl = (routeId: number | "general") => (routeId === "general" ? GENERAL_URL : `/api/item-reports/templates/${routeId}`);
const templateKey = (routeId: number | "general") => ["item-report-template", routeId] as const;

/** A template row's read: on mount, on "נסה שוב" and after a save here; no retry, no refetch on
 *  focus. Its data stays on screen while it reads again. */
function useTemplate<T>(routeId: number | "general") {
  return useQuery({
    queryKey: templateKey(routeId),
    queryFn: () => getJson<T>(templateUrl(routeId)),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
}

/** `routes`: the item routes on screen; null when no item type or kit is chosen. */
export default function ReportTemplatesPanel({ routes, loading }: { routes: ReportRoute[] | null; loading: boolean }) {
  // A route moving between its own template and the general one changes the general row's count.
  const queryClient = useQueryClient();
  const changed = React.useCallback(() => void queryClient.invalidateQueries({ queryKey: templateKey("general") }), [queryClient]);

  if (loading) return <div className="settings-card"><Skeleton height={56} /><Skeleton height={56} /></div>;
  return (
    <div className="settings-card rf-report">
      <p className="rf-report__lead">
        בסוף המסלול מופק לכל פריט דוח PDF, עם התוצאות מכל עמדה שהפריט עבר. מסלול שאין לו תבנית משלו משתמש בתבנית
        הכללית. כל עוד הפריט במסלול, הדוח הוא טיוטה. כשהמסלול מסתיים והדוח נחתם, הוא ננעל ולא משתנה גם אם התבנית
        תשתנה.
      </p>
      <ul className="rf-report__list">
        <GeneralReportRow />
        {(routes ?? []).map((r) => (
          <RouteReportRow key={r.test_route_id} route={r} onChanged={changed} />
        ))}
      </ul>
      {!routes ? (
        <Alert severity="info">בחר סוג פריט או מארז ומספר מסלול כדי לראות את התבנית של המסלול.</Alert>
      ) : routes.length === 0 ? (
        <Alert severity="info">אין כאן מסלול פריט. דוח מופק לכל פריט, לפי התבנית של המסלול שהוא עובר.</Alert>
      ) : null}
    </div>
  );
}

/** The general template: edited here, saved after a confirmation that names its reach. */
function GeneralReportRow() {
  const generalQ = useTemplate<GeneralTemplateJson>("general");
  const error = generalQ.isError;
  // A failed read shows no count.
  const data = error ? null : generalQ.data ?? null;
  const load = () => void generalQ.refetch();
  const [editing, setEditing] = React.useState(false);
  const [pending, setPending] = React.useState<Data | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await sendJson(GENERAL_URL, "PUT", { template: pending });
      setPending(null);
      setEditing(false);
      setNotice("התבנית הכללית נשמרה");
      await generalQ.refetch();
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

function RouteReportRow({ route, onChanged }: { route: ReportRoute; onChanged: () => void }) {
  const routeQ = useTemplate<RouteTemplateJson>(route.test_route_id);
  // "נסה שוב" reads as loading again.
  const error = routeQ.isError && !routeQ.isFetching;
  const data = routeQ.data ?? null;
  const load = () => routeQ.refetch();
  // The document the editor opens with: the route's own, or — "התאמה למסלול" — a copy of the general one.
  const [editing, setEditing] = React.useState<{ value: Data | null } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmRevert, setConfirmRevert] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const url = templateUrl(route.test_route_id);

  const own = hasContent(data?.template);

  const customize = async () => {
    const g = await getJson<GeneralTemplateJson>(GENERAL_URL).catch(() => null);
    if (!g) {
      setNotice("טעינת התבנית הכללית נכשלה. נסה שוב.");
      return;
    }
    setEditing({ value: g.template });
  };

  const save = async (template: Data) => {
    setSaving(true);
    try {
      await sendJson(url, "PUT", { template });
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
      await sendJson(url, "DELETE");
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
        <Button size="small" variant="outlined" onClick={() => void load()}>נסה שוב</Button>
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
