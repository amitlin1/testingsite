"use client";

// §5 / §14 — the whole dashboard, one page.
//
// It owns three things and delegates everything else: the shared state, the
// shared fetch, and the history overlay. The app shell's rail and top bar are
// untouched (§14.3) — this component renders INSIDE them and never draws a
// second product title.
//
// THE ONE-SCREEN CONTRACT is structural, not decorative. Root is `height:100%`
// (never 100vh — the shell's content area is already `calc(100vh - 56px)` with
// its own scrollbar), the main column is a flex column, and the tab body is the
// only child that takes the leftover. Every flex:1 box that holds a chart or a
// table carries `min-height:0`; without it a recharts container reports its
// intrinsic aspect ratio as its minimum and pushes the page into a scroll.

import * as React from "react";

import { useMediaQuery } from "@/components/ui";
import { FilterList } from "@/components/ui/icons";
import { AmberNotice, CappedPeriodNotice } from "./_components/AmberNotice";
import DashboardHeader from "./_components/DashboardHeader";
import DashboardSidebar, { NAV_ITEMS } from "./_components/DashboardSidebar";
import HistoryOverlay, { type HistoryTarget } from "./_components/HistoryOverlay";
import TopStatsBar from "./_components/TopStatsBar";
import { STUCK_HOURS, formatClock, formatLongDate } from "./_lib/format";
import { EMPTY_FILTERS, activeChips, type FilterKey } from "./_lib/filters";
import type { DashboardState, TabKey } from "./_lib/state";
import { rangeIsComplete, useDashboardData } from "./_lib/useDashboardData";
import { useDashboardOptions } from "./_lib/useDashboardOptions";
import { useDashboardState } from "./_lib/useDashboardState";

import CustomersTab from "./tabs/CustomersTab";
import ItemTypesTab from "./tabs/ItemTypesTab";
import KpisTab from "./tabs/KpisTab";
import OverviewTab from "./tabs/OverviewTab";
import ShipmentsTab from "./tabs/ShipmentsTab";
import SlowItemsTab, { passesThreshold } from "./tabs/SlowItemsTab";
import StationsTab from "./tabs/StationsTab";
import StatusTab from "./tabs/StatusTab";
import TimesTab from "./tabs/TimesTab";
import { ClockInfoProvider } from "@/app/components/ClockInfo/ClockInfo";
import "./dashboard.css";

const TAB_COMPONENTS: Record<TabKey, React.ComponentType<React.ComponentProps<typeof OverviewTab>>> = {
  overview: OverviewTab,
  kpis: KpisTab,
  stations: StationsTab,
  slow: SlowItemsTab,
  shipments: ShipmentsTab,
  times: TimesTab,
  status: StatusTab,
  customers: CustomersTab,
  types: ItemTypesTab,
};

/** dashboard.css hides the rail at the same width. */
const DRAWER_QUERY = "(max-width: 1100px)";

export default function DashboardShell({ initial }: { initial?: Partial<DashboardState> }) {
  const api = useDashboardState(initial);
  const options = useDashboardOptions();
  const data = useDashboardData(api.state);
  const [history, setHistory] = React.useState<HistoryTarget | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // The only place `useMediaQuery` is used: turning the rail into a drawer is
  // behaviour, not layout, and everything layout-shaped is a CSS media query so
  // the first paint is already correct (§15).
  const isDrawerWidth = useMediaQuery(DRAWER_QUERY);
  // A wide window or another tab closes the drawer; adjusted during render.
  const tab = api.state.tab;
  const [drawerSeen, setDrawerSeen] = React.useState({ isDrawerWidth, tab });
  if (drawerSeen.isDrawerWidth !== isDrawerWidth || drawerSeen.tab !== tab) {
    setDrawerSeen({ isDrawerWidth, tab });
    if (drawerSeen.tab !== tab || !isDrawerWidth) setDrawerOpen(false);
  }
  const drawerRef = React.useRef<HTMLDivElement>(null);
  useDrawerFocus(drawerOpen, drawerRef, () => setDrawerOpen(false));

  const kpis = data.get("kpis");
  const stations = data.get("stationsLive");
  const slow = data.get("slow");
  const shipments = data.get("shipments");
  const customers = data.get("customers");
  const types = data.get("types");
  const status = data.get("status");

  // §7's fifth cell and the nav badge count the same thing: rows in the page
  // the server returned whose WALL wait has passed STUCK_HOURS.
  const stuckCount = React.useMemo(
    () =>
      slow.data === null
        ? null
        : slow.data.filter((row) => passesThreshold(row, STUCK_HOURS)).length,
    [slow.data],
  );

  const chips = React.useMemo(
    () =>
      activeChips(api.state.filters, {
        customer: options.customers.find((c) => c.id === api.state.filters.customerId)?.name,
        shipment: options.shipments.find((s) => s.id === api.state.filters.shipmentId)?.shipment_code,
        itemType: options.itemTypes.find((t) => t.id === api.state.filters.itemTypeId)?.name,
        station: options.stations.find((s) => s.id === api.state.filters.testStationId)?.name,
        stationType: options.stationTypes.find((s) => s.id === api.state.filters.testStationTypeId)?.name,
      }),
    [api.state.filters, options],
  );

  const meta = tabMeta(api.state, {
    stations: stations.data?.length ?? null,
    shipments: shipments.data?.length ?? null,
    customers: customers.data?.length ?? null,
    types: types.data?.length ?? null,
    activeItems: status.data ? status.data.reduce((sum, s) => sum + s.count, 0) : null,
    asOf: status.data?.[0]?.asOf ?? null,
  });

  // §16.3 — when the server narrowed the window, the window it actually served
  // is shown rather than the one that was asked for.
  const capped = [kpis, stations, shipments, customers, status].find((r) => r.meta.capped)?.meta;

  const Tab = TAB_COMPONENTS[api.state.tab];

  const removeChip = (key: FilterKey) => api.setFilter(key, EMPTY_FILTERS[key]);

  return (
    // One ברוטו / נטו panel for the whole dashboard (the header button and the
    // icon beside every duration open it).
    <ClockInfoProvider>
      <div className="dash-root" dir="rtl">
        {/* The rail is the FIRST child on purpose: in an RTL flex row that places
            it at the start edge — screen right, immediately inside the app shell's
            own 56px rail — which is the order the design is laid out in. */}
        <DashboardSidebar api={api} options={options} stuckCount={stuckCount} />

        <div className="dash-main" style={{ flex: 1, minWidth: 0, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <DashboardHeader
            title={meta.title}
            subtitle={meta.subtitle}
            chips={chips}
            onRemoveChip={removeChip}
            lastUpdatedAt={data.lastUpdatedAt}
            refreshing={data.refreshing}
            onRefresh={data.refresh}
          />

          {/* A refresh never blanks the body; this 2px bar is the only signal. */}
          <div className={data.refreshing ? "dash-refresh-bar dash-refresh-bar--on" : "dash-refresh-bar"} aria-hidden>
            <span />
          </div>

          {!rangeIsComplete(api.state) && (
            <AmberNotice>בחר תאריך התחלה ותאריך סיום · עד אז הנתונים אינם מתעדכנים</AmberNotice>
          )}

          {capped && (
            <CappedPeriodNotice lead="התקופה קוצרה על ידי השרת" from={capped.periodFrom} to={capped.periodTo} />
          )}

          {/* At 1100px and below the rail is gone and the tabs become a scrollable pill
              row with the filters behind one button. */}
          <MobileNav
            tab={api.state.tab}
            onSelect={api.setTab}
            activeFilterCount={api.activeFilterCount}
            onOpenFilters={() => setDrawerOpen(true)}
          />

          <TopStatsBar
            kpis={kpis.data}
            stations={stations.data}
            stuckCount={stuckCount}
            loading={kpis.loading}
            onShowStuck={() => api.drillTo("slow", {}, { stuckHours: STUCK_HOURS })}
          />

          <Tab api={api} data={data} openHistory={setHistory} />
        </div>

        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1200,
              background: "var(--color-scrim)",
              display: "flex",
              justifyContent: "flex-start",
            }}
          >
            {/* A modal panel: Escape closes it, Tab stays inside it, and focus
                returns to the button that opened it (useDrawerFocus). */}
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="מקטעים ומסננים"
              onClick={(event) => event.stopPropagation()}
              style={{ height: "100%" }}
            >
              <DashboardSidebar
                api={api}
                options={options}
                stuckCount={stuckCount}
                drawer
                onCloseDrawer={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        )}

        {history && (
          <HistoryOverlay
            target={history}
            onClose={() => setHistory(null)}
            onApplyFilter={(target) => {
              if (target.kind === "station") {
                // The station dialog's CTA is a drilldown, not a filter: "show me
                // what is stuck HERE" is the question a queue-age spike raises.
                api.drillTo("slow", { testStationId: target.id });
              } else if (target.kind === "shipment") {
                api.setFilter("shipmentId", target.id);
              } else if (target.kind === "customer") {
                api.setFilter("customerId", target.id);
              } else {
                api.setFilter("itemTypeId", target.id);
              }
            }}
          />
        )}
      </div>
    </ClockInfoProvider>
  );
}

// ---------------------------------------------------------------------------

interface MetaCounts {
  stations: number | null;
  shipments: number | null;
  customers: number | null;
  types: number | null;
  activeItems: number | null;
  asOf: string | null;
}

function tabMeta(state: DashboardState, counts: MetaCounts): { title: string; subtitle: string } {
  switch (state.tab) {
    case "kpis":
      return { title: "מדדי ביצוע", subtitle: "מגמה מול התקופה הקודמת" };
    case "stations":
      return {
        title: "עומס עמדות",
        subtitle: counts.stations === null ? "בזמן אמת" : `בזמן אמת · ${counts.stations} עמדות`,
      };
    case "slow":
      return {
        title: "פריטים איטיים",
        subtitle:
          state.stuckHours === null
            ? "כל הפריטים שנמדדו בתקופה"
            : `מעל ${state.stuckHours} שעות במערכת`,
      };
    case "shipments":
      return {
        title: "מעקב משלוחים",
        subtitle:
          counts.shipments === null
            ? "משלוחים פתוחים"
            : `${counts.shipments} משלוחים פתוחים`,
      };
    case "times":
      return { title: "זמנים ממוצעים", subtitle: "המתנה מול ביצוע" };
    case "status":
      return {
        title: "התפלגות סטטוסים",
        subtitle:
          counts.activeItems === null
            ? "פריטים פעילים"
            : `${counts.activeItems} פריטים פעילים${
                counts.asOf ? ` · נכון ל-${formatClock(counts.asOf)}` : ""
              }`,
      };
    case "customers":
      return {
        title: "ביצועים לפי לקוח",
        subtitle: counts.customers === null ? "לקוחות" : `${counts.customers} לקוחות`,
      };
    case "types":
      return {
        title: "ביצועים לפי סוג פריט",
        subtitle: counts.types === null ? "סוגי פריט" : `${counts.types} סוגים`,
      };
    default:
      return { title: "סקירה", subtitle: `היום · ${formatLongDate(new Date())}` };
  }
}

/**
 * The ≤1100px tab row. The active pill is brought into view with `scrollBy`
 * on a delta measured with getBoundingClientRect — never `scrollIntoView`,
 * which scrolls every scrollable ancestor and would drag the page itself — and
 * never `scrollLeft` arithmetic, which assumes LTR: in this RTL scroller
 * `scrollLeft` runs from 0 down to negatives.
 */
function MobileNav({
  tab,
  onSelect,
  activeFilterCount,
  onOpenFilters,
}: {
  tab: TabKey;
  onSelect: (tab: TabKey) => void;
  activeFilterCount: number;
  onOpenFilters: () => void;
}) {
  const scroller = React.useRef<HTMLElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const box = scroller.current;
    const pill = activeRef.current;
    if (!box || !pill) return;
    // Viewport coordinates mean the same thing in RTL and LTR, and scrollBy
    // takes a physical delta, so the centring is direction-proof.
    const boxRect = box.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const delta = pillRect.left + pillRect.width / 2 - (boxRect.left + boxRect.width / 2);
    if (delta !== 0) box.scrollBy({ left: delta });
  }, [tab]);

  return (
    <div
      className="dash-mobile-nav"
      style={{ display: "none", alignItems: "center", gap: 8, flexShrink: 0 }}
    >
      <nav
        ref={scroller}
        aria-label="מקטעי הלוח"
        className="dash-scroll"
        style={{ flex: 1, minWidth: 0, display: "flex", gap: 6, overflowX: "auto", overflowY: "hidden", paddingBottom: 2 }}
      >
        {NAV_ITEMS.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-current={active ? "page" : undefined}
              className="dash-pill dash-tap"
            >
              <span className="dash-icon">
                <item.Icon fontSize={14} aria-hidden />
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        className="dash-pill dash-tap"
        style={{ fontWeight: 600 }}
      >
        <span className="dash-icon">
          <FilterList fontSize={14} aria-hidden />
        </span>
        מסננים
        {activeFilterCount > 0 && (
          <span
            style={{
              background: "var(--color-primary)",
              color: "var(--color-on-primary)",
              fontSize: "var(--text-micro)",
              fontWeight: 700,
              borderRadius: "var(--r-pill)",
              padding: "1px 6px",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The filter drawer behaves as the modal it looks like: focus moves into it
 * when it opens, Tab and Shift+Tab cycle inside it, Escape closes it, and
 * focus goes back to whatever opened it (the מסננים pill) when it closes.
 */
function useDrawerFocus(
  open: boolean,
  panelRef: React.RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  // The latest close, without re-running the effect (and refocusing) on every
  // render that hands in a new arrow.
  const closeRef = React.useRef(close);
  React.useEffect(() => {
    closeRef.current = close;
  }, [close]);

  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open, panelRef]);
}
