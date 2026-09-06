"use client";

// §6 — section navigation and scope, in one rail.
//
// The rail owns the nine tabs and the filter set. It does NOT own the product
// title or the system navigation: those belong to the app shell's top bar and
// its own rail (§14.3), and duplicating a level is the thing that makes a
// dense screen unreadable.
//
// Collapsed (56px) it keeps the nine icons and puts a blue count badge on the
// filter glyph, so the manager can see that a scope is still applied even when
// the fields are hidden. The state is one localStorage key and survives a
// reload (§12.6).

import * as React from "react";

import {
  AccessTime,
  ArrowDropDown,
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
          className="dash-press dash-icon"
          style={iconButtonStyle(false)}
        >
          <ChevronLeft fontSize={16} />
        </button>
        <div style={{ width: 24, height: 1, background: "var(--color-hairline)", margin: "6px 0" }} />
        {NAV_ITEMS.map((item) => {
          const active = item.key === state.tab;
          return (
            <button
              key={item.key}
              type="button"
              title={item.label}
              aria-label={item.label}
              onClick={() => setTab(item.key)}
              className={active ? "dash-icon" : "dash-icon dash-nav-item"}
              style={{ ...iconButtonStyle(active), position: "relative" }}
            >
              <item.Icon fontSize={16} />
              {item.key === "slow" && (stuckCount ?? 0) > 0 && (
                <span style={badgeStyle("var(--color-destructive)")}>{stuckCount}</span>
              )}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", position: "relative" }}>
          <div className="dash-icon" style={iconButtonStyle(false)} title="מסננים">
            <FilterList fontSize={16} />
            {api.activeFilterCount > 0 && (
              <span style={badgeStyle("var(--color-primary)")}>{api.activeFilterCount}</span>
            )}
          </div>
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
        <div style={{ fontSize: 14, fontWeight: 700 }}>לוח בדיקות</div>
        <button
          type="button"
          onClick={drawer ? onCloseDrawer : toggleRail}
          aria-label={drawer ? "סגירת המסננים" : "כיווץ סרגל הלוח"}
          className="dash-press dash-icon"
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "var(--color-canvas-parchment)",
            color: "var(--color-ink-muted-48)",
            border: "none",
            cursor: "pointer",
          }}
        >
          <ChevronRight fontSize={15} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.key === state.tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key);
                onCloseDrawer?.();
              }}
              className={active ? "dash-tap" : "dash-nav-item dash-tap"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "6px 10px",
                borderRadius: 8,
                border: "none",
                width: "100%",
                fontFamily: "inherit",
                fontSize: 13,
                textAlign: "start",
                cursor: "pointer",
                background: active ? "var(--dash-tint)" : "transparent",
                color: active ? "var(--color-primary)" : "var(--color-ink-muted-80)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span className="dash-icon">
                <item.Icon fontSize={16} />
              </span>
              {item.label}
              {item.key === "slow" && (stuckCount ?? 0) > 0 && (
                <span
                  style={{
                    marginInlineStart: "auto",
                    background: "var(--color-destructive)",
                    color: "var(--color-on-primary)",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 9999,
                    padding: "1px 6px",
                  }}
                >
                  {stuckCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ height: 1, background: "var(--color-hairline)" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="dash-icon" style={{ color: "var(--color-ink-muted-48)" }}>
            <FilterList fontSize={13} />
          </span>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-muted-48)" }}>מסננים</div>
          {api.activeFilterCount > 0 && (
            <span
              style={{
                background: "var(--dash-tint)",
                color: "var(--color-primary)",
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 9999,
                padding: "1px 6px",
              }}
            >
              {api.activeFilterCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={clearFilters}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "inherit",
            fontSize: 11.5,
            color: "var(--color-primary)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          נקה הכל
        </button>
      </div>

      <div
        className="dash-scroll"
        style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 2px" }}
      >
        <Field label="טווח תאריכים">
          <Segmented
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            value={state.datePreset}
            onChange={(value) => setDatePreset(value as DateRangePreset)}
            padding="5px 0"
          />
        </Field>

        {state.datePreset === "custom" && (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="date"
              value={state.customStart}
              onChange={(e) => setCustomRange(e.target.value, state.customEnd)}
              style={inputStyle(Boolean(state.customStart))}
              aria-label="מתאריך"
            />
            <input
              type="date"
              value={state.customEnd}
              onChange={(e) => setCustomRange(state.customStart, e.target.value)}
              style={inputStyle(Boolean(state.customEnd))}
              aria-label="עד תאריך"
            />
          </div>
        )}

        <SelectField
          label="לקוח"
          value={state.filters.customerId}
          onChange={(v) => setFilter("customerId", v)}
          placeholder="כל הלקוחות"
          options={options.customers.map((c: CustomerOption) => ({ id: c.id, name: c.name }))}
        />

        <SelectField
          label="משלוח"
          value={state.filters.shipmentId}
          onChange={(v) => setFilter("shipmentId", v)}
          placeholder="כל המשלוחים"
          options={shipmentOptions(options.shipments, state.filters.showAllHistory === true)}
        />

        <SelectField
          label="סוג פריט"
          value={state.filters.itemTypeId}
          onChange={(v) => setFilter("itemTypeId", v)}
          placeholder="הכל"
          options={options.itemTypes.map((t: Option) => ({ id: Number(t.id), name: t.name }))}
        />

        {EXTRAS[state.tab].includes("stationType") && (
          <SelectField
            label="סוג עמדה"
            value={state.filters.testStationTypeId}
            onChange={(v) => setFilter("testStationTypeId", v)}
            placeholder="הכל"
            options={options.stationTypes.map((t: Option) => ({ id: Number(t.id), name: t.name }))}
          />
        )}

        {EXTRAS[state.tab].includes("station") && (
          <SelectField
            label="עמדה"
            value={state.filters.testStationId}
            onChange={(v) => setFilter("testStationId", v)}
            placeholder="כל העמדות"
            options={options.stations.map((s: Option) => ({ id: Number(s.id), name: s.name }))}
          />
        )}

        {EXTRAS[state.tab].includes("worker") && (
          <TextField
            label="מס׳ עובד"
            value={state.filters.workerId ?? ""}
            onChange={(v) => setFilter("workerId", v || null)}
            placeholder="חיפוש…"
          />
        )}

        {EXTRAS[state.tab].includes("serial") && (
          <TextField
            label="סריאלי"
            value={state.filters.itemSerial ?? ""}
            onChange={(v) => setFilter("itemSerial", v || null)}
            placeholder="חיפוש…"
          />
        )}

        {EXTRAS[state.tab].includes("status") && (
          <Field label="סטטוס">
            <NativeSelect
              value={state.filters.status}
              set={state.filters.status !== "all"}
              onChange={(v) => setFilter("status", v as StatusFilter)}
              items={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            />
          </Field>
        )}

        {EXTRAS[state.tab].includes("shipmentScope") && (
          <Field label="סטטוס משלוח">
            <NativeSelect
              value={state.filters.showAllHistory ? "all" : "open"}
              set={state.filters.showAllHistory === true}
              onChange={(v) => setFilter("showAllHistory", v === "all")}
              items={[
                { value: "open", label: "פתוחים בלבד" },
                { value: "all", label: "הכל" },
              ]}
            />
          </Field>
        )}

        <div
          className="dash-tap"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 2 }}
        >
          <div style={{ fontSize: 12 }}>כלול משלוחים שנשלחו</div>
          <button
            type="button"
            role="switch"
            aria-checked={state.filters.showAllHistory === true}
            aria-label="כלול משלוחים שנשלחו"
            onClick={() => setFilter("showAllHistory", !state.filters.showAllHistory)}
            style={{
              width: 32,
              height: 19,
              borderRadius: 9999,
              border: "none",
              padding: 0,
              cursor: "pointer",
              position: "relative",
              background: state.filters.showAllHistory
                ? "var(--color-primary)"
                : "var(--color-hairline)",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                insetInlineEnd: state.filters.showAllHistory ? 15 : 2,
                width: 15,
                height: 15,
                borderRadius: 9999,
                background: "var(--color-canvas)",
                transition: "inset-inline-end 120ms var(--ease-press)",
              }}
            />
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontSize: 11.5,
          color: "var(--color-ink-muted-48)",
          padding: "0 2px",
        }}
      >
        <span
          style={{ width: 6, height: 6, borderRadius: 9999, background: "var(--color-status-approved)" }}
        />
        רענון אוטומטי · כל דקה
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function iconButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--dash-tint)" : "transparent",
    color: active ? "var(--color-primary)" : "var(--color-ink-muted-48)",
  };
}

function badgeStyle(background: string): React.CSSProperties {
  return {
    position: "absolute",
    top: 2,
    insetInlineEnd: 2,
    background,
    color: "var(--color-on-primary)",
    fontSize: 9,
    fontWeight: 700,
    borderRadius: 9999,
    padding: "0 4px",
    lineHeight: "13px",
  };
}

function inputStyle(set: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    height: 32,
    border: `1px solid ${set ? "var(--color-primary-focus)" : "var(--color-hairline)"}`,
    borderRadius: 8,
    padding: "0 9px",
    fontSize: 12.5,
    fontFamily: "inherit",
    color: set ? "var(--color-primary)" : "var(--color-ink)",
    background: "var(--color-canvas)",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--color-ink-muted-48)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

/** A filter carrying a value gets the focus-blue border and blue text (§6). */
function NativeSelect({
  value,
  set,
  onChange,
  items,
}: {
  value: string;
  set: boolean;
  onChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
}) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 32,
          border: `1px solid ${set ? "var(--color-primary-focus)" : "var(--color-hairline)"}`,
          borderRadius: 8,
          padding: "0 9px",
          paddingInlineEnd: 28,
          fontSize: 12.5,
          fontWeight: set ? 600 : 400,
          fontFamily: "inherit",
          color: set ? "var(--color-primary)" : "var(--color-ink-muted-48)",
          background: "var(--color-canvas)",
          appearance: "none",
          cursor: "pointer",
        }}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <span
        className="dash-icon"
        style={{
          position: "absolute",
          insetInlineStart: 9,
          top: 9,
          color: "var(--color-ink-muted-48)",
          pointerEvents: "none",
        }}
      >
        <ArrowDropDown fontSize={14} />
      </span>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder: string;
  options: Array<{ id: number; name: string }>;
}) {
  return (
    <Field label={label}>
      <NativeSelect
        value={value === null ? "" : String(value)}
        set={value !== null}
        onChange={(v) => onChange(v === "" ? null : Number(v))}
        items={[
          { value: "", label: placeholder },
          ...options.map((o) => ({ value: String(o.id), label: o.name })),
        ]}
      />
    </Field>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle(value !== ""), width: "100%" }}
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
