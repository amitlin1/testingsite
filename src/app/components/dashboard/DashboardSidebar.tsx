"use client";

// §6 — section navigation and scope, in one rail.
//
// The rail owns the nine tabs and the filter set. It does NOT own the product
// title or the system navigation: those belong to the app shell's top bar and
// its own rail (§14.3), and duplicating a level is the thing that makes a
// dense screen unreadable.
//
// Collapsed (56px) it keeps the nine icons and puts a blue count badge on the
// filter button, so the manager can see that a scope is still applied even when
// the fields are hidden — and one press on it opens the rail again. The state
// is one localStorage key and survives a reload (§12.6).
//
// Every field has a real <label>; a text field that carries a value is told
// apart from a focused one (dashboard.css `.dash-field--set` vs `:focus`); the
// pickers are the app's SearchableCombobox (dense, 34px — one combobox across
// the app), whose value and × say a filter is on; the current tab is
// `aria-current="page"`; the switch is the app's ui Switch.

import * as React from "react";

import { Switch } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import {
  AccessTime,
  BarChart,
  Business,
  Category,
  ChevronLeft,
  ChevronRight,
  Dashboard,
  DonutLarge,
  FilterList,
  LocalShipping,
  Speed,
  Timer,
} from "@/components/ui/icons";
import type { SvgIconComponent } from "@/components/ui/icons";
import type { CustomerOption, DashboardFilters, DateRangePreset, Option, StatusFilter } from "@/types/dashboard";
import type { DashboardOptions } from "@/app/lib/hooks/useDashboardOptions";
import type { DashboardStateApi, TabKey } from "@/app/lib/hooks/useDashboardState";
import Segmented from "./Segmented";

export const NAV_ITEMS: Array<{ key: TabKey; label: string; Icon: SvgIconComponent }> = [
  { key: "overview", label: "סקירה", Icon: Dashboard },
  { key: "kpis", label: "מדדים", Icon: BarChart },
  { key: "stations", label: "עומס עמדות", Icon: Speed },
  { key: "slow", label: "פריטים איטיים", Icon: Timer },
  { key: "shipments", label: "משלוחים", Icon: LocalShipping },
  { key: "times", label: "זמנים ממוצעים", Icon: AccessTime },
  { key: "status", label: "התפלגות סטטוס", Icon: DonutLarge },
  { key: "customers", label: "לקוחות", Icon: Business },
  { key: "types", label: "סוגי פריט", Icon: Category },
];

const RANGES: Array<{ value: DateRangePreset; label: string }> = [
  { value: "today", label: "היום" },
  { value: "last7days", label: "7 ימים" },
  { value: "last30days", label: "30 ימים" },
  { value: "custom", label: "מותאם" },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "הכל" },
  { value: "queue", label: "בתור" },
  { value: "processing", label: "בבדיקה" },
  { value: "finished", label: "הסתיים" },
];

/** Which contextual filters a tab appends (§6). */
type ExtraKey = "station" | "stationType" | "worker" | "serial" | "status" | "shipmentScope";

const EXTRAS: Record<TabKey, ExtraKey[]> = {
  overview: ["station", "status"],
  kpis: ["stationType", "status"],
  stations: ["stationType", "station", "worker"],
  slow: ["station", "serial", "worker"],
  shipments: ["shipmentScope"],
  times: ["station", "stationType", "worker"],
  status: ["station"],
  customers: ["status"],
  types: ["station", "status"],
};

export interface DashboardSidebarProps {
  api: DashboardStateApi;
  options: DashboardOptions;
  stuckCount: number | null;
  /** Rendered as a drawer at <=1099px instead of a rail. */
  drawer?: boolean;
  onCloseDrawer?: () => void;
}

export default function DashboardSidebar({
  api,
  options,
  stuckCount,
  drawer = false,
  onCloseDrawer,
}: DashboardSidebarProps) {
  const { state, setTab, setDatePreset, setCustomRange, setFilter, clearFilters, toggleRail } = api;
  const open = drawer || state.railOpen;
  // The rail and the drawer can be mounted at once (the rail is only hidden by
  // CSS below 1100px), so every id is per instance.
  const uid = React.useId();
  const id = (name: string) => `${uid}-${name}`;

  if (!open) {
    return (
      <div
        className="dash-rail"
        style={{
          width: 56,
          flexShrink: 0,
          background: "var(--color-canvas)",
          borderInlineEnd: "1px solid var(--color-hairline)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 0",
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={toggleRail}
          aria-label="הרחבת סרגל הלוח"
          title="הרחבת סרגל הלוח"
          className="dash-icon-btn"
        >
          <ChevronLeft fontSize={16} aria-hidden />
        </button>
        <div aria-hidden style={{ width: 24, height: 1, background: "var(--color-hairline)", margin: "6px 0" }} />
        <nav aria-label="מקטעי הלוח" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          {NAV_ITEMS.map((item) => {
            const active = item.key === state.tab;
            const stuck = item.key === "slow" && (stuckCount ?? 0) > 0;
            return (
              <button
                key={item.key}
                type="button"
                title={item.label}
                aria-label={stuck ? `${item.label} · ${stuckCount} תקועים` : item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(item.key)}
                className="dash-icon-btn"
              >
                <item.Icon fontSize={16} aria-hidden />
                {stuck && (
                  <span aria-hidden style={badgeStyle("var(--color-destructive)")}>{stuckCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        {/* Filters are hidden in this state; the button says how many are on
            and opens the rail to show them. */}
        <div style={{ marginTop: "auto" }}>
          <button
            type="button"
            onClick={toggleRail}
            title="מסננים"
            aria-label={
              api.activeFilterCount > 0
                ? `מסננים · ${api.activeFilterCount} פעילים — הרחבת הסרגל`
                : "מסננים — הרחבת הסרגל"
            }
            className="dash-icon-btn"
          >
            <FilterList fontSize={16} aria-hidden />
            {api.activeFilterCount > 0 && (
              <span aria-hidden style={badgeStyle("var(--color-primary)")}>{api.activeFilterCount}</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={drawer ? undefined : "dash-rail"}
      style={{
        width: drawer ? 300 : 248,
        flexShrink: 0,
        background: "var(--color-canvas)",
        borderInlineEnd: "1px solid var(--color-hairline)",
        display: "flex",
        flexDirection: "column",
        padding: "14px 12px",
        gap: 12,
        overflow: "hidden",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
        <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 700 }}>לוח בדיקות</div>
        <button
          type="button"
          onClick={drawer ? onCloseDrawer : toggleRail}
          aria-label={drawer ? "סגירת המסננים" : "כיווץ סרגל הלוח"}
          title={drawer ? "סגירת המסננים" : "כיווץ סרגל הלוח"}
          className="dash-icon-btn dash-icon-btn--sm"
        >
          <ChevronRight fontSize={15} aria-hidden />
        </button>
      </div>

      <nav aria-label="מקטעי הלוח" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.key === state.tab;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setTab(item.key);
                onCloseDrawer?.();
              }}
              className="dash-nav-item dash-tap"
            >
              <span className="dash-icon">
                <item.Icon fontSize={16} aria-hidden />
              </span>
              {item.label}
              {item.key === "slow" && (stuckCount ?? 0) > 0 && (
                <span
                  style={{
                    marginInlineStart: "auto",
                    background: "var(--color-destructive)",
                    color: "var(--color-on-primary)",
                    fontSize: "var(--text-micro)",
                    fontWeight: 700,
                    borderRadius: "var(--r-pill)",
                    padding: "1px 6px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {stuckCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div aria-hidden style={{ height: 1, background: "var(--color-hairline)" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="dash-icon" style={{ color: "var(--color-ink-muted-48)" }}>
            <FilterList fontSize={13} aria-hidden />
          </span>
          <div style={{ fontSize: "var(--text-fine)", fontWeight: 700, color: "var(--color-ink-muted-48)" }}>מסננים</div>
          {api.activeFilterCount > 0 && (
            <span
              style={{
                background: "var(--dash-tint)",
                color: "var(--color-primary)",
                fontSize: "var(--text-micro)",
                fontWeight: 700,
                borderRadius: "var(--r-pill)",
                padding: "1px 6px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {api.activeFilterCount}
            </span>
          )}
        </div>
        <button type="button" onClick={clearFilters} className="dash-link">
          נקה הכל
        </button>
      </div>

      <div
        className="dash-scroll"
        style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 2px" }}
      >
        <div>
          <div className="dash-field-label" aria-hidden>טווח תאריכים</div>
          <Segmented
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            value={state.datePreset}
            onChange={(value) => setDatePreset(value as DateRangePreset)}
            padding="5px 0"
            ariaLabel="טווח תאריכים"
          />
        </div>

        {state.datePreset === "custom" && (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="date"
              value={state.customStart}
              onChange={(e) => setCustomRange(e.target.value, state.customEnd)}
              className={fieldClass(Boolean(state.customStart))}
              style={{ flex: 1, fontVariantNumeric: "tabular-nums" }}
              aria-label="מתאריך"
            />
            <input
              type="date"
              value={state.customEnd}
              onChange={(e) => setCustomRange(state.customStart, e.target.value)}
              className={fieldClass(Boolean(state.customEnd))}
              style={{ flex: 1, fontVariantNumeric: "tabular-nums" }}
              aria-label="עד תאריך"
            />
          </div>
        )}

        <ComboField
          id={id("customer")}
          label="לקוח"
          value={state.filters.customerId}
          onChange={(v) => setFilter("customerId", v)}
          placeholder="כל הלקוחות"
          options={options.customers.map((c: CustomerOption) => ({ id: c.id, name: c.name }))}
        />

        <ComboField
          id={id("shipment")}
          label="משלוח"
          value={state.filters.shipmentId}
          onChange={(v) => setFilter("shipmentId", v)}
          placeholder="כל המשלוחים"
          options={shipmentOptions(options.shipments, state.filters.showAllHistory === true)}
        />

        <ComboField
          id={id("type")}
          label="סוג פריט"
          value={state.filters.itemTypeId}
          onChange={(v) => setFilter("itemTypeId", v)}
          placeholder="הכל"
          options={options.itemTypes.map((t: Option) => ({ id: Number(t.id), name: t.name }))}
        />

        {EXTRAS[state.tab].includes("stationType") && (
          <ComboField
            id={id("stationType")}
            label="סוג עמדה"
            value={state.filters.testStationTypeId}
            onChange={(v) => setFilter("testStationTypeId", v)}
            placeholder="הכל"
            options={options.stationTypes.map((t: Option) => ({ id: Number(t.id), name: t.name }))}
          />
        )}

        {EXTRAS[state.tab].includes("station") && (
          <ComboField
            id={id("station")}
            label="עמדה"
            value={state.filters.testStationId}
            onChange={(v) => setFilter("testStationId", v)}
            placeholder="כל העמדות"
            options={options.stations.map((s: Option) => ({ id: Number(s.id), name: s.name }))}
          />
        )}

        {EXTRAS[state.tab].includes("worker") && (
          <TextField
            id={id("worker")}
            label="מס׳ עובד"
            value={state.filters.workerId ?? ""}
            onChange={(v) => setFilter("workerId", v || null)}
            placeholder="חיפוש…"
          />
        )}

        {EXTRAS[state.tab].includes("serial") && (
          <TextField
            id={id("serial")}
            label="סריאלי"
            value={state.filters.itemSerial ?? ""}
            onChange={(v) => setFilter("itemSerial", v || null)}
            placeholder="חיפוש…"
            ltr
          />
        )}

        {EXTRAS[state.tab].includes("status") && (
          // "all" is no filter: the empty field (its placeholder), cleared by ×.
          <ComboField
            id={id("status")}
            label="סטטוס"
            value={state.filters.status === "all" ? null : state.filters.status}
            onChange={(v) => setFilter("status", (v ?? "all") as StatusFilter)}
            placeholder="הכל"
            options={STATUS_OPTIONS.filter((s) => s.value !== "all").map((s) => ({ id: s.value, name: s.label }))}
          />
        )}

        {EXTRAS[state.tab].includes("shipmentScope") && (
          <ComboField
            id={id("scope")}
            label="סטטוס משלוח"
            value={state.filters.showAllHistory ? "all" : "open"}
            onChange={(v) => setFilter("showAllHistory", v === "all")}
            placeholder="פתוחים בלבד"
            options={[
              { id: "open", name: "פתוחים בלבד" },
              { id: "all", name: "הכל" },
            ]}
            required
          />
        )}

        {/* The app's Switch (focus ring, 3:1 off track, the RTL thumb travel
            every other switch uses), named by its label. */}
        <div
          className="dash-tap"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 2 }}
        >
          <label htmlFor={id("sent")} style={{ fontSize: "var(--text-fine)", cursor: "pointer" }}>
            כלול משלוחים שנשלחו
          </label>
          <Switch
            id={id("sent")}
            checked={state.filters.showAllHistory === true}
            onChange={(_, checked) => setFilter("showAllHistory", checked)}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: "var(--text-fine)",
          color: "var(--color-ink-muted-48)",
          padding: "0 2px",
        }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: "var(--r-pill)", background: "var(--color-status-approved)" }}
        />
        רענון אוטומטי · כל דקה
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function badgeStyle(background: string): React.CSSProperties {
  return {
    position: "absolute",
    top: 1,
    insetInlineEnd: 1,
    background,
    color: "var(--color-on-primary)",
    fontSize: "var(--text-micro)",
    fontWeight: 700,
    borderRadius: "var(--r-pill)",
    padding: "0 4px",
    lineHeight: "14px",
    fontVariantNumeric: "tabular-nums",
  };
}

/** A field carrying a value gets the "set" look (soft-blue fill, bold ink) —
 *  never the focus blue, so a focused field and a filled one differ (§6). */
function fieldClass(set: boolean): string {
  return set ? "dash-field dash-field--set" : "dash-field";
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="dash-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A picker of the rail: the app's SearchableCombobox (type to filter, the
 * shared list and check), dense at 34px to sit in the 248px rail. Empty =
 * no filter, its placeholder says what that means ("כל הלקוחות"); × clears it.
 * `required` pickers always hold a value and have no ×.
 */
function ComboField<K extends string | number>({
  id,
  label,
  value,
  onChange,
  placeholder,
  options,
  required = false,
}: {
  id: string;
  label: string;
  value: K | null;
  onChange: (value: K | null) => void;
  placeholder: string;
  options: Array<{ id: K; name: string }>;
  required?: boolean;
}) {
  return (
    <Field id={id} label={label}>
      <SearchableCombobox<{ id: K; name: string }>
        id={id}
        options={options}
        value={options.find((o) => o.id === value) ?? null}
        onChange={(o) => onChange(o ? o.id : null)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        placeholder={placeholder}
        dense
        denseHeight={34}
        disableClearable={required}
      />
    </Field>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  ltr = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Codes (serials) are typed left to right, aligned with the Hebrew fields. */
  ltr?: boolean;
}) {
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass(value !== "")}
        dir={ltr ? "ltr" : undefined}
        style={ltr ? { textAlign: "right" } : undefined}
      />
    </Field>
  );
}

interface RawShipment {
  id?: number;
  shipment_id?: number;
  shipment_code?: string;
  shipmentCode?: string;
  is_sent?: boolean | null;
}

/**
 * `is_sent` is nullable, and a NULL shipment is an OPEN one — the same
 * `IS NOT TRUE` the ledger uses (§5.0(1)). `=== false` would drop every
 * raw-SQL-written shipment from this list exactly as it used to drop them from
 * the numbers.
 */
function shipmentOptions(raw: unknown[], showSent: boolean): Array<{ id: number; name: string }> {
  return (raw as RawShipment[])
    .filter((s) => showSent || s.is_sent !== true)
    .map((s) => ({
      id: Number(s.id ?? s.shipment_id ?? 0),
      name: String(s.shipment_code ?? s.shipmentCode ?? s.id ?? ""),
    }))
    .filter((s) => Number.isFinite(s.id) && s.id > 0);
}

export type { DashboardFilters };
