import { putObject, removeObject } from './storage';
import {
  registerFileObject,
  markFileObjectDeleted,
  type FileEntityType,
} from './file-registry';

/**
 * Shipment signature storage.
 *
 * Signatures live in MinIO under `shipments/{shipmentId}/{filename}` and are
 * tracked in the `file_objects` registry. The database column
 * (`signature_path`) keeps storing only the *filename*, so the existing API
 * contract (`/api/shipments/{id}/files/{filename}`) and the frontend/PDF code
 * stay unchanged.
 */

/** Build the MinIO object key for a shipment signature. */
export function signatureObjectKey(
  shipmentId: number | string | undefined,
  filename: string,
): string {
  return shipmentId !== undefined && shipmentId !== null && `${shipmentId}` !== ''
    ? `shipments/${shipmentId}/${filename}`
    : `shipments/${filename}`;
}

/**
 * Save a signature image for a shipment to MinIO and register it.
 *
 * @param base64Data - The base64 encoded image data (data URL or raw).
 * @param prefix     - Filename prefix, e.g. 'recv' or 'send'.
 * @param shipmentId - The shipment id (for object-key organisation).
 * @returns Only the filename (stored in the DB), or null if it failed.
 */
export async function saveSignature(
  base64Data: string,
  prefix: string,
  shipmentId?: number | string,
): Promise<string | null> {
  if (!base64Data) return null;

  try {
    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      console.error('Invalid base64 string');
      return null;
    }

    const contentType = matches[1] || 'image/png';
    const buffer = Buffer.from(matches[2], 'base64');
    const fileName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.png`;
    const objectKey = signatureObjectKey(shipmentId, fileName);

    const stored = await putObject(objectKey, buffer, contentType);

    const entityType: FileEntityType =
      prefix === 'send' ? 'shipment_history_signature' : 'shipment_signature';

    await registerFileObject({
      objectKey,
      fileName,
      contentType,
      sizeBytes: stored.size,
      checksum: stored.checksum,
      entityType,
      entityId: shipmentId ?? null,
      metadata: { prefix },
    });

    console.log(`Signature saved to MinIO object: ${objectKey}`);

    // Return only the filename for database storage (signature_path).
    return fileName;
  } catch (error) {
    console.error('Error saving signature to MinIO:', error);
    return null;
  }
}

/**
 * Delete a shipment signature from MinIO and soft-delete its registry row.
 * Best-effort: never throws. Call this when a shipment / history entry that
 * owns a signature is removed.
 */
export async function deleteSignature(
  shipmentId: number | string,
  filename: string,
): Promise<void> {
  if (!filename) return;
  const objectKey = signatureObjectKey(shipmentId, filename);
  try {
    await removeObject(objectKey);
  } catch (err) {
    console.warn('Could not remove signature object', objectKey, (err as Error).message);
  }
  await markFileObjectDeleted(objectKey);
}
