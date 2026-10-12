"use client";
import * as React from "react";
import { Search, Plus } from "lucide-react";
import { Button, TextField } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import "./items.css";

/* =========================================================================
   ItemsToolbar — the ניהול פריטים header: the page title and its one primary
   action first, then an optional summary (the KPI strip) under them, then
   the search + filter row.

   The filter row is one field vocabulary: the search box is the same
   TextField the comboboxes are built from (40px, --r-field, 15px), so every
   control in the row has one height, one radius and one type size. Each
   control has an accessible name — their visible cue is only a placeholder.

   Filters use the unified <SearchableCombobox> (searchable) per the app-wide
   "one combobox" decision.
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
  /** Rendered between the title row and the filters (the KPI strip). */
  summary?: React.ReactNode;
};

export default function ItemsToolbar({
  search,
  onSearch,
  searchPlaceholder = "חיפוש לפי סריאלי, מק״ט, דגם או מזהה",
  filters,
  onAdd,
  addLabel = "הוסף פריט",
  summary,
}: Props) {
  const anyFilter = search.trim() !== "" || filters.some((f) => f.value !== "");
  const idBase = React.useId();

  const clearAll = () => {
    onSearch("");
    filters.forEach((f) => f.onChange(""));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      {/* header row: title + the page's primary action */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-ml)", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-page)", fontWeight: 700, letterSpacing: "var(--ls-display)", lineHeight: 1.1 }}>
            ניהול פריטים
          </h1>
          <p style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--text-body)", color: "var(--color-ink-muted-70)", lineHeight: "var(--lh-body)" }}>
            כל הפריטים שנקלטו במערכת, הסטטוס וההתקדמות שלהם בתהליך הבדיקה.
          </p>
        </div>
        <Button onClick={onAdd} startIcon={<Plus size={18} strokeWidth={2} aria-hidden />}>
          {addLabel}
        </Button>
      </div>

      {summary}

      {/* filters row — one height (40), one radius (--r-field), one type size */}
      <div role="search" aria-label="סינון פריטים" style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 240, maxWidth: 340 }}>
          <TextField
            fullWidth
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="חיפוש פריטים"
            InputProps={{ startAdornment: <Search size={16} strokeWidth={1.75} aria-hidden /> }}
          />
        </div>

        {/* filter comboboxes (unified SearchableCombobox); the hidden label
            names each one, since the placeholder vanishes once a value is set */}
        {filters.map((f) => {
          const id = `${idBase}-${f.key}`;
          return (
            <div key={f.key}>
              <label htmlFor={id} className="items-vh">{`סינון לפי ${f.placeholder}`}</label>
              <SearchableCombobox<FilterOption>
                id={id}
                options={f.options}
                value={f.options.find((o) => o.value === f.value) ?? null}
                onChange={(opt) => f.onChange(opt?.value ?? "")}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(a, b) => a.value === b.value}
                placeholder={f.placeholder}
                width={f.width ?? 175}
              />
            </div>
          );
        })}

        {anyFilter && (
          <Button variant="text" onClick={clearAll}>נקה הכל</Button>
        )}
      </div>
    </div>
  );
}
