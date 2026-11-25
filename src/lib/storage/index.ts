import { createHash } from 'crypto';
import type { Readable } from 'stream';
import { BUCKET, REFERENCE_BUCKET, ensureBucket, minioClient, presignClient } from './minio';
import { contentTypeFromName } from '@/lib/file-types';

/**
 * Storage service — the only module that talks to MinIO. MinIO is the single
 * source of truth for file bytes; the key layout is ./keys.ts.
 *
 * Two ways bytes get in:
 *   - putObject()   — server-side writes (signatures, OnlyOffice saves, inline
 *                     text edits). The bytes pass through this process.
 *   - presignPost() — browser uploads. The app only signs a POST policy; the
 *                     browser sends the bytes straight to MinIO and the route
 *                     then verifies the object with inspectUploadedObject().
 */

export { BUCKET, REFERENCE_BUCKET };

export interface StoredObject {
  /** Full object key inside the bucket, e.g. "shipments/12/recv_169..._42.png" */
  key: string;
  size: number;
  contentType: string;
  etag?: string;
  checksum?: string;
}

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

export async function putObject(
  key: string,
  buffer: Buffer,
  contentType = 'application/octet-stream',
): Promise<StoredObject> {
  await ensureBucket(BUCKET);
  const checksum = sha256(buffer);
  const result = await minioClient.putObject(BUCKET, key, buffer, buffer.length, {
    'Content-Type': contentType,
    'x-amz-meta-uploaded-at': new Date().toISOString(),
    'x-amz-meta-sha256': checksum,
  });
  return {
    key,
    size: buffer.length,
    contentType,
    etag: result.etag,
    checksum,
  };
}

/** A file-manager folder: the zero-byte object with a trailing slash MinIO lists as a folder. */
export async function putFolderMarker(folderPath: string): Promise<void> {
  await ensureBucket(BUCKET);
  await minioClient.putObject(BUCKET, folderPath, Buffer.alloc(0), 0, {
    'Content-Type': 'application/x-directory',
  });
}

/** A signed browser→MinIO upload: POST `fields` + the file (last) to `url`. */
export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
  /** ISO timestamp after which MinIO refuses the POST. */
  expiresAt: string;
}

/**
 * Sign a POST policy the browser can use to upload ONE object directly to
 * MinIO, bypassing this server entirely. The policy pins the bucket, the exact
 * key, the Content-Type and a size ceiling, so the ticket cannot be reused for
 * anything else. Bucket existence is ensured here (app-side) because the
 * browser's POST would otherwise fail with NoSuchBucket.
 */
export async function presignPost(opts: {
  key: string;
  contentType: string;
  maxBytes: number;
  expirySeconds: number;
  bucket?: string;
}): Promise<PresignedPost> {
  const bucket = opts.bucket ?? BUCKET;
  await ensureBucket(bucket);

  const expiresAt = new Date(Date.now() + opts.expirySeconds * 1000);
  const policy = presignClient.newPostPolicy();
  policy.setBucket(bucket);
  policy.setKey(opts.key);
  policy.setContentType(opts.contentType);
  policy.setContentLengthRange(0, opts.maxBytes);
  policy.setExpires(expiresAt);

  const { postURL, formData } = await presignClient.presignedPostPolicy(policy);
  return { url: postURL, fields: formData, expiresAt: expiresAt.toISOString() };
}

/** What MinIO reports about an object the browser says it uploaded. */
export interface UploadedObjectInfo {
  size: number;
  contentType: string;
  etag: string | null;
  lastModified: Date | null;
}

/** Stat an object after a direct upload. null = nothing could be read under that key. */
export async function inspectUploadedObject(
  key: string,
  bucket: string = BUCKET,
): Promise<UploadedObjectInfo | null> {
  const stat = await statObject(key, bucket);
  if (!stat) return null;
  return {
    size: stat.size,
    contentType: (stat.metaData?.['content-type'] as string) || 'application/octet-stream',
    etag: stat.etag ?? null,
    lastModified: stat.lastModified ?? null,
  };
}

/** Return the raw Node stream for an object (caller is responsible for piping). */
export async function getObjectStream(key: string, bucket: string = BUCKET): Promise<Readable> {
  await ensureBucket(bucket);
  return minioClient.getObject(bucket, key);
}

/** Read a whole object into memory (small objects: signatures, report PDFs, photos). */
export async function getObjectBuffer(key: string, bucket: string = BUCKET): Promise<Buffer> {
  const stream = await getObjectStream(key, bucket);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** `data:<type by name>;base64,…` — how a PDF inlines an image (Chromium makes no network call). */
export const toDataUrl = (bytes: Buffer, name: string): string =>
  `data:${contentTypeFromName(name)};base64,${bytes.toString('base64')}`;

/** An object of the default bucket as a data URL. Throws when it cannot be read. */
export async function readDataUrl(key: string): Promise<string> {
  return toDataUrl(await getObjectBuffer(key), key);
}

/**
 * Stat an object; null when it cannot be stat'ed — a missing object, but also
 * any MinIO error (an outage then reads as "not found").
 */
export async function statObject(key: string, bucket: string = BUCKET) {
  await ensureBucket(bucket);
  try {
    return await minioClient.statObject(bucket, key);
  } catch {
    return null;
  }
}

export async function removeObject(key: string, bucket: string = BUCKET): Promise<void> {
  await ensureBucket(bucket);
  await minioClient.removeObject(bucket, key);
}

export async function removeObjects(keys: string[], bucket: string = BUCKET): Promise<void> {
  if (keys.length === 0) return;
  await ensureBucket(bucket);
  await minioClient.removeObjects(bucket, keys);
}

export async function copyObject(srcKey: string, destKey: string, bucket: string = BUCKET): Promise<void> {
  await ensureBucket(bucket);
  await minioClient.copyObject(bucket, destKey, `/${bucket}/${srcKey}`);
}

function listObjects<T>(prefix: string, recursive: boolean, bucket: string, pick: (obj: { name?: string; prefix?: string; size?: number; lastModified?: Date }) => T | null): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const out: T[] = [];
    const stream = minioClient.listObjectsV2(bucket, prefix, recursive);
    stream.on('data', (obj) => {
      const v = pick(obj);
      if (v != null) out.push(v);
    });
    stream.on('end', () => resolve(out));
    stream.on('error', reject);
  });
}

/** Every object key under a prefix, at any depth (a folder marker included). */
export async function listKeys(prefix: string, bucket: string = BUCKET): Promise<string[]> {
  await ensureBucket(bucket);
  return listObjects(prefix, true, bucket, (obj) => obj.name ?? null);
}

/** One entry of a folder listing: a sub-folder (its prefix) or an object. */
export interface FolderEntry {
  key: string;
  isFolder: boolean;
  size: number;
  lastModified: Date | null;
}

/** One folder level under a prefix (sub-folders and objects). */
export async function listFolder(prefix: string, bucket: string = BUCKET): Promise<FolderEntry[]> {
  await ensureBucket(bucket);
  return listObjects(prefix, false, bucket, (obj) =>
    obj.prefix
      ? { key: obj.prefix, isFolder: true, size: 0, lastModified: null }
      : obj.name
        ? { key: obj.name, isFolder: false, size: obj.size || 0, lastModified: obj.lastModified ? new Date(obj.lastModified) : null }
        : null,
  );
}

/** Delete every object under a prefix (a folder marker included). */
export async function removePrefix(prefix: string, bucket: string = BUCKET): Promise<number> {
  const keys = await listKeys(prefix, bucket);
  await removeObjects(keys, bucket);
  return keys.length;
}

/** A MinIO Node stream as the Web stream a route Response takes. */
function nodeToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err: Error) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export interface ServeOptions {
  bucket?: string;
  /** `attachment` makes the browser save it under `filename`; no header when omitted. */
  disposition?: 'inline' | 'attachment';
  /** Defaults to the key's last segment. */
  filename?: string;
  cacheControl?: string;
}

/**
 * An object as a streamed 200 Response: its stored content type (else one by
 * name) and its length. null when the object cannot be stat'ed — the caller
 * answers its own 404. Throws when the stream cannot be opened.
 */
export async function serveObject(key: string, opts: ServeOptions = {}): Promise<Response | null> {
  const bucket = opts.bucket ?? BUCKET;
  const stat = await statObject(key, bucket);
  if (!stat) return null;
  const stream = await getObjectStream(key, bucket);
  const filename = opts.filename ?? (key.split('/').pop() || 'file');
  const headers: Record<string, string> = {
    'Content-Type': (stat.metaData?.['content-type'] as string) || contentTypeFromName(filename),
    'Content-Length': stat.size.toString(),
  };
  if (opts.disposition) headers['Content-Disposition'] = `${opts.disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;
  return new Response(nodeToWebStream(stream), { headers });
}
