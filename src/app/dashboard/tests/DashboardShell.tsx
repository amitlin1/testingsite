"use client";

// §5 / §14 — the one page the eight old dashboard pages became.
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
import DashboardHeader from "@/app/components/dashboard/DashboardHeader";
import DashboardSidebar, { NAV_ITEMS } from "@/app/components/dashboard/DashboardSidebar";
import HistoryOverlay, { type HistoryTarget } from "@/app/components/dashboard/HistoryOverlay";
import TopStatsBar from "@/app/components/dashboard/TopStatsBar";
import type {
  CustomerWire,
  ItemTypeWire,
  KpisWire,
  ShipmentWire,
  SlowItemWire,
  StationWire,
  StatusWire,
} from "@/app/lib/dashboard/api-types";
import { formatClock, formatDayTick, formatLongDate } from "@/app/lib/dashboard/format";
import { activeChips, rangeIsComplete, useDashboardData } from "@/app/lib/hooks/useDashboardData";
import { useDashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import {
  useDashboardState,
  type DashboardState,
  type TabKey,
} from "@/app/lib/hooks/useDashboardState";
import type { DashboardFilters } from "@/types/dashboard";

import CustomersTab from "./tabs/CustomersTab";
import ItemTypesTab from "./tabs/ItemTypesTab";
import KpisTab from "./tabs/KpisTab";
import OverviewTab from "./tabs/OverviewTab";
import ShipmentsTab from "./tabs/ShipmentsTab";
import SlowItemsTab, { passesThreshold } from "./tabs/SlowItemsTab";
import StationsTab from "./tabs/StationsTab";
import StatusTab from "./tabs/StatusTab";
import TimesTab from "./tabs/TimesTab";
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

const DRAWER_QUERY = "(max-width: 1099px)";

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
  React.useEffect(() => {
    if (!isDrawerWidth) setDrawerOpen(false);
  }, [isDrawerWidth]);
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [api.state.tab]);

  const kpis = data.get<KpisWire>("kpis");
  const stations = data.get<StationWire[]>("stationsLive");
  const slow = data.get<SlowItemWire[]>("slow");
  const shipments = data.get<ShipmentWire[]>("shipments");
  const customers = data.get<CustomerWire[]>("customers");
  const types = data.get<ItemTypeWire[]>("types");
  const status = data.get<StatusWire[]>("status");

  // §7's fifth cell and the nav badge count the same thing: rows in the page
  // the server returned whose WALL wait has passed 48 hours.
  const stuckCount = React.useMemo(
    () =>
      slow.data === null
        ? null
        : slow.data.filter((row) => passesThreshold(row, 48)).length,
    [slow.data],
  );

  const chips = React.useMemo(
    () =>
      activeChips(api.state.filters, {
        customer: options.customers.find((c) => c.id === api.state.filters.customerId)?.name,
        shipment: findName(options.shipments, api.state.filters.shipmentId),
        itemType: options.itemTypes.find((t) => Number(t.id) === api.state.filters.itemTypeId)?.name,
        station: options.stations.find((s) => Number(s.id) === api.state.filters.testStationId)?.name,
        stationType: options.stationTypes.find(
          (s) => Number(s.id) === api.state.filters.testStationTypeId,
        )?.name,
      }),
    [api.state.filters, options],
  );

  const meta = tabMeta(api.state, {
    stations: stations.data?.length ?? null,
    shipments: shipments.data?.length ?? null,
    customers: customers.data?.length ?? null,
    types: types.data?.length ?? null,
    activeItems: status.data ? status.data.reduce((sum, s) => sum + s.count, 0) : null,
    asOf: status.data?.[0]?._new_asOf ?? null,
  });

  // §16.3 — when the server narrowed the window, the window it actually served
  // is shown rather than the one that was asked for.
  const capped = [kpis, stations, shipments, customers, status].find((r) => r.meta.capped)?.meta;

  const Tab = TAB_COMPONENTS[api.state.tab];

  const removeChip = (key: keyof DashboardFilters) => {
    if (key === "showAllHistory") api.setFilter("showAllHistory", false);
    else if (key === "status") api.setFilter("status", "all");
    else if (key === "itemSerial" || key === "workerId") api.setFilter(key, null);
    else api.setFilter(key as "customerId", null);
  };

  return (
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
        <div className="dash-refresh-bar" aria-hidden style={{ opacity: data.refreshing ? 1 : 0 }}>
          <span />
        </div>

        {!rangeIsComplete(api.state) && (
          <div
            style={{
              flexShrink: 0,
              fontSize: 11.5,
              color: "var(--dash-amber-ink)",
              background: "var(--dash-amber-tint)",
              border: "1px solid var(--dash-amber-hairline)",
              borderRadius: 8,
              padding: "5px 12px",
            }}
          >
            בחר תאריך התחלה ותאריך סיום · עד אז הנתונים אינם מתעדכנים
          </div>
        )}

        {capped && (
          <div
            style={{
              flexShrink: 0,
              fontSize: 11.5,
              color: "var(--dash-amber-ink)",
              background: "var(--dash-amber-tint)",
              border: "1px solid var(--dash-amber-hairline)",
              borderRadius: 8,
              padding: "5px 12px",
            }}
          >
            התקופה קוצרה על ידי השרת · הוצג {formatDayTick(capped.periodFrom ?? "")} –{" "}
            {formatDayTick(capped.periodTo ?? "")} במקום הטווח שהתבקש
          </div>
        )}

        {/* Below 1100px the rail is gone and the tabs become a scrollable pill
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
          onShowStuck={() => api.drillTo("slow", {}, { stuckHours: 48 })}
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
            background: "rgba(0,0,0,.28)",
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <div onClick={(event) => event.stopPropagation()} style={{ height: "100%" }}>
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
  );
}

// ---------------------------------------------------------------------------

function findName(raw: unknown[], id: number | null): string | undefined {
  if (id === null) return undefined;
  const match = (raw as Array<Record<string, unknown>>).find(
    (s) => Number(s.id ?? s.shipment_id) === id,
  );
  return match ? String(match.shipment_code ?? match.shipmentCode ?? id) : undefined;
}

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
 * The ≤1099px tab row. The active pill is brought into view with `scrollLeft`
 * arithmetic — never `scrollIntoView`, which scrolls every scrollable ancestor
 * and would drag the page itself.
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
  const scroller = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const box = scroller.current;
    const pill = activeRef.current;
    if (!box || !pill) return;
    box.scrollLeft = pill.offsetLeft - (box.clientWidth - pill.clientWidth) / 2;
  }, [tab]);

  return (
    <div
      className="dash-mobile-nav"
      style={{ display: "none", alignItems: "center", gap: 8, flexShrink: 0 }}
    >
      <div
        ref={scroller}
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
              className="dash-press dash-tap"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 13px",
                borderRadius: 9999,
                fontSize: 12.5,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                cursor: "pointer",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "var(--color-on-primary)" : "var(--color-ink-muted-80)",
                fontWeight: active ? 600 : 400,
                border: active ? "none" : "1px solid var(--color-hairline)",
              }}
            >
              <span className="dash-icon">
                <item.Icon fontSize={14} />
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onOpenFilters}
        className="dash-press dash-tap"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "var(--color-canvas)",
          border: "1px solid var(--color-hairline)",
          borderRadius: 9999,
          padding: "7px 13px",
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        <span className="dash-icon">
          <FilterList fontSize={14} />
        </span>
        מסננים
        {activeFilterCount > 0 && (
          <span
            style={{
              background: "var(--color-primary)",
              color: "var(--color-on-primary)",
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 9999,
              padding: "1px 6px",
            }}
          >
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
