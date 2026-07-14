"use client";
import * as React from "react";
import { Search, ChevronDown, Plus, Check } from "lucide-react";

/* =========================================================================
   ItemsToolbar — the search bar + filter dropdowns + "הוסף פריט" pill.
   Shifthouse-styled, RTL, flat (no MUI elevation). Drop-in replacement for
   the toolbar Paper in ItemTable.tsx.

   Requires: import "@/styles/shifthouse.css" once in the app.
   ========================================================================= */

export type FilterOption = { value: string; label: string };
export type FilterDef = {
  key: string;
  placeholder: string;      // shown when nothing selected, e.g. "סטטוס"
  value: string;            // current value ("" = none)
  options: FilterOption[];
  onChange: (value: string) => void;
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
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const anyFilter = search.trim() !== "" || filters.some((f) => f.value !== "");

  const clearAll = () => {
    onSearch("");
    filters.forEach((f) => f.onChange(""));
    setOpenKey(null);
  };

  return (
    <div dir="rtl" style={{ position: "relative" }}>
      {/* header row: title chip + add button */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1 }}>ניהול פריטים</h1>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 16, color: "#444", lineHeight: 1.5 }}>
            כל הפריטים שנקלטו במערכת, הסטטוס וההתקדמות שלהם בתהליך הבדיקה.
          </p>
        </div>
        <button className="sh-btn sh-btn-primary" onClick={onAdd}>
          <Plus size={18} strokeWidth={2} />
          {addLabel}
        </button>
      </div>

      {/* filters row */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 24 }}>
        {/* search */}
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 340 }}>
          <span style={{ position: "absolute", insetInlineStart: 14, top: "50%", transform: "translateY(-50%)", color: "#7a7a7a", pointerEvents: "none", display: "flex" }}>
            <Search size={16} strokeWidth={1.75} />
          </span>
          <input
            className="sh-input"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            style={{ height: 42, borderRadius: 10, paddingInlineStart: 40, paddingInlineEnd: 14, fontSize: 14 }}
          />
        </div>

        {/* filter dropdowns */}
        {filters.map((f) => {
          const open = openKey === f.key;
          const selected = f.options.find((o) => o.value === f.value);
          return (
            <div key={f.key} style={{ position: "relative" }}>
              <button
                onClick={() => setOpenKey(open ? null : f.key)}
                style={{
                  height: 42, display: "inline-flex", alignItems: "center", gap: 10,
                  border: `1px solid ${open ? "#0071e3" : "#e0e0e0"}`, borderRadius: 10, background: "#fff",
                  padding: "0 14px", fontSize: 14, color: "#1d1d1f", cursor: "pointer", minWidth: 155, justifyContent: "space-between",
                }}
              >
                <span style={{ color: selected ? "#1d1d1f" : "#7a7a7a", fontWeight: selected ? 600 : 400 }}>
                  {selected ? selected.label : f.placeholder}
                </span>
                <ChevronDown size={15} strokeWidth={1.75} color="#7a7a7a" />
              </button>
              {open && (
                <div className="sh-scroll" style={{ position: "absolute", zIndex: 25, top: "calc(100% + 6px)", insetInlineStart: 0, minWidth: "100%", background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, boxShadow: "rgba(0,0,0,0.12) 0 10px 34px 0", overflow: "hidden", maxHeight: 300, overflowY: "auto", whiteSpace: "nowrap" }}>
                  {[{ value: "", label: f.placeholder.startsWith("כל") ? f.placeholder : `כל ה${f.placeholder}` }, ...f.options].map((o) => {
                    const on = o.value === f.value;
                    return (
                      <div
                        key={o.value}
                        onClick={() => { f.onChange(o.value); setOpenKey(null); }}
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 16px", fontSize: 14, cursor: "pointer", borderTop: "1px solid #f0f0f0", background: on ? "#f3f8ff" : "#fff" }}
                        onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLDivElement).style.background = "#f5f5f7"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = on ? "#f3f8ff" : "#fff"; }}
                      >
                        <span style={{ width: 14, display: "flex", color: "#0066cc" }}>{on ? <Check size={14} strokeWidth={2.2} /> : null}</span>
                        {o.label}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {anyFilter && (
          <button className="sh-btn-ghost-link" onClick={clearAll} style={{ height: 42 }}>נקה הכל</button>
        )}
      </div>

      {/* click-away */}
      {openKey && <div onClick={() => setOpenKey(null)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />}
    </div>
  );
}
