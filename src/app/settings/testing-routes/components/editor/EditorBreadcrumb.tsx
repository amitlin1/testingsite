"use client";
import * as React from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui";
import { EDITOR_TEXT } from "../../lib/labels";
import "./editor.css";

/**
 * The cell editor's breadcrumb (artboard 2, spec §5.5 פריסה 1). Artboard 2 draws it at the inline end
 * of the view tabs' row, so the page renders it in RouteViewTabs' `trailing` slot while the editor is
 * open.
 */

export type EditorBreadcrumbProps = {
  /** The cell's station (its map column). */
  stationLabel: string;
  /** The cell's row. */
  rowLabel: string;
  /** "חזרה למפה" and "מפת שדות". */
  onBackToMap: () => void;
};

export function EditorBreadcrumb({ stationLabel, rowLabel, onBackToMap }: EditorBreadcrumbProps) {
  return (
    <nav aria-label={EDITOR_TEXT.breadcrumbLabel} className="sfe-crumbs">
      <Button variant="text" startIcon={<ArrowRight size={16} strokeWidth={1.75} aria-hidden />} onClick={onBackToMap}>
        {EDITOR_TEXT.backToMap}
      </Button>
      <ol className="sfe-crumbs__list">
        <li>
          <button type="button" className="sfe-crumbs__link" onClick={onBackToMap}>
            {EDITOR_TEXT.mapCrumb}
          </button>
        </li>
        <li aria-hidden="true" className="sfe-crumbs__sep"><ChevronLeft size={14} strokeWidth={1.75} /></li>
        <li>{stationLabel}</li>
        <li aria-hidden="true" className="sfe-crumbs__sep"><ChevronLeft size={14} strokeWidth={1.75} /></li>
        <li aria-current="page" className="sfe-crumbs__current">{rowLabel}</li>
      </ol>
    </nav>
  );
}
