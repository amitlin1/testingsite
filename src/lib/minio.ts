import { Client } from 'minio';

/** Split "http://host:9000" into the pieces the MinIO client constructor wants. */
function parseEndpoint(endpoint: string): { endPoint: string; port: number; useSSL: boolean } {
  try {
    const url = new URL(endpoint);
    const useSSL = url.protocol === 'https:';
    return {
      endPoint: url.hostname,
      port: parseInt(url.port) || (useSSL ? 443 : 9000),
      useSSL,
    };
  } catch {
    return { endPoint: 'minio', port: 9000, useSSL: false };
  }
}

const ACCESS_KEY = process.env.MINIO_ROOT_USER || '';
const SECRET_KEY = process.env.MINIO_ROOT_PASSWORD || '';

/** Where the APP reaches MinIO (container / LAN address of the DB server). */
export const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'http://minio:9000';

/**
 * Where the BROWSER reaches MinIO. Presigned upload tickets are built against
 * this address, and SigV4 signs the Host, so it has to be the exact origin the
 * client will POST to. Defaults to MINIO_ENDPOINT, which is right for the
 * two-server production layout: http://<DB-IP>:9000 is reachable from the app
 * and from every client PC alike. Override only when the app-side address is
 * container-only (e.g. host.docker.internal on a single-machine install).
 */
export const MINIO_PUBLIC_ENDPOINT = process.env.MINIO_PUBLIC_ENDPOINT || MINIO_ENDPOINT;

/**
 * Region baked into presigned tickets. MinIO's default is us-east-1; set
 * MINIO_REGION only if the server runs with a custom MINIO_SITE_REGION. Fixing
 * it on the presign client lets it sign OFFLINE: it never has to call
 * GetBucketLocation on the public endpoint, which may not resolve from inside
 * the container.
 */
export const MINIO_REGION = process.env.MINIO_REGION || 'us-east-1';

function createMinioClient(endpoint: string, region?: string): Client {
  return new Client({
    ...parseEndpoint(endpoint),
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    ...(region ? { region } : {}),
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

const globalForMinio = globalThis as unknown as {
  _minioClient?: Client;
  _minioPresignClient?: Client;
};

/** App-side client: every server-side read/write/stat/list goes through this one. */
export const minioClient: Client =
  globalForMinio._minioClient ?? createMinioClient(MINIO_ENDPOINT);

/**
 * Presign-only client, pointed at the PUBLIC endpoint. It never performs a
 * request itself; it only computes POST-policy signatures for the browser.
 */
export const presignClient: Client =
  globalForMinio._minioPresignClient ?? createMinioClient(MINIO_PUBLIC_ENDPOINT, MINIO_REGION);

if (process.env.NODE_ENV !== 'production') {
  globalForMinio._minioClient = minioClient;
  globalForMinio._minioPresignClient = presignClient;
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
