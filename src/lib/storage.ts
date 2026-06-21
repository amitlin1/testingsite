import { createHash } from 'crypto';
import type { Readable } from 'stream';
import minioClient, { BUCKET, ensureBucket } from './minio';

/**
 * Storage service — the ONLY module that talks to MinIO directly.
 *
 * MinIO is the single source of truth for file bytes. Higher layers
 * (signatures, file manager) go through these helpers so that swapping
 * the backend, adding caching, or changing the bucket layout is a
 * one-file change.
 */

export { BUCKET, ensureBucket };

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
): Promise<StoredObject> {
  await ensureBucket();
  const checksum = sha256(buffer);
  const result = await minioClient.putObject(BUCKET, key, buffer, buffer.length, {
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

/** Return the raw Node stream for an object (caller is responsible for piping). */
export async function getObjectStream(key: string): Promise<Readable> {
  await ensureBucket();
  return minioClient.getObject(BUCKET, key);
}

/** Stat an object; returns null if it does not exist. */
export async function statObject(key: string) {
  await ensureBucket();
  try {
    return await minioClient.statObject(BUCKET, key);
  } catch {
    return null;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  return (await statObject(key)) !== null;
}

export async function removeObject(key: string): Promise<void> {
  await ensureBucket();
  await minioClient.removeObject(BUCKET, key);
}

export async function removeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await ensureBucket();
  await minioClient.removeObjects(BUCKET, keys);
}

export async function copyObject(srcKey: string, destKey: string): Promise<void> {
  await ensureBucket();
  await minioClient.copyObject(BUCKET, destKey, `/${BUCKET}/${srcKey}`);
}

/** List object keys under a prefix. recursive=false returns one folder level. */
export async function listKeys(prefix: string, recursive = true): Promise<string[]> {
  await ensureBucket();
  return new Promise<string[]>((resolve, reject) => {
    const keys: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = minioClient.listObjectsV2(BUCKET, prefix, recursive) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream.on('data', (obj: any) => {
      if (obj.name) keys.push(obj.name as string);
    });
    stream.on('end', () => resolve(keys));
    stream.on('error', reject);
  });
}

/** Delete every object under a prefix (e.g. all files for a shipment). */
export async function removePrefix(prefix: string): Promise<number> {
  const keys = await listKeys(prefix, true);
  await removeObjects(keys);
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
