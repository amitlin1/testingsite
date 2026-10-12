"use client";

import * as React from "react";
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Tag,
  TextField,
} from "@/components/ui";
import { Add as AddIcon } from "@/components/ui/icons";
import { Close as CloseIcon } from "@/components/ui/icons";
import { EditOutlined as EditOutlinedIcon } from "@/components/ui/icons";
import { CloudUploadOutlined as CloudUploadOutlinedIcon } from "@/components/ui/icons";
import { Star as StarIcon } from "@/components/ui/icons";
import { Inventory2Outlined as Inventory2OutlinedIcon } from "@/components/ui/icons";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import SettingsToolbar from "../components/SettingsToolbar";
import { apiFetch } from "@/lib/api/client";
import { uploadReferenceImages } from "@/lib/api/direct-upload";

// ---- Types -----------------------------------------------------------------
interface ItemType {
  item_type_id: number;
  item_type_desc: string;
}

interface RefImage {
  id: number;
  file_name: string;
  sort_order: number;
  /** photo_types.code — which group this image belongs to ("package" | "product" | ...). */
  photo_type: string | null;
  url: string;
  is_primary: boolean;
}

interface PhotoType {
  photo_type_id: number;
  code: string;
  photo_type_desc: string;
  sort_order: number;
}

interface ReferenceItem {
  reference_item_id: number;
  reference_weight: string | null;
  item_type_id: number;
  item_type_desc: string | null;
  manufacturer_sku: string;
  manufacturer: string;
  name: string | null;
  notes: string | null;
  primary_image_id: number | null;
  images: RefImage[];
  cover_url: string | null;
  image_count: number;
}

// A form image is either one already stored on the server, or a freshly
// selected File that hasn't been uploaded yet. `key` is stable within the form.
// `photoType` is the photo_types.code of the group the image belongs to.
type FormImage =
  | { key: string; kind: "existing"; id: number; url: string; fileName: string; photoType: string }
  | { key: string; kind: "new"; url: string; file: File; fileName: string; photoType: string };

/** The form fields a save checks; each error is shown on its field. */
type FieldKey = "type" | "sku" | "manu" | "weight" | "name";

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

let keySeq = 0;
const nextKey = () => `img_${Date.now()}_${keySeq++}`;

export default function ReferenceItemsPage() {
  const [itemTypes, setItemTypes] = React.useState<ItemType[]>([]);
  const [selectedType, setSelectedType] = React.useState<ItemType | null>(null);
  const [photoTypes, setPhotoTypes] = React.useState<PhotoType[]>([]);

  const [items, setItems] = React.useState<ReferenceItem[]>([]);
  const [loadingItems, setLoadingItems] = React.useState(false);
  // A failed load is not "no items": each gets an error band and a retry.
  const [itemsError, setItemsError] = React.useState(false);
  const [optionsError, setOptionsError] = React.useState(false);

  const [skuFilter, setSkuFilter] = React.useState<string | null>(null);
  const [manuFilter, setManuFilter] = React.useState<string | null>(null);

  // dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [formType, setFormType] = React.useState<ItemType | null>(null);
  const [formSku, setFormSku] = React.useState("");
  const [formManu, setFormManu] = React.useState("");
  const [formName, setFormName] = React.useState("");
  const [formreference_weight, setFormreference_weight] = React.useState("");
  const [formNotes, setFormNotes] = React.useState("");
  const [formImages, setFormImages] = React.useState<FormImage[]>([]);
  const [primaryKey, setPrimaryKey] = React.useState<string | null>(null);
  // Which photo group newly-added files go to (photo_types.code).
  const [uploadType, setUploadType] = React.useState<string>("");
  const [formError, setFormError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // ---- data loading --------------------------------------------------------
  const loadOptions = React.useCallback(() => {
    setOptionsError(false);
    apiFetch("/api/settings/item-types")
      .then(okJson)
      .then((data: ItemType[]) => setItemTypes(Array.isArray(data) ? data : []))
      .catch(() => { setItemTypes([]); setOptionsError(true); });
    apiFetch("/api/settings/photo-types")
      .then(okJson)
      .then((data: PhotoType[]) => {
        const rows = Array.isArray(data) ? data : [];
        setPhotoTypes(rows);
        setUploadType((cur) => cur || rows[0]?.code || "");
      })
      .catch(() => { setPhotoTypes([]); setOptionsError(true); });
  }, []);

  React.useEffect(() => { loadOptions(); }, [loadOptions]);

  const loadItems = React.useCallback((typeId: number) => {
    setLoadingItems(true);
    setItemsError(false);
    apiFetch(`/api/settings/reference-items?itemTypeId=${typeId}`)
      .then(okJson)
      .then((data: ReferenceItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => { setItems([]); setItemsError(true); })
      .finally(() => setLoadingItems(false));
  }, []);

  React.useEffect(() => {
    if (selectedType) {
      loadItems(selectedType.item_type_id);
      setSkuFilter(null);
      setManuFilter(null);
    } else {
      setItems([]);
    }
  }, [selectedType, loadItems]);

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
  const headerCount = anyFilter
    ? `${filtered.length} מתוך ${items.length}`
    : `${items.length} פריטים`;

  // ---- dialog helpers ------------------------------------------------------
  const revokeNewUrls = React.useCallback((imgs: FormImage[]) => {
    imgs.forEach((img) => {
      if (img.kind === "new") URL.revokeObjectURL(img.url);
    });
  }, []);

  const openNew = () => {
    setEditingId(null);
    setFormType(selectedType);
    setFormSku("");
    setFormreference_weight("");
    setFormManu("");
    setFormName("");
    setFormNotes("");
    setFormImages([]);
    setPrimaryKey(null);
    setUploadType(photoTypes[0]?.code ?? "");
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (it: ReferenceItem) => {
    setEditingId(it.reference_item_id);
    setFormType(itemTypes.find((t) => t.item_type_id === it.item_type_id) ?? selectedType);
    setFormSku(it.manufacturer_sku);
    setFormManu(it.manufacturer);
    setFormName(it.name ?? "");
    setFormreference_weight(it.reference_weight ?? "");
    setFormNotes(it.notes ?? "");
    const imgs: FormImage[] = it.images.map((img) => ({
      key: `e_${img.id}`,
      kind: "existing",
      id: img.id,
      url: img.url,
      fileName: img.file_name,
      photoType: img.photo_type ?? photoTypes[0]?.code ?? "",
    }));
    setFormImages(imgs);
    const primary = it.images.find((i) => i.is_primary) ?? it.images[0];
    setPrimaryKey(primary ? `e_${primary.id}` : null);
    setUploadType(photoTypes[0]?.code ?? "");
    setFormError("");
    setFieldErrors({});
    setFormOpen(true);
  };

  const clearFieldError = (key: FieldKey) =>
    setFieldErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const closeForm = () => {
    revokeNewUrls(formImages);
    setFormOpen(false);
  };

  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    if (!uploadType) {
      setFormError("יש לבחור סוג תמונה לפני העלאה.");
      return;
    }
    // Every added file is tagged with the currently selected photo group.
    const tagType = uploadType;
    setFormImages((prev) => {
      const additions: FormImage[] = imgs.map((f) => ({
        key: nextKey(),
        kind: "new",
        url: URL.createObjectURL(f),
        file: f,
        fileName: f.name,
        photoType: tagType,
      }));
      const next = [...prev, ...additions];
      setPrimaryKey((pk) => pk ?? next[0]?.key ?? null);
      return next;
    });
    setFormError("");
  };

  const removeImage = (key: string) => {
    setFormImages((prev) => {
      const target = prev.find((i) => i.key === key);
      if (target && target.kind === "new") URL.revokeObjectURL(target.url);
      const next = prev.filter((i) => i.key !== key);
      setPrimaryKey((pk) => (pk === key ? next[0]?.key ?? null : pk));
      return next;
    });
  };

  const save = async () => {
    // Every missing field is marked on itself, all at once.
    const missing: Partial<Record<FieldKey, string>> = {};
    if (!formType) missing.type = "יש לבחור סוג פריט";
    if (!formSku.trim()) missing.sku = "יש להזין מק״ט יצרן";
    if (!formManu.trim()) missing.manu = "יש להזין יצרן";
    if (!formreference_weight.trim()) missing.weight = "יש להזין משקל";
    if (!formName.trim()) missing.name = "יש להזין שם";
    setFieldErrors(missing);
    if (!formType || Object.keys(missing).length > 0) return;

    // New files, in display order — the server appends them in this same order.
    const newImages = formImages.filter((i) => i.kind === "new") as Extract<
      FormImage,
      { kind: "new" }
    >[];

    // Everything except the image bytes. `images` is filled in after the direct
    // upload below, with the keys MinIO now holds.
    const payload: Record<string, unknown> = {
      item_type_id: formType.item_type_id,
      manufacturer_sku: formSku.trim(),
      manufacturer: formManu.trim(),
      name: formName.trim(),
      reference_weight: formreference_weight.trim(),
      notes: formNotes.trim(),
    };

    if (editingId == null) {
      payload.primaryIndex = Math.max(
        0,
        newImages.findIndex((i) => i.key === primaryKey),
      );
    } else {
      payload.keepImageIds = formImages
        .filter((i) => i.kind === "existing")
        .map((i) => (i as Extract<FormImage, { kind: "existing" }>).id);

      const primary = formImages.find((i) => i.key === primaryKey);
      if (primary?.kind === "existing") {
        payload.primaryKey = String(primary.id);
      } else if (primary?.kind === "new") {
        payload.primaryKey = `new:${newImages.findIndex((i) => i.key === primary.key)}`;
      }
    }

    setSaving(true);
    setFormError("");
    try {
      // 1) New images go from the browser straight to MinIO. Nothing is saved on
      //    the item yet, so a failed upload leaves no half-written item behind.
      payload.images = await uploadReferenceImages(
        newImages.map((img) => ({ file: img.file, fileName: img.fileName, photoType: img.photoType })),
        editingId,
      );
      // 2) The form itself is plain JSON — the server verifies every key before
      //    it touches the item.
      const url =
        editingId == null
          ? "/api/settings/reference-items"
          : `/api/settings/reference-items/${editingId}`;
      const res = await apiFetch(url, {
        method: editingId == null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "שגיאה בשמירה");
      }
      revokeNewUrls(formImages);
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
    if (editingId == null) return;
    setConfirmDelete(false);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/settings/reference-items/${editingId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "שגיאה במחיקה");
      }
      revokeNewUrls(formImages);
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

  // The settings layout owns the frame (scroll, padding, 1180 column).
  return (
    <div dir="rtl" style={{ color: C.ink }}>
      <SettingsToolbar
        title="פריטי ייחוס"
        subtitle="בחר סוג פריט, ואז סנן לפי מק״ט יצרן או יצרן. פריט הייחוס משמש להשוואה אוטומטית בבדיקות."
        countText={selectedType && !loadingItems && !itemsError ? headerCount : undefined}
        onAdd={openNew}
        addLabel="פריט ייחוס חדש"
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
                <div className="settings-empty__title">אין פריטי ייחוס שתואמים לסינון.</div>
                <div>נקה את הסינון כדי לראות את כל פריטי הייחוס של {typeName}.</div>
                <Button variant="outlined" color="inherit" onClick={clearFilters}>נקה סינון</Button>
              </div>
            ) : (
              <div className="settings-empty" style={{ padding: "64px 0" }}>
                <div className="settings-empty__title">עדיין אין פריטי ייחוס ל{typeName}.</div>
                <div>צור פריט ייחוס כדי שהבדיקות של סוג זה יושוו אליו אוטומטית.</div>
                <Button onClick={openNew} startIcon={<AddIcon fontSize={18} aria-hidden />}>פריט ייחוס חדש</Button>
              </div>
            )
          ) : (
            <div className="ri-grid">
              {filtered.map((it) => (
                <ReferenceCard key={it.reference_item_id} item={it} onEdit={() => openEdit(it)} />
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

      {/* Add / Edit dialog */}
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
            {editingId == null ? "פריט ייחוס חדש" : "עריכת פריט ייחוס"}
            <span style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 400, color: C.muted, marginTop: 4, fontFamily: "var(--font-text)" }}>
              פריט הייחוס ישמש להשוואה אוטומטית בבדיקות.
            </span>
          </span>
        </DialogTitle>

        <DialogContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-ml)" }}>
            <div className="ri-form-grid">
              <SearchableCombobox<ItemType>
                label="סוג פריט"
                required
                value={formType}
                onChange={(v) => { setFormType(v); clearFieldError("type"); }}
                options={itemTypes}
                getOptionLabel={(o) => o.item_type_desc}
                isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                placeholder="בחר סוג פריט…"
                error={!!fieldErrors.type}
                helperText={fieldErrors.type}
              />
              <TextField
                label="מק״ט יצרן"
                required
                fullWidth
                value={formSku}
                onChange={(e) => { setFormSku(e.target.value); clearFieldError("sku"); }}
                placeholder="לדוגמה: 745781-4"
                error={!!fieldErrors.sku}
                helperText={fieldErrors.sku}
                // A code: typed left-to-right, aligned with the Hebrew labels.
                inputProps={{ dir: "ltr", style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
              />
              <TextField
                label="משקל"
                required
                fullWidth
                value={formreference_weight}
                onChange={(e) => { setFormreference_weight(e.target.value); clearFieldError("weight"); }}
                placeholder="לדוגמה: 0.5kg"
                error={!!fieldErrors.weight}
                helperText={fieldErrors.weight}
                inputProps={{ dir: "ltr", style: { textAlign: "right" } }}
              />
            </div>

            <div className="ri-form-grid">
              <TextField
                label="יצרן"
                required
                fullWidth
                value={formManu}
                onChange={(e) => { setFormManu(e.target.value); clearFieldError("manu"); }}
                placeholder="לדוגמה: TE Connectivity"
                error={!!fieldErrors.manu}
                helperText={fieldErrors.manu}
              />
              <TextField
                label="שם הפריט"
                required
                fullWidth
                value={formName}
                onChange={(e) => { setFormName(e.target.value); clearFieldError("name"); }}
                placeholder="תיאור קצר"
                error={!!fieldErrors.name}
                helperText={fieldErrors.name}
              />
            </div>

            {/* images */}
            <div role="group" aria-labelledby="ri-images-label">
              <div id="ri-images-label" className="sh-field-label">תמונות ייחוס</div>

              {/* Photo-group selector: newly-added files are tagged with the
                  active group ("צילום אריזה" / "צילום פריט" / ...). */}
              {photoTypes.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "var(--text-small)", color: C.muted }}>העלאה אל:</span>
                  {photoTypes.map((pt) => (
                    <button
                      key={pt.code}
                      type="button"
                      className="ri-chip"
                      aria-pressed={pt.code === uploadType}
                      onClick={() => setUploadType(pt.code)}
                    >
                      {pt.photo_type_desc}
                    </button>
                  ))}
                </div>
              )}

              {/* Drop zone: a click or Enter / Space opens the file picker. */}
              <div
                role="button"
                tabIndex={0}
                aria-label="הוספת תמונות ייחוס: גרור תמונות לכאן או לחץ לבחירה"
                className={"ri-drop" + (dragOver ? " ri-drop--over" : "")}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  addFiles([...(e.dataTransfer?.files ?? [])]);
                }}
              >
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "var(--r-pill)",
                    background: C.card,
                    border: `1px solid ${C.hairline}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.muted,
                  }}
                >
                  <CloudUploadOutlinedIcon fontSize={20} aria-hidden />
                </span>
                <span style={{ fontSize: "var(--text-body-sm)", color: C.ink }}>
                  גרור תמונות לכאן, או{" "}
                  <span style={{ color: C.accent, fontWeight: 600 }}>לחץ לבחירה</span>
                </span>
                <span style={{ fontSize: "var(--text-fine)", color: C.muted }}>
                  PNG או JPG · עד 50MB לתמונה · ניתן לבחור כמה
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    addFiles([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </div>

              {/* Thumbnails grouped by photo type — one section per group so it's
                  obvious which reference set each image belongs to. */}
              {formImages.length > 0 && (() => {
                const knownCodes = photoTypes.map((pt) => pt.code);
                const groups: Array<{ code: string; label: string; images: FormImage[] }> = [
                  ...photoTypes.map((pt) => ({
                    code: pt.code,
                    label: pt.photo_type_desc,
                    images: formImages.filter((i) => i.photoType === pt.code),
                  })),
                  // Safety net: images whose code isn't in the active list (e.g. a
                  // type deactivated after upload) still render, under their code.
                  ...[...new Set(formImages.map((i) => i.photoType).filter((c) => !knownCodes.includes(c)))]
                    .map((code) => ({ code, label: code, images: formImages.filter((i) => i.photoType === code) })),
                ].filter((g) => g.images.length > 0);

                return groups.map((group) => (
                  <div key={group.code} style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", marginBottom: "var(--space-xs)" }}>
                      <span style={{ fontSize: "var(--text-small)", fontWeight: 600, color: C.ink }}>{group.label}</span>
                      <span style={{ fontSize: "var(--text-fine)", color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                        {group.images.length} תמונות
                      </span>
                      <span style={{ flex: 1, height: 1, background: "var(--color-divider-soft)" }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: "var(--space-sm)" }}>
                      {group.images.map((img) => {
                        const isPrimary = img.key === primaryKey;
                        return (
                          <div
                            key={img.key}
                            style={{
                              position: "relative",
                              aspectRatio: "1 / 1",
                              borderRadius: "var(--r-sm)",
                              overflow: "hidden",
                              border: isPrimary ? `2px solid ${C.accent}` : `1px solid ${C.hairline}`,
                              background: "var(--color-canvas-parchment)",
                            }}
                          >
                            {/* contain so the full image is visible in the square preview */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={img.fileName}
                              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                            />
                            <div style={{ position: "absolute", top: 4, insetInlineStart: 4, display: "flex", gap: 4 }}>
                              <IconButton
                                size="small"
                                round
                                color={isPrimary ? "primary" : "default"}
                                title={isPrimary ? "תמונת הכריכה" : `הגדר את ${img.fileName} כתמונת כריכה`}
                                aria-pressed={isPrimary}
                                onClick={(e) => { e.stopPropagation(); setPrimaryKey(img.key); }}
                              >
                                <StarIcon fontSize={14} fill={isPrimary ? "currentColor" : "none"} aria-hidden />
                              </IconButton>
                              <IconButton
                                size="small"
                                round
                                color="error"
                                title={`הסר את ${img.fileName}`}
                                onClick={(e) => { e.stopPropagation(); removeImage(img.key); }}
                              >
                                <CloseIcon fontSize={14} aria-hidden />
                              </IconButton>
                            </div>
                            {isPrimary && (
                              <span
                                style={{
                                  position: "absolute",
                                  bottom: 0,
                                  insetInline: 0,
                                  background: C.accent,
                                  color: "var(--color-on-primary)",
                                  fontSize: "var(--text-micro)",
                                  fontWeight: 600,
                                  textAlign: "center",
                                  padding: "2px 0",
                                }}
                              >
                                כריכה
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* notes */}
            <TextField
              label={<>הערות <span style={{ color: C.muted, fontWeight: 400 }}>· לא חובה</span></>}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="נקודות לבדיקה, מאפיינים מיוחדים, או סטיות מותרות…"
              multiline
              minRows={3}
              fullWidth
            />

            {formError && <Alert severity="error">{formError}</Alert>}
          </div>
        </DialogContent>

        {/* Standard footer: delete at the start, Cancel then Save at the end. */}
        <DialogActions>
          {editingId != null && (
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
        message={`למחוק את פריט הייחוס "${formName.trim() || formSku.trim() || "ללא שם"}"? פעולה זו אינה ניתנת לביטול.`}
        confirmText="מחק"
        destructive
        onConfirm={deleteItem}
        onCancel={() => setConfirmDelete(false)}
      />
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

function ReferenceCard({ item, onEdit }: { item: ReferenceItem; onEdit: () => void }) {
  const title = item.name || item.item_type_desc || "פריט ייחוס";
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
          <Tag tone="neutral">{item.item_type_desc ?? "—"}</Tag>
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
      </span>
    </button>
  );
}
