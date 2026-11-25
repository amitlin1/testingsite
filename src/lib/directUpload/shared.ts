/**
 * Direct-to-MinIO uploads — the wire contract and the pure helpers (the key
 * layout itself is @/lib/storage/keys).
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
