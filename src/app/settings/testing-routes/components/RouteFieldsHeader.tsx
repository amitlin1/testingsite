"use client";
import * as React from "react";
import { CircleAlert, Send } from "lucide-react";
import { Button, ConfirmDialog, StatusPill } from "@/components/ui";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import SettingsToolbar from "../../components/SettingsToolbar";
import { contextRouteIds, contextRoutes, entryHasDraft } from "../lib/draftModel";
import type { DraftModel, DraftSummary } from "../lib/draftModel";
import { useDraftSnapshot, useDraftStore } from "../lib/draftStore";
import type { DraftStore } from "../lib/draftStore";
import type { FieldsMapModel } from "../lib/mapModel";
import {
  COPY_PENDING, HEADER_TEXT, draftPillText, issuesToFixText, publishedPillText, routesCountText, savedAgoText,
} from "../lib/labels";

/**
 * The page header of /settings/testing-routes (route-fields spec §5.1, §5.2; artboards 1, 2, 8, 11):
 * SettingsToolbar with "מסלולי בדיקה", the count "{n} מסלולים", the subtitle, and the actions —
 *
 * | state                     | pill (dot)                    | note                          | 1                | 2                      |
 * |---------------------------|-------------------------------|-------------------------------|------------------|------------------------|
 * | draft, no blocking errors | "טיוטה · N שינויים" (late)    | the session's save            | "ביטול הטיוטה"   | "פרסום לעמדות" (Send)  |
 * | draft with errors         | same                          | same                          | same             | "בעיה אחת לתיקון" pill |
 * | no fields (artboard 11)   | "ללא שדות" (muted-40)         | "אין שינויים לפרסום" (its id) | —                | publish, disabled      |
 * | published, no draft       | COPY-PENDING (approved)       | —                             | —                | publish, disabled      |
 *
 * Until the context of the route on screen is in — loading, a load failure, or the store not yet
 * holding that context — the header shows neither "ללא שדות" nor an enabled publish (artboard 11):
 * only the disabled publish button.
 *
 * "נשמר אוטומטית …" is the time of the last autosave made in THIS session (lead decision): a draft
 * another admin saved earlier shows no save time. The draft store's write states add the COPY-PENDING
 * "save failed" (+ retry) and "conflict" (+ reload) notes.
 */

export type RouteFieldsHeaderProps = {
  /** All routes (GET /api/settings/testing-routes); null while unknown — no count pill. */
  routeCount: number | null;
  /** A route is chosen (the URL names one). */
  routeChosen: boolean;
  /** The fields context of that route once loaded; null while loading or after a failure. */
  context: FieldsContextJson | null;
  /** The map built from it (useFieldsMap); null with it. */
  map: FieldsMapModel | null;
  /** Opens the publish dialog (session 2c). Without it the publish button stays disabled. */
  onPublish?: () => void;
  /** "בעיה אחת לתיקון": brings the map (and its error bar) into view. */
  onShowIssues: () => void;
};

type HeaderMode =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "draft" }
  | { kind: "noFields" }
  | { kind: "published"; version: number };

const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Which row of the table above the header shows. */
function headerMode(props: Pick<RouteFieldsHeaderProps, "routeChosen" | "context" | "map">, model: DraftModel, summary: DraftSummary): HeaderMode {
  const { routeChosen, context, map } = props;
  if (!routeChosen) return { kind: "none" };
  // The store merges a new context in an effect: until it holds this one, its summary is another
  // route's.
  if (!context || !map || !sameIds(model.order, contextRouteIds(context))) return { kind: "pending" };
  if (summary.hasDraft) return { kind: "draft" };
  const own = context.kit ?? context.item;
  const ownVersion = own?.published_version ?? 0;
  if (map.emptyState != null) return ownVersion > 0 ? { kind: "published", version: ownVersion } : { kind: "noFields" };
  if (map.onboarding) return { kind: "noFields" };
  // Fields this route holds are published. "גרסה N" is the version of the route the screen is open
  // on (spec §10.2-4); a kit route never published shows the newest of its item routes.
  const version = ownVersion > 0 ? ownVersion : Math.max(0, ...contextRoutes(context).map((r) => r.published_version));
  return version > 0 ? { kind: "published", version } : { kind: "noFields" };
}

// ---- the session's autosaves -----------------------------------------------------------------------
type SessionSave = { savedAt: number | null; now: number };

/** A PUT of this session landed: the entry was writing a config and now holds it, error-free. */
function savedNow(before: DraftModel, after: DraftModel): boolean {
  return after.order.some((id) => {
    const was = before.routes[id];
    const is = after.routes[id];
    return !!was && !!is && was.saving && was.inFlight != null && !is.saving && is.error == null && is.conflict == null && is.serverDraft != null;
  });
}

/** The time (this browser's clock) of the last autosave this session made for the context on
 *  screen, and a clock that ticks while there is one. Cleared when the screen moves to another
 *  context or no route of it holds a draft any more (discarded). */
function useSessionSave(store: DraftStore): SessionSave {
  const [state, setState] = React.useState<SessionSave>({ savedAt: null, now: 0 });
  React.useEffect(() => {
    let prev = store.getSnapshot().model;
    return store.subscribe(() => {
      const next = store.getSnapshot().model;
      if (next === prev) return;
      const before = prev;
      prev = next;
      if (savedNow(before, next)) {
        const t = Date.now();
        setState({ savedAt: t, now: t });
        return;
      }
      const otherContext = !sameIds(before.order, next.order);
      const noDraft = !next.order.some((id) => {
        const e = next.routes[id];
        return e != null && entryHasDraft(e);
      });
      if (otherContext || noDraft) setState((s) => (s.savedAt == null ? s : { savedAt: null, now: s.now }));
    });
  }, [store]);
  const saved = state.savedAt != null;
  React.useEffect(() => {
    if (!saved) return;
    const tick = setInterval(() => setState((s) => ({ ...s, now: Date.now() })), 30_000);
    return () => clearInterval(tick);
  }, [saved]);
  return state;
}

// ---- the header ------------------------------------------------------------------------------------
export default function RouteFieldsHeader({ routeCount, routeChosen, context, map, onPublish, onShowIssues }: RouteFieldsHeaderProps) {
  const store = useDraftStore();
  const { model, summary } = useDraftSnapshot();
  const session = useSessionSave(store);
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
          {COPY_PENDING.conflict}
          <Button variant="text" size="small" color="inherit" loading={reloading} onClick={reloadConflicts}>
            {COPY_PENDING.conflictReload}
          </Button>
        </span>
      );
    }
    if (summary.failedRoutes.length > 0) {
      return (
        <span className="rf-header-note rf-header-note--failed" role="status">
          {COPY_PENDING.saveFailed}
          <Button variant="text" size="small" color="inherit" onClick={() => store.retry()}>
            {COPY_PENDING.saveRetry}
          </Button>
        </span>
      );
    }
    let text: string | null = null;
    if (session.savedAt != null) text = savedAgoText(session.savedAt, Math.max(session.now, session.savedAt));
    else if (summary.unsaved) text = COPY_PENDING.saving;
    return text == null ? null : <span className="rf-header-note" role="status">{text}</span>;
  };

  const publishButton = (disabled: boolean, describedBy?: string) => (
    <Button
      onClick={onPublish}
      disabled={disabled || !onPublish}
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
        title={COPY_PENDING.discardTitle}
        message={COPY_PENDING.discardMessage}
        confirmText={COPY_PENDING.discardConfirm}
        cancelText={COPY_PENDING.discardCancel}
        destructive
        busy={discarding}
        draggable={false}
        onConfirm={() => void discard()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
