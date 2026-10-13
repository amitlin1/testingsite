"use client";
import * as React from "react";
import Link from "next/link";
import { LayoutGrid, Library, Route } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { VIEW_TAB_TEXT } from "../lib/labels";
import type { RouteView } from "../lib/routeQuery";

/**
 * The view tabs of /settings/testing-routes (route-fields spec §5.2; artboards 1, 8, 11):
 * <nav aria-label="תצוגות"> with "מפת שדות" | "שלבי המסלול" | "ערכות ורשימות". Each tab is a link to
 * the same page with another `view` (the URL holds the state, routeQuery.ts) — it replaces the
 * history entry, like every other change of the screen's state.
 *
 * "שלבי המסלול" carries a count chip: the steps of the SELECTED route (spec §10.3 — the artboards'
 * "5" counts the map's merged columns; the decision is the route's own steps). No chip while the
 * count is unknown (no route, a route not created yet, the list still loading).
 *
 * The active tab is aria-current="page" — except while the cell editor is open under "מפת שדות":
 * then the editor's breadcrumb holds the page, and the tab is aria-current="true" (artboard 2).
 */

export type RouteViewTabsProps = {
  view: RouteView;
  /** The cell editor is open (view=map with step and target). */
  editorOpen?: boolean;
  /** The link of each tab (the page builds it with routeQuery's withView). */
  hrefOf: (view: RouteView) => string;
  /** route_steps.length of the selected route; null = unknown (no chip). */
  stepsCount: number | null;
};

const TABS: readonly { view: RouteView; label: string; Icon: LucideIcon }[] = [
  { view: "map", label: VIEW_TAB_TEXT.map, Icon: LayoutGrid },
  { view: "steps", label: VIEW_TAB_TEXT.steps, Icon: Route },
  { view: "library", label: VIEW_TAB_TEXT.library, Icon: Library },
];

export default function RouteViewTabs({ view, editorOpen = false, hrefOf, stepsCount }: RouteViewTabsProps) {
  const current = editorOpen && view === "map" ? "true" : "page";
  return (
    <nav aria-label={VIEW_TAB_TEXT.navLabel} className="rf-view-tabs">
      {TABS.map(({ view: v, label, Icon }) => (
        <Link
          key={v}
          href={hrefOf(v)}
          replace
          scroll={false}
          className="rf-view-tab"
          aria-current={v === view ? current : undefined}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          {label}
          {v === "steps" && stepsCount != null && (
            <span className="rf-view-tab__count" dir="ltr">{stepsCount}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
