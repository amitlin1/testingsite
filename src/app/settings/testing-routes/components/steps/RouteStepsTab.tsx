"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Snackbar, Alert, Button, IconButton, Skeleton, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { AlertTriangle, ArrowUp, ArrowDown, ExternalLink, Package, X, Plus, Save, Route } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { checkItemRouteAgainstPackage, checkPackageRoute } from "@/app/lib/packages/route-rules";
import type { RouteShape } from "@/app/lib/packages/route-rules";
import type { ContextLineJson, FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { SharedRouteNotice } from "../editor/SharedRouteNotice";
import { useDraftStore } from "../../lib/draftStore";
import type { FieldsContextState } from "../../lib/useFieldsContext";
import type { RouteRef } from "../../lib/routeQuery";
import {
  NO_ROUTE_TEXT, STEPS_PARTS_TEXT, lineRouteMissingText, lineSubText, qtyText, routeNumberText, sharedStepsNoticeText, stepsTitleText,
} from "../../lib/labels";

/**
 * The "שלבי המסלול" tab (route-fields spec §5.13, §3.5; reworked 2026-10-26). The context card
 * picks a KIT route (package type + route number); this tab shows the parts of that kit side by
 * side with the steps of the part chosen:
 *
 *   "חלקי המארז"  "המארז עצמו" (the kit route itself), then one row per template line (its item
 *                 type, ×quantity, the item route it runs: "מסלול {r} · {n} עמדות"). Each row is a
 *                 link (?item={item_type_id}; none = the box), so the URL holds the choice. A row
 *                 whose saved route breaks the package rules (docs/packages/PLAN.md §4,
 *                 route-rules.ts) carries a warning with the reason.
 *   the editor    the steps of that route, as the old page edited them: the box edits
 *                 (package type, route number); an item edits (item type, the LINE's route_number),
 *                 which the item type's other kits may run too (the shared notice, with "צור מסלול
 *                 נפרד למארז הזה"). The rules are checked live on the unsaved steps — a warning,
 *                 never a block (the packages screen treats them the same; intake enforces them).
 *
 * Every step carries its uid: the state is { uid, typeId }[], so a move or a removal carries the
 * uid along with no mapping code. A loaded route pairs step_uids[i] with route_steps[i] (all null
 * when the lengths differ — a route a script inserted); an added step has uid null and the server
 * mints one. The save sends route_steps AND step_uids, and takes the uids back from the answer. A
 * uid is never derived from an index (spec §11.3). After a save the page reloads what depends on
 * the steps (the route list, the fields context: the map's columns and this tab's parts).
 */

interface Option {
  id: number;
  label: string;
  /** Station types only: a package-level (opening / closing) station type. */
  packageLevel?: boolean;
}

interface RouteData {
  test_route_id: number;
  item_type_id: number;
  test_station_type_id: number;
  route_number: number;
  route_steps: number[];
  /** Parallel to route_steps (spec §3.5); another length = a route without uids. */
  step_uids?: string[] | null;
}

/** One step of the route: its station type, and its uid (null = added here, not saved yet). */
type Step = { uid: string | null; typeId: number };

/** The route's steps with their uids: step_uids[i] belongs to route_steps[i]; when the two do not
 *  line up, no step has a uid (the server infers them on save). */
function stepsOf(route: RouteData): Step[] {
  const typeIds = route.route_steps || [];
  const uids = Array.isArray(route.step_uids) && route.step_uids.length === typeIds.length ? route.step_uids : null;
  return typeIds.map((typeId, i) => ({ uid: uids ? uids[i] || null : null, typeId }));
}

const sameSteps = (a: readonly Step[], b: readonly Step[]) =>
  a.length === b.length && a.every((s, i) => s.uid === b[i].uid && s.typeId === b[i].typeId);

export type RouteStepsTabProps = {
  /** The kit route the context card names (null = none). */
  route: RouteRef | null;
  /** ?item= — the template line (its item_type_id) whose route is shown; null = the box. */
  item: number | null;
  /** The fields context of the kit route: its own route and its template lines. */
  ctx: FieldsContextState;
  /** Every station type, for the step names, "הוסף שלב (סוג עמדה)" and the package rules. */
  stationTypes: Option[];
  /** The link of a part: a line's item_type_id, or null for the box. */
  hrefOfItem: (item: number | null) => string;
  /** /settings/packages?type={kit} — where the template (and each line's route number) is edited. */
  packagesHref: string;
  /** The steps were saved (the route may be new). */
  onSaved: () => void;
};

export default function RouteStepsTab({ route, item, ctx, stationTypes, hrefOfItem, packagesHref, onSaved }: RouteStepsTabProps) {
  if (!route) {
    return (
      <div className="settings-card">
        <div className="settings-empty" style={{ padding: "48px 0" }}>
          <Route size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
          <div className="settings-empty__title">{NO_ROUTE_TEXT}</div>
          <div>שלבי המסלול יופיעו כאן לעריכה.</div>
        </div>
      </div>
    );
  }
  if (ctx.status === "error") {
    return (
      <div className="settings-card settings-error">
        <Alert severity="error">{STEPS_PARTS_TEXT.loadFailed}</Alert>
        <Button variant="outlined" color="inherit" size="small" loading={ctx.retrying} onClick={ctx.retry}>נסה שוב</Button>
      </div>
    );
  }
  if (ctx.status !== "ready" || ctx.data.kind !== "package") {
    return (
      <div className="rf-steps" aria-busy="true">
        <div className="settings-card rf-parts">
          {[0, 1, 2].map((i) => <div key={i} className="rf-parts__skeleton"><Skeleton variant="rounded" height={40} /></div>)}
        </div>
        <div className="settings-card"><div style={{ padding: 18 }}><Skeleton variant="rounded" height={160} /></div></div>
      </div>
    );
  }
  return (
    <KitSteps
      route={route}
      item={item}
      context={ctx.data}
      reloadContext={ctx.reload}
      stationTypes={stationTypes}
      hrefOfItem={hrefOfItem}
      packagesHref={packagesHref}
      onSaved={onSaved}
    />
  );
}

type KitStepsProps = Omit<RouteStepsTabProps, "ctx"> & {
  route: RouteRef;
  context: FieldsContextJson;
  reloadContext: () => void;
};

function KitSteps({ route, item, context, reloadContext, stationTypes, hrefOfItem, packagesHref, onSaved }: KitStepsProps) {
  const packageLevel = useMemo(() => new Set(stationTypes.filter((t) => t.packageLevel).map((t) => t.id)), [stationTypes]);
  const kitShape: RouteShape | null = context.kit
    ? { itemTypeId: route.type, routeNumber: route.route, steps: context.kit.route.route_steps }
    : null;
  // An item route is measured against a well-formed kit route only (the packages screen's order).
  const kitValid = kitShape != null && checkPackageRoute(kitShape, packageLevel, route.route) == null;

  // A line without its item route blocks intake, so it is flagged once the kit route exists.
  const lineWarning = (line: ContextLineJson): string | null => {
    if (!kitShape) return null;
    if (!line.route) return lineRouteMissingText(line.route_number);
    if (!kitValid) return null;
    const shape = { itemTypeId: line.item_type_id, routeNumber: line.route_number, steps: line.route.route.route_steps };
    return checkItemRouteAgainstPackage(shape, kitShape, packageLevel, line.route_number);
  };

  const line = item == null ? null : context.lines.find((l) => l.item_type_id === item) ?? null;
  const target: EditorTarget = line
    ? {
        typeId: line.item_type_id,
        routeNumber: line.route_number,
        name: line.item_type_desc.trim(),
        check: (steps) => (kitShape && kitValid
          ? checkItemRouteAgainstPackage({ itemTypeId: line.item_type_id, routeNumber: line.route_number, steps }, kitShape, packageLevel, line.route_number)
          : null),
      }
    : {
        typeId: route.type,
        routeNumber: route.route,
        name: null,
        check: (steps) => checkPackageRoute({ itemTypeId: route.type, routeNumber: route.route, steps }, packageLevel, route.route),
      };

  const others = line?.route ? line.route.shared_with.filter((k) => k.package_type_id !== route.type).map((k) => k.desc) : [];

  return (
    <div className="rf-steps">
      <nav aria-label={STEPS_PARTS_TEXT.navLabel} className="settings-card rf-parts">
        <div className="settings-card__head rf-parts__head">
          <span className="settings-card__title">{STEPS_PARTS_TEXT.navLabel}</span>
        </div>
        <ul className="rf-parts__list">
          <li>
            <PartLink
              href={hrefOfItem(null)}
              current={line == null}
              icon={<Package size={17} strokeWidth={1.75} aria-hidden />}
              name={STEPS_PARTS_TEXT.box}
              sub={context.kit ? lineSubText(route.route, context.kit.route.route_steps.length) : routeNumberText(route.route) + " · " + STEPS_PARTS_TEXT.notCreated}
              warning={kitShape ? checkPackageRoute(kitShape, packageLevel, route.route) : null}
            />
          </li>
        </ul>
        <div className="rf-parts__heading">{STEPS_PARTS_TEXT.items}</div>
        {context.lines.length === 0 ? (
          <div className="rf-parts__empty">
            {STEPS_PARTS_TEXT.noLines}{" "}
            <Link href={packagesHref} className="sh-link">{STEPS_PARTS_TEXT.editContents}</Link>
          </div>
        ) : (
          <ul className="rf-parts__list">
            {context.lines.map((l) => (
              <li key={l.line_id}>
                <PartLink
                  href={hrefOfItem(l.item_type_id)}
                  current={line?.line_id === l.line_id}
                  name={l.item_type_desc.trim()}
                  qty={l.quantity}
                  sub={l.route ? lineSubText(l.route_number, l.route.route.route_steps.length) : routeNumberText(l.route_number) + " · " + STEPS_PARTS_TEXT.notCreated}
                  warning={lineWarning(l)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <StepsEditor
        // Another part (or a line moved to another route by a fork) is another route: a fresh editor.
        key={`${target.typeId}:${target.routeNumber}`}
        target={target}
        stationTypes={stationTypes}
        onSaved={onSaved}
        notice={line ? (
          <>
            {others.length > 0 && line.route && (
              <SharedRouteNotice
                routeNumber={line.route_number}
                item={line.item_type_desc.trim()}
                kits={others}
                text={sharedStepsNoticeText(line.route_number, line.item_type_desc.trim(), others)}
                fork={{
                  routeId: line.route.route.test_route_id,
                  packageTypeId: route.type,
                  kitName: context.subject.desc.trim(),
                  onForked: () => reloadContext(),
                  onStale: () => reloadContext(),
                }}
              />
            )}
            <div className="rf-steps__from">
              {STEPS_PARTS_TEXT.itemRouteFrom}{" "}
              <Link href={packagesHref} className="sh-link rf-steps__from-link">
                {STEPS_PARTS_TEXT.editContents}
                <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
              </Link>
            </div>
          </>
        ) : null}
      />
    </div>
  );
}

type PartLinkProps = {
  href: string;
  current: boolean;
  icon?: React.ReactNode;
  name: string;
  qty?: number;
  sub: string;
  warning: string | null;
};

function PartLink({ href, current, icon, name, qty, sub, warning }: PartLinkProps) {
  return (
    <Link href={href} replace scroll={false} className="rf-part" aria-current={current ? "true" : undefined}>
      {icon && <span className="rf-part__icon">{icon}</span>}
      <span className="rf-part__body">
        <span className="rf-part__name">
          {name}
          {qty != null && <span className="rf-part__qty" dir="ltr">{qtyText(qty)}</span>}
        </span>
        <span className="rf-part__sub">{sub}</span>
      </span>
      {warning && (
        <span className="rf-part__warn" role="img" aria-label={warning} title={warning}>
          <AlertTriangle size={16} strokeWidth={1.9} aria-hidden />
        </span>
      )}
    </Link>
  );
}

/** The route the editor shows: the kit's own (name null) or a template line's item route. */
type EditorTarget = {
  typeId: number;
  routeNumber: number;
  /** The item type's name; null = the box. */
  name: string | null;
  /** The package rule these steps break (route-rules.ts' reason), or null. */
  check: (steps: number[]) => string | null;
};

type StepsEditorProps = {
  target: EditorTarget;
  stationTypes: Option[];
  onSaved: () => void;
  /** Under the title: an item route's shared notice and where its number comes from. */
  notice: React.ReactNode;
};

function StepsEditor({ target, stationTypes, onSaved, notice }: StepsEditorProps) {
  const store = useDraftStore();
  const { typeId, routeNumber } = target;

  // Route Data
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [routeError, setRouteError] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteData | null>(null);
  const [loadedSteps, setLoadedSteps] = useState<Step[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add Step
  const [stepToAdd, setStepToAdd] = useState<Option | null>(null);

  // UI
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success"
  });

  // The editor is keyed by its route: a reply that lands after it left the screen is dropped.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Load Route
  const loadRoute = useCallback(async () => {
    setLoadingRoute(true);
    setRouteError(false);
    try {
      const res = await apiFetch(`/api/settings/testing-routes?itemTypeId=${typeId}&routeNumber=${routeNumber}`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      if (!alive.current) return;

      if (Array.isArray(data) && data.length > 0) {
        const found = data[0] as RouteData;
        setCurrentRoute(found);
        setLoadedSteps(stepsOf(found));
        setSteps(stepsOf(found));
        setIsNew(false);
      } else {
        setCurrentRoute(null);
        setLoadedSteps([]);
        setSteps([]);
        setIsNew(true);
      }
    } catch {
      if (alive.current) setRouteError(true);
    } finally {
      if (alive.current) setLoadingRoute(false);
    }
  }, [typeId, routeNumber]);

  useEffect(() => {
    void loadRoute();
  }, [loadRoute]);

  // Editor Actions — on { uid, typeId } steps: the uid moves with its step.
  const handleAddStep = () => {
    if (stepToAdd) {
      setSteps([...steps, { uid: null, typeId: stepToAdd.id }]);
      setStepToAdd(null);
    }
  };

  const handleRemoveStep = (index: number) => {
    const newSteps = [...steps];
    newSteps.splice(index, 1);
    setSteps(newSteps);
  };

  const handleMoveStep = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index > 0) {
      const newSteps = [...steps];
      [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
      setSteps(newSteps);
    } else if (direction === "down" && index < steps.length - 1) {
      const newSteps = [...steps];
      [newSteps[index + 1], newSteps[index]] = [newSteps[index], newSteps[index + 1]];
      setSteps(newSteps);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Field edits still waiting for their autosave go first: a step save prunes the route's
      // draft on the server (spec §3.5), and a later autosave would meet its newer draft_rev.
      await store.flushAll();

      const body = {
        item_type_id: typeId,
        route_number: routeNumber,
        route_steps: steps.map((s) => s.typeId),
        step_uids: steps.map((s) => s.uid),
      };

      let url = "/api/settings/testing-routes";
      let method = "POST";

      if (!isNew && currentRoute) {
        url = `/api/settings/testing-routes/${currentRoute.test_route_id}`;
        method = "PUT";
      }

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "שמירת המסלול נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      }

      const saved: RouteData = await res.json();
      if (alive.current) {
        setCurrentRoute(saved);
        // The server's uids: a step added here has one now, and the next save must send it.
        setLoadedSteps(stepsOf(saved));
        setSteps(stepsOf(saved));
        setIsNew(false);
        setSnackbar({ open: true, message: "מסלול נשמר בהצלחה", severity: "success" });
      }
      onSaved();
    } catch (err: any) {
      if (alive.current) setSnackbar({ open: true, message: err.message || "שמירת המסלול נכשלה. נסה שוב.", severity: "error" });
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const getStationName = (id: number) => {
    return stationTypes.find(s => s.id === id)?.label || `ID ${id}`;
  };

  const dirty = !loadingRoute && !routeError && !sameSteps(steps, loadedSteps);
  const ruleBroken = !loadingRoute && !routeError && steps.length > 0 ? target.check(steps.map((s) => s.typeId)) : null;

  return (
    <div className="settings-card" style={{ overflow: "visible" }}>
      <div className="settings-card__head" style={{ paddingInline: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ display: "flex", color: "var(--color-ink-muted-48)" }}>
            {target.name == null ? <Package size={20} strokeWidth={1.75} aria-hidden /> : <Route size={20} strokeWidth={1.75} aria-hidden />}
          </span>
          <span className="settings-card__title">{stepsTitleText(target.name)}</span>
          <span className="settings-count">{routeNumberText(routeNumber)}</span>
          <span aria-live="polite" style={{ display: "contents" }}>
            {!loadingRoute && !routeError && isNew && <Tag tone="neutral" size="md">{STEPS_PARTS_TEXT.newRoute}</Tag>}
            {dirty && <Tag tone="warning" size="md">{STEPS_PARTS_TEXT.dirty}</Tag>}
          </span>
        </div>
        <Button
          onClick={handleSave}
          disabled={loadingRoute || routeError}
          loading={saving}
          startIcon={<Save size={18} strokeWidth={2} aria-hidden />}
        >
          שמור
        </Button>
      </div>

      <div style={{ padding: 18 }}>
        {routeError ? (
          <div className="settings-error" style={{ padding: 0 }}>
            <Alert severity="error">טעינת המסלול נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
            <Button variant="outlined" color="inherit" size="small" onClick={loadRoute}>נסה שוב</Button>
          </div>
        ) : (
          <>
            {notice && <div className="rf-steps__notice">{notice}</div>}
            {ruleBroken && (
              <Alert severity="warning" style={{ marginBottom: "var(--space-sm)", maxWidth: 560 }}>
                {ruleBroken}. {STEPS_PARTS_TEXT.ruleTail}
              </Alert>
            )}
            <div className="sh-field-label" style={{ marginBottom: 10 }}>שלבי המסלול · לפי הסדר</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", maxWidth: 560 }}>
              {loadingRoute ? (
                // While the route loads its steps are unknown — never "no steps".
                <div aria-busy="true" aria-label="טוען שלבים" style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} variant="rounded" height={48} />
                  ))}
                </div>
              ) : (
                <>
                  {steps.map((step, index) => {
                    const name = getStationName(step.typeId);
                    return (
                      // The uid is the step's identity; a step added here (no uid yet) is keyed
                      // by its place until the save gives it one. Never an index-derived uid.
                      <div key={step.uid ?? `new-${index}`} className="route-step">
                        <span className="route-step__num">{index + 1}</span>
                        <span style={{ flex: 1, fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--color-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                          {name}
                          {stationTypes.find((t) => t.id === step.typeId)?.packageLevel && (
                            // design/Settings.dc.html — a package-level step (opening / closing) is marked on the route.
                            <Tag tone="primary">עמדה ברמת מארז</Tag>
                          )}
                        </span>
                        <IconButton size="small" className="route-step__btn" title={`הקדם את ${name}`} disabled={index === 0} onClick={() => handleMoveStep(index, "up")}>
                          <ArrowUp size={15} strokeWidth={1.9} aria-hidden />
                        </IconButton>
                        <IconButton size="small" className="route-step__btn" title={`אחר את ${name}`} disabled={index === steps.length - 1} onClick={() => handleMoveStep(index, "down")}>
                          <ArrowDown size={15} strokeWidth={1.9} aria-hidden />
                        </IconButton>
                        <IconButton size="small" className="route-step__btn route-step__btn--danger" title={`הסר את ${name} מהמסלול`} onClick={() => handleRemoveStep(index)}>
                          <X size={15} strokeWidth={1.9} aria-hidden />
                        </IconButton>
                      </div>
                    );
                  })}
                  {steps.length === 0 && (
                    <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", padding: "var(--space-xs) 0" }}>אין שלבים. הוסף עמדה למסלול.</div>
                  )}
                </>
              )}

              {/* add-step row */}
              <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
                  <SearchableCombobox<Option>
                    options={stationTypes}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    value={stepToAdd}
                    onChange={(newValue) => setStepToAdd(newValue)}
                    label="הוסף שלב (סוג עמדה)"
                    placeholder="בחר סוג עמדה…"
                    disabled={loadingRoute}
                  />
                </div>
                <button type="button" className="route-add" onClick={handleAddStep} disabled={!stepToAdd || loadingRoute}>
                  <Plus size={16} strokeWidth={2} aria-hidden />הוסף שלב
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </div>
  );
}
