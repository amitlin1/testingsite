"use client";
import * as React from "react";
import { Search, Plus } from "lucide-react";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";

/* =========================================================================
   ItemsToolbar — the search bar + filter dropdowns + "הוסף פריט" pill.
   Shifthouse-styled, RTL, flat (no MUI elevation). Drop-in replacement for
   the toolbar Paper in ItemTable.tsx.

   Filters use the unified <SearchableCombobox> (searchable) per the app-wide
   "one combobox" decision — the flat inline dropdown was a visual fallback.

   Requires: import "@/styles/shifthouse.css" once in the app.
   ========================================================================= */

export type FilterOption = { value: string; label: string };
export type FilterDef = {
  key: string;
  placeholder: string;      // shown when nothing selected, e.g. "סטטוס"
  value: string;            // current value ("" = none)
  options: FilterOption[];
  onChange: (value: string) => void;
  width?: number;
};

type Props = {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;
  filters: FilterDef[];
  onAdd: () => void;
  addLabel?: string;
};

export default function ItemsToolbar({
  search,
  onSearch,
  searchPlaceholder = "חיפוש לפי סריאלי, מק״ט, דגם או מזהה",
  filters,
  onAdd,
  addLabel = "הוסף פריט",
}: Props) {
  const anyFilter = search.trim() !== "" || filters.some((f) => f.value !== "");

  const clearAll = () => {
    onSearch("");
    filters.forEach((f) => f.onChange(""));
  };

  return (
    <div dir="rtl" style={{ position: "relative" }}>
      {/* header row: title + add button */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1 }}>ניהול פריטים</h1>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 16, color: "#444", lineHeight: 1.5 }}>
            כל הפריטים שנקלטו במערכת, הסטטוס וההתקדמות שלהם בתהליך הבדיקה.
          </p>
        </div>
        <button className="shx-btn shx-btn-primary" onClick={onAdd}>
          <Plus size={18} strokeWidth={2} />
          {addLabel}
        </button>
      </div>

      {/* filters row */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
        {/* search */}
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 340 }}>
          <span style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex", zIndex: 1 }}>
            <Search size={16} strokeWidth={1.75} />
          </span>
          <input
            className="shx-input"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ height: 42, borderRadius: 10, paddingInlineStart: 40, paddingInlineEnd: 14, fontSize: 14 }}
          />
        </div>

        {/* filter comboboxes (unified SearchableCombobox) */}
        {filters.map((f) => (
          <SearchableCombobox<FilterOption>
            key={f.key}
            options={f.options}
            value={f.options.find((o) => o.value === f.value) ?? null}
            onChange={(opt) => f.onChange(opt?.value ?? "")}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.value === b.value}
            placeholder={f.placeholder}
            width={f.width ?? 175}
          />
        ))}

        {anyFilter && (
          <button className="shx-btn-ghost-link" onClick={clearAll} style={{ height: 42 }}>נקה הכל</button>
        )}
      </div>
    </div>
  );
}
