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
      url: imageUrl(img.object_key),
      is_primary: img.reference_item_image_id === it.primary_image_id,
    }));
  const cover = images.find((i) => i.is_primary) || images[0] || null;

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
    cover_url: cover?.url ?? null,
    image_count: images.length,
    created_at: it.created_at,
    updated_at: it.updated_at,
  };
}

/** Prisma `include` used everywhere a reference item is read out. */
export const referenceItemInclude = {
  item_types: { select: { item_type_desc: true } },
  images: true,
} as const;

/**
 * Upload files to the RU bucket, insert `reference_item_images` rows, and
 * register each object in `file_objects`. Returns the created image rows.
 * Skips non-image files and rejects anything over MAX_IMAGE_SIZE.
 */
export async function uploadReferenceImages(
  referenceItemId: number,
  files: File[],
  startSort = 0,
): Promise<{ reference_item_image_id: number }[]> {
  const created: { reference_item_image_id: number }[] = [];
  let i = 0;

  for (const file of files) {
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
