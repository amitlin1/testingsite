"use client";

import { apiFetch } from "./client";
import type {
  ConfirmResponse,
  PresignResponse,
  UploadDescriptor,
  UploadTicket,
} from "@/lib/directUpload/shared";

/**
 * Browser side of direct-to-MinIO uploads.
 *
 * The app never sees the bytes any more: it signs a POST policy (presign), the
 * browser POSTs the file straight to MinIO, then tells the app which key landed
 * (confirm) so it can stat the object and register it. presign/confirm go
 * through apiFetch (session cookie, 401 → refresh → retry); the POST to MinIO
 * is a plain cross-origin XHR — no cookies, no custom headers, so no preflight —
 * and it is the one place we get real upload progress from.
 *
 * Contract and validation rules: src/lib/directUpload/shared.ts.
 */

export type UploadStage = "presign" | "storage" | "confirm";

export class DirectUploadError extends Error {
  constructor(
    message: string,
    readonly stage: UploadStage,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DirectUploadError";
  }
}

export type ProgressFn = (loaded: number, total: number) => void;

export function describeFiles(files: File[]): UploadDescriptor[] {
  return files.map((f) => ({ name: f.name, type: f.type || null, size: f.size }));
}

async function postJson<T>(url: string, body: unknown, stage: UploadStage, fallback: string): Promise<T> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new DirectUploadError(data?.error || fallback, stage, res.status);
  return data;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Turn MinIO's XML error into one line a user can act on. */
function storageErrorMessage(xhr: XMLHttpRequest): string {
  const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText || "")?.[1];
  switch (code) {
    case "EntityTooLarge":
      return "הקובץ חורג מהגודל המרבי";
    case "AccessDenied":
      return "אישור ההעלאה נדחה או פג תוקפו — נסה שוב";
    default:
      return `שרת הקבצים דחה את ההעלאה (${xhr.status}${code ? ` ${code}` : ""})`;
  }
}

/**
 * POST one file to MinIO with its ticket. S3 POST rules: every field from the
 * ticket goes in verbatim and the file itself must be the LAST field.
 */
export function postToStorage(ticket: UploadTicket, file: File, onProgress?: ProgressFn): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
    form.append("file", file, ticket.fileName);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", ticket.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new DirectUploadError(storageErrorMessage(xhr), "storage", xhr.status));
    };
    // status 0: the browser could not reach MinIO at all (host/port closed, or a
    // CORS answer it refused). The host is in the message so the operator can
    // check MINIO_PUBLIC_ENDPOINT / the firewall from the error alone.
    xhr.onerror = () =>
      reject(new DirectUploadError(`לא ניתן להגיע לשרת הקבצים (${hostOf(ticket.url)})`, "storage", 0));
    xhr.onabort = () => reject(new DirectUploadError("ההעלאה בוטלה", "storage", 0));
    xhr.send(form);
  });
}

/** Run `fn` over `items`, at most `limit` at a time, preserving order in the result. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** A few uploads in flight at once: enough to overlap, not enough to flood a Wi-Fi link. */
const DEFAULT_CONCURRENCY = 3;

// ---- item attachments -----------------------------------------------------

export interface ItemUploadOptions {
  workerId?: string | number | null;
  stationTypeId?: number | null;
  isGlobal?: boolean;
  photoType?: string | null;
  /** Per-file progress, indexed like `files`. */
  onProgress?: (index: number, loaded: number, total: number) => void;
  concurrency?: number;
}

export interface ItemUploadResult {
  fileName: string;
  /** Set when the file is stored AND registered; null on any failure. */
  objectKey: string | null;
  error: string | null;
}

const itemFilesBase = (itemId: number | string) =>
  `/api/items/${encodeURIComponent(String(itemId))}/files`;

/**
 * Upload attachments to an item. Presign is one call for the whole batch; each
 * file then uploads and confirms on its own, so one failure never takes the
 * rest down — the caller gets a per-file result. Throws only when the presign
 * itself is refused (bad item, oversize file, no session).
 */
export async function uploadItemFiles(
  itemId: number | string,
  files: File[],
  opts: ItemUploadOptions = {},
): Promise<ItemUploadResult[]> {
  if (files.length === 0) return [];
  const base = itemFilesBase(itemId);

  const presign = await postJson<PresignResponse>(
    `${base}/presign`,
    {
      files: describeFiles(files),
      worker_id: opts.workerId ?? null,
      station_type_id: opts.stationTypeId ?? null,
      is_global: !!opts.isGlobal,
      photo_type: opts.photoType ?? null,
    },
    "presign",
    "שגיאה בהכנת ההעלאה",
  );

  return mapWithConcurrency(files, opts.concurrency ?? DEFAULT_CONCURRENCY, async (file, i) => {
    const ticket = presign.uploads[i];
    if (!ticket) return { fileName: file.name, objectKey: null, error: "לא התקבל אישור העלאה" };
    try {
      await postToStorage(ticket, file, (loaded, total) => opts.onProgress?.(i, loaded, total));
      const confirm = await postJson<ConfirmResponse>(
        `${base}/confirm`,
        {
          uploads: [{ objectKey: ticket.objectKey, fileName: file.name }],
          worker_id: opts.workerId ?? null,
        },
        "confirm",
        "אימות ההעלאה נכשל",
      );
      if (!confirm.confirmed.some((c) => c.objectKey === ticket.objectKey)) {
        return {
          fileName: file.name,
          objectKey: null,
          error: confirm.failed[0]?.error ?? "אימות ההעלאה נכשל",
        };
      }
      return { fileName: file.name, objectKey: ticket.objectKey, error: null };
    } catch (e) {
      return {
        fileName: file.name,
        objectKey: null,
        error: e instanceof Error ? e.message : "שגיאה בהעלאה",
      };
    }
  });
}

/** Replace the bytes behind an existing attachment key (MinIO versioning keeps the old ones). */
export async function replaceItemFile(
  itemId: number | string,
  objectKey: string,
  file: File,
  workerId: string | number | null | undefined,
  onProgress?: ProgressFn,
): Promise<void> {
  const base = itemFilesBase(itemId);
  const presign = await postJson<PresignResponse>(
    `${base}/presign`,
    { files: describeFiles([file]), worker_id: workerId ?? null, replace_key: objectKey },
    "presign",
    "שגיאה בהכנת ההחלפה",
  );
  const ticket = presign.uploads[0];
  if (!ticket) throw new DirectUploadError("לא התקבל אישור העלאה", "presign");

  await postToStorage(ticket, file, onProgress);

  const confirm = await postJson<ConfirmResponse>(
    `${base}/confirm`,
    {
      uploads: [{ objectKey: ticket.objectKey, fileName: file.name }],
      worker_id: workerId ?? null,
      replaced: true,
    },
    "confirm",
    "אימות ההחלפה נכשל",
  );
  if (!confirm.confirmed.some((c) => c.objectKey === ticket.objectKey)) {
    throw new DirectUploadError(confirm.failed[0]?.error ?? "אימות ההחלפה נכשל", "confirm");
  }
}

// ---- file manager -----------------------------------------------------------

/** Upload one file into a file-manager folder ('' = root). Throws on any failure. */
export async function uploadFileManagerFile(
  folderPath: string,
  file: File,
  onProgress?: ProgressFn,
): Promise<void> {
  const presign = await postJson<PresignResponse>(
    "/api/files/upload/presign",
    { files: describeFiles([file]), path: folderPath },
    "presign",
    "שגיאה בהכנת ההעלאה",
  );
  const ticket = presign.uploads[0];
  if (!ticket) throw new DirectUploadError("לא התקבל אישור העלאה", "presign");

  await postToStorage(ticket, file, onProgress);

  const confirm = await postJson<ConfirmResponse>(
    "/api/files/upload/confirm",
    { path: folderPath, uploads: [{ objectKey: ticket.objectKey, fileName: file.name }] },
    "confirm",
    "אימות ההעלאה נכשל",
  );
  if (!confirm.confirmed.some((c) => c.objectKey === ticket.objectKey)) {
    throw new DirectUploadError(confirm.failed[0]?.error ?? "אימות ההעלאה נכשל", "confirm");
  }
}

// ---- reference-item images -----------------------------------------------------

export interface ReferenceImageInput {
  file: File;
  fileName: string;
  /** photo_types.code the image belongs to. */
  photoType: string;
}

export interface UploadedReferenceImage {
  objectKey: string;
  fileName: string;
  photoType: string;
}

/**
 * Upload the NEW images of a reference-item form. There is no separate confirm:
 * the form save that follows carries these keys and the server verifies each
 * one before it touches the item. Throws on the first failure so the form stays
 * open with one clear message.
 */
export async function uploadReferenceImages(
  images: ReferenceImageInput[],
  referenceItemId: number | null,
  onProgress?: (index: number, loaded: number, total: number) => void,
): Promise<UploadedReferenceImage[]> {
  if (images.length === 0) return [];

  const presign = await postJson<PresignResponse>(
    "/api/settings/reference-items/images/presign",
    {
      referenceItemId,
      files: images.map((img) => ({
        name: img.fileName,
        type: img.file.type || null,
        size: img.file.size,
        photoType: img.photoType,
      })),
    },
    "presign",
    "שגיאה בהכנת העלאת התמונות",
  );
  if (presign.uploads.length !== images.length) {
    throw new DirectUploadError("לא התקבל אישור העלאה לכל התמונות", "presign");
  }

  await mapWithConcurrency(images, DEFAULT_CONCURRENCY, async (img, i) => {
    try {
      await postToStorage(presign.uploads[i], img.file, (loaded, total) => onProgress?.(i, loaded, total));
    } catch (e) {
      if (e instanceof DirectUploadError) {
        throw new DirectUploadError(`${img.fileName}: ${e.message}`, e.stage, e.status);
      }
      throw e;
    }
  });

  return images.map((img, i) => ({
    objectKey: presign.uploads[i].objectKey,
    fileName: img.fileName,
    photoType: img.photoType,
  }));
}
