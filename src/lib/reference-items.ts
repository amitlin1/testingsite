import { prisma } from '@/app/lib/prisma';
import { putObject, removeObjects, REFERENCE_BUCKET } from '@/lib/storage';
import { registerFileObject, markFileObjectDeleted } from '@/lib/file-registry';

/**
 * Reference-items helpers.
 *
 * Reference-item images follow the SAME file procedure as everything else in
 * the system — `putObject` → `registerFileObject` (file_objects registry) →
 * served back through a streaming route — the only difference is the target
 * bucket: the dedicated `REFERENCE_BUCKET` ("RU") instead of the default one.
 * Keeping the flow identical is why this lives next to the storage layer.
 */

/** Key prefix inside the reference bucket: `reference-items/{id}/...`. */
export const REFERENCE_PREFIX = 'reference-items';

/** Max size per reference image (matches the dialog copy: "עד 10MB לתמונה"). */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/** Build the browser-facing URL that streams an object from the RU bucket. */
export function imageUrl(objectKey: string): string {
  return `/api/settings/reference-items/images/${objectKey
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

/** Filesystem-safe object-key segment derived from the uploaded file name. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'image';
  return base.replace(/[^\w.-]+/g, '_').slice(0, 200) || 'image';
}

type ImageRow = {
  reference_item_image_id: number;
  object_key: string;
  file_name: string;
  sort_order: number;
  photo_type_id: number;
  photo_types?: { code: string } | null;
};

type ReferenceItemRow = {
  reference_item_id: number;
  item_type_id: number; 
  reference_weight: string | null;
  manufacturer_sku: string;
  manufacturer: string;
  name: string | null;
  notes: string | null;
  primary_image_id: number | null;
  created_at: Date;
  updated_at: Date;
  item_types?: { item_type_desc: string } | null;
  images: ImageRow[];
};

/** Shape the DB row into the JSON the page consumes (with image URLs + cover). */
export function serializeReferenceItem(it: ReferenceItemRow) {
  const images = [...it.images]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({
      id: img.reference_item_image_id,
      file_name: img.file_name,
      sort_order: img.sort_order,
      photo_type: img.photo_types?.code ?? null,
      url: imageUrl(img.object_key),
      is_primary: img.reference_item_image_id === it.primary_image_id,
    }));
  const cover = images.find((i) => i.is_primary) || images[0] || null;

  // Group by photo-type code so each wizard screen can pull only its own
  // reference set (e.g. "package" for the package-photo step, "product" for
  // the item-photo/weighing steps).
  const imagesByType: Record<string, typeof images> = {};
  for (const img of images) {
    if (!img.photo_type) continue;
    (imagesByType[img.photo_type] ??= []).push(img);
  }

  return {
    reference_item_id: it.reference_item_id,
    item_type_id: it.item_type_id,
    reference_weight: it.reference_weight,
    item_type_desc: it.item_types?.item_type_desc?.trim() ?? null,
    manufacturer_sku: it.manufacturer_sku,
    manufacturer: it.manufacturer,
    name: it.name,
    notes: it.notes,
    primary_image_id: it.primary_image_id,
    images,
    images_by_type: imagesByType,
    cover_url: cover?.url ?? null,
    image_count: images.length,
    created_at: it.created_at,
    updated_at: it.updated_at,
  };
}

/** Prisma `include` used everywhere a reference item is read out. */
export const referenceItemInclude = {
  item_types: { select: { item_type_desc: true } },
  images: { include: { photo_types: { select: { code: true } } } },
} as const;

/**
 * Pair uploaded files with their photo-type codes from a multipart form.
 * `image_types` is a JSON array of codes aligned with the `images` file order
 * (mirrors the primaryIndex "parallel field" pattern); a single `photo_type`
 * field is accepted as a shorthand that applies to every file in the batch.
 * Throws (Hebrew, user-facing) when a file arrives without a valid type.
 */
export async function pairFilesWithTypes(
  form: FormData,
  files: File[],
): Promise<Array<{ file: File; photoTypeId: number }>> {
  if (files.length === 0) return [];

  let codes: string[] = [];
  const raw = String(form.get('image_types') ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) codes = parsed.map(String);
    } catch {
      throw new Error('image_types אינו JSON תקין');
    }
  } else {
    const single = String(form.get('photo_type') ?? '').trim();
    if (single) codes = files.map(() => single);
  }
  if (codes.length !== files.length) {
    throw new Error('יש לציין סוג תמונה לכל תמונה שמועלית');
  }

  const idByCode = await resolvePhotoTypeIds(codes);
  return files.map((file, i) => ({ file, photoTypeId: idByCode.get(codes[i])! }));
}

/**
 * Resolve photo-type codes (the stable strings screens speak, e.g. "package")
 * to their DB ids. Throws (Hebrew, user-facing) on an unknown/inactive code so
 * routes can surface it as a 400.
 */
export async function resolvePhotoTypeIds(codes: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.photo_types.findMany({
    where: { code: { in: unique }, is_active: true },
    select: { photo_type_id: true, code: true },
  });
  const map = new Map(rows.map((r) => [r.code, r.photo_type_id]));
  const missing = unique.filter((c) => !map.has(c));
  if (missing.length > 0) throw new Error(`סוג תמונה לא מוכר: ${missing.join(", ")}`);
  return map;
}

/**
 * Upload files to the RU bucket, insert `reference_item_images` rows, and
 * register each object in `file_objects`. Returns the created image rows.
 * Skips non-image files and rejects anything over MAX_IMAGE_SIZE.
 * Every upload carries its photo-type id (resolve codes via resolvePhotoTypeIds).
 */
export async function uploadReferenceImages(
  referenceItemId: number,
  uploads: Array<{ file: File; photoTypeId: number }>,
  startSort = 0,
): Promise<{ reference_item_image_id: number }[]> {
  const created: { reference_item_image_id: number }[] = [];
  let i = 0;

  for (const { file, photoTypeId } of uploads) {
    if (!file || typeof file.arrayBuffer !== 'function') continue;
    if (file.type && !file.type.startsWith('image/')) {
      throw new Error(`הקובץ ${file.name} אינו תמונה`);
    }
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(`הקובץ ${file.name} חורג מהגודל המרבי (10MB)`);
    }

    const sortOrder = startSort + i;
    const objectKey = `${REFERENCE_PREFIX}/${referenceItemId}/${Date.now()}-${sortOrder}-${safeName(
      file.name,
    )}`;
    const contentType = file.type || 'application/octet-stream';
    const buffer = Buffer.from(await file.arrayBuffer());

    const stored = await putObject(objectKey, buffer, contentType, {}, REFERENCE_BUCKET);

    const row = await prisma.reference_item_images.create({
      data: {
        reference_item_id: referenceItemId,
        bucket: REFERENCE_BUCKET,
        object_key: objectKey,
        file_name: file.name.slice(0, 255),
        content_type: contentType,
        size_bytes: BigInt(stored.size),
        sort_order: sortOrder,
        photo_type_id: photoTypeId,
      },
      select: { reference_item_image_id: true },
    });

    await registerFileObject({
      objectKey,
      fileName: file.name,
      contentType,
      sizeBytes: stored.size,
      checksum: stored.checksum,
      entityType: 'reference_item_image',
      entityId: referenceItemId,
      bucket: REFERENCE_BUCKET,
    });

    created.push(row);
    i++;
  }

  return created;
}

/**
 * Delete image rows + their bytes in the RU bucket + soft-delete the registry
 * rows. Best-effort on the object store so a MinIO hiccup can't strand the DB.
 */
export async function deleteReferenceImages(images: { reference_item_image_id: number; object_key: string }[]) {
  if (images.length === 0) return;
  const keys = images.map((img) => img.object_key);

  await prisma.reference_item_images.deleteMany({
    where: { reference_item_image_id: { in: images.map((i) => i.reference_item_image_id) } },
  });

  try {
    await removeObjects(keys, REFERENCE_BUCKET);
  } catch (err) {
    console.warn('[reference-items] failed to remove objects:', (err as Error).message);
  }
  await Promise.all(keys.map((k) => markFileObjectDeleted(k)));
}
