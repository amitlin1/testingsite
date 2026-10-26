"use client";
import * as React from "react";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { Alert, Button, ConfirmDialog, Skeleton, Tag } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { CODE_POPUPS } from "@/app/lib/popup-templates/codePopups";
import SettingsToolbar from "../components/SettingsToolbar";
import TemplateEditor from "./components/TemplateEditor";
import type { EditorType } from "./components/TemplateEditor";
import { EDITOR_TEXT } from "./lib/labels";
import "./popup-templates.css";

/**
 * /settings/popup-templates — "תבניות חלון" (docs/popup-templates/PLAN.md step 1.6): the station
 * types (master) and the selected type's template (detail). ?type= holds the selection, so a link
 * (the stations screen's "תבנית חלון") opens it. Leaving a draft with unsaved changes asks first.
 */

type Summary = { station_type_id: number; base: string; version: number };
type PhotoType = { photo_type_id: number; code: string };

export default function PopupTemplatesPage() {
  return (
    <Suspense fallback={<div dir="rtl"><SettingsToolbar title={EDITOR_TEXT.title} subtitle={EDITOR_TEXT.subtitle} /></div>}>
      <PopupTemplatesView />
    </Suspense>
  );
}

function PopupTemplatesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = Number(params.get("type")) || null;

  const [types, setTypes] = React.useState<EditorType[] | null>(null);
  const [summaries, setSummaries] = React.useState<Map<number, Summary>>(new Map());
  const [photoTypes, setPhotoTypes] = React.useState<PhotoType[]>([]);
  const [failed, setFailed] = React.useState(false);

  const loadSummaries = React.useCallback(async () => {
    const res = await apiFetch("/api/settings/popup-templates");
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as Summary[];
    setSummaries(new Map(rows.map((r) => [r.station_type_id, r])));
  }, []);

  const load = React.useCallback(async () => {
    setFailed(false);
    try {
      const [typesRes, photosRes] = await Promise.all([apiFetch("/api/settings/test-stations-type"), apiFetch("/api/settings/photo-types?all=1"), loadSummaries()]);
      if (!typesRes.ok || !photosRes.ok) throw new Error("load");
      const rows = (await typesRes.json()) as { test_station_type_id: number; test_type_desc: string; package_level: boolean }[];
      setTypes(rows.map((r) => ({ id: r.test_station_type_id, name: r.test_type_desc.trim(), packageLevel: r.package_level })));
      setPhotoTypes((await photosRes.json()) as PhotoType[]);
    } catch {
      setFailed(true);
    }
  }, [loadSummaries]);

  React.useEffect(() => { void load(); }, [load]);

  // ---- selection, with a guard for unsaved changes ----
  const [dirty, setDirty] = React.useState(false);
  const [pending, setPending] = React.useState<number | null>(null);
  const go = (id: number) => router.replace(`${pathname}?type=${id}`, { scroll: false });
  const pick = (id: number) => {
    if (id === selectedId) return;
    if (dirty) setPending(id);
    else go(id);
  };
  const onDirty = React.useCallback((d: boolean) => setDirty(d), []);

  const selected = types?.find((t) => t.id === selectedId) ?? null;
  const photoCodeOf = React.useCallback((id: number) => photoTypes.find((p) => p.photo_type_id === id)?.code ?? null, [photoTypes]);
  const reloadSummaries = React.useCallback(() => { void loadSummaries().catch(() => undefined); }, [loadSummaries]);

  return (
    <div dir="rtl">
      <SettingsToolbar title={EDITOR_TEXT.title} subtitle={EDITOR_TEXT.subtitle} />
      {failed && (
        <div className="settings-card settings-error" style={{ marginTop: "var(--space-lg)" }}>
          <Alert severity="error">{EDITOR_TEXT.listFailed}</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={() => void load()}>{EDITOR_TEXT.retry}</Button>
        </div>
      )}

      <div className="stations-grid">
        <nav aria-label={EDITOR_TEXT.typesTitle} className="settings-card">
          <div className="settings-card__head"><span className="settings-card__title">{EDITOR_TEXT.typesTitle}</span></div>
          {types == null ? (
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }} aria-busy="true">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={40} />)}
            </div>
          ) : (
            <ul className="pt-types">
              {types.map((t) => {
                const s = summaries.get(t.id);
                return (
                  <li key={t.id}>
                    <button type="button" className="pt-type" aria-current={t.id === selectedId ? "true" : undefined} onClick={() => pick(t.id)}>
                      <span className="pt-type__name">{t.name}</span>
                      {t.packageLevel ? (
                        <span className="pt-type__sub">{EDITOR_TEXT.rowPackage}</span>
                      ) : s ? (
                        <Tag tone="primary">{EDITOR_TEXT.rowTemplate(s.version)}</Tag>
                      ) : (
                        <span className="pt-type__sub">{EDITOR_TEXT.rowCode}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {selected ? (
          <TemplateEditor
            key={selected.id}
            type={selected}
            codePopup={CODE_POPUPS[selected.id]}
            photoCodeOf={photoCodeOf}
            onSaved={reloadSummaries}
            onDirty={onDirty}
          />
        ) : (
          <div className="settings-card settings-empty" style={{ minHeight: 240, padding: "64px var(--space-lg)" }}>
            <LayoutTemplate size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
            <div className="settings-empty__title">{EDITOR_TEXT.pickType}</div>
            <div>{EDITOR_TEXT.pickTypeSub}</div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending != null}
        title={EDITOR_TEXT.leaveTitle}
        message={EDITOR_TEXT.leaveMessage}
        confirmText={EDITOR_TEXT.leaveConfirm}
        draggable={false}
        onCancel={() => setPending(null)}
        onConfirm={() => { const id = pending; setPending(null); setDirty(false); if (id != null) go(id); }}
      />
    </div>
  );
}
