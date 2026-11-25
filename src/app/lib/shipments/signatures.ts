import { decodeImageDataUrl } from "@/lib/data-url";
import { registerFileObject, markFileObjectDeleted, type FileEntityType } from "@/lib/file-registry";
import { newPrefixedId } from "@/lib/random-id";
import { putObject, removeObject } from "@/lib/storage";
import { ShipmentKeys } from "@/lib/storage/keys";

/**
 * Shipment signatures.
 *
 * Signatures live in MinIO under `shipments/{shipmentId}/{filename}` and are
 * tracked in the `file_objects` registry. The database column
 * (`signature_path`) keeps storing only the *filename*, so the existing API
 * contract (`/api/shipments/{id}/files/{filename}`) and the frontend/PDF code
 * stay unchanged.
 */

/** recv = the receiving worker's (shipments), send = the sender's (shipment_history). */
export type SignatureKind = 'recv' | 'send';

const ENTITY_TYPE: Record<SignatureKind, FileEntityType> = {
  recv: 'shipment_signature',
  send: 'shipment_history_signature',
};

/**
 * Store a drawn signature (a PNG / JPEG / WebP / SVG data URL) of a shipment
 * and register it. Returns the filename the DB keeps, or null when it was not
 * stored.
 */
export async function saveSignature(
  dataUrl: string,
  kind: SignatureKind,
  shipmentId: number,
): Promise<string | null> {
  if (!dataUrl) return null;
  const img = decodeImageDataUrl(dataUrl, Number.POSITIVE_INFINITY);
  if (!img) {
    console.error('Invalid signature data URL');
    return null;
  }
  try {
    const fileName = `${kind}_${Date.now()}_${newPrefixedId("")}.png`;
    const objectKey = ShipmentKeys.signature(shipmentId, fileName);
    const stored = await putObject(objectKey, img.bytes, img.type);
    await registerFileObject({
      objectKey,
      fileName,
      contentType: img.type,
      sizeBytes: stored.size,
      checksum: stored.checksum,
      entityType: ENTITY_TYPE[kind],
      entityId: shipmentId,
      metadata: { prefix: kind },
    });
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
export async function deleteSignature(shipmentId: number, filename: string): Promise<void> {
  if (!filename) return;
  const objectKey = ShipmentKeys.signature(shipmentId, filename);
  try {
    await removeObject(objectKey);
  } catch (err) {
    console.warn('Could not remove signature object', objectKey, (err as Error).message);
  }
  await markFileObjectDeleted(objectKey);
}
