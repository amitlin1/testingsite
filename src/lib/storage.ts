import { createHash } from 'crypto';
import type { Readable } from 'stream';
import minioClient, {
  BUCKET,
  REFERENCE_BUCKET,
  MINIO_PUBLIC_ENDPOINT,
  ensureBucket,
  presignClient,
} from './minio';

/**
 * Storage service — the ONLY module that talks to MinIO directly.
 *
 * MinIO is the single source of truth for file bytes. Higher layers
 * (signatures, file manager) go through these helpers so that swapping
 * the backend, adding caching, or changing the bucket layout is a
 * one-file change.
 *
 * Two ways bytes get in:
 *   - putObject()   — server-side writes (signatures, OnlyOffice saves, inline
 *                     text edits). The bytes pass through this process.
 *   - presignPost() — browser uploads. The app only signs a POST policy; the
 *                     browser sends the bytes straight to MinIO and the route
 *                     then verifies the object with inspectUploadedObject().
 */

export { BUCKET, REFERENCE_BUCKET, MINIO_PUBLIC_ENDPOINT, ensureBucket };

export interface StoredObject {
  /** Full object key inside the bucket, e.g. "shipments/12/recv_169..._42.png" */
  key: string;
  size: number;
  contentType: string;
  etag?: string;
  checksum?: string;
}

/** sha256 hex digest of a buffer — used for integrity checks and dedup. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Upload a buffer to MinIO. Returns metadata about the stored object.
 */
export async function putObject(
  key: string,
  buffer: Buffer,
  contentType = 'application/octet-stream',
  metadata: Record<string, string> = {},
  bucket: string = BUCKET,
): Promise<StoredObject> {
  await ensureBucket(bucket);
  const checksum = sha256(buffer);
  const result = await minioClient.putObject(bucket, key, buffer, buffer.length, {
    'Content-Type': contentType,
    'x-amz-meta-uploaded-at': new Date().toISOString(),
    'x-amz-meta-sha256': checksum,
    ...metadata,
  });
  return {
    key,
    size: buffer.length,
    contentType,
    etag: result.etag,
    checksum,
  };
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

/** Stat an object after a direct upload. null = nothing landed under that key. */
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

/** Stat an object; returns null if it does not exist. */
export async function statObject(key: string, bucket: string = BUCKET) {
  await ensureBucket(bucket);
  try {
    return await minioClient.statObject(bucket, key);
  } catch {
    return null;
  }
}

export async function objectExists(key: string, bucket: string = BUCKET): Promise<boolean> {
  return (await statObject(key, bucket)) !== null;
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

/** List object keys under a prefix. recursive=false returns one folder level. */
export async function listKeys(prefix: string, recursive = true, bucket: string = BUCKET): Promise<string[]> {
  await ensureBucket(bucket);
  return new Promise<string[]>((resolve, reject) => {
    const keys: string[] = [];
    const stream = minioClient.listObjectsV2(bucket, prefix, recursive) as any;
    stream.on('data', (obj: any) => {
      if (obj.name) keys.push(obj.name as string);
    });
    stream.on('end', () => resolve(keys));
    stream.on('error', reject);
  });
}

/** Delete every object under a prefix (e.g. all files for a shipment). */
export async function removePrefix(prefix: string, bucket: string = BUCKET): Promise<number> {
  const keys = await listKeys(prefix, true, bucket);
  await removeObjects(keys, bucket);
  return keys.length;
}

/**
 * Convert a MinIO Node stream into a Web ReadableStream for Next.js Response.
 * Centralises the boilerplate that was duplicated across the file routes.
 */
export function nodeToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
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

/** Map a filename extension to a content type for serving. */
export function contentTypeFromName(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
