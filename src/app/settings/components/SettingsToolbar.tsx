"use client";
import * as React from "react";
import { Search, Plus } from "lucide-react";

/* =========================================================================
   SettingsToolbar — the Items/Shipments-style page header for /settings/*.

   One header row: large left-aligned (RTL: right) title + optional neutral
   count pill, with the blue primary "add" pill on the opposite end. Then an
   optional inline filters/search row beneath it.

   Replaces the old centered PageHeader across the settings pages so they use
   the exact same visual language as the Items and Shipments pages.

   Requires: import "@/styles/shifthouse.css" once in the app (done in layout).
   ========================================================================= */

type Props = {
  title: string;
  subtitle?: string;
  /** When set, renders a neutral count pill beside the title (e.g. "12 לקוחות"). */
  count?: number;
  /** Plural noun for the count pill, e.g. "לקוחות". Pill shows "{count} {countLabel}". */
  countLabel?: string;
  onAdd?: () => void;
  addLabel?: string;
  /** Search field — omit both to hide the whole filters row. */
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  /** Extra filter controls placed in the filters row after the search field. */
  children?: React.ReactNode;
};

export default function SettingsToolbar({
  title,
  subtitle,
  count,
  countLabel,
  onAdd,
  addLabel = "הוסף",
  search,
  onSearch,
  searchPlaceholder = "חיפוש...",
  children,
}: Props) {
  const showSearch = onSearch != null;
  const showFilters = showSearch || children != null;

  return (
    <div dir="rtl" style={{ flexShrink: 0 }}>
      {/* header row: title (+ count pill) on one side, add pill on the other */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1, color: "#1d1d1f" }}>
              {title}
            </h1>
            {count != null && (
              <span
                style={{
                  fontSize: 13,
                  color: "#7a7a7a",
                  background: "#f5f5f7",
                  border: "1px solid #e0e0e0",
                  borderRadius: 9999,
                  padding: "4px 11px",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {count}
                {countLabel ? ` ${countLabel}` : ""}
              </span>
            )}
          </div>
          {subtitle && (
            <p style={{ margin: "8px 0 0", fontSize: 16, color: "#444", lineHeight: 1.5 }}>{subtitle}</p>
          )}
        </div>
        {onAdd && (
          <button className="shx-btn shx-btn-primary" onClick={onAdd}>
            <Plus size={18} strokeWidth={2} />
            {addLabel}
          </button>
        )}
      </div>

      {/* filters row */}
      {showFilters && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
          {showSearch && (
            <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 340 }}>
              <span style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex", zIndex: 1 }}>
                <Search size={16} strokeWidth={1.75} />
              </span>
              <input
                className="shx-input"
                value={search ?? ""}
                onChange={(e) => onSearch?.(e.target.value)}
                placeholder={searchPlaceholder}
                style={{ height: 42, borderRadius: 10, paddingInlineStart: 40, paddingInlineEnd: 14, fontSize: 14 }}
              />
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
