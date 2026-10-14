"use client";
import * as React from "react";
import Link from "next/link";
import { CircleAlert, ExternalLink, Package, RefreshCw, Route } from "lucide-react";
import { Button, Skeleton } from "@/components/ui";
import { MAP_STATE_TEXT } from "../../lib/labels";

/**
 * The fields map's states other than the map itself (route-fields spec §5.12; artboard 11, the
 * strip of extra states): loading, load failure, a route without steps, a kit without contents.
 * Each fills the map's place under the tabs. The onboarding card of a route without fields
 * (artboard 11, top) is session 2e's.
 *
 * Never "ללא שדות" before the data is in, and never during a failure: a route that could not be
 * read must not look like a route without fields ("המסלול לא מוצג כריק כדי לא לאבד נתונים").
 */

/** Columns and rows of the loading shape: artboard 1's five stations and its six rows. */
const SKELETON_COLUMNS = 5;
const SKELETON_ROWS = 6;

/** Loading: the map's shape — a column header and 6 rows. The aria-label is the old page's route
 *  skeleton's ("טוען מסלול"). */
export function MapLoadingState() {
  const cols = Array.from({ length: SKELETON_COLUMNS }, (_, i) => i);
  return (
    <div className="rf-map-skeleton" aria-busy="true" aria-label="טוען מסלול">
      <div className="rf-map-skeleton__row rf-map-skeleton__row--head">
        <div className="rf-map-skeleton__label">
          <Skeleton variant="text" width="45%" height={14} />
        </div>
        {cols.map((c) => (
          <Skeleton key={c} variant="rounded" height={80} />
        ))}
      </div>
      {Array.from({ length: SKELETON_ROWS }, (_, r) => (
        <div key={r} className="rf-map-skeleton__row">
          <div className="rf-map-skeleton__label">
            <Skeleton variant="rounded" width={30} height={30} />
            <div className="rf-map-skeleton__lines">
              <Skeleton variant="text" width="60%" height={14} />
              <Skeleton variant="text" width="80%" height={12} />
            </div>
          </div>
          {cols.map((c) => (
            <Skeleton key={c} variant="rounded" height={62} />
          ))}
        </div>
      ))}
    </div>
  );
}

export type MapLoadErrorStateProps = {
  /** A retry is running: "טוען…" and disabled. */
  retrying: boolean;
  onRetry: () => void;
};

/** The fields context could not be read: role="alert", the danger wash, "נסה שוב". */
export function MapLoadErrorState({ retrying, onRetry }: MapLoadErrorStateProps) {
  return (
    <div role="alert" className="rf-load-error">
      <CircleAlert className="rf-load-error__icon" size={18} strokeWidth={1.75} aria-hidden />
      <div className="rf-load-error__body">
        <h2 className="rf-load-error__title">{MAP_STATE_TEXT.loadFailedTitle}</h2>
        <p className="rf-load-error__text">{MAP_STATE_TEXT.loadFailedBody}</p>
        <Button
          variant="outlined"
          disabled={retrying}
          onClick={onRetry}
          startIcon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden />}
        >
          {retrying ? MAP_STATE_TEXT.retrying : MAP_STATE_TEXT.retry}
        </Button>
      </div>
    </div>
  );
}

export type MapNoStepsStateProps = {
  /** "עבור לשלבי המסלול" → view=steps. */
  onGoToSteps: () => void;
};

/** The route has no steps (route_steps is empty) — nothing to map. */
export function MapNoStepsState({ onGoToSteps }: MapNoStepsStateProps) {
  return (
    <div className="settings-empty rf-state-card">
      <Route size={34} strokeWidth={1.75} color="var(--color-ink-muted-48)" aria-hidden />
      <h2 className="settings-empty__title">{MAP_STATE_TEXT.noStepsTitle}</h2>
      <p>{MAP_STATE_TEXT.noStepsBody}</p>
      <Button variant="outlined" onClick={onGoToSteps}>{MAP_STATE_TEXT.noStepsAction}</Button>
    </div>
  );
}

export type MapNoContentsStateProps = {
  /** "פתח את הגדרות המארזים" → /settings/packages?type={kit}. */
  packagesHref: string;
};

/** A kit whose type has no package_contents lines — no item rows to map. */
export function MapNoContentsState({ packagesHref }: MapNoContentsStateProps) {
  return (
    <div className="settings-empty rf-state-card">
      <Package size={34} strokeWidth={1.75} color="var(--color-ink-muted-48)" aria-hidden />
      <h2 className="settings-empty__title">{MAP_STATE_TEXT.noContentsTitle}</h2>
      <p>{MAP_STATE_TEXT.noContentsBody}</p>
      <Button
        variant="outlined"
        component={Link}
        href={packagesHref}
        startIcon={<ExternalLink size={16} strokeWidth={1.75} aria-hidden />}
      >
        {MAP_STATE_TEXT.noContentsAction}
      </Button>
    </div>
  );
}
