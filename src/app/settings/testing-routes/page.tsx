"use client";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Route } from "lucide-react";
import { Alert, Button, Snackbar, cn } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { FieldId } from "@/app/lib/station-fields/schema";
import SettingsToolbar from "../components/SettingsToolbar";
import RouteFieldsHeader from "./components/RouteFieldsHeader";
import RouteContextCard from "./components/RouteContextCard";
import RouteViewTabs from "./components/RouteViewTabs";
import RouteStepsTab from "./components/steps/RouteStepsTab";
import RouteReportTab from "./components/report/RouteReportTab";
import {
  MapLoadErrorState, MapLoadingState, MapNoContentsState, MapNoStepsState,
} from "./components/map/MapViewStates";
import FieldsMap from "./components/map/FieldsMap";
import FieldsOnboarding from "./components/map/FieldsOnboarding";
import { MAP_ERROR_ACTION_ID } from "./components/map/FieldsMapErrorBar";
import StationFieldEditor from "./components/editor/StationFieldEditor";
import { EditorBreadcrumb } from "./components/editor/EditorBreadcrumb";
import PublishDialog from "./components/dialogs/PublishDialog";
import ApplyFieldSetDialog from "./components/dialogs/ApplyFieldSetDialog";
import FieldLibrary from "./components/library/FieldLibrary";
import { useFieldSetNames, useFieldSetVersions } from "./lib/useLibrary";
import { DraftStoreProvider, useFieldsMap, useStepsOutOfContextKey } from "./lib/draftStore";
import { findCell, relevantCells } from "./lib/mapModel";
import type { CellBinding, MapCell } from "./lib/mapModel";
import { firstColumnCells } from "./lib/applySetModel";
import type { PasteCounts } from "./lib/bulkModel";
import { pastedText } from "./lib/bulkLabels";
import { useFieldsContext } from "./lib/useFieldsContext";
import type { FieldsContextState, FieldsContextSubject } from "./lib/useFieldsContext";
import {
  backToMap, isEditorOpen, parseRouteQuery, readLastRoute, routeQueryHref, routeRefOf, sameRouteQuery,
  withEditor, withItem, withLastRoute, withLibrary, withRoute, withView, writeLastRoute,
} from "./lib/routeQuery";
import type { RouteQuery, RouteRef, RouteView } from "./lib/routeQuery";
import { kitTypeOptions, routeForKitType, routeNumberOptions } from "./lib/routePickModel";
import type { ItemTypeRow, RouteRow } from "./lib/routePickModel";
import { HEADER_TEXT, NO_ROUTE_TEXT } from "./lib/labels";
import "./route-fields.css";

/**
 * /settings/testing-routes — "מסלולי בדיקה" (route-fields spec §5.1, §5.2; D6): the shell of the
 * route-fields screen. Header (RouteFieldsHeader) → context card "מסלול נבחר" (hidden on the
 * library): a package type, then its route number — never an item type (2026-10-26) → the view
 * tabs → the view:
 *   map      the fields map (FieldsMap, artboard 1) — under the onboarding card while the route holds
 *            no fields of its own (FieldsOnboarding, artboard 11) — and, with ?step=&target=, its cell
 *            editor (StationFieldEditor, artboard 2 — its breadcrumb in the tabs' row); this shell
 *            draws the map's other states (artboard 11)
 *   steps    "שלבי המסלול" (RouteStepsTab) — the box or one of its items (?item=), and its steps
 *   library  "ערכות ורשימות" (FieldLibrary, artboard 8)
 *   report   "דוח PDF" (RouteReportTab) — the report template of each item route on screen
 *
 * "החלת ערכת שדות" (ApplyFieldSetDialog, artboard 9) is the page's: the selection bar's "החל ערכת
 * שדות…" (the selected cells), the editor's ⋯ "החל ערכה…" (its cell) and the onboarding's "החל ערכת
 * שדות…" (the cells of the map's first column — artboard 11 selects none) open it. The library's
 * "החל על תאים…" cannot pick cells there (spec §5.10: "לא מצויר"), so it opens the map of the route
 * on screen and remembers its set: the next opening of the dialog starts on it — no undrawn UI. After
 * an apply, the paste's undrawn message tells what went in.
 *
 * ALL view state is in the URL (lib/routeQuery.ts), changed with router.replace. Without a route
 * in the URL the page opens the route last opened in this browser (localStorage), else the empty
 * state "בחר סוג מארז ומספר מסלול". A route of an item type (an old link, an old remembered route)
 * is no route here: the screen opens kit routes only. The map and its editor take the whole frame
 * (`settings-wide`).
 *
 * Data: the item types and station types (the old page's options), the route list (the two
 * pickers and the header count), and GET …/fields-context for the kit route on screen
 * (useFieldsContext), whose answer feeds the page's one DraftStoreProvider. The context is asked
 * for again whenever a route's steps change: after a steps save, and when the draft store read a
 * route back with other steps (409 STEP_UNKNOWN) — the map's columns are the context's.
 */

interface Option {
  id: number;
  label: string;
  /** Station types only: a package-level (opening / closing) station type. */
  packageLevel?: boolean;
}


// ---- the route last opened (localStorage) ----------------------------------------------------------
// Read through useSyncExternalStore: the server snapshot is "unknown" (null), so the first client
// render reads storage without a hydration mismatch. A string snapshot compares by value.
const noSubscribe = () => () => {};
const lastRouteSnapshot = (): string => {
  const ref = readLastRoute();
  return ref ? `${ref.type}:${ref.route}` : "";
};
const unknownSnapshot = (): string | null => null;

function parseRefKey(key: string | null): RouteRef | null {
  if (!key) return null;
  const [type, route] = key.split(":").map(Number);
  return { type, route };
}

// ---- the map's id: the header's "בעיה אחת לתיקון" brings it into view ------------------------------
const MAP_REGION_ID = "rf-map-region";

/** The testing routes, or null when they could not be read. */
async function readRoutes(): Promise<RouteRow[] | null> {
  try {
    const res = await apiFetch("/api/settings/testing-routes");
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("not a list");
    return data as RouteRow[];
  } catch (err) {
    console.error("Failed to load testing routes", err);
    return null;
  }
}

export default function TestingRoutesPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<div dir="rtl"><SettingsToolbar title={HEADER_TEXT.title} subtitle={HEADER_TEXT.subtitle} /></div>}>
      <TestingRoutesShell />
    </Suspense>
  );
}

function TestingRoutesShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // ---- URL state ------------------------------------------------------------------------------
  const urlQuery = useMemo(() => parseRouteQuery(searchParams), [searchParams]);
  const lastKey = useSyncExternalStore<string | null>(noSubscribe, lastRouteSnapshot, unknownSnapshot);
  const lastRef = useMemo(() => parseRefKey(lastKey), [lastKey]);
  // Without a route in the URL: the last route (the URL catches up below). Until storage is known
  // (server render) the page waits rather than flash the empty state.
  const query = useMemo(() => withLastRoute(urlQuery, lastRef), [urlQuery, lastRef]);
  const routeUnknown = routeRefOf(urlQuery) == null && lastKey == null;

  useEffect(() => {
    const ref = routeRefOf(urlQuery);
    if (ref) writeLastRoute(ref);
    else if (lastRef) router.replace(routeQueryHref(pathname, withLastRoute(urlQuery, lastRef)), { scroll: false });
  }, [urlQuery, lastRef, router, pathname]);

  const navigate = useCallback((next: RouteQuery) => {
    if (!sameRouteQuery(next, query)) router.replace(routeQueryHref(pathname, next), { scroll: false });
  }, [query, router, pathname]);

  // ---- options: item types, station types, routes ----------------------------------------------
  const [itemTypes, setItemTypes] = useState<ItemTypeRow[]>([]);
  const [stationTypes, setStationTypes] = useState<Option[]>([]);
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  // A failed options load is not "no item types": it gets a band and a retry.
  const [optionsError, setOptionsError] = useState(false);

  // Read, then applied in the promise's callback, so the effects below can run these.
  const loadRoutes = useCallback(
    (): Promise<boolean> => readRoutes().then((rows) => {
      if (rows) setRoutes(rows);
      return rows !== null;
    }),
    [],
  );

  const fetchOptions = useCallback(() => {
    Promise.all([
      apiFetch("/api/settings/item-types").then(async res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      }),
      apiFetch("/api/settings/test-stations-type").then(async res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      }),
      loadRoutes(),
    ]).then(([items, stations, routesOk]) => {
      setItemTypes(Array.isArray(items) ? (items as any[]).map((i) => ({
        id: i.item_type_id,
        label: i.item_type_desc,
        isPackage: i.is_package === true,
        defaultRoute: typeof i.default_route_number === "number" ? i.default_route_number : null,
      })) : []);
      setStationTypes(Array.isArray(stations) ? (stations as any[]).map((s) => ({ id: s.test_station_type_id, label: s.test_type_desc, packageLevel: s.package_level === true })) : []);
      setOptionsLoaded(true);
      // Without the route list the "מסלול" combobox cannot offer a route: the same band.
      if (!routesOk) setOptionsError(true);
    }).catch(err => {
      console.error("Failed to load options", err);
      setItemTypes([]);
      setStationTypes([]);
      // Without the item types a route is neither kit nor item: the context is not asked for
      // (a retry that fails after an earlier success must not ask for it as an item route).
      setOptionsLoaded(false);
      setOptionsError(true);
    }).finally(() => {
      setOptionsLoading(false);
    });
  }, [loadRoutes]);
  // The retry clears the band and shows the spinner first (the first load starts that way).
  const loadOptions = useCallback(() => {
    setOptionsError(false);
    setOptionsLoading(true);
    fetchOptions();
  }, [fetchOptions]);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);

  // The route on screen: a kit route only. Until the item types are in, the URL's pair waits (the
  // views show their loading states); then a pair of an item type is no route.
  const ref = useMemo((): RouteRef | null => {
    const r = routeRefOf(query);
    if (!r || !optionsLoaded) return r;
    return itemTypes.find((t) => t.id === r.type)?.isPackage ? r : null;
  }, [query, optionsLoaded, itemTypes]);

  // ---- the fields context of the route on screen --------------------------------------------------
  // Kit or item decides the request; it is known once the item types are in.
  const subject = useMemo((): FieldsContextSubject | null => {
    if (!ref || !optionsLoaded) return null;
    const type = itemTypes.find((t) => t.id === ref.type);
    return { itemTypeId: ref.type, isPackage: type?.isPackage === true, routeNumber: ref.route };
  }, [ref, optionsLoaded, itemTypes]);
  const ctx = useFieldsContext(subject);
  const context = ctx.status === "ready" ? ctx.data : null;

  // After a steps save: the list (count, combobox, the tab's chip) and the context (the map's
  // columns follow the steps).
  const reloadContext = ctx.status === "idle" ? null : ctx.reload;
  const onStepsSaved = useCallback(() => {
    void loadRoutes();
    reloadContext?.();
  }, [loadRoutes, reloadContext]);

  return (
    <DraftStoreProvider context={context}>
      <RouteFieldsScreen
        query={query}
        routeRef={ref}
        routeUnknown={routeUnknown}
        navigate={navigate}
        pathname={pathname}
        itemTypes={itemTypes}
        stationTypes={stationTypes}
        routes={routes}
        optionsError={optionsError}
        optionsLoading={optionsLoading}
        optionsLoaded={optionsLoaded}
        onRetryOptions={loadOptions}
        ctx={ctx}
        context={context}
        onStepsSaved={onStepsSaved}
      />
    </DraftStoreProvider>
  );
}

type ScreenProps = {
  query: RouteQuery;
  /** The kit route on screen (null = none, or the URL names an item type's route). */
  routeRef: RouteRef | null;
  /** No route in the URL and storage not read yet (server render). */
  routeUnknown: boolean;
  navigate: (next: RouteQuery) => void;
  pathname: string;
  itemTypes: ItemTypeRow[];
  stationTypes: Option[];
  routes: RouteRow[] | null;
  optionsError: boolean;
  optionsLoading: boolean;
  optionsLoaded: boolean;
  onRetryOptions: () => void;
  ctx: FieldsContextState;
  context: FieldsContextJson | null;
  onStepsSaved: () => void;
};

/** Everything under the page's DraftStoreProvider. */
function RouteFieldsScreen({
  query, routeRef: ref, routeUnknown, navigate, pathname, itemTypes, stationTypes, routes, optionsError, optionsLoading,
  optionsLoaded, onRetryOptions, ctx, context, onStepsSaved,
}: ScreenProps) {
  // Field sets (session 2d): their versions mark "הערכה עודכנה" cells, their names the "ערכה: …" tags.
  const setVersions = useFieldSetVersions();
  const setNames = useFieldSetNames();
  const map = useFieldsMap(context, setVersions);
  const view = query.view;
  const editorOpen = isEditorOpen(query);

  // ---- a route read back with other steps (409 STEP_UNKNOWN): the context again ----------------
  // The map's columns are the context's, so it follows the route's steps; once per change.
  const reloadContext = ctx.status === "idle" ? null : ctx.reload;
  const stepsKey = useStepsOutOfContextKey();
  const reloadedFor = useRef("");
  useEffect(() => {
    if (!stepsKey) {
      reloadedFor.current = "";
      return;
    }
    if (!reloadContext || reloadedFor.current === stepsKey) return;
    reloadedFor.current = stepsKey;
    reloadContext();
  }, [stepsKey, reloadContext]);

  // ---- the two pickers: "סוג מארז", then "מספר מסלול" ---------------------------------------------
  const typeById = useMemo(() => new Map(itemTypes.map((t) => [t.id, t])), [itemTypes]);
  const kitTypes = useMemo(
    () => (routes && optionsLoaded ? kitTypeOptions(itemTypes, routes) : null),
    [routes, optionsLoaded, itemTypes],
  );
  const routeNumbers = useMemo(
    () => (ref && routes ? routeNumberOptions(ref.type, routes, typeById.get(ref.type)?.defaultRoute ?? null, ref.route) : []),
    [ref, routes, typeById],
  );
  // The header counts the routes the pickers offer: the kits'.
  const kitRouteCount = useMemo(
    () => (routes && optionsLoaded ? routes.filter((r) => typeById.get(r.item_type_id)?.isPackage).length : null),
    [routes, optionsLoaded, typeById],
  );
  const stepsCount = useMemo(() => {
    if (!ref || !routes) return null;
    const row = routes.find((r) => r.item_type_id === ref.type && r.route_number === ref.route);
    return row ? (row.route_steps ?? []).length : null;
  }, [ref, routes]);

  // ---- context card tags ---------------------------------------------------------------------------
  // "מארז · {k} סוגי פריטים · {u} יחידות": k = the template's lines, u = their quantities (spec
  // §5.2). A kit without contents has its own state under the tabs instead.
  const kit = useMemo(() => {
    if (!context || context.kind !== "package" || context.lines.length === 0) return null;
    return { kinds: context.lines.length, units: context.lines.reduce((n, l) => n + l.quantity, 0) };
  }, [context]);
  const coverage = map && map.emptyState == null ? map.coverage : null;

  // ---- "בעיה אחת לתיקון": the map's error bar into view, its "עבור לשדה" focused (spec §5.2) -------
  // From the editor (or another tab) the map comes back first. An error on no cell has no "עבור
  // לשדה": the map region takes the focus then.
  const mapRegionRef = useRef<HTMLDivElement>(null);
  const scrollToMapPending = useRef(false);
  const scrollToMap = useCallback(() => {
    const el = mapRegionRef.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    const action = document.getElementById(MAP_ERROR_ACTION_ID);
    (action && el.contains(action) ? action : el).focus({ preventScroll: true });
  }, []);
  const onMapView = view === "map" && !editorOpen;
  const showIssues = useCallback(() => {
    if (onMapView) {
      scrollToMap();
      return;
    }
    scrollToMapPending.current = true;
    navigate(backToMap(query));
  }, [onMapView, scrollToMap, navigate, query]);
  useEffect(() => {
    if (onMapView && scrollToMapPending.current) {
      scrollToMapPending.current = false;
      scrollToMap();
    }
  }, [onMapView, scrollToMap]);

  const hrefOf = useCallback((v: RouteView) => routeQueryHref(pathname, withView(query, v)), [pathname, query]);
  const onRouteChange = useCallback((next: RouteRef) => navigate(withRoute(query, next)), [navigate, query]);
  const onTypeChange = useCallback((typeId: number) => {
    if (ref?.type === typeId) return;
    const route = routeForKitType(typeId, routes ?? [], typeById.get(typeId)?.defaultRoute ?? null);
    navigate(withRoute(query, { type: typeId, route }));
  }, [ref, routes, typeById, navigate, query]);
  const hrefOfItem = useCallback((item: number | null) => routeQueryHref(pathname, withItem(query, item)), [pathname, query]);
  const packagesHref = ref ? `/settings/packages?type=${ref.type}` : "/settings/packages";

  // ---- the map and its cell editor ----------------------------------------------------------------
  const openCell = useCallback(
    (binding: CellBinding, field?: FieldId) => navigate(withEditor(query, binding.step_uid, binding.target, field ?? null)),
    [navigate, query],
  );
  const toMap = useCallback(() => navigate(backToMap(query)), [navigate, query]);

  // ---- "פרסום לעמדות" → the publish dialog (artboard 10; session 2c) ------------------------------
  const [publishOpen, setPublishOpen] = useState(false);
  const openPublish = useCallback(() => setPublishOpen(true), []);
  const closePublish = useCallback(() => setPublishOpen(false), []);
  const reloadAfterPublish = useCallback(() => reloadContext?.(), [reloadContext]);

  // ---- "החלת ערכת שדות" (artboard 9; session 2e) ---------------------------------------------------
  // The cells stay with a closed dialog, so its text does not change while it closes. `returnFocus`:
  // ui/Dialog has no trigger to give the focus back to — the control that opened it takes it, or the
  // map region when that control is gone (the onboarding card leaves once a cell has fields).
  const [applyBox, setApplyBox] = useState<{ open: boolean; cells: MapCell[]; returnFocus: HTMLElement | null }>(
    { open: false, cells: [], returnFocus: null },
  );
  // The library's "החל על תאים…": the set the next opening starts on.
  const [pendingSetId, setPendingSetId] = useState<number | null>(null);
  // The message after an apply (the paste's undrawn words); a new one restarts the Snackbar.
  const [applyNotice, setApplyNotice] = useState<{ text: string; seq: number } | null>(null);
  const openApply = useCallback((cells: MapCell[], returnFocus?: HTMLElement | null) => {
    if (cells.length === 0) return;
    const active = typeof document === "undefined" ? null : document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    setApplyBox({ open: true, cells, returnFocus: returnFocus ?? opener });
  }, []);
  const closeApply = useCallback(() => {
    const back = applyBox.returnFocus;
    setApplyBox((b) => ({ ...b, open: false }));
    window.setTimeout(() => {
      if (back?.isConnected) back.focus({ preventScroll: true });
      else mapRegionRef.current?.focus({ preventScroll: true });
    }, 0);
  }, [applyBox.returnFocus]);
  const onApplied = useCallback((counts: PasteCounts) => {
    setPendingSetId(null);
    setApplyNotice((n) => ({ text: pastedText(counts), seq: (n?.seq ?? 0) + 1 }));
  }, []);
  const openSetsLibrary = useCallback((setId: number | null) => navigate(withLibrary(query, "sets", setId)), [navigate, query]);
  const applyToCellsFromLibrary = useCallback((setId: number) => {
    setPendingSetId(setId);
    navigate(withView(query, "map"));
  }, [navigate, query]);
  // A route change leaves the dialog's cells behind: they belong to the map that was on screen.
  const routeKey = ref ? `${ref.type}:${ref.route}` : "";
  const [applyRouteKey, setApplyRouteKey] = useState(routeKey);
  if (applyRouteKey !== routeKey) {
    setApplyRouteKey(routeKey);
    if (applyBox.open) setApplyBox((b) => ({ ...b, open: false }));
  }

  // The cell the editor is open on, once the map is drawn: its breadcrumb goes in the tabs' row
  // (artboard 2). A cell the map does not have gets none — the editor sends the URL back to the map.
  const mapReady = view === "map" && ctx.status === "ready" && map != null && map.emptyState == null;
  const editorCell = useMemo(
    () => (mapReady && editorOpen && map && query.step != null && query.target != null ? findCell(map, query.step, query.target) : null),
    [mapReady, editorOpen, map, query.step, query.target],
  );

  // ---- the map view --------------------------------------------------------------------------------
  const mapView = (): React.ReactNode => {
    if (!ref) {
      if (routeUnknown) return null;
      return (
        <div className="settings-card">
          <div className="settings-empty" style={{ padding: "48px 0" }}>
            <Route size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
            <div className="settings-empty__title">{NO_ROUTE_TEXT}</div>
          </div>
        </div>
      );
    }
    // The options decide kit or item: without them the context cannot be asked for.
    if (!optionsLoaded) {
      return optionsError ? <MapLoadErrorState retrying={optionsLoading} onRetry={onRetryOptions} /> : <MapLoadingState />;
    }
    if (ctx.status === "error") return <MapLoadErrorState retrying={ctx.retrying} onRetry={ctx.retry} />;
    if (ctx.status !== "ready" || !map) return <MapLoadingState />;
    switch (map.emptyState) {
      // A pair without a route has no steps either: "שלבי המסלול" creates it.
      case "route_missing":
      case "no_steps":
        return <MapNoStepsState onGoToSteps={() => navigate(withView(query, "steps"))} />;
      case "no_contents":
        return <MapNoContentsState packagesHref={packagesHref} />;
      default: {
        // With ?step=&target= the cell editor, else the map (its error bar, toolbar, selection bar and
        // footer) under the onboarding card while the route holds no fields of its own.
        if (editorOpen) {
          return (
            <StationFieldEditor
              context={ctx.data}
              model={map}
              query={query}
              onNavigate={navigate}
              breadcrumbOutside
              onApplySet={openApply}
              reloadContext={ctx.reload}
            />
          );
        }
        const model = map;
        return (
          <>
            <FieldsOnboarding
              context={ctx.data}
              model={model}
              onStart={() => {
                // "התחל בעמדה הראשונה": the first relevant cell (a kit's: its first step, the box).
                const first = relevantCells(model)[0];
                if (first) openCell(first.binding);
              }}
              onApplySet={() => openApply(firstColumnCells(model))}
              onOpenKit={(id) => navigate(withRoute(query, { type: id, route: 1 }))}
            />
            <FieldsMap
              context={ctx.data}
              model={model}
              query={query}
              onOpenCell={openCell}
              setNames={setNames}
              onApplySet={(cells) => openApply(cells)}
            />
          </>
        );
      }
    }
  };

  return (
    <div dir="rtl" className={cn("rf-page", view === "map" && "settings-wide")}>
      <RouteFieldsHeader
        routeCount={kitRouteCount}
        routeChosen={ref != null}
        context={context}
        map={map}
        onPublish={openPublish}
        onShowIssues={showIssues}
      />
      <PublishDialog open={publishOpen} onClose={closePublish} context={context} map={map} onReloadContext={reloadAfterPublish} />
      {context && map && (
        <ApplyFieldSetDialog
          open={applyBox.open}
          cells={applyBox.cells}
          context={context}
          model={map}
          preferredSetId={pendingSetId}
          onClose={closeApply}
          onApplied={onApplied}
          onOpenLibrary={openSetsLibrary}
        />
      )}
      <Snackbar
        key={applyNotice?.seq ?? 0}
        open={applyNotice != null}
        message={applyNotice?.text}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setApplyNotice(null)}
      />

      {optionsError && (
        <div className="settings-card settings-error">
          <Alert severity="error">טעינת סוגי הפריטים והעמדות נכשלה, ולכן אי אפשר לבחור מסלול. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={onRetryOptions}>נסה שוב</Button>
        </div>
      )}

      {view !== "library" && (
        <RouteContextCard
          kitTypes={kitTypes}
          routeNumbers={routeNumbers}
          value={ref}
          onTypeChange={onTypeChange}
          onRouteChange={onRouteChange}
          kit={kit}
          coverage={coverage}
        />
      )}

      <RouteViewTabs
        view={view}
        editorOpen={editorOpen}
        hrefOf={hrefOf}
        stepsCount={stepsCount}
        trailing={editorCell ? <EditorBreadcrumb stationLabel={editorCell.stationLabel} rowLabel={editorCell.rowLabel} onBackToMap={toMap} /> : null}
      />

      {view === "map" && (
        <div id={MAP_REGION_ID} ref={mapRegionRef} tabIndex={-1} className="rf-map-region">
          {mapView()}
        </div>
      )}

      {view === "steps" && (
        <RouteStepsTab
          route={ref}
          item={query.item}
          ctx={ctx}
          stationTypes={stationTypes}
          hrefOfItem={hrefOfItem}
          packagesHref={packagesHref}
          onSaved={onStepsSaved}
        />
      )}

      {view === "report" && (
        <RouteReportTab context={context} loading={ref != null && (ctx.status === "loading" || ctx.status === "idle")} />
      )}

      {/* "ערכות ורשימות" (artboard 8): global, independent of the chosen route. */}
      {view === "library" && <FieldLibrary query={query} onNavigate={navigate} onApplyToCells={applyToCellsFromLibrary} />}
    </div>
  );
}
