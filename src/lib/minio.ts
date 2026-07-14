import { Client } from 'minio';

function createMinioClient(): Client {
  const endpoint = process.env.MINIO_ENDPOINT || 'http://minio:9000';
  let hostname = 'minio';
  let port = 9000;
  let useSSL = false;

  try {
    const url = new URL(endpoint);
    hostname = url.hostname;
    port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 9000);
    useSSL = url.protocol === 'https:';
  } catch {
    // fall back to defaults
  }

  return new Client({
    endPoint: hostname,
    port,
    useSSL,
    accessKey: process.env.MINIO_ROOT_USER || '',
    secretKey: process.env.MINIO_ROOT_PASSWORD || '',
  });
}

/** Default bucket — used by signatures and the file manager. */
export const BUCKET = process.env.MINIO_BUCKET || 'digitalfactory-files';

/**
 * Dedicated bucket for reference-item images (the "RU" bucket the user asked
 * for). MinIO/S3 bucket names must be lowercase and 3–63 chars, so the literal
 * "RU" is invalid; we use a valid, descriptive name. Same storage procedure as
 * the default bucket — only the target bucket differs.
 */
export const REFERENCE_BUCKET =
  process.env.MINIO_REFERENCE_BUCKET || 'ru-reference-items';

const globalForMinio = globalThis as unknown as { _minioClient?: Client };
export const minioClient: Client =
  globalForMinio._minioClient ?? createMinioClient();

if (process.env.NODE_ENV !== 'production') {
  globalForMinio._minioClient = minioClient;
}

// Cache the bucket-ready check per bucket so we don't hit MinIO on every request.
const readyBuckets = new Set<string>();

export async function ensureBucket(bucket: string = BUCKET): Promise<void> {
  if (readyBuckets.has(bucket)) return;

  const exists = await minioClient.bucketExists(bucket);
  if (!exists) {
    await minioClient.makeBucket(bucket);
  }

  // Enable versioning so overwrites and deletes are recoverable (durability).
  // Safe to call repeatedly; ignore if the backend doesn't support it.
  if (process.env.MINIO_VERSIONING !== 'false') {
    try {
      await minioClient.setBucketVersioning(bucket, { Status: 'Enabled' });
    } catch (err) {
      console.warn('Could not enable bucket versioning:', (err as Error).message);
    }
  }

  readyBuckets.add(bucket);
}

export default minioClient;
