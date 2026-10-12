"use client";
import * as React from "react";
import { Plus } from "lucide-react";
import { Button, SearchInput } from "@/components/ui";
import "../settings.css";

/* =========================================================================
   SettingsToolbar — THE page header for /settings/* (and /files).

   Settings.dc.html: a 30/700 <h1> (--text-page) with a 15px muted subtitle,
   an optional neutral count pill beside the title, and the blue primary
   "add" pill at the inline end. Then an optional filters row (SearchInput +
   the page's own filter controls) beneath it.

   One header for every settings page, so the title, its size and the action
   look the same wherever you are. Styles: settings.css `.settings-header*`.
   ========================================================================= */

type Props = {
  title: string;
  subtitle?: string;
  /** When set, renders a neutral count pill beside the title (e.g. "12 לקוחות"). */
  count?: number;
  /** Plural noun for the count pill, e.g. "לקוחות". Pill shows "{count} {countLabel}". */
  countLabel?: string;
  /** Free-form pill text instead of `count` (e.g. "3 מתוך 12"). */
  countText?: string;
  onAdd?: () => void;
  addLabel?: string;
  /** Extra header actions, placed before the add pill. */
  actions?: React.ReactNode;
  /** Search field — omit both to hide the search. */
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
  countText,
  onAdd,
  addLabel = "הוסף",
  actions,
  search,
  onSearch,
  searchPlaceholder = "חיפוש…",
  children,
}: Props) {
  const showSearch = onSearch != null;
  const showFilters = showSearch || children != null;
  const pill = countText ?? (count != null ? `${count}${countLabel ? ` ${countLabel}` : ""}` : null);

  return (
    <div dir="rtl" style={{ flexShrink: 0 }}>
      <div className="settings-header">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <h1 className="settings-header__title">{title}</h1>
            {pill != null && <span className="settings-count">{pill}</span>}
          </div>
          {subtitle && <p className="settings-header__subtitle">{subtitle}</p>}
        </div>
        {(onAdd || actions) && (
          <div className="settings-header__actions">
            {actions}
            {onAdd && (
              <Button onClick={onAdd} startIcon={<Plus size={18} strokeWidth={2} aria-hidden />}>
                {addLabel}
              </Button>
            )}
          </div>
        )}
      </div>

      {showFilters && (
        <div className="settings-filters">
          {showSearch && (
            <div className="settings-filters__search">
              <SearchInput
                fullWidth
                value={search ?? ""}
                onChange={(e) => onSearch?.(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
