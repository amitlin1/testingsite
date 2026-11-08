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
import PackageReferenceDialog from "./PackageReferenceDialog";
import {
  stationsFor,
  type ItemType, type ReferenceItem, type ReferenceStations, type TemplateLine,
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

/** Every reference item not inside a package reference; the page keeps those of regular types. */
type LegacyState = { status: "loading" } | { status: "error" } | { status: "ready"; items: ReferenceItem[] };

/**
 * הגדרות → פריטי ייחוס. Only package types are offered: a package reference
 * (ייחוס מארז) is the box plus a reference item per content line, edited in
 * PackageReferenceDialog — each item's SKU, images and weight are given there,
 * and the stations find an item by them (api/testing/reference-lookup).
 * Reference items of a regular type made before that are listed at the foot
 * as "פריטי ייחוס ישנים": still used by the stations (they come before a
 * member of the same SKU), opened to view and to delete only.
 */
export default function ReferenceItemsPage() {
  const [itemTypes, setItemTypes] = React.useState<ItemType[]>([]);
  const [selectedType, setSelectedType] = React.useState<ItemType | null>(null);
  // The stations that take reference images, per item type in route order; null until loaded.
  const [stations, setStations] = React.useState<ReferenceStations | null>(null);

  const [items, setItems] = React.useState<ReferenceItem[]>([]);
  const [loadingItems, setLoadingItems] = React.useState(false);
  // A failed load is not "no items": each gets an error band and a retry.
  const [itemsError, setItemsError] = React.useState(false);
  const [optionsError, setOptionsError] = React.useState(false);
  const [lines, setLines] = React.useState<LinesState>({ status: "loading" });

  const [skuFilter, setSkuFilter] = React.useState<string | null>(null);
  const [manuFilter, setManuFilter] = React.useState<string | null>(null);

  // older reference items of regular types: the list, and the one open to view / delete
  const [legacy, setLegacy] = React.useState<LegacyState>({ status: "loading" });
  const [viewing, setViewing] = React.useState<ReferenceItem | null>(null);
  const [viewError, setViewError] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
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
    apiFetch("/api/settings/reference-items/stations")
      .then(okJson)
      .then((data: ReferenceStations) => setStations(data && Array.isArray(data.stations) && data.byItemType ? data : null))
      .catch(() => { setStations(null); setOptionsError(true); });
  }, []);
  const loadOptions = React.useCallback(() => {
    setOptionsError(false);
    fetchOptions();
  }, [fetchOptions]);

  React.useEffect(() => { fetchOptions(); }, [fetchOptions]);

  const fetchLegacy = React.useCallback(() => {
    apiFetch("/api/settings/reference-items")
      .then(okJson)
      .then((data: ReferenceItem[]) => setLegacy({ status: "ready", items: Array.isArray(data) ? data : [] }))
      .catch(() => setLegacy({ status: "error" }));
  }, []);
  const loadLegacy = React.useCallback(() => {
    setLegacy({ status: "loading" });
    fetchLegacy();
  }, [fetchLegacy]);

  React.useEffect(() => { fetchLegacy(); }, [fetchLegacy]);

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
  const packageTypes = React.useMemo(() => itemTypes.filter((t) => t.is_package), [itemTypes]);
  // Known only once the types are in: an item whose type is not a package type.
  const legacyItems = React.useMemo(() => {
    if (legacy.status !== "ready" || itemTypes.length === 0) return [];
    const packageIds = new Set(packageTypes.map((t) => t.item_type_id));
    return legacy.items.filter((it) => !packageIds.has(it.item_type_id));
  }, [legacy, itemTypes.length, packageTypes]);

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
  const openPackage = (editing: ReferenceItem | null) => setPkgDialog({ key: ++pkgOpenings.current, editing });

  const openNew = () => openPackage(null);

  // A package type's reference opens for editing; an older regular one only to view.
  const openEdit = (it: ReferenceItem) => {
    if (itemTypes.find((t) => t.item_type_id === it.item_type_id)?.is_package) { openPackage(it); return; }
    setViewError("");
    setViewing(it);
  };

  // Asked through the app's ConfirmDialog (below), not window.confirm.
  const deleteViewed = async () => {
    if (!viewing) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/settings/reference-items/${viewing.reference_item_id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "שגיאה במחיקה");
      }
      setViewing(null);
      loadLegacy();
    } catch (e) {
      setViewError(e instanceof Error ? e.message : "שגיאה במחיקה");
    } finally {
      setDeleting(false);
    }
  };

  // ---- render --------------------------------------------------------------
  const typeName = selectedType?.item_type_desc ?? "";
  const templateLines = isPackage && lines.status === "ready" ? lines.lines : null;
  // A package type's dialog needs its contents; until they load it waits.
  const canAdd = isPackage && lines.status === "ready";
  const newLabel = "ייחוס מארז חדש";
  const viewStations = stationsFor(stations, viewing?.item_type_id);

  // The settings layout owns the frame (scroll, padding, 94% column).
  return (
    <div dir="rtl" style={{ color: C.ink }}>
      <SettingsToolbar
        title="פריטי ייחוס"
        subtitle="בחר סוג מארז, ואז סנן לפי מק״ט יצרן או יצרן. בייחוס המארז מגדירים גם את המק״ט, התמונות והמשקל של כל פריט בתכולה."
        countText={selectedType && !loadingItems && !itemsError ? headerCount : undefined}
        onAdd={canAdd ? openNew : undefined}
        addLabel={newLabel}
      />

      {optionsError && (
        <div className="settings-card settings-error" style={{ marginTop: "var(--space-lg)" }}>
          <Alert severity="error">טעינת סוגי המארזים או העמדות נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={loadOptions}>נסה שוב</Button>
        </div>
      )}

      {/* Step 1: choose type */}
      <div className="settings-card ri-step-card">
        <StepBadge n={1} label="בחר סוג מארז" />
        <div style={{ display: "flex", gap: "var(--space-ml)", alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 260, maxWidth: 480 }}>
            <SearchableCombobox<ItemType>
              value={selectedType}
              onChange={setSelectedType}
              options={packageTypes}
              getOptionLabel={(o) => o.item_type_desc}
              isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
              placeholder="הקלד או בחר סוג מארז…"
            />
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-small)", color: C.muted, maxWidth: 240, lineHeight: 1.45 }}>
            בחירת הסוג תציג את ייחוסי המארז שלו בלבד.
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
          <div className="settings-empty__title" style={{ fontSize: "var(--text-lead)", marginTop: 6 }}>בחר סוג מארז כדי להתחיל</div>
          <div style={{ fontSize: "var(--text-body-sm)" }}>ייחוסי המארז יוצגו לפי הסוג שתבחר למעלה.</div>
        </div>
      )}

      {/* Older reference items of regular types: still used by the stations, view and delete only. */}
      {legacy.status === "error" ? (
        <div className="settings-card settings-error" style={{ marginTop: "var(--space-xl)" }}>
          <Alert severity="error">טעינת פריטי הייחוס הישנים נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={loadLegacy}>נסה שוב</Button>
        </div>
      ) : legacyItems.length > 0 && (
        <section aria-labelledby="ri-legacy-title" style={{ marginTop: "var(--space-xl)", paddingTop: "var(--space-lg)", borderTop: `1px solid ${C.hairline}` }}>
          <h2 id="ri-legacy-title" style={{ margin: 0, fontSize: "var(--text-body)", fontWeight: 600, color: C.ink }}>
            פריטי ייחוס ישנים <span style={{ fontWeight: 400, color: C.muted, fontVariantNumeric: "tabular-nums" }}>· {legacyItems.length}</span>
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: "var(--text-small)", color: C.muted, maxWidth: 640, lineHeight: 1.5 }}>
            הוגדרו לסוג פריט רגיל, לפני שפריטי הייחוס עברו לייחוס המארז. העמדות עדיין משתמשות בהם, והם קודמים לפריט באותו מק״ט שבתוך ייחוס מארז. אפשר לצפות בהם ולמחוק אותם.
          </p>
          <div className="ri-grid">
            {legacyItems.map((it) => (
              <ReferenceCard key={it.reference_item_id} item={it} lines={null} onEdit={() => openEdit(it)} viewOnly />
            ))}
          </div>
        </section>
      )}

      {/* An older regular reference item: view and delete only */}
      <Dialog
        open={viewing != null}
        onClose={() => setViewing(null)}
        maxWidth={false}
        fullWidth
        dir="rtl"
        PaperProps={{ style: { maxWidth: 720 } }}
      >
        <DialogTitle onClose={() => setViewing(null)}>
          <span style={{ minWidth: 0 }}>
            {viewing?.name || viewing?.manufacturer_sku || "פריט ייחוס"}
            <span style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 400, color: C.muted, marginTop: 4, fontFamily: "var(--font-text)" }}>
              פריט ייחוס ישן · לצפייה ולמחיקה בלבד
            </span>
          </span>
        </DialogTitle>

        <DialogContent>
          {viewing && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-ml)" }}>
              <dl className="ri-form-grid" style={{ margin: 0 }}>
                {([
                  ["סוג פריט", viewing.item_type_desc ?? "—", false],
                  ["מק״ט יצרן", viewing.manufacturer_sku, true],
                  ["יצרן", viewing.manufacturer || "—", false],
                  ["משקל ייחוס", viewing.reference_weight ? `${viewing.reference_weight} גר׳` : "לא מוגדר", false],
                ] as const).map(([label, value, code]) => (
                  <div key={label}>
                    <dt style={{ fontSize: "var(--text-small)", color: C.muted }}>{label}</dt>
                    <dd style={{ margin: "4px 0 0", fontSize: "var(--text-body)", color: C.ink }}>
                      {code ? <bdi dir="ltr" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</bdi> : value}
                    </dd>
                  </div>
                ))}
              </dl>
              {viewing.notes?.trim() && (
                <div>
                  <div style={{ fontSize: "var(--text-small)", color: C.muted }}>הערות</div>
                  <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{viewing.notes}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: "var(--text-small)", color: C.muted, marginBottom: 8 }}>
                  תמונות ייחוס {viewing.images.length > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}>· {viewing.images.length}</span>}
                </div>
                {viewing.images.length === 0 ? (
                  <div style={{ fontSize: "var(--text-small)", color: C.muted }}>אין תמונות.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                    {viewing.images.map((img) => (
                      <figure key={img.id} style={{ margin: 0, border: `1px solid ${C.hairline}`, borderRadius: "var(--r-md)", overflow: "hidden", background: "var(--color-canvas-parchment)" }}>
                        <a href={img.url} target="_blank" rel="noreferrer" style={{ display: "block" }} aria-label={`פתיחת ${img.file_name}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="" style={{ width: "100%", height: 110, objectFit: "contain", display: "block" }} />
                        </a>
                        <figcaption style={{ padding: "6px 8px", fontSize: "var(--text-fine)", color: C.muted, background: C.card }}>
                          {img.station_type_id != null ? viewStations.nameOf(img.station_type_id) : "לא משויכת לעמדה"}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
              {viewError && <Alert severity="error">{viewError}</Alert>}
            </div>
          )}
        </DialogContent>

        <DialogActions>
          <Button
            variant="text"
            color="error"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            style={{ order: -1, marginInlineEnd: "auto" }}
          >
            מחק פריט
          </Button>
          <Button variant="outlined" color="inherit" onClick={() => setViewing(null)} disabled={deleting}>
            סגירה
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        draggable={false}
        open={confirmDelete}
        title="מחיקת פריט ייחוס"
        message={`למחוק את פריט הייחוס "${viewing?.name?.trim() || viewing?.manufacturer_sku.trim() || "ללא שם"}"? העמדות יחפשו את המק״ט שלו בייחוסי המארזים. פעולה זו אינה ניתנת לביטול.`}
        confirmText="מחק"
        destructive
        onConfirm={deleteViewed}
        onCancel={() => setConfirmDelete(false)}
      />

      {pkgDialog && selectedType && templateLines && (
        <PackageReferenceDialog
          key={pkgDialog.key}
          packageType={selectedType}
          editing={pkgDialog.editing}
          lines={templateLines}
          stations={stations}
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
 *  package reference's: which content lines have a reference item. `viewOnly`:
 *  an older regular one, opened to view (no edit mark). */
function ReferenceCard({ item, lines, onEdit, viewOnly = false }: { item: ReferenceItem; lines: TemplateLine[] | null; onEdit: () => void; viewOnly?: boolean }) {
  const title = item.name || item.item_type_desc || "פריט ייחוס";
  const lineState = lines?.map((l) => ({ ...l, has: item.members.some((m) => m.item_type_id === l.item_type_id) })) ?? null;
  const missing = lineState?.filter((l) => !l.has).map((l) => l.item_type_desc) ?? [];
  return (
    // The whole card opens the item for editing: a real button (Tab, Enter /
    // Space), hover and focus in settings.css (.ri-card).
    <button type="button" className="ri-card" onClick={onEdit} aria-label={`${viewOnly ? "צפייה ב" : "עריכת "}${title}`}>
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
          {!viewOnly && <EditOutlinedIcon fontSize={16} color="var(--color-ink-muted-48)" aria-hidden />}
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
