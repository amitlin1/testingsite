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

export const BUCKET = process.env.MINIO_BUCKET || 'digitalfactory-files';

const globalForMinio = globalThis as unknown as { _minioClient?: Client };
export const minioClient: Client =
  globalForMinio._minioClient ?? createMinioClient();

if (process.env.NODE_ENV !== 'production') {
  globalForMinio._minioClient = minioClient;
}

// Cache the bucket-ready check so we don't hit MinIO on every request.
let bucketReady = false;

export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;

  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
  }

  // Enable versioning so overwrites and deletes are recoverable (durability).
  // Safe to call repeatedly; ignore if the backend doesn't support it.
  if (process.env.MINIO_VERSIONING !== 'false') {
    try {
      await minioClient.setBucketVersioning(BUCKET, { Status: 'Enabled' });
    } catch (err) {
      console.warn('Could not enable bucket versioning:', (err as Error).message);
    }
  }

  bucketReady = true;
}

export default minioClient;
