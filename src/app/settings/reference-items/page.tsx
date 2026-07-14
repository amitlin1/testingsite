"use client";

import * as React from "react";
import {
  Box,
  Typography,
  Button,
  Dialog,
  TextField,
  CircularProgress,
} from "@mui/material";
import { Add as AddIcon } from "@/components/ui/icons";
import { Close as CloseIcon } from "@/components/ui/icons";
import { EditOutlined as EditOutlinedIcon } from "@/components/ui/icons";
import { DeleteOutline as DeleteOutlineIcon } from "@/components/ui/icons";
import { CloudUploadOutlined as CloudUploadOutlinedIcon } from "@/components/ui/icons";
import { Star as StarIcon } from "@/components/ui/icons";
import { StarBorder as StarBorderIcon } from "@/components/ui/icons";
import { Inventory2Outlined as Inventory2OutlinedIcon } from "@/components/ui/icons";
import { ErrorOutline as ErrorOutlineIcon } from "@/components/ui/icons";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";

// ---- Types -----------------------------------------------------------------
interface ItemType {
  item_type_id: number;
  item_type_desc: string;
}

interface RefImage {
  id: number;
  file_name: string;
  sort_order: number;
  url: string;
  is_primary: boolean;
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
type FormImage =
  | { key: string; kind: "existing"; id: number; url: string; fileName: string }
  | { key: string; kind: "new"; url: string; file: File; fileName: string };

// ---- Design tokens (Shifthouse) --------------------------------------------
const C = {
  accent: "#0066cc",
  accentHover: "#0058b3",
  ink: "#1d1d1f",
  muted: "#7a7a7a",
  mutedSoft: "#9a9aa0",
  hairline: "#e0e0e0",
  card: "#fff",
  subtle: "#fafafc",
  danger: "#bf3535",
};

let keySeq = 0;
const nextKey = () => `img_${Date.now()}_${keySeq++}`;

export default function ReferenceItemsPage() {
  const [itemTypes, setItemTypes] = React.useState<ItemType[]>([]);
  const [selectedType, setSelectedType] = React.useState<ItemType | null>(null);

  const [items, setItems] = React.useState<ReferenceItem[]>([]);
  const [loadingItems, setLoadingItems] = React.useState(false);

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
  const [formError, setFormError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // ---- data loading --------------------------------------------------------
  React.useEffect(() => {
    fetch("/api/settings/item-types")
      .then((r) => r.json())
      .then((data: ItemType[]) => setItemTypes(Array.isArray(data) ? data : []))
      .catch(() => setItemTypes([]));
  }, []);

  const loadItems = React.useCallback((typeId: number) => {
    setLoadingItems(true);
    fetch(`/api/settings/reference-items?itemTypeId=${typeId}`)
      .then((r) => r.json())
      .then((data: ReferenceItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
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
    setFormError("");
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
    }));
    setFormImages(imgs);
    const primary = it.images.find((i) => i.is_primary) ?? it.images[0];
    setPrimaryKey(primary ? `e_${primary.id}` : null);
    setFormError("");
    setFormOpen(true);
  };

  const closeForm = () => {
    revokeNewUrls(formImages);
    setFormOpen(false);
  };

  const addFiles = (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setFormImages((prev) => {
      const additions: FormImage[] = imgs.map((f) => ({
        key: nextKey(),
        kind: "new",
        url: URL.createObjectURL(f),
        file: f,
        fileName: f.name,
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
    if (!formType) return setFormError("יש לבחור סוג פריט.");
    if (!formSku.trim()) return setFormError("יש להזין מק״ט יצרן.");
    if (!formManu.trim()) return setFormError("יש להזין יצרן.");
    if (!formreference_weight.trim()) return setFormError("יש להזין משקל.");
    if (!formName.trim()) return setFormError("יש להזין שם.");

    const fd = new FormData();
    fd.append("item_type_id", String(formType.item_type_id));
    fd.append("manufacturer_sku", formSku.trim());
    fd.append("manufacturer", formManu.trim());
    fd.append("name", formName.trim());
    fd.append("reference_weight", formreference_weight.trim());
    fd.append("notes", formNotes.trim());

    // New files, in display order — the server appends them in this same order.
    const newImages = formImages.filter((i) => i.kind === "new") as Extract<
      FormImage,
      { kind: "new" }
    >[];
    newImages.forEach((img) => fd.append("images", img.file, img.fileName));

    if (editingId == null) {
      const primaryIndex = Math.max(
        0,
        newImages.findIndex((i) => i.key === primaryKey),
      );
      fd.append("primaryIndex", String(primaryIndex));
    } else {
      const keepIds = formImages
        .filter((i) => i.kind === "existing")
        .map((i) => (i as Extract<FormImage, { kind: "existing" }>).id);
      fd.append("keepImageIds", JSON.stringify(keepIds));

      const primary = formImages.find((i) => i.key === primaryKey);
      if (primary?.kind === "existing") {
        fd.append("primaryKey", String(primary.id));
      } else if (primary?.kind === "new") {
        fd.append("primaryKey", `new:${newImages.findIndex((i) => i.key === primary.key)}`);
      }
    }

    setSaving(true);
    setFormError("");
    try {
      const url =
        editingId == null
          ? "/api/settings/reference-items"
          : `/api/settings/reference-items/${editingId}`;
      const res = await fetch(url, { method: editingId == null ? "POST" : "PUT", body: fd });
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

  const deleteItem = async () => {
    if (editingId == null) return;
    if (!window.confirm("למחוק את פריט הייחוס? פעולה זו אינה הפיכה.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/reference-items/${editingId}`, { method: "DELETE" });
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
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        direction: "rtl",
        color: C.ink,
      }}
    >
      {/* Scroll region */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Box sx={{ maxWidth: 1180, mx: "auto", px: 3, py: 3, pb: 9 }}>
          {/* Title row */}
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 2.5,
              flexWrap: "wrap",
            }}
          >
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography
                  component="h1"
                  sx={{ m: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.6px", lineHeight: 1.1 }}
                >
                  פריטי ייחוס
                </Typography>
                {selectedType && (
                  <Box
                    sx={{
                      fontSize: 13,
                      color: C.muted,
                      bgcolor: C.card,
                      border: `1px solid ${C.hairline}`,
                      borderRadius: "9999px",
                      px: 1.4,
                      py: 0.4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {headerCount}
                  </Box>
                )}
              </Box>
              <Typography sx={{ mt: 1, fontSize: 15, color: "#444", maxWidth: 620, lineHeight: 1.5 }}>
                בחר סוג פריט, ואז סנן לפי מק״ט יצרן או יצרן. פריט הייחוס משמש להשוואה אוטומטית בבדיקות.
              </Typography>
            </Box>
            <Button
              onClick={openNew}
              startIcon={<AddIcon />}
              variant="contained"
              sx={{
                borderRadius: "9999px",
                px: 2.75,
                py: 1.4,
                fontSize: 15,
                fontWeight: 600,
                bgcolor: C.accent,
                "&:hover": { bgcolor: C.accentHover },
                whiteSpace: "nowrap",
              }}
            >
              פריט ייחוס חדש
            </Button>
          </Box>

          {/* Step 1: choose type */}
          <Box
            sx={{
              bgcolor: C.card,
              border: `1px solid ${C.hairline}`,
              borderRadius: "18px",
              p: 3,
              mt: 3,
            }}
          >
            <StepBadge n={1} label="בחר סוג פריט" />
            <Box sx={{ display: "flex", gap: 2.5, alignItems: "center", flexWrap: "wrap", mt: 1.75 }}>
              <Box sx={{ flex: 1, minWidth: 260, maxWidth: 480 }}>
                <SearchableCombobox<ItemType>
                  value={selectedType}
                  onChange={setSelectedType}
                  options={itemTypes}
                  getOptionLabel={(o) => o.item_type_desc}
                  isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                  placeholder="הקלד או בחר סוג פריט…"
                />
              </Box>
              <Typography sx={{ fontSize: 13, color: C.muted, maxWidth: 240, lineHeight: 1.45 }}>
                בחירת הסוג תציג את פריטי הייחוס המתאימים בלבד.
              </Typography>
            </Box>
          </Box>

          {/* Step 2 + grid */}
          {selectedType && (
            <>
              <Box sx={{ mt: 3 }}>
                <StepBadge n={2} label="סנן לפי מק״ט יצרן או יצרן" />
                <Box
                  sx={{
                    display: "flex",
                    gap: 2,
                    alignItems: "flex-end",
                    flexWrap: "wrap",
                    mt: 1.75,
                  }}
                >
                  <Box sx={{ minWidth: 240, flex: 1, maxWidth: 320 }}>
                    <SearchableCombobox<string>
                      label="מק״ט יצרן"
                      value={skuFilter}
                      onChange={setSkuFilter}
                      options={skuOptions}
                      getOptionLabel={(o) => o}
                      placeholder="כל המק״טים"
                    />
                  </Box>
                  <Box sx={{ minWidth: 240, flex: 1, maxWidth: 320 }}>
                    <SearchableCombobox<string>
                      label="יצרן"
                      value={manuFilter}
                      onChange={setManuFilter}
                      options={manuOptions}
                      getOptionLabel={(o) => o}
                      placeholder="כל היצרנים"
                    />
                  </Box>
                  {anyFilter && (
                    <Button
                      onClick={() => {
                        setSkuFilter(null);
                        setManuFilter(null);
                      }}
                      sx={{
                        height: 46,
                        color: C.accent,
                        fontSize: 14,
                        fontWeight: 600,
                        "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
                      }}
                    >
                      נקה סינון
                    </Button>
                  )}
                </Box>
              </Box>

              {loadingItems ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                  <CircularProgress size={30} />
                </Box>
              ) : filtered.length === 0 ? (
                <Box sx={{ textAlign: "center", py: 8 }}>
                  <Typography sx={{ fontSize: 18, fontWeight: 600, mb: 0.75 }}>
                    אין פריטי ייחוס תואמים.
                  </Typography>
                  <Typography sx={{ fontSize: 14, color: C.muted, mb: 2.5 }}>
                    נסה לשנות את הסינון, או צור פריט ייחוס חדש לסוג זה.
                  </Typography>
                  <Button
                    onClick={openNew}
                    variant="outlined"
                    sx={{
                      borderRadius: "9999px",
                      px: 2.5,
                      py: 1.25,
                      fontSize: 15,
                      fontWeight: 600,
                      borderColor: C.accent,
                      color: C.accent,
                    }}
                  >
                    פריט ייחוס חדש
                  </Button>
                </Box>
              ) : (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))",
                    gap: 2.5,
                    mt: 3,
                  }}
                >
                  {filtered.map((it) => (
                    <ReferenceCard key={it.reference_item_id} item={it} onEdit={() => openEdit(it)} />
                  ))}
                </Box>
              )}
            </>
          )}

          {/* No type chosen */}
          {!selectedType && (
            <Box sx={{ textAlign: "center", pt: 7, pb: 2.5, color: C.muted }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: "9999px",
                  bgcolor: C.card,
                  border: `1px solid ${C.hairline}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.accent,
                }}
              >
                <Inventory2OutlinedIcon sx={{ fontSize: 30 }} />
              </Box>
              <Typography sx={{ fontSize: 17, color: C.ink, fontWeight: 600, mt: 1.75 }}>
                בחר סוג פריט כדי להתחיל
              </Typography>
              <Typography sx={{ fontSize: 14, mt: 0.75 }}>
                פריטי הייחוס יוצגו לפי הסוג שתבחר למעלה.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Add / Edit dialog */}
      <Dialog
        open={formOpen}
        onClose={closeForm}
        maxWidth="sm"
        fullWidth
        dir="rtl"
        slotProps={{ paper: { sx: { borderRadius: "18px", width: "min(720px, 94vw)", maxWidth: "94vw" } } }}
      >
        {/* header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 2,
            p: 3,
            borderBottom: `1px solid ${C.hairline}`,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>
              {editingId == null ? "פריט ייחוס חדש" : "עריכת פריט ייחוס"}
            </Typography>
            <Typography sx={{ fontSize: 13, color: C.muted, mt: 0.4 }}>
              פריט הייחוס ישמש להשוואה אוטומטית בבדיקות.
            </Typography>
          </Box>
          <Box
            component="button"
            onClick={closeForm}
            sx={{
              width: 34,
              height: 34,
              border: 0,
              borderRadius: "9999px",
              bgcolor: "#f5f5f7",
              color: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              "&:hover": { bgcolor: "#ececf0" },
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </Box>
        </Box>

        {/* body */}
        <Box sx={{ p: 3, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            <SearchableCombobox<ItemType>
              label="סוג פריט"
              required
              value={formType}
              onChange={setFormType}
              options={itemTypes}
              getOptionLabel={(o) => o.item_type_desc}
              isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
              placeholder="בחר סוג פריט…"
            />
            <FieldText
              label="מק״ט יצרן"
              required
              value={formSku}
              onChange={setFormSku}
              placeholder="לדוגמה: 745781-4"
            />
            <FieldText
              label="משקל"
              required
              value={formreference_weight}
              onChange={setFormreference_weight}
              placeholder="לדוגמה: 0.5kg"
            />
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            <FieldText
              label="יצרן"
              required
              value={formManu}
              onChange={setFormManu}
              placeholder="לדוגמה: TE Connectivity"
            />
            <FieldText
              label="שם הפריט"
              optional
              value={formName}
              onChange={setFormName}
              placeholder="תיאור קצר"
            />
          </Box>

          {/* images */}
          <Box>
            <FieldCaption>תמונות ייחוס</FieldCaption>
            <Box
              onClick={() => fileRef.current?.click()}
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
              sx={{
                border: `1.5px dashed ${dragOver ? C.accent : "#c7c7cf"}`,
                borderRadius: "12px",
                bgcolor: dragOver ? "#f3f8ff" : C.subtle,
                p: 2.75,
                textAlign: "center",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                transition: "border-color 0.15s ease, background-color 0.15s ease",
                "&:hover": { borderColor: C.accent, bgcolor: "#f3f8ff" },
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: "9999px",
                  bgcolor: C.card,
                  border: `1px solid ${C.hairline}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.accent,
                }}
              >
                <CloudUploadOutlinedIcon sx={{ fontSize: 20 }} />
              </Box>
              <Typography sx={{ fontSize: 14, color: C.ink }}>
                גרור תמונות לכאן, או{" "}
                <Box component="span" sx={{ color: C.accent, fontWeight: 600 }}>
                  לחץ לבחירה
                </Box>
              </Typography>
              <Typography sx={{ fontSize: 12, color: C.mutedSoft }}>
                PNG או JPG · עד 10MB לתמונה · ניתן לבחור כמה
              </Typography>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </Box>

            {formImages.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                  gap: 1.5,
                  mt: 1.75,
                }}
              >
                {formImages.map((img) => {
                  const isPrimary = img.key === primaryKey;
                  return (
                    <Box
                      key={img.key}
                      sx={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        borderRadius: "8px",
                        overflow: "hidden",
                        border: isPrimary ? `2px solid ${C.accent}` : `1px solid ${C.hairline}`,
                        bgcolor: "#f5f5f7",
                      }}
                    >
                      {/* contain so the full image is visible in the square preview */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={img.fileName}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      />
                      <Box sx={{ position: "absolute", top: 5, insetInlineStart: 5, display: "flex", gap: 0.5 }}>
                        <MiniBtn title="הגדר כתמונת כריכה" onClick={() => setPrimaryKey(img.key)}>
                          {isPrimary ? (
                            <StarIcon sx={{ fontSize: 14, color: C.accent }} />
                          ) : (
                            <StarBorderIcon sx={{ fontSize: 14 }} />
                          )}
                        </MiniBtn>
                        <MiniBtn title="הסר" danger onClick={() => removeImage(img.key)}>
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </MiniBtn>
                      </Box>
                      {isPrimary && (
                        <Box
                          sx={{
                            position: "absolute",
                            bottom: 0,
                            insetInline: 0,
                            bgcolor: C.accent,
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 600,
                            textAlign: "center",
                            py: 0.25,
                          }}
                        >
                          כריכה
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          {/* notes */}
          <Box>
            <FieldCaption optional>הערות</FieldCaption>
            <TextField
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="נקודות לבדיקה, מאפיינים מיוחדים, או סטיות מותרות…"
              multiline
              minRows={3}
              fullWidth
              size="small"
            />
          </Box>

          {formError && (
            <Box sx={{ fontSize: 13, color: C.danger, display: "flex", alignItems: "center", gap: 0.75 }}>
              <ErrorOutlineIcon sx={{ fontSize: 16 }} />
              {formError}
            </Box>
          )}
        </Box>

        {/* footer */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            p: "16px 24px",
            borderTop: `1px solid ${C.hairline}`,
            background: "rgba(245,245,247,0.85)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
          }}
        >
          {editingId != null && (
            <Button
              onClick={deleteItem}
              disabled={saving}
              sx={{
                color: C.danger,
                fontSize: 14,
                fontWeight: 600,
                "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
              }}
            >
              מחק פריט
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            onClick={closeForm}
            disabled={saving}
            variant="outlined"
            sx={{ borderRadius: "9999px", px: 2.5, py: 1.25, fontSize: 15, fontWeight: 600, borderColor: "#d4d4dc", color: C.ink }}
          >
            ביטול
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            variant="contained"
            sx={{
              borderRadius: "9999px",
              px: 3,
              py: 1.4,
              fontSize: 15,
              fontWeight: 600,
              bgcolor: C.accent,
              "&:hover": { bgcolor: C.accentHover },
            }}
          >
            {saving ? <CircularProgress size={20} color="inherit" /> : "שמירה"}
          </Button>
        </Box>
      </Dialog>
    </Box>
  );
}

// ---- small presentational helpers ------------------------------------------
function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
      <Box
        sx={{
          width: 24,
          height: 24,
          borderRadius: "9999px",
          bgcolor: C.accent,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {n}
      </Box>
      <Typography sx={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{label}</Typography>
    </Box>
  );
}

function FieldCaption({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <Typography component="label" sx={{ display: "block", fontSize: 13, fontWeight: 600, color: "#333", mb: 1 }}>
      {children}
      {optional && (
        <Box component="span" sx={{ color: C.mutedSoft, fontWeight: 400 }}>
          {" "}
          · לא חובה
        </Box>
      )}
    </Typography>
  );
}

function FieldText({
  label,
  value,
  onChange,
  placeholder,
  required,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <Box>
      <FieldCaption optional={optional}>
        {label}
        {required && (
          <Box component="span" sx={{ color: C.danger, fontWeight: 700 }}>
            {" *"}
          </Box>
        )}
      </FieldCaption>
      <TextField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        fullWidth
        size="small"
      />
    </Box>
  );
}

function MiniBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      sx={{
        width: 24,
        height: 24,
        border: 0,
        borderRadius: "9999px",
        bgcolor: "rgba(255,255,255,0.92)",
        color: danger ? C.danger : C.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        p: 0,
        "&:hover": { bgcolor: "#fff" },
      }}
    >
      {children}
    </Box>
  );
}

function ReferenceCard({ item, onEdit }: { item: ReferenceItem; onEdit: () => void }) {
  return (
    <Box
      onClick={onEdit}
      sx={{
        bgcolor: C.card,
        border: `1px solid ${C.hairline}`,
        borderRadius: "18px",
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.15s ease",
        "&:hover": { borderColor: "#c4c4cc" },
      }}
    >
      {item.cover_url ? (
        <Box sx={{ position: "relative", bgcolor: "#f5f5f7" }}>
          {/* contain (not cover) so the whole reference image is visible, not cropped */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.cover_url}
            alt={item.name ?? ""}
            style={{ width: "100%", height: 172, objectFit: "contain", display: "block" }}
          />
          {item.image_count > 1 && (
            <Box
              sx={{
                position: "absolute",
                top: 10,
                insetInlineStart: 10,
                bgcolor: "rgba(0,0,0,0.62)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: "9999px",
                px: 1.1,
                py: 0.4,
                backdropFilter: "blur(4px)",
              }}
            >
              {item.image_count} תמונות
            </Box>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            height: 172,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            bgcolor: "#eef1f4",
            color: "#5a6b7a",
          }}
        >
          <Inventory2OutlinedIcon sx={{ fontSize: 40 }} />
          <Typography sx={{ fontSize: 12, opacity: 0.8 }}>ממתין לתמונה</Typography>
        </Box>
      )}
      <Box sx={{ p: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              fontSize: 11,
              fontWeight: 600,
              color: C.ink,
              bgcolor: "#f5f5f7",
              border: `1px solid ${C.hairline}`,
              borderRadius: "9999px",
              px: 1.25,
              py: 0.5,
              whiteSpace: "nowrap",
            }}
          >
            {item.item_type_desc ?? "—"}
          </Box>
          <EditOutlinedIcon sx={{ fontSize: 16, color: C.mutedSoft }} />
        </Box>
        <Typography sx={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.2px", lineHeight: 1.25 }}>
          {item.name || item.item_type_desc || "פריט ייחוס"}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.4, fontSize: 13, color: C.muted }}>
          <Box>
            מק״ט יצרן ·{" "}
            <Box component="span" sx={{ color: C.ink, fontVariantNumeric: "tabular-nums" }}>
              {item.manufacturer_sku}
            </Box>
          </Box>
          <Box>
            יצרן · <Box component="span" sx={{ color: C.ink }}>{item.manufacturer}</Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
