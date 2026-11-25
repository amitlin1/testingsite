import { randomUUID } from 'crypto';
import {
  BUCKET,
  inspectUploadedObject,
  presignPost,
  removeObject,
  type UploadedObjectInfo,
} from '@/lib/storage';
import type { ConfirmEntry, ConfirmResponse, UploadTicket } from './shared';

/**
 * Server half of the direct-upload flow (see ./shared.ts for the contract).
 * Route handlers stay thin: they validate their own request shape, then call
 * issueTicket() on presign and confirmUploads() on confirm.
 */

/** Per-file ceiling for the item files and the file manager (env MAX_FILE_SIZE_MB, default 100). */
export const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '100', 10) || 100;
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * How long a ticket stays valid. A ticket is bound to one key, one content type
 * and a size ceiling, so a long window costs little; a short one would fail the
 * tail of a big batch on a slow Wi-Fi link. Same 1h the OnlyOffice download
 * token uses.
 */
const PRESIGN_EXPIRY_SECONDS = 60 * 60;

export const newUploadId = (): string => randomUUID();

export async function issueTicket(opts: {
  key: string;
  fileName: string;
  contentType: string;
  maxBytes: number;
  bucket?: string;
}): Promise<UploadTicket> {
  const signed = await presignPost({
    key: opts.key,
    contentType: opts.contentType,
    maxBytes: opts.maxBytes,
    expirySeconds: PRESIGN_EXPIRY_SECONDS,
    bucket: opts.bucket ?? BUCKET,
  });
  return {
    objectKey: opts.key,
    fileName: opts.fileName,
    url: signed.url,
    fields: signed.fields,
    expiresAt: signed.expiresAt,
  };
}

export type VerifyResult =
  | { ok: true; info: UploadedObjectInfo }
  | { ok: false; status: 404 | 413; error: string };

/**
 * Confirm-step check: the object must exist and respect the size ceiling. The
 * POST policy already enforces the ceiling at MinIO, so an oversize object here
 * means a forged ticket — the bytes are removed rather than registered.
 */
export async function verifyUploaded(
  key: string,
  maxBytes: number,
  bucket: string = BUCKET,
): Promise<VerifyResult> {
  const info = await inspectUploadedObject(key, bucket);
  if (!info) {
    return { ok: false, status: 404, error: 'הקובץ לא נמצא באחסון — ההעלאה לא הושלמה' };
  }
  if (info.size > maxBytes) {
    try {
      await removeObject(key, bucket);
    } catch (err) {
      console.warn('[direct-upload] could not remove oversize object', key, (err as Error).message);
    }
    return {
      ok: false,
      status: 413,
      error: `הקובץ חורג מהגודל המרבי (${Math.floor(maxBytes / (1024 * 1024))}MB)`,
    };
  }
  return { ok: true, info };
}

export function parseConfirmEntries(
  raw: unknown,
  max: number,
): { ok: true; entries: Array<{ objectKey: string; fileName: string }> } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'לא צוינו קבצים לאישור' };
  }
  if (raw.length > max) {
    return { ok: false, error: `ניתן לאשר עד ${max} קבצים בבת אחת` };
  }
  const entries: Array<{ objectKey: string; fileName: string }> = [];
  for (const entry of raw) {
    const objectKey = (entry as Record<string, unknown>)?.objectKey;
    const fileName = (entry as Record<string, unknown>)?.fileName;
    if (typeof objectKey !== 'string' || objectKey === '') {
      return { ok: false, error: 'מפתח קובץ חסר' };
    }
    entries.push({
      objectKey,
      fileName:
        typeof fileName === 'string' && fileName.trim() !== ''
          ? fileName
          : objectKey.split('/').pop() || objectKey,
    });
  }
  return { ok: true, entries };
}

/** The worker a request names, as the registry's created_by / updated_by text; null when none. */
export function uploadedByOf(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/**
 * The confirm step for a batch: each entry must pass the route's own `accept`
 * (an error to report, or null), exist in MinIO within `maxBytes`, and is then
 * registered. 200 when any entry was confirmed — a partial batch lists both —
 * else the first failure's status, with its message as `error`.
 */
export async function confirmUploads(
  entries: readonly ConfirmEntry[],
  opts: {
    accept: (entry: ConfirmEntry) => string | null;
    maxBytes: number;
    register: (entry: ConfirmEntry, info: UploadedObjectInfo) => Promise<void>;
  },
): Promise<{ status: number; body: ConfirmResponse & { error?: string } }> {
  const result: ConfirmResponse = { confirmed: [], failed: [] };
  let firstFailureStatus: number | null = null;

  for (const entry of entries) {
    const refused = opts.accept(entry);
    if (refused) {
      result.failed.push({ objectKey: entry.objectKey, error: refused });
      firstFailureStatus ??= 400;
      continue;
    }
    const verified = await verifyUploaded(entry.objectKey, opts.maxBytes);
    if (!verified.ok) {
      result.failed.push({ objectKey: entry.objectKey, error: verified.error });
      firstFailureStatus ??= verified.status;
      continue;
    }
    await opts.register(entry, verified.info);
    result.confirmed.push({ objectKey: entry.objectKey, fileName: entry.fileName });
  }

  const status = result.confirmed.length > 0 ? 200 : firstFailureStatus ?? 400;
  return {
    status,
    body: status === 200 ? result : { ...result, error: result.failed[0]?.error ?? 'אימות ההעלאה נכשל' },
  };
}
