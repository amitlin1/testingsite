"use client";
import * as React from "react";
import { ChevronDown, Link2, Minus, Pencil, Plus, Send, X } from "lucide-react";
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Snackbar, Tag,
} from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { VERSION_NOTE_MAX } from "@/app/lib/station-fields/admin-types";
import type { ApplyMode, FieldsContextJson, PublishImpactJson } from "@/app/lib/station-fields/admin-types";
import { useDraftSnapshot, useDraftStore } from "../../lib/draftStore";
import type { FieldsMapModel } from "../../lib/mapModel";
import { UNDRAWN_TEXT, HEADER_TEXT, MAP_STATE_TEXT, routeOptionText } from "../../lib/labels";
import {
  CHANGE_BADGE_TEXT, PUBLISH_UNDRAWN_TEXT, PUBLISH_TEXT, countTagsText, infoNoteText, publishButtonText, publishTitleText,
  publishedSnackText, replacesVersionText, scopeLabelText, scopeNewSubText, scopePendingSubText, scopePendingTitleText,
} from "../../lib/publishLabels";
import {
  APPLY_MODE_DEFAULT, FIELD_SETS_URL, PUBLISH_PREVIEW_URL, PUBLISH_URL, buildPublishGroups, contextKitId, errorCode,
  fromSetIds, ownRouteId, parsePublishImpact, parsePublishResult, parseSetNames, pendingVersion, previewRequestBody,
  publishRequestBody, publishVersion, publishedVersionOf, sharedNoteText,
} from "../../lib/publishModel";
import type { PublishBadge } from "../../lib/publishModel";
import "@/app/packages/packages.css";
import "./publish-dialog.css";

/**
 * "פרסום גרסה N" — the publish dialog (artboard 10, route-fields spec §5.11, §3.4.2, §3.4.3). Opened
 * from the header's "פרסום לעמדות" (only with a draft and no blocking error):
 *
 *   1. store.flushAll() — every pending edit is saved first; a save that fails or is in conflict
 *      stops here (the header's undrawn save-failed / conflict words, with their actions);
 *   2. POST …/fields/publish-preview { route_ids: the context's routes with a draft, context_kit_id }
 *      — 422 LINT_ERRORS closes the dialog and reloads the context: the header turns to "בעיה אחת
 *      לתיקון";
 *   3. the impact: title "פרסום גרסה {v} · {route}" (v = the version of the route on screen, §10.2-4),
 *      the count tags, "מה השתנה" grouped by (route, station), the shared-kits warning, the info note
 *      for the chosen scope, the scope radiogroup and "הערת גרסה";
 *   4. "פרסם גרסה {v}" → POST …/fields/publish { route_ids, base_revs (the preview's), apply_mode,
 *      note }: 200 → close, reload the context (drafts gone, versions up) and an undrawn Snackbar;
 *      409 DRAFT_CONFLICT → an undrawn note with "טען מחדש" (context and preview again); 422 →
 *      as in 2.
 *
 * Not drawn here: "היסטוריית גרסאות" (artboard 10's footer ghost button) — its screen is not drawn
 * (spec §5.11, §10.4), so the footer holds "ביטול" and the primary only.
 *
 * Each opening is a session of its own (PublishSession, keyed): its state starts fresh, and it stays
 * mounted after closing so the dialog's exit animation keeps its content. The Snackbar lives outside
 * the session — it outlives the dialog.
 */

export type PublishDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The fields context on screen; null while none (the dialog then shows nothing). */
  context: FieldsContextJson | null;
  /** The fields map built from it (useFieldsMap): the groups' station names and order. */
  map: FieldsMapModel | null;
  /** Ask for the fields context again — after a publish, a conflict or a refusal (422). */
  onReloadContext: () => void;
};

export default function PublishDialog(props: PublishDialogProps) {
  const { open } = props;
  // A new session per opening: state from the previous one never leaks into the next.
  const [session, setSession] = React.useState(0);
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((s) => s + 1);
  }
  const [snack, setSnack] = React.useState<string | null>(null);
  const closeSnack = React.useCallback(() => setSnack(null), []);
  const onPublished = React.useCallback((version: number) => setSnack(publishedSnackText(version)), []);

  return (
    <>
      {session > 0 && props.context && (
        <PublishSession key={session} {...props} context={props.context} onPublished={onPublished} />
      )}
      <Snackbar open={snack != null} autoHideDuration={6000} onClose={closeSnack} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Alert severity="success" onClose={closeSnack}>{snack}</Alert>
      </Snackbar>
    </>
  );
}

// ---- one opening ---------------------------------------------------------------------------------------
type Load =
  | { kind: "loading" }
  /** flushAll: a route could not be saved (network, 5xx, refused). */
  | { kind: "saveFailed" }
  /** flushAll: a route is in conflict (409 DRAFT_CONFLICT on autosave). */
  | { kind: "saveConflict" }
  /** publish-preview failed, or answered something that is not an impact. */
  | { kind: "previewFailed" }
  | { kind: "ready"; impact: PublishImpactJson; routeIds: number[] };

type SessionProps = Omit<PublishDialogProps, "context"> & {
  context: FieldsContextJson;
  onPublished: (version: number) => void;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** The field sets' names, for "מולאו מהערכה '{set}'" — best effort: {} on any failure. */
async function loadSetNames(): Promise<Record<number, string>> {
  try {
    const res = await apiFetch(FIELD_SETS_URL, { cache: "no-store" });
    return res.ok ? parseSetNames(await readBody(res)) : {};
  } catch {
    return {};
  }
}

const BADGE_ICON: Record<PublishBadge, { Icon: typeof Plus; size: number }> = {
  add: { Icon: Plus, size: 14 },
  edit: { Icon: Pencil, size: 13 },
  del: { Icon: Minus, size: 14 },
};

function PublishSession({ open, onClose, context, map, onReloadContext, onPublished }: SessionProps) {
  const store = useDraftStore();
  const { model } = useDraftSnapshot();
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<"failed" | "conflict" | null>(null);
  const [mode, setMode] = React.useState<ApplyMode>(APPLY_MODE_DEFAULT);
  const [note, setNote] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [setNames, setSetNames] = React.useState<Record<number, string>>({});
  /** Each run of prepare() takes a number; an answer to an older run is dropped. */
  const runRef = React.useRef(0);
  const scopeRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = React.useId();
  const changesLabelId = baseId + "-changes";
  const scopeLabelId = baseId + "-scope";
  const noteId = baseId + "-note";
  const noteHelpId = baseId + "-note-help";

  const ownId = ownRouteId(context);
  const kitId = contextKitId(context);

  /** A refusal for lint errors (422): the header's "בעיה אחת לתיקון" takes over. */
  const closeForIssues = () => {
    runRef.current += 1;
    onReloadContext();
    onClose();
  };

  /** Save, then ask for the impact. The state is "loading" when it starts (the first render, or the
   *  action that called it). */
  const prepare = async () => {
    const run = ++runRef.current;
    const live = () => run === runRef.current;
    const flushed = await store.flushAll();
    if (!live()) return;
    if (!flushed.ok) {
      setLoad({ kind: flushed.conflicts.length > 0 ? "saveConflict" : "saveFailed" });
      return;
    }
    const routeIds = store.getSnapshot().summary.draftRouteIds;
    if (routeIds.length === 0) {
      // Nothing left to publish (the drafts went meanwhile).
      onClose();
      return;
    }
    let status = 0;
    let body: unknown = null;
    try {
      const res = await apiFetch(PUBLISH_PREVIEW_URL, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(previewRequestBody(routeIds, kitId)),
        cache: "no-store",
      });
      status = res.status;
      body = await readBody(res);
    } catch {
      status = 0;
    }
    if (!live()) return;
    if (status === 422 && errorCode(body) === "LINT_ERRORS") {
      closeForIssues();
      return;
    }
    const impact = status === 200 ? parsePublishImpact(body) : null;
    if (!impact) {
      setLoad({ kind: "previewFailed" });
      return;
    }
    if (impact.routes.length === 0) {
      onClose();
      return;
    }
    setLoad({ kind: "ready", impact, routeIds });
    if (fromSetIds(impact).length > 0) {
      const names = await loadSetNames();
      if (live()) setSetNames(names);
    }
  };

  // The first run, once per session (StrictMode's second mount drops the first run's answers).
  const start = React.useEffectEvent(() => {
    void prepare();
  });
  React.useEffect(() => {
    start();
    return () => {
      runRef.current += 1;
    };
  }, []);

  const again = () => {
    setPublishError(null);
    setLoad({ kind: "loading" });
    void prepare();
  };
  const retrySave = () => {
    store.retry();
    again();
  };
  const reloadConflicts = async () => {
    setLoad({ kind: "loading" });
    await store.reloadConflicts();
    again();
  };
  const reloadAfterConflict = () => {
    onReloadContext();
    again();
  };

  const handleClose = () => {
    if (publishing) return;
    runRef.current += 1;
    onClose();
  };

  const ready = load.kind === "ready" ? load : null;
  const view = ready ? publishVersion(ready.impact, ownId) : null;
  // Until the preview answers, the title names the version the store's drafts would become.
  const version = view?.version ?? pendingVersion(model, ownId);
  const routeText = routeOptionText(context.subject.desc.trim(), context.subject.route_number);

  const groups = React.useMemo(
    () => (ready ? buildPublishGroups({ impact: ready.impact, context, map, setNames }) : []),
    [ready, context, map, setNames],
  );
  const allOpen = groups.every((g) => !collapsed.has(g.key));
  const toggleAll = () => setCollapsed(allOpen ? new Set(groups.map((g) => g.key)) : new Set());
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const publish = async () => {
    if (!ready || publishing) return;
    const run = runRef.current;
    setPublishing(true);
    setPublishError(null);
    let status = 0;
    let body: unknown = null;
    try {
      const res = await apiFetch(PUBLISH_URL, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(publishRequestBody(ready.routeIds, ready.impact, mode, note)),
        cache: "no-store",
      });
      status = res.status;
      body = await readBody(res);
    } catch {
      status = 0;
    }
    setPublishing(false);
    if (run !== runRef.current) return;
    if (status === 200) {
      const published = publishedVersionOf(parsePublishResult(body), ownId) ?? view?.version ?? null;
      runRef.current += 1;
      onReloadContext();
      if (published != null) onPublished(published);
      onClose();
      return;
    }
    if (status === 409 && errorCode(body) === "DRAFT_CONFLICT") {
      setPublishError("conflict");
      return;
    }
    if (status === 422 && errorCode(body) === "LINT_ERRORS") {
      closeForIssues();
      return;
    }
    setPublishError("failed");
  };

  // ---- the scope radiogroup (arrows move and choose, as PackageDecisionDialog) ----------------------
  const scopes: { mode: ApplyMode; title: string; sub: string }[] = ready && view
    ? [
        { mode: "new_only", title: PUBLISH_TEXT.scopeNewTitle, sub: scopeNewSubText(view.fromVersion) },
        { mode: "not_reached", title: scopePendingTitleText(ready.impact.not_reached), sub: scopePendingSubText(view.version) },
      ]
    : [];
  const onScopeKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowLeft" ? 1 : e.key === "ArrowUp" || e.key === "ArrowRight" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + scopes.length) % scopes.length;
    setMode(scopes[next].mode);
    scopeRefs.current[next]?.focus();
  };

  // ---- the body, by state -----------------------------------------------------------------------------
  const stateBody = (): React.ReactNode => {
    switch (load.kind) {
      case "loading":
        return (
          <div className="rf-pub__state" aria-busy="true">
            <CircularProgress size={28} />
          </div>
        );
      case "saveFailed":
        return (
          <Alert
            severity="error"
            action={<Button variant="text" size="small" color="inherit" onClick={retrySave}>{UNDRAWN_TEXT.saveRetry}</Button>}
          >
            {UNDRAWN_TEXT.saveFailed}
          </Alert>
        );
      case "saveConflict":
        return (
          <Alert
            severity="warning"
            action={<Button variant="text" size="small" color="inherit" onClick={() => void reloadConflicts()}>{UNDRAWN_TEXT.conflictReload}</Button>}
          >
            {UNDRAWN_TEXT.conflict}
          </Alert>
        );
      case "previewFailed":
        return (
          <Alert
            severity="error"
            action={<Button variant="text" size="small" color="inherit" onClick={again}>{MAP_STATE_TEXT.retry}</Button>}
          >
            {PUBLISH_UNDRAWN_TEXT.previewFailed}
          </Alert>
        );
      case "ready":
        return null;
    }
  };

  const sharedNote = ready ? sharedNoteText(ready.impact, context) : null;
  const infoText = ready && view
    ? infoNoteText({
        pending: mode === "not_reached",
        items: ready.impact.items_on_routes,
        notReached: ready.impact.not_reached,
        version: view.version,
        fromVersion: view.fromVersion,
      })
    : "";
  const tags = ready ? countTagsText(ready.impact.totals) : [];
  const replaces = view ? replacesVersionText(view.fromVersion) : null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={publishing}
      PaperProps={{ className: "rf-pub" }}
    >
      <div className="rf-pub__head">
        <div className="rf-pub__head-main">
          <DialogTitle className="rf-pub__title">{version != null ? publishTitleText(version, routeText) : routeText}</DialogTitle>
          {ready && (
            <div className="rf-pub__tags">
              {tags.map((t) => <span key={t} className="settings-count">{t}</span>)}
              {replaces && <span className="rf-pub__replaces">{replaces}</span>}
            </div>
          )}
        </div>
        <IconButton className="rf-pub__close" aria-label={PUBLISH_TEXT.close} onClick={handleClose} disabled={publishing}>
          <X size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </div>

      <DialogContent className="rf-pub__body">
        {stateBody()}
        {ready && view && (
          <>
            <div className="rf-pub__section">
              <div className="rf-pub__section-head">
                <span id={changesLabelId} className="rf-pub__label">{PUBLISH_TEXT.changesLabel}</span>
                <Button variant="text" size="small" className="rf-pub__toggle" onClick={toggleAll}>
                  {allOpen ? PUBLISH_TEXT.collapseAll : PUBLISH_TEXT.expandAll}
                </Button>
              </div>
              <div role="list" aria-labelledby={changesLabelId} className="rf-pub__list">
                {groups.map((g, gi) => {
                  const expanded = !collapsed.has(g.key);
                  const panelId = baseId + "-g" + gi;
                  return (
                    <div role="listitem" key={g.key} className="rf-pub__group">
                      <button
                        type="button"
                        className="rf-pub__group-btn"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => toggleGroup(g.key)}
                      >
                        <span className="rf-pub__group-title">{g.title}</span>
                        <span className="rf-pub__group-sub">{g.sub}</span>
                        {g.shared && (
                          <Tag tone="primary" icon={<Link2 size={12} strokeWidth={1.75} aria-hidden />}>{PUBLISH_TEXT.shared}</Tag>
                        )}
                        <span className="rf-pub__group-count">{g.count}</span>
                        <ChevronDown className="rf-pub__chevron" size={16} strokeWidth={1.75} aria-hidden />
                      </button>
                      <div id={panelId} className="rf-pub__panel" hidden={!expanded}>
                        {g.lines.map((ln, li) => {
                          const { Icon, size } = BADGE_ICON[ln.badge];
                          const word = CHANGE_BADGE_TEXT[ln.badge];
                          return (
                            <div key={li} className="rf-pub__line">
                              <span className={"rf-pub__badge rf-pub__badge--" + ln.badge} title={word}>
                                <Icon size={size} strokeWidth={1.75} role="img" aria-label={word} />
                              </span>
                              <span className="rf-pub__line-text">
                                {ln.text}
                                {ln.warn && <span className="rf-pub__warn"> · {ln.warn}</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rf-pub__notes">
              {sharedNote && <Alert severity="warning" role="note">{sharedNote}</Alert>}
              <Alert severity="info" aria-live="polite">{infoText}</Alert>
            </div>

            <div className="rf-pub__section">
              <span id={scopeLabelId} className="rf-pub__label">{scopeLabelText(view.version)}</span>
              <div role="radiogroup" aria-labelledby={scopeLabelId} className="rf-pub__scopes">
                {scopes.map((s, i) => {
                  const on = mode === s.mode;
                  return (
                    <button
                      key={s.mode}
                      ref={(el) => { scopeRefs.current[i] = el; }}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => setMode(s.mode)}
                      onKeyDown={(e) => onScopeKey(e, i)}
                      className="pkg-choice rf-pub__scope"
                    >
                      <span className="rf-pub__radio" aria-hidden><span className="rf-pub__radio-dot" /></span>
                      <span className="rf-pub__scope-text">
                        <span className="rf-pub__scope-title">{s.title}</span>
                        <span className="rf-pub__scope-sub">{s.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rf-pub__section">
              <div className="rf-pub__note-head">
                <label htmlFor={noteId} className="rf-pub__label">{PUBLISH_TEXT.noteLabel}</label>
                <span id={noteHelpId} className="rf-pub__help">{PUBLISH_TEXT.noteHelp}</span>
              </div>
              <textarea
                id={noteId}
                rows={2}
                maxLength={VERSION_NOTE_MAX}
                aria-describedby={noteHelpId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rf-pub__textarea"
              />
            </div>

            {publishError === "conflict" && (
              <Alert
                severity="warning"
                action={<Button variant="text" size="small" color="inherit" onClick={reloadAfterConflict}>{UNDRAWN_TEXT.conflictReload}</Button>}
              >
                {PUBLISH_UNDRAWN_TEXT.publishConflict}
              </Alert>
            )}
            {publishError === "failed" && <Alert severity="error">{PUBLISH_UNDRAWN_TEXT.publishFailed}</Alert>}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={handleClose} disabled={publishing}>{PUBLISH_TEXT.cancel}</Button>
        <Button
          onClick={() => void publish()}
          loading={publishing}
          disabled={!ready || publishError === "conflict"}
          startIcon={<Send className="rf-send-icon" size={18} strokeWidth={1.75} aria-hidden />}
        >
          {version != null ? publishButtonText(version) : HEADER_TEXT.publish}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
