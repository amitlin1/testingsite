"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Alert, Button, IconButton, Skeleton, Tag, SearchableCombobox } from "@/components/ui";
import { useSettingsToast } from "../../../components/useSettingsToast";
import { AlertTriangle, ArrowUp, ArrowDown, ExternalLink, Package, X, Plus, Save, Route } from "lucide-react";
import { getJson, sendJson } from "@/lib/api/client";
import { popupTemplatesHref } from "@/app/lib/links";
import { checkItemRouteAgainstPackage, checkPackageRoute } from "@/app/lib/packages/route-rules";
import type { RouteShape } from "@/app/lib/packages/route-rules";
import type { ContextLineJson, FieldsContextJson, StationTypeJson } from "@/app/lib/station-fields/admin-types";
import { roleAtStep } from "@/app/lib/popup-templates/placement";
import { usePopupTemplateTypes } from "../../lib/resources";
import { SharedRouteNotice } from "../editor/SharedRouteNotice";
import { useDraftStore } from "../../lib/draftStore";
import { alignedStepUids, kitIdOf, otherKits, packageLevelIds, stationLabel } from "../../lib/fieldsContext";
import { API, parseRouteRow, parseRouteRows } from "../../lib/wire";
import type { RouteRowJson } from "../../lib/wire";
import type { FieldsContextState } from "../../lib/useFieldsContext";
import type { RouteRef } from "../../lib/routeQuery";
import {
  EDITOR_TEXT, MAP_STATE_TEXT, NO_ROUTE_TEXT, STEPS_PARTS_TEXT, lineSubText, qtyText, routeNumberText,
  sharedStepsNoticeText, stepsTitleText,
} from "../../lib/labels";
import { STEPS_EDITOR_TEXT, moveStepDownTitle, moveStepUpTitle, removeStepTitle, routeNotCreatedText } from "../../lib/stepsLabels";
import { errorMessage } from "@/lib/errors";
import { itemRouteMissingText } from "@/app/lib/packages/template-wire";

/**
 * The "שלבי המסלול" tab (route-fields spec §5.13, §3.5; reworked 2026-10-26). The context card
 * picks a KIT route (package type + route number); this tab shows the parts of that kit side by
 * side with the steps of the part chosen:
 *
 *   "חלקי המארז"  the kit route itself, then one row per template line (the item route it runs).
 *                 Each row is a link (?item={item_type_id}; none = the box), so the URL holds the
 *                 choice. A row whose saved route breaks the package rules (docs/features/packages/PLAN.md
 *                 §4, route-rules.ts) carries a warning with the reason.
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

/** A station type of "הוסף שלב (סוג עמדה)". */
export type StationOption = { id: number; label: string };

/** One step of the route: its station type, and its uid (null = added here, not saved yet). */
type Step = { uid: string | null; typeId: number };

/** The route's steps with their uids (fieldsContext.alignedStepUids: none when the two arrays do not
 *  line up — the server infers them on save). */
function stepsOf(route: RouteRowJson): Step[] {
  const uids = alignedStepUids(route);
  return route.route_steps.map((typeId, i) => ({ uid: uids[i], typeId }));
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
  /** Every station type, for "הוסף שלב (סוג עמדה)". */
  stationTypes: StationOption[];
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
          <div>{STEPS_EDITOR_TEXT.noRouteHint}</div>
        </div>
      </div>
    );
  }
  if (ctx.status === "error") {
    return (
      <div className="settings-card settings-error">
        <Alert severity="error">{STEPS_PARTS_TEXT.loadFailed}</Alert>
        <Button variant="outlined" color="inherit" size="small" loading={ctx.retrying} onClick={ctx.retry}>{MAP_STATE_TEXT.retry}</Button>
      </div>
    );
  }
  if (ctx.status !== "ready") {
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
  const packageLevel = useMemo(() => new Set(packageLevelIds(context)), [context]);
  const kitShape: RouteShape | null = context.kit
    ? { itemTypeId: route.type, routeNumber: route.route, steps: context.kit.route.route_steps }
    : null;
  // An item route is measured against a well-formed kit route only (the packages screen's order).
  const kitValid = kitShape != null && checkPackageRoute(kitShape, packageLevel, route.route) == null;

  // A line without its item route blocks intake, so it is flagged once the kit route exists.
  const lineWarning = (line: ContextLineJson): string | null => {
    if (!kitShape) return null;
    if (!line.route) return itemRouteMissingText(line.route_number);
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

  const others = line?.route ? otherKits(line.route.shared_with, kitIdOf(context)).map((k) => k.desc) : [];

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
              sub={context.kit ? lineSubText(route.route, context.kit.route.route_steps.length) : routeNotCreatedText(route.route)}
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
                  sub={l.route ? lineSubText(l.route_number, l.route.route.route_steps.length) : routeNotCreatedText(l.route_number)}
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
        stations={context.stations}
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
                  onReload: reloadContext,
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
  stationTypes: StationOption[];
  /** The context's station types: names and package_level. */
  stations: Readonly<Record<number, StationTypeJson>>;
  onSaved: () => void;
  /** Under the title: an item route's shared notice and where its number comes from. */
  notice: React.ReactNode;
};

/** A route's row: the route, null when it does not exist yet, "error" when it could not be read. */
async function fetchRoute(typeId: number, routeNumber: number): Promise<RouteRowJson | null | "error"> {
  try {
    return parseRouteRows(await getJson<unknown>(API.routeOf(typeId, routeNumber)))[0] ?? null;
  } catch (e) {
    console.error("Route " + typeId + "/" + routeNumber + " failed to load", e);
    return "error";
  }
}

function StepsEditor({ target, stationTypes, stations, onSaved, notice }: StepsEditorProps) {
  const store = useDraftStore();
  const { typeId, routeNumber } = target;
  // The box's own route: a package-level step's template plays the role of its place (placement.ts).
  const templates = usePopupTemplateTypes();
  const templateRoleAt = (stepTypeId: number, index: number, count: number) => {
    if (target.name != null) return null;
    const role = templates?.get(stepTypeId)?.role ?? null;
    return role ? { role, fits: role === roleAtStep(index, count) } : null;
  };

  // Route Data
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [routeError, setRouteError] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteRowJson | null>(null);
  const [loadedSteps, setLoadedSteps] = useState<Step[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add Step
  const [stepToAdd, setStepToAdd] = useState<StationOption | null>(null);

  const say = useSettingsToast({ dismissible: false });

  // The editor is keyed by its route: a reply that lands after it left the screen is dropped.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Load Route — read (fetchRoute), then applied in the promise's callback: the editor is keyed by
  // its route and starts loading, so nothing is set in an effect's own body. "נסה שוב" shows
  // loading first (retryRoute).
  const applyRoute = useCallback((found: RouteRowJson | null | "error") => {
    if (!alive.current) return;
    if (found === "error") {
      setRouteError(true);
    } else {
      setCurrentRoute(found);
      setLoadedSteps(found ? stepsOf(found) : []);
      setSteps(found ? stepsOf(found) : []);
      setIsNew(found == null);
    }
    setLoadingRoute(false);
  }, []);

  useEffect(() => {
    fetchRoute(typeId, routeNumber).then(applyRoute);
  }, [typeId, routeNumber, applyRoute]);
  const retryRoute = () => {
    setLoadingRoute(true);
    setRouteError(false);
    fetchRoute(typeId, routeNumber).then(applyRoute);
  };

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

      const existing = !isNew && currentRoute ? currentRoute : null;
      const saved = parseRouteRow(await sendJson<unknown>(
        existing ? API.route(existing.test_route_id) : API.routes,
        existing ? "PUT" : "POST",
        body,
        STEPS_EDITOR_TEXT.saveFailed,
      ));
      if (alive.current) {
        setCurrentRoute(saved);
        // The server's uids: a step added here has one now, and the next save must send it.
        setLoadedSteps(stepsOf(saved));
        setSteps(stepsOf(saved));
        setIsNew(false);
        say(STEPS_EDITOR_TEXT.saved, "success");
      }
      onSaved();
    } catch (err) {
      if (alive.current) say(errorMessage(err) || STEPS_EDITOR_TEXT.saveFailedRetry, "error");
    } finally {
      if (alive.current) setSaving(false);
    }
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
          {STEPS_EDITOR_TEXT.save}
        </Button>
      </div>

      <div style={{ padding: 18 }}>
        {routeError ? (
          <div className="settings-error" style={{ padding: 0 }}>
            <Alert severity="error">{STEPS_EDITOR_TEXT.loadFailed}</Alert>
            <Button variant="outlined" color="inherit" size="small" onClick={retryRoute}>{MAP_STATE_TEXT.retry}</Button>
          </div>
        ) : (
          <>
            {notice && <div className="rf-steps__notice">{notice}</div>}
            {ruleBroken && (
              <Alert severity="warning" style={{ marginBottom: "var(--space-sm)", maxWidth: 560 }}>
                {ruleBroken}. {STEPS_PARTS_TEXT.ruleTail}
              </Alert>
            )}
            <div className="sh-field-label" style={{ marginBottom: 10 }}>{STEPS_EDITOR_TEXT.stepsLabel}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", maxWidth: 560 }}>
              {loadingRoute ? (
                // While the route loads its steps are unknown — never "no steps".
                <div aria-busy="true" aria-label={STEPS_EDITOR_TEXT.loadingSteps} style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} variant="rounded" height={48} />
                  ))}
                </div>
              ) : (
                <>
                  {steps.map((step, index) => {
                    const name = stationLabel(stations, step.typeId);
                    const packageLevel = stations[step.typeId]?.package_level ?? false;
                    const tpl = packageLevel ? templateRoleAt(step.typeId, index, steps.length) : null;
                    return (
                      // The uid is the step's identity; a step added here (no uid yet) is keyed
                      // by its place until the save gives it one. Never an index-derived uid.
                      <React.Fragment key={step.uid ?? `new-${index}`}>
                      <div className="route-step">
                        <span className="route-step__num">{index + 1}</span>
                        <span style={{ flex: 1, fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--color-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                          {name}
                          {packageLevel && (
                            // design/Settings.dc.html — a package-level step (opening / closing) is marked on the route.
                            <Tag tone="primary">{EDITOR_TEXT.packageLevel}</Tag>
                          )}
                          {tpl && <Tag tone={tpl.fits ? "neutral" : "warning"}>{STEPS_PARTS_TEXT.templateRole(tpl.role)}</Tag>}
                        </span>
                        <IconButton size="small" className="route-step__btn" title={moveStepUpTitle(name)} disabled={index === 0} onClick={() => handleMoveStep(index, "up")}>
                          <ArrowUp size={15} strokeWidth={1.9} aria-hidden />
                        </IconButton>
                        <IconButton size="small" className="route-step__btn" title={moveStepDownTitle(name)} disabled={index === steps.length - 1} onClick={() => handleMoveStep(index, "down")}>
                          <ArrowDown size={15} strokeWidth={1.9} aria-hidden />
                        </IconButton>
                        <IconButton size="small" className="route-step__btn route-step__btn--danger" title={removeStepTitle(name)} onClick={() => handleRemoveStep(index)}>
                          <X size={15} strokeWidth={1.9} aria-hidden />
                        </IconButton>
                      </div>
                      {tpl && !tpl.fits && (
                        <div role="note" className="rf-steps__tpl-warn">
                          <AlertTriangle size={15} strokeWidth={1.9} aria-hidden />
                          <span>
                            {STEPS_PARTS_TEXT.templateRoleMismatch(tpl.role)}{" "}
                            <Link href={popupTemplatesHref(step.typeId)} className="sh-link">{STEPS_PARTS_TEXT.templateLink}</Link>
                          </span>
                        </div>
                      )}
                      </React.Fragment>
                    );
                  })}
                  {steps.length === 0 && (
                    <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", padding: "var(--space-xs) 0" }}>{STEPS_EDITOR_TEXT.noSteps}</div>
                  )}
                </>
              )}

              {/* add-step row */}
              <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
                  <SearchableCombobox<StationOption>
                    options={stationTypes}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    value={stepToAdd}
                    onChange={(newValue) => setStepToAdd(newValue)}
                    label={STEPS_EDITOR_TEXT.addStepLabel}
                    placeholder={STEPS_EDITOR_TEXT.addStepPlaceholder}
                    disabled={loadingRoute}
                  />
                </div>
                <button type="button" className="route-add" onClick={handleAddStep} disabled={!stepToAdd || loadingRoute}>
                  <Plus size={16} strokeWidth={2} aria-hidden />{STEPS_EDITOR_TEXT.addStep}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
