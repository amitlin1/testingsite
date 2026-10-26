"use client";

import * as React from "react";
import { CircleAlert, Check, Package } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Tag,
} from "@/components/ui";
import { Add as AddIcon } from "@/components/ui/icons";
import { EditOutlined as EditOutlinedIcon } from "@/components/ui/icons";
import { Inventory2Outlined as Inventory2OutlinedIcon } from "@/components/ui/icons";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import SettingsToolbar from "../components/SettingsToolbar";
import { apiFetch } from "@/lib/api/client";
import ReferenceItemFields from "./ReferenceItemFields";
import PackageReferenceDialog from "./PackageReferenceDialog";
import {
  checkDraft, draftOf, draftPayload, revokeDraftUrls, startUploadType,
  type FieldErrors, type FieldKey, type ItemDraft, type ItemType, type PhotoType, type ReferenceItem, type TemplateLine,
} from "./referenceForm";

// ---- Design tokens (Shifthouse) --------------------------------------------
// States (hover / focus / drag) live in settings.css (.ri-*): inline styles
// cannot express them.
const C = {
  accent: "var(--color-primary)",
  ink: "var(--color-ink)",
  muted: "var(--color-ink-muted-48)",
  hairline: "var(--color-hairline)",
  card: "var(--color-canvas)",
};

// A non-OK reply counts as a failure (it used to read as an empty list).
const okJson = (r: Response) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** The selected package type's contents: what its package references hold. */
type LinesState = { status: "loading" } | { status: "error" } | { status: "ready"; lines: TemplateLine[] };

/**
 * הגדרות → פריטי ייחוס. A reference item of a regular type is edited in the
 * dialog below; one of a package type is a package reference (ייחוס מארז) —
 * the box plus a reference item per content line — edited in
 * PackageReferenceDialog. Both fill the same form (ReferenceItemFields).
 */
export default function ReferenceItemsPage() {
  const [itemTypes, setItemTypes] = React.useState<ItemType[]>([]);
  const [selectedType, setSelectedType] = React.useState<ItemType | null>(null);
  const [photoTypes, setPhotoTypes] = React.useState<PhotoType[]>([]);
  // item_type_id → the station types on its routes; null when the routes did not load (every station shows).
  const [stationsByType, setStationsByType] = React.useState<Map<number, Set<number>> | null>(null);
  const stationTypesOf = React.useCallback(
    (itemTypeId: number | null | undefined) => (stationsByType && itemTypeId != null ? stationsByType.get(itemTypeId) ?? new Set<number>() : null),
    [stationsByType],
  );

  const [items, setItems] = React.useState<ReferenceItem[]>([]);
  const [loadingItems, setLoadingItems] = React.useState(false);
  // A failed load is not "no items": each gets an error band and a retry.
  const [itemsError, setItemsError] = React.useState(false);
  const [optionsError, setOptionsError] = React.useState(false);
  const [lines, setLines] = React.useState<LinesState>({ status: "loading" });

  const [skuFilter, setSkuFilter] = React.useState<string | null>(null);
  const [manuFilter, setManuFilter] = React.useState<string | null>(null);

  // regular dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [formType, setFormType] = React.useState<ItemType | null>(null);
  const [draft, setDraft] = React.useState<ItemDraft | null>(null);
  const [formError, setFormError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // package reference dialog: open with the reference being edited (null: new);
  // a fresh key per opening, so its state starts from that reference
  const [pkgDialog, setPkgDialog] = React.useState<{ key: number; editing: ReferenceItem | null } | null>(null);
  const pkgOpenings = React.useRef(0);

  // ---- data loading --------------------------------------------------------
  // The fetches set state only from their callbacks, so the effects below can
  // run them; the retries clear the error first.
  const fetchOptions = React.useCallback(() => {
    apiFetch("/api/settings/item-types")
      .then(okJson)
      .then((data: ItemType[]) => setItemTypes(Array.isArray(data) ? data : []))
      .catch(() => { setItemTypes([]); setOptionsError(true); });
    apiFetch("/api/settings/photo-types")
      .then(okJson)
      .then((data: PhotoType[]) => setPhotoTypes(Array.isArray(data) ? data : []))
      .catch(() => { setPhotoTypes([]); setOptionsError(true); });
    // Best effort: without the routes every station's photo components show.
    apiFetch("/api/settings/testing-routes")
      .then(okJson)
      .then((rows: { item_type_id: number; route_steps: number[] | null }[]) => {
        const map = new Map<number, Set<number>>();
        for (const r of Array.isArray(rows) ? rows : []) {
          const set = map.get(r.item_type_id) ?? new Set<number>();
          for (const st of r.route_steps ?? []) set.add(st);
          map.set(r.item_type_id, set);
        }
        setStationsByType(map);
      })
      .catch(() => setStationsByType(null));
  }, []);
  const loadOptions = React.useCallback(() => {
    setOptionsError(false);
    fetchOptions();
  }, [fetchOptions]);

  React.useEffect(() => { fetchOptions(); }, [fetchOptions]);

  const fetchItems = React.useCallback((typeId: number) => {
    apiFetch(`/api/settings/reference-items?itemTypeId=${typeId}`)
      .then(okJson)
      .then((data: ReferenceItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => { setItems([]); setItemsError(true); })
      .finally(() => setLoadingItems(false));
  }, []);
  const loadItems = React.useCallback((typeId: number) => {
    setLoadingItems(true);
    setItemsError(false);
    fetchItems(typeId);
  }, [fetchItems]);

  const fetchLines = React.useCallback((typeId: number) => {
    apiFetch(`/api/settings/item-types/${typeId}/contents`)
      .then(okJson)
      .then((data: { lines?: TemplateLine[] }) => setLines({ status: "ready", lines: Array.isArray(data.lines) ? data.lines : [] }))
      .catch(() => setLines({ status: "error" }));
  }, []);
  const loadLines = React.useCallback((typeId: number) => {
    setLines({ status: "loading" });
    fetchLines(typeId);
  }, [fetchLines]);

  // A newly selected type starts its loads (and drops the old filters) during
  // render; the effect below only fetches.
  const [loadedType, setLoadedType] = React.useState<ItemType | null>(null);
  if (loadedType !== selectedType) {
    setLoadedType(selectedType);
    if (selectedType) {
      setLoadingItems(true);
      setItemsError(false);
      if (selectedType.is_package) setLines({ status: "loading" });
      setSkuFilter(null);
      setManuFilter(null);
    } else {
      setItems([]);
    }
  }
  React.useEffect(() => {
    if (!selectedType) return;
    fetchItems(selectedType.item_type_id);
    if (selectedType.is_package) fetchLines(selectedType.item_type_id);
  }, [selectedType, fetchItems, fetchLines]);

  const isPackage = !!selectedType?.is_package;
  const regularTypes = React.useMemo(() => itemTypes.filter((t) => !t.is_package), [itemTypes]);

  // ---- derived: mutually-filtering SKU / manufacturer options --------------
  const skuOptions = React.useMemo(() => {
    const pool = manuFilter ? items.filter((i) => i.manufacturer === manuFilter) : items;
    return Array.from(new Set(pool.map((i) => i.manufacturer_sku))).sort((a, b) =>
      a.localeCompare(b, "he"),
    );
  }, [items, manuFilter]);

  const manuOptions = React.useMemo(() => {
    const pool = skuFilter ? items.filter((i) => i.manufacturer_sku === skuFilter) : items;
    return Array.from(new Set(pool.map((i) => i.manufacturer))).sort((a, b) =>
      a.localeCompare(b, "he"),
    );
  }, [items, skuFilter]);

  const filtered = React.useMemo(
    () =>
      items.filter(
        (i) =>
          (!skuFilter || i.manufacturer_sku === skuFilter) &&
          (!manuFilter || i.manufacturer === manuFilter),
      ),
    [items, skuFilter, manuFilter],
  );

  const anyFilter = !!(skuFilter || manuFilter);
  const clearFilters = () => {
    setSkuFilter(null);
    setManuFilter(null);
  };
  const noun = isPackage ? "ייחוסי מארז" : "פריטים";
  const headerCount = anyFilter
    ? `${filtered.length} מתוך ${items.length}`
    : `${items.length} ${noun}`;

  // ---- dialogs -------------------------------------------------------------
  const fallbackPhoto = photoTypes[0]?.code ?? "";

  const openPackage = (editing: ReferenceItem | null) => setPkgDialog({ key: ++pkgOpenings.current, editing });

  const openNew = () => {
    if (isPackage) { openPackage(null); return; }
    setFormType(selectedType);
    setDraft(draftOf(null, startUploadType(photoTypes, ""), fallbackPhoto));
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (it: ReferenceItem) => {
    if (itemTypes.find((t) => t.item_type_id === it.item_type_id)?.is_package) { openPackage(it); return; }
    setFormType(itemTypes.find((t) => t.item_type_id === it.item_type_id) ?? selectedType);
    setDraft(draftOf(it, startUploadType(photoTypes, ""), fallbackPhoto));
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const clearFieldError = (key: FieldKey) =>
    setFieldErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const closeForm = () => {
    revokeDraftUrls(draft);
    setFormOpen(false);
  };

  const save = async () => {
    if (!draft) return;
    // Every missing field is marked on itself, all at once.
    const missing: FieldErrors = checkDraft(draft);
    if (!formType) missing.type = "יש לבחור סוג פריט";
    setFieldErrors(missing);
    if (!formType || Object.keys(missing).length > 0) return;

    setSaving(true);
    setFormError("");
    try {
      const body = { item_type_id: formType.item_type_id, ...(await draftPayload(draft)) };
      const res = await apiFetch(draft.id == null ? "/api/settings/reference-items" : `/api/settings/reference-items/${draft.id}`, {
        method: draft.id == null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "שגיאה בשמירה");
      }
      revokeDraftUrls(draft);
      setFormOpen(false);
      // Jump the browse view to the type we just saved under, and reload it.
      setSelectedType(formType);
      if (selectedType?.item_type_id === formType.item_type_id) {
        loadItems(formType.item_type_id);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  // Asked through the app's ConfirmDialog (below), not window.confirm.
  const deleteItem = async () => {
    if (draft?.id == null) return;
    setConfirmDelete(false);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/settings/reference-items/${draft.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "שגיאה במחיקה");
      }
      revokeDraftUrls(draft);
      setFormOpen(false);
      if (selectedType) loadItems(selectedType.item_type_id);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "שגיאה במחיקה");
    } finally {
      setSaving(false);
    }
  };

  // ---- render --------------------------------------------------------------
  const typeName = selectedType?.item_type_desc ?? "";
  const templateLines = isPackage && lines.status === "ready" ? lines.lines : null;
  // A package type's dialog needs its contents; until they load it waits.
  const canAdd = !isPackage || lines.status === "ready";
  const newLabel = isPackage ? "ייחוס מארז חדש" : "פריט ייחוס חדש";

  // The settings layout owns the frame (scroll, padding, 1180 column).
  return (
    <div dir="rtl" style={{ color: C.ink }}>
      <SettingsToolbar
        title="פריטי ייחוס"
        subtitle="בחר סוג פריט, ואז סנן לפי מק״ט יצרן או יצרן. פריט הייחוס משמש להשוואה אוטומטית בבדיקות."
        countText={selectedType && !loadingItems && !itemsError ? headerCount : undefined}
        onAdd={canAdd ? openNew : undefined}
        addLabel={newLabel}
      />

      {optionsError && (
        <div className="settings-card settings-error" style={{ marginTop: "var(--space-lg)" }}>
          <Alert severity="error">טעינת סוגי הפריטים או סוגי התמונות נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={loadOptions}>נסה שוב</Button>
        </div>
      )}

      {/* Step 1: choose type */}
      <div className="settings-card ri-step-card">
        <StepBadge n={1} label="בחר סוג פריט" />
        <div style={{ display: "flex", gap: "var(--space-ml)", alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 260, maxWidth: 480 }}>
            <SearchableCombobox<ItemType>
              value={selectedType}
              onChange={setSelectedType}
              options={itemTypes}
              getOptionLabel={(o) => o.item_type_desc}
              isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
              placeholder="הקלד או בחר סוג פריט…"
            />
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-small)", color: C.muted, maxWidth: 240, lineHeight: 1.45 }}>
            בחירת הסוג תציג את פריטי הייחוס המתאימים בלבד.
          </p>
        </div>
        {isPackage && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, padding: "12px 14px", fontSize: "var(--text-small)", background: "var(--color-primary-tint)", border: "1px solid var(--color-primary-soft)", borderRadius: "var(--r-md)" }}>
            <Package size={18} strokeWidth={1.75} aria-hidden style={{ color: C.accent, marginTop: 1, flexShrink: 0 }} />
            <span>
              <span style={{ fontWeight: 600 }}>{typeName} הוא סוג מארז.</span>{" "}
              כל ייחוס שלו כולל את הקופסה עצמה ופריט ייחוס לכל פריט בתכולה
              {templateLines && templateLines.length > 0 && <>: {templateLines.map((l) => `${l.item_type_desc} ×${l.quantity}`).join(", ")}</>}.
            </span>
          </div>
        )}
      </div>

      {/* Step 2 + grid */}
      {selectedType && (
        <>
          <div style={{ marginTop: "var(--space-lg)" }}>
            <StepBadge n={2} label="סנן לפי מק״ט יצרן או יצרן" />
            <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ minWidth: 240, flex: 1, maxWidth: 320 }}>
                <SearchableCombobox<string>
                  label="מק״ט יצרן"
                  value={skuFilter}
                  onChange={setSkuFilter}
                  options={skuOptions}
                  getOptionLabel={(o) => o}
                  placeholder="כל המק״טים"
                />
              </div>
              <div style={{ minWidth: 240, flex: 1, maxWidth: 320 }}>
                <SearchableCombobox<string>
                  label="יצרן"
                  value={manuFilter}
                  onChange={setManuFilter}
                  options={manuOptions}
                  getOptionLabel={(o) => o}
                  placeholder="כל היצרנים"
                />
              </div>
              {anyFilter && (
                <Button variant="text" onClick={clearFilters}>נקה סינון</Button>
              )}
            </div>
          </div>

          {isPackage && lines.status === "error" && (
            <div className="settings-card settings-error" style={{ marginTop: "var(--space-lg)" }}>
              <Alert severity="error">טעינת התכולה של {typeName} נכשלה. בלעדיה אי אפשר לערוך ייחוסי מארז. בדוק את החיבור לשרת ונסה שוב.</Alert>
              <Button variant="outlined" color="inherit" size="small" onClick={() => loadLines(selectedType.item_type_id)}>נסה שוב</Button>
            </div>
          )}

          {itemsError ? (
            <div className="settings-card settings-error" style={{ marginTop: "var(--space-lg)" }}>
              <Alert severity="error">טעינת פריטי הייחוס של {typeName} נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
              <Button variant="outlined" color="inherit" size="small" onClick={() => loadItems(selectedType.item_type_id)}>נסה שוב</Button>
            </div>
          ) : loadingItems ? (
            // Skeleton cards in the grid's own shape, not a centred spinner.
            <div className="ri-grid" aria-busy="true" aria-label="טוען פריטי ייחוס">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="settings-card" aria-hidden>
                  <Skeleton variant="rectangular" width="100%" height={172} />
                  <div style={{ padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <Skeleton width={70} height={18} />
                    <Skeleton width="80%" height={16} />
                    <Skeleton width="60%" height={13} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            anyFilter ? (
              <div className="settings-empty" style={{ padding: "64px 0" }}>
                <div className="settings-empty__title">אין {isPackage ? "ייחוסי מארז" : "פריטי ייחוס"} שתואמים לסינון.</div>
                <div>נקה את הסינון כדי לראות את כל {isPackage ? "ייחוסי המארז" : "פריטי הייחוס"} של {typeName}.</div>
                <Button variant="outlined" color="inherit" onClick={clearFilters}>נקה סינון</Button>
              </div>
            ) : (
              <div className="settings-empty" style={{ padding: "64px 0" }}>
                <div className="settings-empty__title">עדיין אין {isPackage ? "ייחוסי מארז" : "פריטי ייחוס"} ל{typeName}.</div>
                <div>
                  {isPackage
                    ? "צור ייחוס מארז כדי שעמדת הפתיחה תדע מה צריך להיות בקופסה ומול מה להשוות כל פריט."
                    : "צור פריט ייחוס כדי שהבדיקות של סוג זה יושוו אליו אוטומטית."}
                </div>
                {canAdd && <Button onClick={openNew} startIcon={<AddIcon fontSize={18} aria-hidden />}>{newLabel}</Button>}
              </div>
            )
          ) : (
            <div className="ri-grid">
              {filtered.map((it) => (
                <ReferenceCard key={it.reference_item_id} item={it} lines={templateLines} onEdit={() => openEdit(it)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* No type chosen */}
      {!selectedType && (
        <div className="settings-empty" style={{ paddingTop: 56, paddingBottom: 20 }}>
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: "var(--r-pill)",
              background: C.card,
              border: `1px solid ${C.hairline}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.muted,
            }}
          >
            <Inventory2OutlinedIcon fontSize={30} aria-hidden />
          </span>
          <div className="settings-empty__title" style={{ fontSize: "var(--text-lead)", marginTop: 6 }}>בחר סוג פריט כדי להתחיל</div>
          <div style={{ fontSize: "var(--text-body-sm)" }}>פריטי הייחוס יוצגו לפי הסוג שתבחר למעלה.</div>
        </div>
      )}

      {/* Add / Edit dialog of a regular reference item */}
      <Dialog
        open={formOpen}
        onClose={closeForm}
        maxWidth={false}
        fullWidth
        dir="rtl"
        PaperProps={{ style: { maxWidth: 720 } }}
      >
        <DialogTitle onClose={closeForm}>
          <span style={{ minWidth: 0 }}>
            {draft?.id == null ? "פריט ייחוס חדש" : "עריכת פריט ייחוס"}
            <span style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 400, color: C.muted, marginTop: 4, fontFamily: "var(--font-text)" }}>
              פריט הייחוס ישמש להשוואה אוטומטית בבדיקות.
            </span>
          </span>
        </DialogTitle>

        <DialogContent>
          {draft && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-ml)" }}>
              <ReferenceItemFields
                idPrefix="ri"
                draft={draft}
                onDraft={setDraft}
                errors={fieldErrors}
                onClearError={clearFieldError}
                photoTypes={photoTypes}
                relevantStationTypes={stationTypesOf(formType?.item_type_id)}
                typeField={
                  // Package types have their own dialog (a package reference).
                  <SearchableCombobox<ItemType>
                    label="סוג פריט"
                    required
                    value={formType}
                    onChange={(v) => { setFormType(v); clearFieldError("type"); }}
                    options={regularTypes}
                    getOptionLabel={(o) => o.item_type_desc}
                    isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                    placeholder="בחר סוג פריט…"
                    error={!!fieldErrors.type}
                    helperText={fieldErrors.type}
                  />
                }
              />
              {formError && <Alert severity="error">{formError}</Alert>}
            </div>
          )}
        </DialogContent>

        {/* Standard footer: delete at the start, Cancel then Save at the end. */}
        <DialogActions>
          {draft?.id != null && (
            <Button
              variant="text"
              color="error"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
              style={{ order: -1, marginInlineEnd: "auto" }}
            >
              מחק פריט
            </Button>
          )}
          <Button variant="outlined" color="inherit" onClick={closeForm} disabled={saving}>
            ביטול
          </Button>
          <Button onClick={save} loading={saving}>
            שמירה
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        draggable={false}
        open={confirmDelete}
        title="מחיקת פריט ייחוס"
        message={`למחוק את פריט הייחוס "${draft?.name.trim() || draft?.sku.trim() || "ללא שם"}"? פעולה זו אינה ניתנת לביטול.`}
        confirmText="מחק"
        destructive
        onConfirm={deleteItem}
        onCancel={() => setConfirmDelete(false)}
      />

      {pkgDialog && selectedType && templateLines && (
        <PackageReferenceDialog
          key={pkgDialog.key}
          packageType={selectedType}
          editing={pkgDialog.editing}
          lines={templateLines}
          photoTypes={photoTypes}
          stationTypesOf={stationTypesOf}
          onClose={() => setPkgDialog(null)}
          onSaved={() => { setPkgDialog(null); loadItems(selectedType.item_type_id); }}
        />
      )}
    </div>
  );
}

// ---- small presentational helpers ------------------------------------------
function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--r-pill)",
          background: C.accent,
          color: "var(--color-on-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--text-small)",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <h2 style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 600, color: C.ink }}>
        {label}
      </h2>
    </div>
  );
}

/** A reference item's card. With `lines` (a package type's contents) it is a
 *  package reference's: which content lines have a reference item. */
function ReferenceCard({ item, lines, onEdit }: { item: ReferenceItem; lines: TemplateLine[] | null; onEdit: () => void }) {
  const title = item.name || item.item_type_desc || "פריט ייחוס";
  const lineState = lines?.map((l) => ({ ...l, has: item.members.some((m) => m.item_type_id === l.item_type_id) })) ?? null;
  const missing = lineState?.filter((l) => !l.has).map((l) => l.item_type_desc) ?? [];
  return (
    // The whole card opens the item for editing: a real button (Tab, Enter /
    // Space), hover and focus in settings.css (.ri-card).
    <button type="button" className="ri-card" onClick={onEdit} aria-label={`עריכת ${title}`}>
      {item.cover_url ? (
        <span style={{ display: "block", position: "relative", background: "var(--color-canvas-parchment)" }}>
          {/* contain (not cover) so the whole reference image is visible, not cropped */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.cover_url}
            alt=""
            style={{ width: "100%", height: 172, objectFit: "contain", display: "block" }}
          />
          {item.image_count > 1 && (
            <span
              style={{
                position: "absolute",
                top: 10,
                insetInlineStart: 10,
                background: "color-mix(in srgb, var(--color-ink) 72%, transparent)",
                color: "var(--color-on-dark)",
                fontSize: "var(--text-micro)",
                fontWeight: 600,
                borderRadius: "var(--r-pill)",
                padding: "3px 9px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {item.image_count} תמונות
            </span>
          )}
        </span>
      ) : (
        <span
          style={{
            height: 172,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "var(--color-canvas-parchment)",
            color: C.muted,
          }}
        >
          <Inventory2OutlinedIcon fontSize={40} aria-hidden />
          <span style={{ fontSize: "var(--text-fine)" }}>ממתין לתמונה</span>
        </span>
      )}
      <span style={{ padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Tag tone="neutral">{item.item_type_desc ?? "—"}</Tag>
            {lineState && <Tag tone="primary">ייחוס מארז</Tag>}
          </span>
          <EditOutlinedIcon fontSize={16} color="var(--color-ink-muted-48)" aria-hidden />
        </span>
        <span style={{ fontSize: "var(--text-body)", fontWeight: 600, lineHeight: 1.25, color: C.ink }}>
          {title}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "var(--text-small)", color: C.muted }}>
          <span>
            מק״ט יצרן ·{" "}
            <bdi dir="ltr" style={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>
              {item.manufacturer_sku}
            </bdi>
          </span>
          <span>
            יצרן · <bdi style={{ color: C.ink }}>{item.manufacturer}</bdi>
          </span>
        </span>
        {lineState && lineState.length > 0 && (
          <>
            <span style={{ height: 1, background: "var(--color-divider-soft)" }} />
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "var(--text-fine)", color: C.muted }}>
              <span>פריטי ייחוס בתכולה</span>
              <span style={{ fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{lineState.length - missing.length} מתוך {lineState.length}</span>
            </span>
            <span className="ri-lines">
              {lineState.map((l) => (
                <Tag key={l.item_type_id} tone={l.has ? "success" : "warning"} icon={l.has ? <Check size={12} strokeWidth={2.5} aria-hidden /> : undefined}>
                  {l.item_type_desc}
                </Tag>
              ))}
            </span>
            {missing.length > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-fine)", fontWeight: 500, color: "var(--color-warning-ink)" }}>
                <CircleAlert size={14} strokeWidth={2} aria-hidden />
                חסר פריט ייחוס: {missing.join(", ")}
              </span>
            )}
          </>
        )}
      </span>
    </button>
  );
}
