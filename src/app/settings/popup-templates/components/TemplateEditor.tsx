"use client";
import * as React from "react";
import { Eye, LayoutTemplate, PackageOpen, Save, Undo2 } from "lucide-react";
import { Alert, Button, ConfirmDialog, Skeleton, Snackbar, Tag, TextField } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { PopupTemplateConfig, PopupTemplateJson } from "@/app/lib/popup-templates/schema";
import { lintPopupTemplate, TEMPLATE_LIMITS } from "@/app/lib/popup-templates/validate";
import type { TemplateIssue } from "@/app/lib/popup-templates/validate";
import type { CodePopup } from "@/app/lib/popup-templates/codePopups";
import { TemplatePopup } from "@/app/testing/tests-popups/TemplateStation";
import type { ItemRow, TestStation } from "@/types";
import { blankTemplate, codeTemplateFor, sameConfig, setFinishLabel, templateIssues } from "../lib/editorModel";
import { EDITOR_TEXT } from "../lib/labels";
import { StepsEditor, VariablesHint } from "./StepsEditor";

/**
 * One station type's template (docs/popup-templates/PLAN.md step 1.6): its state (none / the
 * template / a new one not saved yet), the draft under edit, save (a new version; 409 when someone
 * saved meanwhile, 422 with the server's issues), "חזור לחלון של היום" (delete), and the preview —
 * the worker's popup itself (TemplatePopup in preview mode) over a sample item.
 *
 * The draft's dirtiness is reported up (onDirty), so the page can ask before leaving it.
 */

export type EditorType = { id: number; name: string; packageLevel: boolean };

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; saved: PopupTemplateJson | null };

export type TemplateEditorProps = {
  type: EditorType;
  codePopup: CodePopup | undefined;
  photoCodeOf: (photoTypeId: number) => string | null;
  /** A save or a delete changed the list's summary. */
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
};

/** A station type's template: null when it has none, "error" when it could not be read. */
async function readTemplate(typeId: number): Promise<PopupTemplateJson | null | "error"> {
  try {
    const res = await apiFetch(`/api/settings/popup-templates/${typeId}`);
    if (res.status === 404) return null;
    if (!res.ok) return "error";
    return (await res.json()) as PopupTemplateJson;
  } catch {
    return "error";
  }
}

export default function TemplateEditor({ type, codePopup, photoCodeOf, onSaved, onDirty }: TemplateEditorProps) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [draft, setDraft] = React.useState<PopupTemplateConfig | null>(null);
  const [serverIssues, setServerIssues] = React.useState<TemplateIssue[] | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [notice, setNotice] = React.useState<{ text: string; severity: "success" | "error"; seq: number } | null>(null);
  const say = (text: string, severity: "success" | "error" = "success") => setNotice((n) => ({ text, severity, seq: (n?.seq ?? 0) + 1 }));

  // Read (readTemplate), then applied in the promise's callback, so nothing is set in an effect's
  // own body; a reload ("נסה שוב", "טען מחדש") first shows loading.
  const applyRead = React.useCallback((read: PopupTemplateJson | null | "error") => {
    if (read === "error") { setLoad({ status: "error" }); return; }
    setLoad({ status: "ready", saved: read });
    setDraft(read?.config ?? null);
  }, []);
  React.useEffect(() => {
    let alive = true;
    readTemplate(type.id).then((read) => { if (alive) applyRead(read); });
    return () => { alive = false; };
  }, [type.id, applyRead]);
  const reload = () => {
    setLoad({ status: "loading" });
    setConflict(false);
    setServerIssues(null);
    readTemplate(type.id).then(applyRead);
  };

  const saved = load.status === "ready" ? load.saved : null;
  const dirty = draft != null && !sameConfig(draft, saved?.config ?? null);
  React.useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const issues = React.useMemo(() => (draft ? lintPopupTemplate(draft) : []), [draft]);
  const shownIssues = serverIssues ?? issues;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setServerIssues(null);
    try {
      const res = await apiFetch(`/api/settings/popup-templates/${type.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: "item", config: draft, expected_version: saved?.version ?? null }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === "TEMPLATE_CONFLICT") { setConflict(true); return; }
      if (res.status === 422 && Array.isArray(body.issues)) { setServerIssues(body.issues as TemplateIssue[]); return; }
      if (!res.ok) { say(typeof body.error === "string" ? body.error : EDITOR_TEXT.saveFailed, "error"); return; }
      const next = body as PopupTemplateJson;
      setLoad({ status: "ready", saved: next });
      setDraft(next.config);
      say(EDITOR_TEXT.saved);
      onSaved();
    } catch {
      say(EDITOR_TEXT.saveFailed, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/settings/popup-templates/${type.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setLoad({ status: "ready", saved: null });
      setDraft(null);
      say(EDITOR_TEXT.deleted);
      onSaved();
    } catch {
      say(EDITOR_TEXT.saveFailed, "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const edit = (next: PopupTemplateConfig) => { setServerIssues(null); setDraft(next); };
  const fromCode = codeTemplateFor(codePopup, photoCodeOf);

  // ---- states before a draft ----
  let body: React.ReactNode;
  if (type.packageLevel) {
    body = (
      <div className="settings-empty" style={{ padding: "48px var(--space-lg)" }}>
        <PackageOpen size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
        <div style={{ maxWidth: 440 }}>{EDITOR_TEXT.packageLater}</div>
      </div>
    );
  } else if (load.status === "loading") {
    body = <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true"><Skeleton variant="rounded" height={44} /><Skeleton variant="rounded" height={160} /><Skeleton variant="rounded" height={160} /></div>;
  } else if (load.status === "error") {
    body = (
      <div className="settings-error">
        <Alert severity="error">{EDITOR_TEXT.loadFailed}</Alert>
        <Button variant="outlined" color="inherit" size="small" onClick={reload}>{EDITOR_TEXT.retry}</Button>
      </div>
    );
  } else if (!draft) {
    body = (
      <div className="settings-empty" style={{ padding: "48px var(--space-lg)" }}>
        <LayoutTemplate size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
        <div className="settings-empty__title">{EDITOR_TEXT.noTemplate}</div>
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", justifyContent: "center", marginTop: "var(--space-xs)" }}>
          {fromCode && <Button onClick={() => edit(fromCode)}>{EDITOR_TEXT.createFromCode}</Button>}
          <Button variant={fromCode ? "outlined" : "contained"} color={fromCode ? "inherit" : "primary"} onClick={() => edit(blankTemplate())}>{EDITOR_TEXT.createBlank}</Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="pt-editor">
        {conflict && (
          <div className="settings-error" style={{ padding: 0 }}>
            <Alert severity="warning">{EDITOR_TEXT.conflict}</Alert>
            <Button variant="outlined" color="inherit" size="small" onClick={reload}>{EDITOR_TEXT.reload}</Button>
          </div>
        )}
        {templateIssues(shownIssues).length > 0 && (
          <Alert severity="warning">
            {EDITOR_TEXT.issuesTitle} {templateIssues(shownIssues).map((i) => i.message).join(" · ")}
          </Alert>
        )}
        <StepsEditor cfg={draft} issues={shownIssues} onChange={edit} />
        <div className="settings-card pt-finish">
          <TextField label={EDITOR_TEXT.finishLabel} value={draft.finish_label} size="small" sx={{ maxWidth: 320 }}
            onChange={(e) => edit(setFinishLabel(draft, e.target.value))} inputProps={{ maxLength: TEMPLATE_LIMITS.finishLabel }} />
          <VariablesHint />
        </div>
      </div>
    );
  }

  const canSave = draft != null && dirty && shownIssues.length === 0 && !saving && !conflict;

  return (
    <div className="settings-card pt-panel" style={{ overflow: "visible" }}>
      <div className="settings-card__head" style={{ paddingInline: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
          <span className="settings-card__title">{type.name}</span>
          {saved && <span className="settings-count">{EDITOR_TEXT.version(saved.version)}</span>}
          {!saved && draft && <Tag tone="neutral" size="md">{EDITOR_TEXT.newTemplate}</Tag>}
          {dirty && saved && <Tag tone="warning" size="md">{EDITOR_TEXT.dirty}</Tag>}
        </div>
        {draft && !type.packageLevel && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap" }}>
            <Button variant="text" startIcon={<Eye size={16} strokeWidth={1.75} aria-hidden />} onClick={() => setPreviewOpen(true)}>{EDITOR_TEXT.preview}</Button>
            {saved && <Button variant="text" color="error" onClick={() => setConfirmDelete(true)}>{EDITOR_TEXT.deleteTemplate}</Button>}
            {dirty && (
              <Button variant="outlined" color="inherit" startIcon={<Undo2 size={16} strokeWidth={1.75} aria-hidden />}
                onClick={() => { setServerIssues(null); setDraft(saved?.config ?? null); }}>{EDITOR_TEXT.discard}</Button>
            )}
            <Button onClick={() => void save()} disabled={!canSave} loading={saving} startIcon={<Save size={18} strokeWidth={2} aria-hidden />}>{EDITOR_TEXT.save}</Button>
          </div>
        )}
      </div>
      <div style={{ padding: draft && !type.packageLevel && load.status === "ready" ? 18 : 0 }}>{body}</div>

      <ConfirmDialog
        open={confirmDelete}
        title={EDITOR_TEXT.deleteTitle}
        message={EDITOR_TEXT.deleteMessage}
        confirmText={EDITOR_TEXT.deleteConfirm}
        destructive
        busy={deleting}
        draggable={false}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />

      {previewOpen && draft && (
        <PreviewPopup type={type} config={draft} version={saved?.version ?? 0} onClose={() => setPreviewOpen(false)} />
      )}

      <Snackbar key={notice?.seq ?? 0} open={notice != null} autoHideDuration={4000} onClose={() => setNotice(null)}>
        <Alert severity={notice?.severity ?? "success"}>{notice?.text}</Alert>
      </Snackbar>
    </div>
  );
}

/** The worker's popup over a sample item, from the draft — nothing is stored. */
function PreviewPopup({ type, config, version, onClose }: { type: EditorType; config: PopupTemplateConfig; version: number; onClose: () => void }) {
  const item = React.useMemo(() => ({
    item_id: "0", model: EDITOR_TEXT.previewItem, serial_no: "SN-0001", makat: null, last_sku: null, item_type_id: null,
  }) as unknown as ItemRow, []);
  const station = React.useMemo(() => ({
    test_station_id: 0, test_station_desc: EDITOR_TEXT.previewNote, test_station_type_id: type.id, status: 0, is_research: false,
  }) as unknown as TestStation, [type.id]);
  const template = React.useMemo((): PopupTemplateJson => ({
    station_type_id: type.id, base: "item", version, config, updated_at: new Date(0).toISOString(), updated_by: null,
  }), [type.id, version, config]);
  return (
    <TemplatePopup open onClose={onClose} item={item} station={station} stationTypeName={type.name}
      workerId={0} workerName={EDITOR_TEXT.previewNote} onSubmit={async () => undefined} template={template} preview />
  );
}
