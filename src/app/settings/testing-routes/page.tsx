"use client";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Route } from "lucide-react";
import { Alert, Button, cn } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import SettingsToolbar from "../components/SettingsToolbar";
import RouteFieldsHeader from "./components/RouteFieldsHeader";
import RouteContextCard, { sortRouteOptions } from "./components/RouteContextCard";
import type { RouteOption } from "./components/RouteContextCard";
import RouteViewTabs from "./components/RouteViewTabs";
import RouteStepsTab from "./components/steps/RouteStepsTab";
import {
  MapLoadErrorState, MapLoadingState, MapNoContentsState, MapNoStepsState,
} from "./components/map/MapViewStates";
import { DraftStoreProvider, useFieldsMap } from "./lib/draftStore";
import { useFieldsContext } from "./lib/useFieldsContext";
import type { FieldsContextState, FieldsContextSubject } from "./lib/useFieldsContext";
import {
  backToMap, isEditorOpen, parseRouteQuery, readLastRoute, routeQueryHref, routeRefOf, sameRouteQuery,
  withLastRoute, withRoute, withView, writeLastRoute,
} from "./lib/routeQuery";
import type { RouteQuery, RouteRef, RouteView } from "./lib/routeQuery";
import { HEADER_TEXT, NO_ROUTE_TEXT } from "./lib/labels";
import "./route-fields.css";

/**
 * /settings/testing-routes — "מסלולי בדיקה" (route-fields spec §5.1, §5.2; D6): the shell of the
 * route-fields screen. Header (RouteFieldsHeader) → context card "מסלול נבחר" (hidden on the
 * library) → the view tabs → the view:
 *   map      the fields map and its cell editor (?step=&target=) — sessions 2b (map, editor) and
 *            2e (onboarding); this shell draws the map's other states (artboard 11)
 *   steps    "שלבי המסלול" (RouteStepsTab)
 *   library  "ערכות ורשימות" — session 2d
 *
 * ALL view state is in the URL (lib/routeQuery.ts), changed with router.replace. Without a route
 * in the URL the page opens the route last opened in this browser (localStorage), else the empty
 * state "בחר סוג פריט ומספר מסלול". The map and its editor take the whole frame (`settings-wide`).
 *
 * Data: the item types and station types (the old page's options), the route list (the "מסלול"
 * combobox and the header count), and GET …/fields-context for the route on screen
 * (useFieldsContext), whose answer feeds the page's one DraftStoreProvider.
 */

interface Option {
  id: number;
  label: string;
  /** Station types only: a package-level (opening / closing) station type. */
  packageLevel?: boolean;
}

interface ItemTypeOption extends Option {
  isPackage: boolean;
}

/** A row of GET /api/settings/testing-routes (the members this page reads). */
interface RouteRow {
  item_type_id: number;
  route_number: number;
  route_steps: number[];
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

  const ref = useMemo(() => routeRefOf(query), [query]);

  // ---- options: item types, station types, routes ----------------------------------------------
  const [itemTypes, setItemTypes] = useState<ItemTypeOption[]>([]);
  const [stationTypes, setStationTypes] = useState<Option[]>([]);
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  // A failed options load is not "no item types": it gets a band and a retry.
  const [optionsError, setOptionsError] = useState(false);

  const loadRoutes = useCallback(async (): Promise<boolean> => {
    try {
      const res = await apiFetch("/api/settings/testing-routes");
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("not a list");
      setRoutes(data as RouteRow[]);
      return true;
    } catch (err) {
      console.error("Failed to load testing routes", err);
      return false;
    }
  }, []);

  const loadOptions = useCallback(() => {
    setOptionsError(false);
    setOptionsLoading(true);
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
      setItemTypes(Array.isArray(items) ? (items as any[]).map((i) => ({ id: i.item_type_id, label: i.item_type_desc, isPackage: i.is_package === true })) : []);
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

  useEffect(() => { loadOptions(); }, [loadOptions]);

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
  /** No route in the URL and storage not read yet (server render). */
  routeUnknown: boolean;
  navigate: (next: RouteQuery) => void;
  pathname: string;
  itemTypes: ItemTypeOption[];
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
  query, routeUnknown, navigate, pathname, itemTypes, stationTypes, routes, optionsError, optionsLoading,
  optionsLoaded, onRetryOptions, ctx, context, onStepsSaved,
}: ScreenProps) {
  const ref = useMemo(() => routeRefOf(query), [query]);
  const map = useFieldsMap(context);
  const view = query.view;

  // ---- the "מסלול" options and value -------------------------------------------------------------
  const typeById = useMemo(() => new Map(itemTypes.map((t) => [t.id, t])), [itemTypes]);
  const routeOptions = useMemo((): RouteOption[] | null => {
    if (!routes || !optionsLoaded) return null;
    return sortRouteOptions(routes.map((r) => {
      const type = typeById.get(r.item_type_id);
      return {
        key: `${r.item_type_id}:${r.route_number}`,
        type: r.item_type_id,
        route: r.route_number,
        // An item type the list does not know is named like an unknown station type ("ID {n}").
        desc: type?.label.trim() || `ID ${r.item_type_id}`,
        isPackage: type?.isPackage === true,
      };
    }));
  }, [routes, optionsLoaded, typeById]);
  const routeValue = useMemo((): RouteOption | null => {
    if (!ref) return null;
    const listed = routeOptions?.find((o) => o.type === ref.type && o.route === ref.route);
    if (listed) return listed;
    // A pair with no route yet ("מסלול חדש — ייווצר בשמירה") still shows what is open.
    const type = typeById.get(ref.type);
    if (!type) return null;
    return { key: `${ref.type}:${ref.route}`, type: ref.type, route: ref.route, desc: type.label.trim(), isPackage: type.isPackage };
  }, [ref, routeOptions, typeById]);
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

  // ---- "בעיה אחת לתיקון": the map into view -------------------------------------------------------
  const mapRegionRef = useRef<HTMLDivElement>(null);
  const scrollToMapPending = useRef(false);
  const scrollToMap = useCallback(() => {
    const el = mapRegionRef.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, []);
  const onMapView = view === "map" && !isEditorOpen(query);
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
  const packagesHref = ref ? `/settings/packages?type=${ref.type}` : "/settings/packages";

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
      default:
        // Session 2b fills this region: the fields map (FieldsMap, its toolbar, selection bar and
        // footer) and, with ?step=&target=, the cell editor (StationFieldEditor); session 2e adds
        // the onboarding card (map.onboarding) and the bulk actions.
        return null;
    }
  };

  return (
    <div dir="rtl" className={cn("rf-page", view === "map" && "settings-wide")}>
      <RouteFieldsHeader
        routeCount={routes ? routes.length : null}
        routeChosen={ref != null}
        context={context}
        map={map}
        onShowIssues={showIssues}
      />

      {optionsError && (
        <div className="settings-card settings-error">
          <Alert severity="error">טעינת סוגי הפריטים והעמדות נכשלה, ולכן אי אפשר לבחור מסלול. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={onRetryOptions}>נסה שוב</Button>
        </div>
      )}

      {view !== "library" && (
        <RouteContextCard
          options={routeOptions}
          value={routeValue}
          onChange={onRouteChange}
          kit={kit}
          coverage={coverage}
        />
      )}

      <RouteViewTabs view={view} editorOpen={isEditorOpen(query)} hrefOf={hrefOf} stepsCount={stepsCount} />

      {view === "map" && (
        <div id={MAP_REGION_ID} ref={mapRegionRef} tabIndex={-1} className="rf-map-region">
          {mapView()}
        </div>
      )}

      {view === "steps" && (
        <RouteStepsTab
          route={ref}
          itemTypes={itemTypes}
          stationTypes={stationTypes}
          onRouteChange={onRouteChange}
          onSaved={onStepsSaved}
        />
      )}

      {/* view === "library": "ערכות ורשימות" (artboard 8) is session 2d's. */}
    </div>
  );
}
