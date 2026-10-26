import { uploadReferenceImages } from "@/lib/api/direct-upload";

/**
 * The reference-item form, shared by the regular dialog and the package
 * reference dialog (the box and each content line fill the same form).
 */

export interface ItemType {
  item_type_id: number;
  item_type_desc: string;
  is_package: boolean;
}

export interface PhotoType {
  photo_type_id: number;
  code: string;
  photo_type_desc: string;
  sort_order: number;
  /** The station type whose popup template owns the group (its photo component); null = none. */
  station_type_id?: number | null;
  station_type_desc?: string | null;
}

export interface RefImage {
  id: number;
  file_name: string;
  sort_order: number;
  /** photo_types.code — which group this image belongs to ("package" | "product" | ...). */
  photo_type: string | null;
  url: string;
  is_primary: boolean;
}

export interface ReferenceItem {
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
  /** A package reference's members, one per content line (empty otherwise). */
  members: ReferenceItem[];
}

/** A line of a package type's contents (/api/settings/item-types/[id]/contents). */
export interface TemplateLine {
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
}

// A form image is either one already stored on the server, or a freshly
// selected File that hasn't been uploaded yet. `key` is stable within the form.
// `photoType` is the photo_types.code of the group the image belongs to.
export type FormImage =
  | { key: string; kind: "existing"; id: number; url: string; fileName: string; photoType: string }
  | { key: string; kind: "new"; url: string; file: File; fileName: string; photoType: string };

/** The form fields a save checks; each error is shown on its field. */
export type FieldKey = "type" | "sku" | "manu" | "weight" | "name";
export type FieldErrors = Partial<Record<FieldKey, string>>;

/** One reference item being edited. `id` is its reference_item_id (null: new). */
export type ItemDraft = {
  id: number | null;
  sku: string;
  manu: string;
  name: string;
  weight: string;
  notes: string;
  images: FormImage[];
  /** The cover: a FormImage key. */
  primaryKey: string | null;
  /** Which photo group newly-added files go to (photo_types.code). */
  uploadType: string;
};

let keySeq = 0;
const nextKey = () => `img_${Date.now()}_${keySeq++}`;

export function draftOf(item: ReferenceItem | null, uploadType: string, fallbackPhotoType: string): ItemDraft {
  const images: FormImage[] = (item?.images ?? []).map((img) => ({
    key: `e_${img.id}`,
    kind: "existing",
    id: img.id,
    url: img.url,
    fileName: img.file_name,
    photoType: img.photo_type ?? fallbackPhotoType,
  }));
  const primary = item?.images.find((i) => i.is_primary) ?? item?.images[0];
  return {
    id: item?.reference_item_id ?? null,
    sku: item?.manufacturer_sku ?? "",
    manu: item?.manufacturer ?? "",
    name: item?.name ?? "",
    weight: item?.reference_weight ?? "",
    notes: item?.notes ?? "",
    images,
    primaryKey: primary ? `e_${primary.id}` : null,
    uploadType,
  };
}

/** The upload group a new form starts on: `preferred` when it is offered, else the first. */
export function startUploadType(photoTypes: PhotoType[], preferred: string): string {
  return photoTypes.some((pt) => pt.code === preferred) ? preferred : photoTypes[0]?.code ?? "";
}

/** Grams: a plain positive number — the stations compare it with Number(). */
export const isGrams = (s: string) => /^\d+(\.\d+)?$/.test(s.trim()) && Number(s) > 0;

/** Every missing or wrong field of a draft, each on its own field. */
export function checkDraft(d: ItemDraft): FieldErrors {
  const e: FieldErrors = {};
  if (!d.sku.trim()) e.sku = "יש להזין מק״ט יצרן";
  if (!d.weight.trim()) e.weight = "יש להזין משקל";
  else if (!isGrams(d.weight)) e.weight = "המשקל הוא מספר בגרמים, למשל 500";
  if (!d.manu.trim()) e.manu = "יש להזין יצרן";
  if (!d.name.trim()) e.name = "יש להזין שם";
  return e;
}

export const isComplete = (d: ItemDraft) => Object.keys(checkDraft(d)).length === 0;

/** Add picked files to the draft, tagged with its current photo group. */
export function withFiles(d: ItemDraft, files: File[]): ItemDraft {
  const added: FormImage[] = files
    .filter((f) => f.type.startsWith("image/"))
    .map((f) => ({ key: nextKey(), kind: "new", url: URL.createObjectURL(f), file: f, fileName: f.name, photoType: d.uploadType }));
  if (added.length === 0) return d;
  const images = [...d.images, ...added];
  return { ...d, images, primaryKey: d.primaryKey ?? images[0]?.key ?? null };
}

export function withoutImage(d: ItemDraft, key: string): ItemDraft {
  const target = d.images.find((i) => i.key === key);
  if (target?.kind === "new") URL.revokeObjectURL(target.url);
  const images = d.images.filter((i) => i.key !== key);
  return { ...d, images, primaryKey: d.primaryKey === key ? images[0]?.key ?? null : d.primaryKey };
}

export function revokeDraftUrls(d: ItemDraft | null) {
  d?.images.forEach((img) => { if (img.kind === "new") URL.revokeObjectURL(img.url); });
}

/**
 * The draft's part of a save body. New images go from the browser straight
 * to MinIO first (nothing is saved on the item yet, so a failed upload leaves
 * no half-written item behind); the body carries the keys MinIO now holds.
 */
export async function draftPayload(d: ItemDraft): Promise<Record<string, unknown>> {
  const fresh = d.images.filter((i): i is Extract<FormImage, { kind: "new" }> => i.kind === "new");
  const images = await uploadReferenceImages(
    fresh.map((img) => ({ file: img.file, fileName: img.fileName, photoType: img.photoType })),
    d.id,
  );
  const primary = d.images.find((i) => i.key === d.primaryKey);
  return {
    manufacturer_sku: d.sku.trim(),
    manufacturer: d.manu.trim(),
    name: d.name.trim(),
    reference_weight: d.weight.trim(),
    notes: d.notes.trim(),
    images,
    keepImageIds: d.images.filter((i) => i.kind === "existing").map((i) => (i as Extract<FormImage, { kind: "existing" }>).id),
    primaryKey: primary?.kind === "existing" ? String(primary.id) : primary ? `new:${fresh.indexOf(primary)}` : "",
  };
}
