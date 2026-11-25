"use client";
import * as React from "react";
import { CircleAlert, Send } from "lucide-react";
import { Button, ConfirmDialog, StatusPill } from "@/components/ui";
import { useNow } from "@/lib/hooks/useNow";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import SettingsToolbar from "../../components/SettingsToolbar";
import { holdsContext } from "../lib/draftModel";
import type { DraftModel, DraftSummary } from "../lib/draftModel";
import { useDraftSnapshot, useDraftStore } from "../lib/draftStore";
import { contextRoutes, ownRouteId, ownOrNewest } from "../lib/fieldsContext";
import type { FieldsMapModel } from "../lib/mapModel";
import {
  UNDRAWN_TEXT, HEADER_TEXT, draftPillText, issuesToFixText, publishedPillText, routesCountText, savedAgoText,
} from "../lib/labels";

/**
 * The page header of /settings/testing-routes (route-fields spec §5.1, §5.2; artboards 1, 2, 8, 11):
 * the title, the count, the subtitle, and the actions of the header's mode (headerMode): a draft
 * (discard, then publish — or the issues button while a draft has blocking errors), no fields
 * (artboard 11), or published without a draft (spec §5.2 table).
 *
 * Until the context of the route on screen is in — loading, a load failure, or the store not yet
 * holding that context — the header shows neither "ללא שדות" nor an enabled publish (artboard 11):
 * only the disabled publish button.
 *
 * "נשמר אוטומטית …" is the time of the last autosave made in THIS session (DraftSnapshot
 * sessionSavedAt). The draft store's write states add the undrawn "save failed" (+ retry) and
 * "conflict" (+ reload) notes.
 */

export type RouteFieldsHeaderProps = {
  /** The kits' routes (the ones the pickers offer); null while unknown — no count pill. */
  routeCount: number | null;
  /** A route is chosen (the URL names one). */
  routeChosen: boolean;
  /** The fields context of that route once loaded; null while loading or after a failure. */
  context: FieldsContextJson | null;
  /** The map built from it (useFieldsMap); null with it. */
  map: FieldsMapModel | null;
  /** Opens the publish dialog. */
  onPublish: () => void;
  /** "בעיה אחת לתיקון": brings the map (and its error bar) into view. */
  onShowIssues: () => void;
};

type HeaderMode =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "draft" }
  | { kind: "noFields" }
  | { kind: "published"; version: number };

/** Which of the header's states shows. */
function headerMode(props: Pick<RouteFieldsHeaderProps, "routeChosen" | "context" | "map">, model: DraftModel, summary: DraftSummary): HeaderMode {
  const { routeChosen, context, map } = props;
  if (!routeChosen) return { kind: "none" };
  // Until the store holds this context, its summary is another route's.
  if (!context || !map || !holdsContext(model, context)) return { kind: "pending" };
  if (summary.hasDraft) return { kind: "draft" };
  const ownVersion = context.kit?.published_version ?? 0;
  if (map.emptyState != null) return ownVersion > 0 ? { kind: "published", version: ownVersion } : { kind: "noFields" };
  if (map.onboarding) return { kind: "noFields" };
  // Fields this route holds are published: "גרסה N" (fieldsContext.ownOrNewest).
  const published = contextRoutes(context).filter((r) => r.published_version > 0);
  const version = ownOrNewest(published, ownRouteId(context), (r) => r.route.test_route_id, (r) => r.published_version)?.published_version ?? 0;
  return version > 0 ? { kind: "published", version } : { kind: "noFields" };
}

// ---- the session's autosaves -----------------------------------------------------------------------
// ---- the header ------------------------------------------------------------------------------------
export default function RouteFieldsHeader({ routeCount, routeChosen, context, map, onPublish, onShowIssues }: RouteFieldsHeaderProps) {
  const store = useDraftStore();
  const { model, summary, sessionSavedAt } = useDraftSnapshot();
  const now = useNow(30_000);
  const mode = headerMode({ routeChosen, context, map }, model, summary);
  const hintId = React.useId();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);
  const [reloading, setReloading] = React.useState(false);

  const discard = async () => {
    setDiscarding(true);
    try {
      await store.discardAll();
    } finally {
      setDiscarding(false);
      setConfirmOpen(false);
    }
  };

  const reloadConflicts = async () => {
    setReloading(true);
    try {
      await store.reloadConflicts();
    } finally {
      setReloading(false);
    }
  };

  /** The muted note beside the pill: the save problem, or the session's last save. */
  const saveNote = (): React.ReactNode => {
    if (summary.conflictRoutes.length > 0) {
      return (
        <span className="rf-header-note rf-header-note--conflict" role="status">
          {UNDRAWN_TEXT.conflict}
          <Button variant="text" size="small" color="inherit" loading={reloading} onClick={reloadConflicts}>
            {UNDRAWN_TEXT.conflictReload}
          </Button>
        </span>
      );
    }
    if (summary.failedRoutes.length > 0) {
      return (
        <span className="rf-header-note rf-header-note--failed" role="status">
          {UNDRAWN_TEXT.saveFailed}
          <Button variant="text" size="small" color="inherit" onClick={() => store.retry()}>
            {UNDRAWN_TEXT.saveRetry}
          </Button>
        </span>
      );
    }
    let text: string | null = null;
    if (sessionSavedAt != null) text = savedAgoText(sessionSavedAt, Math.max(now, sessionSavedAt));
    else if (summary.unsaved) text = UNDRAWN_TEXT.saving;
    return text == null ? null : <span className="rf-header-note" role="status">{text}</span>;
  };

  const publishButton = (disabled: boolean, describedBy?: string) => (
    <Button
      onClick={onPublish}
      disabled={disabled}
      aria-describedby={describedBy}
      startIcon={<Send className="rf-send-icon" size={18} strokeWidth={1.75} aria-hidden />}
    >
      {HEADER_TEXT.publish}
    </Button>
  );

  let actions: React.ReactNode = null;
  switch (mode.kind) {
    case "none":
      break;
    case "pending":
      actions = publishButton(true);
      break;
    case "noFields":
      actions = (
        <>
          <StatusPill className="rf-header-pill" label={HEADER_TEXT.noFields} dotColor="var(--color-ink-muted-40)" />
          {saveNote()}
          <span id={hintId} className="rf-header-note">{HEADER_TEXT.nothingToPublish}</span>
          {publishButton(true, hintId)}
        </>
      );
      break;
    case "published":
      actions = (
        <>
          <StatusPill className="rf-header-pill" label={publishedPillText(mode.version)} dotColor="var(--color-status-approved)" />
          {saveNote()}
          {publishButton(true)}
        </>
      );
      break;
    case "draft": {
      // A draft that changes nothing against the published version: nothing to publish, yet a draft
      // to discard.
      const noop = summary.isNoopDraft;
      actions = (
        <>
          <StatusPill className="rf-header-pill" label={draftPillText(summary.changeCount)} dotColor="var(--color-status-late)" />
          {saveNote()}
          {noop && <span id={hintId} className="rf-header-note">{HEADER_TEXT.nothingToPublish}</span>}
          <Button variant="outlined" color="inherit" onClick={() => setConfirmOpen(true)} disabled={discarding}>
            {HEADER_TEXT.discardDraft}
          </Button>
          {summary.blockingErrorCount > 0 ? (
            <Button
              variant="outlined"
              color="warning"
              className="rf-issues-btn"
              onClick={onShowIssues}
              startIcon={<CircleAlert size={18} strokeWidth={1.75} aria-hidden />}
            >
              {issuesToFixText(summary.blockingErrorCount)}
            </Button>
          ) : (
            publishButton(noop, noop ? hintId : undefined)
          )}
        </>
      );
      break;
    }
  }

  return (
    <>
      <SettingsToolbar
        title={HEADER_TEXT.title}
        subtitle={HEADER_TEXT.subtitle}
        countText={routeCount == null ? undefined : routesCountText(routeCount)}
        actions={actions ?? undefined}
      />
      <ConfirmDialog
        open={confirmOpen}
        title={UNDRAWN_TEXT.discardTitle}
        message={UNDRAWN_TEXT.discardMessage}
        confirmText={UNDRAWN_TEXT.discardConfirm}
        cancelText={UNDRAWN_TEXT.discardCancel}
        destructive
        busy={discarding}
        onConfirm={() => void discard()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
