import { prisma } from '@/app/lib/prisma';
import { BUCKET } from './storage';

/**
 * File registry — keeps the Postgres `file_objects` table in sync with MinIO.
 *
 * The registry is an auxiliary index/audit log: MinIO remains the source of
 * truth for bytes. Every helper here is BEST-EFFORT — it runs on its own
 * connection and swallows errors so a registry hiccup can never break the
 * primary operation (saving a shipment, uploading a file). Drift is repaired
 * by `scripts/reconcile-file-registry.mjs`.
 *
 * Row lifecycle:
 *   pending → active → deleted
 *   - `pending`: a direct (browser → MinIO) upload has a ticket but has not
 *     been confirmed yet. Invisible to every listing. Written by
 *     registerPendingFileObject().
 *   - `active`:  the bytes are in MinIO and verified. registerFileObject()
 *     creates or flips a row to this state.
 *   - `deleted`: soft-deleted; the bytes may survive as a MinIO version.
 */

export type FileEntityType =
  | 'shipment_signature'
  | 'shipment_history_signature'
  | 'file_manager'
  | 'item_attachment'
  | 'reference_item_image';

export interface RegisterInput {
  objectKey: string;
  fileName: string;
  contentType?: string | null;
  sizeBytes?: number;
  checksum?: string | null;
  entityType?: FileEntityType | null;
  entityId?: string | number | null;
  metadata?: Record<string, unknown> | null;
  /** Who first uploaded the object. Only set on initial create; ignored on update. */
  createdBy?: string | null;
  /** Who last touched it (upload/replace/edit). Set on every write; falls back to createdBy on first insert. */
  updatedBy?: string | null;
  bucket?: string;
}

const normalizeEntityId = (entityId: RegisterInput['entityId']): string | null =>
  entityId === null || entityId === undefined ? null : String(entityId);

/** Insert (or refresh, on overwrite) a registry row for a stored object. */
export async function registerFileObject(input: RegisterInput): Promise<void> {
  try {
    const entityId = normalizeEntityId(input.entityId);

    // updated_by tracks "who touched it last"; on first insert it mirrors created_by
    // so the row always has a populated actor field even if a caller forgets updatedBy.
    const updatedBy = input.updatedBy ?? input.createdBy ?? null;

    // On UPDATE (same object_key — byte replace, inline edit, OnlyOffice save,
    // or a pending direct upload being confirmed), MERGE the incoming metadata
    // into whatever is already stored instead of overwriting it wholesale. A
    // replace/edit passes only its own marker (e.g. { replaced: true }); without
    // merging, the classification tags written at presign/upload time
    // (stationTypeId / isGlobal / photoType) would be silently lost. New keys
    // win; keys the caller omits survive. `metadata: undefined` still means
    // "leave the column untouched", so callers that pass nothing are unaffected.
    let updateMetadata: Record<string, unknown> | undefined;
    if (input.metadata != null) {
      const existing = await prisma.file_objects.findUnique({
        where: { object_key: input.objectKey },
        select: { metadata: true },
      });
      const prev =
        existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? (existing.metadata as Record<string, unknown>)
          : {};
      updateMetadata = { ...prev, ...input.metadata };
    }

    await prisma.file_objects.upsert({
      where: { object_key: input.objectKey },
      create: {
        bucket: input.bucket ?? BUCKET,
        object_key: input.objectKey,
        file_name: input.fileName,
        content_type: input.contentType ?? null,
        size_bytes: BigInt(input.sizeBytes ?? 0),
        checksum_sha256: input.checksum ?? null,
        entity_type: input.entityType ?? null,
        entity_id: entityId,
        metadata: (input.metadata ?? undefined) as never,
        created_by: input.createdBy ?? null,
        updated_by: updatedBy,
        status: 'active',
      },
      update: {
        file_name: input.fileName,
        content_type: input.contentType ?? null,
        size_bytes: BigInt(input.sizeBytes ?? 0),
        checksum_sha256: input.checksum ?? null,
        // The owner can only become MORE specific on update (a reference image
        // presigned under "new" learns its item id when the form is saved);
        // a caller that passes null keeps whatever is stored.
        ...(input.entityType != null ? { entity_type: input.entityType } : {}),
        ...(entityId != null ? { entity_id: entityId } : {}),
        metadata: (updateMetadata ?? undefined) as never,
        updated_by: updatedBy,
        status: 'active',
        deleted_at: null,
      },
    });
  } catch (err) {
    console.warn('[file-registry] register failed for', input.objectKey, (err as Error).message);
  }
}

/**
 * Reserve a row for an object the browser is about to upload straight to MinIO
 * (presigned POST). status='pending' keeps it out of every listing until the
 * confirm step flips it to 'active' through registerFileObject(). The tags the
 * upload was requested with (station, photo type, owner) are stored here, so
 * the confirm only has to name the key. Rows that are never confirmed are
 * swept by scripts/reconcile-file-registry.mjs.
 */
export async function registerPendingFileObject(input: RegisterInput): Promise<void> {
  try {
    await prisma.file_objects.create({
      data: {
        bucket: input.bucket ?? BUCKET,
        object_key: input.objectKey,
        file_name: input.fileName,
        content_type: input.contentType ?? null,
        size_bytes: BigInt(input.sizeBytes ?? 0),
        checksum_sha256: null,
        entity_type: input.entityType ?? null,
        entity_id: normalizeEntityId(input.entityId),
        metadata: (input.metadata ?? undefined) as never,
        created_by: input.createdBy ?? null,
        updated_by: input.updatedBy ?? input.createdBy ?? null,
        status: 'pending',
      },
    });
  } catch (err) {
    console.warn('[file-registry] pending register failed for', input.objectKey, (err as Error).message);
  }
}

/** Soft-delete a single object's registry row. */
export async function markFileObjectDeleted(objectKey: string): Promise<void> {
  try {
    await prisma.file_objects.updateMany({
      where: { object_key: objectKey, status: 'active' },
      data: { status: 'deleted', deleted_at: new Date() },
    });
  } catch (err) {
    console.warn('[file-registry] soft-delete failed for', objectKey, (err as Error).message);
  }
}

/** Soft-delete every active row whose key starts with the prefix (folder delete). */
export async function markPrefixDeleted(prefix: string): Promise<void> {
  try {
    await prisma.file_objects.updateMany({
      where: { object_key: { startsWith: prefix }, status: 'active' },
      data: { status: 'deleted', deleted_at: new Date() },
    });
  } catch (err) {
    console.warn('[file-registry] prefix soft-delete failed for', prefix, (err as Error).message);
  }
}

/** Move/rename: repoint an existing row to a new key (and derive file_name). */
export async function renameFileObject(oldKey: string, newKey: string): Promise<void> {
  try {
    const fileName = newKey.split('/').pop() || newKey;
    await prisma.file_objects.updateMany({
      where: { object_key: oldKey },
      data: { object_key: newKey, file_name: fileName, updated_at: new Date() },
    });
  } catch (err) {
    console.warn('[file-registry] rename failed', oldKey, '->', newKey, (err as Error).message);
  }
}
