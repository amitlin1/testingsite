import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import { REFERENCE_BUCKET, removeObjects } from '@/lib/storage';
import {
  registerFileObject,
  registerPendingFileObject,
  markFileObjectDeleted,
} from '@/lib/file-registry';
import {
  REFERENCE_PREFIX,
  buildReferenceObjectKey,
  contentTypeOf,
  isReferenceObjectKey,
  parseUploadDescriptors,
  type UploadDescriptor,
  type UploadTicket,
} from '@/lib/directUpload/shared';
import { issueTicket, newUploadId, verifyUploaded } from '@/lib/directUpload/server';

/**
 * Reference-items helpers.
 *
 * Reference-item images follow the SAME file procedure as everything else in
 * the system — a direct browser → MinIO upload through a presigned ticket, a
 * server-side verify, `registerFileObject` (file_objects registry), and a
 * streaming route to serve them back — the only difference is the target
 * bucket: the dedicated `REFERENCE_BUCKET` ("RU") instead of the default one.
 *
 * Flow:
 *   1. POST images/presign            → presignReferenceImages(): tickets + pending rows
 *   2. browser POSTs each file to MinIO
 *   3. POST/PUT reference-items       → verifyReferenceImageUploads() checks every
 *                                       key BEFORE anything is created or deleted,
 *                                       createReferenceImageRows() makes the rows
 *                                       (inside the save's transaction) and
 *                                       registerReferenceImages() activates the
 *                                       registry rows once it has committed
 *
 * An image belongs to a STATION TYPE (reference_item_images.test_station_type_id): the station type
 * is the reference set. The page lists the stations of the item's route and uploads to one; every
 * station shows the images of its own type (images_by_station). NULL = not assigned to a station
 * yet (an image of an older photo group no single station showed) — listed on the page with a
 * station to pick, shown at no station. docs/popup-templates/PLAN.md §5ג.
 *
 * A reference item of a package type is a PACKAGE REFERENCE: besides the box
 * it holds one member reference item per content line (parent_reference_id),
 * made and edited only inside it (lib/reference-items-save.ts). Members are
 * never listed or looked up on their own.
 */

export { REFERENCE_PREFIX };

/** Max size per reference image (matches the dialog copy: "עד 50MB לתמונה"). */
export const MAX_IMAGE_SIZE_MB = 50;
export const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/** Build the browser-facing URL that streams an object from the RU bucket. */
export function imageUrl(objectKey: string): string {
  return `/api/settings/reference-items/images/${objectKey
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

type ImageRow = {
  reference_item_image_id: number;
  object_key: string;
  file_name: string;
  sort_order: number;
  test_station_type_id: number | null;
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
  parent_reference_id: number | null;
  created_at: Date;
  updated_at: Date;
  item_types?: { item_type_desc: string } | null;
  images: ImageRow[];
  members?: ReferenceItemRow[];
};

export type SerializedReferenceItem = ReturnType<typeof serializeOne> & {
  /** A package reference's members (empty for any other item). */
  members: SerializedReferenceItem[];
};

/** Shape the DB row into the JSON the page consumes (with image URLs + cover),
 *  a package reference's members included. */
export function serializeReferenceItem(it: ReferenceItemRow): SerializedReferenceItem {
  return {
    ...serializeOne(it),
    members: [...(it.members ?? [])]
      .sort((a, b) => a.reference_item_id - b.reference_item_id)
      .map(serializeReferenceItem),
  };
}

function serializeOne(it: ReferenceItemRow) {
  const images = [...it.images]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({
      id: img.reference_item_image_id,
      file_name: img.file_name,
      sort_order: img.sort_order,
      station_type_id: img.test_station_type_id,
      url: imageUrl(img.object_key),
      is_primary: img.reference_item_image_id === it.primary_image_id,
    }));
  const cover = images.find((i) => i.is_primary) || images[0] || null;

  // By station type: each station shows only its own type's images. Unassigned ones are in none.
  const imagesByStation: Record<string, typeof images> = {};
  for (const img of images) {
    if (img.station_type_id == null) continue;
    (imagesByStation[String(img.station_type_id)] ??= []).push(img);
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
    parent_reference_id: it.parent_reference_id,
    images,
    images_by_station: imagesByStation,
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

/** The same, with a package reference's members (and their images). */
export const referenceItemWithMembersInclude = {
  ...referenceItemInclude,
  members: { include: referenceItemInclude },
} as const;

/**
 * A reference weight is grams: a plain positive number ("500", "12.5"). The
 * stations read it with Number(), so a value like "0.5kg" never compared —
 * every weighing against it failed. Empty is allowed (no reference weight).
 */
export function parseReferenceWeight(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) {
    return { ok: false, error: 'המשקל הוא מספר בגרמים, למשל 500.' };
  }
  return { ok: true, value: String(Number(s)) };
}

/** A station type id as a request carries it: a positive int4, else null. */
export function stationTypeIdOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/**
 * Check that every station type id names a station type. Throws (Hebrew, user-facing) on an
 * unknown one so routes can surface it as a 400.
 */
export async function checkStationTypeIds(ids: number[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await prisma.test_stations_type.findMany({
    where: { test_station_type_id: { in: unique } },
    select: { test_station_type_id: true },
  });
  const known = new Set(rows.map((r) => r.test_station_type_id));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length > 0) throw new Error(`סוג עמדה לא מוכר: ${missing.join(', ')}`);
}

// ---- step 1: presign -------------------------------------------------------

/** A file the browser wants to upload, plus the station type it is for. */
export interface ReferenceImageDescriptor extends UploadDescriptor {
  stationTypeId: number;
}

/**
 * Parse the `files` array of an images/presign request: the generic descriptor
 * rules (name, size ≤ 50MB) plus "must look like an image" and "must name a
 * station type". Same rule the old multipart route applied to types: a
 * declared non-image type is refused, an unknown/empty type is let through.
 */
export function parseReferenceImageDescriptors(
  raw: unknown,
): { ok: true; files: ReferenceImageDescriptor[] } | { ok: false; error: string } {
  const parsed = parseUploadDescriptors(raw, MAX_IMAGE_SIZE, MAX_IMAGE_SIZE_MB);
  if (!parsed.ok) return parsed;

  const entries = raw as Array<Record<string, unknown>>;
  const files: ReferenceImageDescriptor[] = [];
  for (let i = 0; i < parsed.files.length; i++) {
    const desc = parsed.files[i];
    if (desc.type && !desc.type.startsWith('image/')) {
      return { ok: false, error: `הקובץ ${desc.name} אינו תמונה` };
    }
    const stationTypeId = stationTypeIdOf(entries[i]?.stationTypeId);
    if (stationTypeId == null) {
      return { ok: false, error: 'יש לציין עמדה לכל תמונה שמועלית' };
    }
    files.push({ ...desc, stationTypeId });
  }
  return { ok: true, files };
}

/**
 * Mint one ticket per image into the RU bucket and reserve a pending registry
 * row for each. Station types must already be checked by the caller
 * (checkStationTypeIds) so a bad one never reaches this point.
 */
export async function presignReferenceImages(
  files: ReferenceImageDescriptor[],
  referenceItemId: number | null,
): Promise<UploadTicket[]> {
  return Promise.all(
    files.map(async (file) => {
      const objectKey = buildReferenceObjectKey(referenceItemId, file.name, newUploadId());
      const contentType = contentTypeOf(file);
      await registerPendingFileObject({
        objectKey,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        entityType: 'reference_item_image',
        entityId: referenceItemId,
        metadata: { stationTypeId: file.stationTypeId },
        bucket: REFERENCE_BUCKET,
      });
      return issueTicket({
        key: objectKey,
        fileName: file.name,
        contentType,
        maxBytes: MAX_IMAGE_SIZE,
        bucket: REFERENCE_BUCKET,
      });
    }),
  );
}

// ---- step 3: save ----------------------------------------------------------

/** What the form sends back for each image it uploaded through a ticket. */
export interface ReferenceImageUpload {
  objectKey: string;
  fileName: string;
  stationTypeId: number;
}

/** Parse the `images` array of a save body. Throws (Hebrew, user-facing). */
export function parseReferenceImageUploads(raw: unknown): ReferenceImageUpload[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('רשימת התמונות אינה תקינה');
  return raw.map((entry) => {
    const { objectKey, fileName, stationTypeId: rawStation } = (entry ?? {}) as Record<string, unknown>;
    if (typeof objectKey !== 'string' || !isReferenceObjectKey(objectKey)) {
      throw new Error('מפתח תמונה לא תקין');
    }
    const stationTypeId = stationTypeIdOf(rawStation);
    if (stationTypeId == null) {
      throw new Error('יש לציין עמדה לכל תמונה שמועלית');
    }
    return {
      objectKey,
      fileName:
        typeof fileName === 'string' && fileName.trim() !== ''
          ? fileName
          : objectKey.split('/').pop() || 'image',
      stationTypeId,
    };
  });
}

export interface VerifiedReferenceImage extends ReferenceImageUpload {
  size: number;
  contentType: string;
  etag: string | null;
}

/**
 * Check that every uploaded image actually landed in the RU bucket, is an
 * image within the cap, for a station type that exists. Runs BEFORE any row is
 * created or deleted, so a failed or forged upload cannot half-apply a save.
 * Throws (Hebrew, user-facing).
 */
export async function verifyReferenceImageUploads(
  uploads: ReferenceImageUpload[],
): Promise<VerifiedReferenceImage[]> {
  if (uploads.length === 0) return [];
  await checkStationTypeIds(uploads.map((u) => u.stationTypeId));

  const verified: VerifiedReferenceImage[] = [];
  for (const upload of uploads) {
    const check = await verifyUploaded(upload.objectKey, MAX_IMAGE_SIZE, REFERENCE_BUCKET);
    if (!check.ok) {
      throw new Error(
        check.status === 404
          ? `התמונה ${upload.fileName} לא נמצאה באחסון — יש להעלות אותה מחדש`
          : `הקובץ ${upload.fileName} חורג מהגודל המרבי (${MAX_IMAGE_SIZE_MB}MB)`,
      );
    }
    const contentType = check.info.contentType;
    // octet-stream = the browser did not know the type; anything else must be an image.
    if (contentType !== 'application/octet-stream' && !contentType.startsWith('image/')) {
      throw new Error(`הקובץ ${upload.fileName} אינו תמונה`);
    }
    verified.push({
      ...upload,
      size: check.info.size,
      contentType,
      etag: check.info.etag,
    });
  }
  return verified;
}

/**
 * Insert `reference_item_images` rows for verified uploads (appended after
 * `startSort`), through `db` — the save's transaction. Returns the created
 * rows in upload order. The registry rows are activated after the commit
 * (registerReferenceImages), so a rolled-back save leaves them pending.
 */
export async function createReferenceImageRows(
  db: Prisma.TransactionClient,
  referenceItemId: number,
  images: VerifiedReferenceImage[],
  startSort = 0,
): Promise<{ reference_item_image_id: number }[]> {
  const created: { reference_item_image_id: number }[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    created.push(await db.reference_item_images.create({
      data: {
        reference_item_id: referenceItemId,
        bucket: REFERENCE_BUCKET,
        object_key: img.objectKey,
        file_name: img.fileName.slice(0, 255),
        content_type: img.contentType,
        size_bytes: BigInt(img.size),
        sort_order: startSort + i,
        test_station_type_id: img.stationTypeId,
      },
      select: { reference_item_image_id: true },
    }));
  }
  return created;
}

/** Activate the registry rows of images whose rows a save has committed. */
export async function registerReferenceImages(referenceItemId: number, images: VerifiedReferenceImage[]) {
  for (const img of images) {
    await registerFileObject({
      objectKey: img.objectKey,
      fileName: img.fileName,
      contentType: img.contentType,
      sizeBytes: img.size,
      // Direct upload: no server-side sha256; MinIO's ETag stands in.
      checksum: null,
      entityType: 'reference_item_image',
      entityId: referenceItemId,
      metadata: { stationTypeId: img.stationTypeId, etag: img.etag, uploadedVia: 'direct' },
      bucket: REFERENCE_BUCKET,
    });
  }
}

/**
 * Remove the bytes of images whose rows are already gone from the RU bucket,
 * and soft-delete their registry rows. Best-effort on the object store so a
 * MinIO hiccup can't strand the DB.
 */
export async function removeReferenceImageObjects(images: { object_key: string }[]) {
  if (images.length === 0) return;
  const keys = images.map((img) => img.object_key);
  try {
    await removeObjects(keys, REFERENCE_BUCKET);
  } catch (err) {
    console.warn('[reference-items] failed to remove objects:', (err as Error).message);
  }
  await Promise.all(keys.map((k) => markFileObjectDeleted(k)));
}
