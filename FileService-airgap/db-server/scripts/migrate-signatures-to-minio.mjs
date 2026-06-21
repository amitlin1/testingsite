/**
 * One-time migration: move on-disk shipment signatures into MinIO + registry.
 *
 * Walks FILES_PATH/{shipmentId}/{filename}, uploads each file to the MinIO key
 * `shipments/{shipmentId}/{filename}`, and upserts a row into `file_objects`.
 * Idempotent: re-running skips objects that already exist in MinIO.
 *
 * Usage (from the project root):
 *   node -r dotenv/config scripts/migrate-signatures-to-minio.mjs dotenv_config_path=.env.development
 *   # or just `node scripts/migrate-signatures-to-minio.mjs` if env is already set
 *
 * Required env: FILES_PATH, MINIO_ENDPOINT, MINIO_ROOT_USER,
 *               MINIO_ROOT_PASSWORD, MINIO_BUCKET, DATABASE_URL
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { Client as MinioClient } from 'minio';
import pg from 'pg';

const FILES_PATH = process.env.FILES_PATH || '/data/shipments';
const BUCKET = process.env.MINIO_BUCKET || 'digitalfactory-files';

function minio() {
  const endpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
  const url = new URL(endpoint);
  return new MinioClient({
    endPoint: url.hostname,
    port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 9000),
    useSSL: url.protocol === 'https:',
    accessKey: process.env.MINIO_ROOT_USER || '',
    secretKey: process.env.MINIO_ROOT_PASSWORD || '',
  });
}

async function objectExists(client, key) {
  try {
    await client.statObject(BUCKET, key);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const client = minio();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  if (!(await client.bucketExists(BUCKET))) {
    await client.makeBucket(BUCKET);
  }

  let dirs = [];
  try {
    dirs = await fs.readdir(FILES_PATH, { withFileTypes: true });
  } catch (err) {
    console.error(`Cannot read FILES_PATH "${FILES_PATH}":`, err.message);
    process.exit(1);
  }

  let uploaded = 0;
  let skipped = 0;

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const shipmentId = dir.name;
    const shipmentDir = path.join(FILES_PATH, shipmentId);
    const files = await fs.readdir(shipmentDir);

    for (const fileName of files) {
      const localPath = path.join(shipmentDir, fileName);
      const objectKey = `shipments/${shipmentId}/${fileName}`;

      if (await objectExists(client, objectKey)) {
        console.log(`skip (exists): ${objectKey}`);
        skipped++;
        continue;
      }

      const buffer = await fs.readFile(localPath);
      const checksum = createHash('sha256').update(buffer).digest('hex');
      const contentType = fileName.endsWith('.png') ? 'image/png' : 'application/octet-stream';
      const entityType = fileName.startsWith('send')
        ? 'shipment_history_signature'
        : 'shipment_signature';

      await client.putObject(BUCKET, objectKey, buffer, buffer.length, {
        'Content-Type': contentType,
        'x-amz-meta-sha256': checksum,
        'x-amz-meta-migrated-at': new Date().toISOString(),
      });

      await pool.query(
        `INSERT INTO file_objects
           (bucket, object_key, file_name, content_type, size_bytes,
            checksum_sha256, entity_type, entity_id, metadata, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
         ON CONFLICT (object_key) DO UPDATE SET
           size_bytes = EXCLUDED.size_bytes,
           checksum_sha256 = EXCLUDED.checksum_sha256,
           status = 'active',
           deleted_at = NULL,
           updated_at = now()`,
        [
          BUCKET,
          objectKey,
          fileName,
          contentType,
          buffer.length,
          checksum,
          entityType,
          shipmentId,
          JSON.stringify({ migrated: true }),
        ],
      );

      console.log(`uploaded: ${objectKey} (${buffer.length} bytes)`);
      uploaded++;
    }
  }

  await pool.end();
  console.log(`\nDone. uploaded=${uploaded} skipped=${skipped}`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
