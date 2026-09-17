/**
 * Direct-to-MinIO uploads — the wire contract and the pure helpers.
 *
 * Nothing in this file touches the network, the database or process.env, so it
 * is safe to import from the browser bundle (types + validation) and from unit
 * tests alike. Everything that needs MinIO or Prisma lives in ./server.ts.
 *
 * The flow every upload follows:
 *   1. browser → POST .../presign   { files: UploadDescriptor[] , ...tags }
 *      app     ← PresignResponse    one UploadTicket per file, aligned by index
 *   2. browser → POST ticket.url    multipart form: ticket.fields + file (last)
 *      MinIO   ← 204                the bytes never pass through the app
 *   3. browser → POST .../confirm   { uploads: ConfirmEntry[] }
 *      app     ← ConfirmResponse    app stat()s the object and registers it
 */

/** What the browser tells the app about a file BEFORE uploading it. */
export interface UploadDescriptor {
  name: string;
  /** MIME type as the browser reports it; empty/unknown becomes octet-stream. */
  type?: string | null;
  size: number;
}

/** One signed upload: POST `fields` + the file (as the LAST field) to `url`. */
export interface UploadTicket {
  /** The key the object WILL live under once the POST succeeds. */
  objectKey: string;
  /** Original file name, echoed back so the client can pair ticket ↔ file. */
  fileName: string;
  url: string;
  fields: Record<string, string>;
  /** ISO timestamp after which MinIO refuses the POST. */
  expiresAt: string;
}

export interface PresignResponse {
  /** Same order as the `files` array of the request. */
  uploads: UploadTicket[];
  /** Per-file ceiling MinIO enforces on the POST (bytes). */
  maxBytes: number;
}

export interface ConfirmEntry {
  objectKey: string;
  fileName: string;
}

export interface ConfirmResponse {
  confirmed: ConfirmEntry[];
  failed: Array<{ objectKey: string; error: string }>;
}

/** Sanity ceiling on how many tickets one presign call may mint. */
export const MAX_UPLOAD_BATCH = 100;

/** Object-key prefix every attachment of an item lives under. */
export const itemPrefix = (itemId: string) => `items/${itemId}/`;

/** Reject keys that don't belong to this item — prevents cross-item writes via a forged key. */
export function keyBelongsToItem(key: string, itemId: string): boolean {
  return key.startsWith(itemPrefix(itemId)) && !key.includes('..');
}

/** Filesystem-safe file name for embedding in an object key. */
export const sanitizeFilename = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');

/** `items/{id}/{uuid}_{safeName}` — the same layout the old multipart route produced. */
export function buildItemObjectKey(itemId: string, fileName: string, uploadId: string): string {
  return `${itemPrefix(itemId)}${uploadId}_${sanitizeFilename(fileName)}`;
}

export type DescriptorParse =
  | { ok: true; files: UploadDescriptor[] }
  | { ok: false; error: string };

/**
 * Validate the `files` array of a presign request. Sizes are checked here so a
 * too-big file is refused BEFORE a ticket exists (MinIO enforces the same cap
 * again on the POST via content-length-range — the guards stack).
 */
export function parseUploadDescriptors(
  raw: unknown,
  maxBytes: number,
  maxMb: number,
): DescriptorParse {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'לא נבחרו קבצים' };
  }
  if (raw.length > MAX_UPLOAD_BATCH) {
    return { ok: false, error: `ניתן להעלות עד ${MAX_UPLOAD_BATCH} קבצים בבת אחת` };
  }

  const files: UploadDescriptor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'תיאור קובץ לא תקין' };
    }
    const { name, type, size } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') {
      return { ok: false, error: 'לקובץ חסר שם' };
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
      return { ok: false, error: `לקובץ ${name} חסר גודל תקין` };
    }
    if (size > maxBytes) {
      return { ok: false, error: `הקובץ ${name} חורג מהגודל המרבי (${maxMb}MB)` };
    }
    files.push({
      name,
      type: typeof type === 'string' && type.trim() !== '' ? type : null,
      size,
    });
  }
  return { ok: true, files };
}

/** MIME type to pin in the POST policy; the browser must send exactly this. */
export function contentTypeOf(desc: Pick<UploadDescriptor, 'type'>): string {
  return desc.type && desc.type.trim() !== '' ? desc.type : 'application/octet-stream';
}

export type FolderPathParse =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * File-manager folder: '' for the root, otherwise 'a/b/' (trailing slash, no
 * leading slash, no traversal). Mirrors the folder-create route's rules.
 */
export function normalizeFolderPath(raw: unknown): FolderPathParse {
  if (raw == null || raw === '') return { ok: true, path: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'נתיב לא תקין' };
  let path = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path === '') return { ok: true, path: '' };
  if (path.split('/').some((seg) => seg === '..')) return { ok: false, error: 'נתיב לא תקין' };
  if (!path.endsWith('/')) path += '/';
  return { ok: true, path };
}

/** A file-manager entry name: a single path segment, nothing that could escape the folder. */
export function isValidFileManagerName(name: string): boolean {
  return (
    name.trim() !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

/** `{folder}{name}` — the file manager keeps the user's own names (overwrites are versioned). */
export function buildFileManagerKey(folderPath: string, fileName: string): string {
  return `${folderPath}${fileName}`;
}

/** Key prefix every reference-item image lives under (inside REFERENCE_BUCKET). */
export const REFERENCE_PREFIX = 'reference-items';

/** Filesystem-safe object-key segment derived from an uploaded image name. */
export function safeReferenceName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'image';
  return base.replace(/[^\w.-]+/g, '_').slice(0, 200) || 'image';
}

/**
 * `reference-items/{itemId|new}/{ts}-{shortId}-{safeName}`. Images for a NOT-YET
 * created reference item are keyed under "new" — the id does not exist until the
 * form is saved, and nothing lists this bucket by prefix.
 */
export function buildReferenceObjectKey(
  referenceItemId: number | null,
  fileName: string,
  uploadId: string,
  now: number = Date.now(),
): string {
  const owner = referenceItemId != null ? String(referenceItemId) : 'new';
  return `${REFERENCE_PREFIX}/${owner}/${now}-${uploadId.slice(0, 8)}-${safeReferenceName(fileName)}`;
}

export function isReferenceObjectKey(key: string): boolean {
  return key.startsWith(`${REFERENCE_PREFIX}/`) && !key.includes('..');
}
