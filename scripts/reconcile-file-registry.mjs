/**
 * Reconcile the `file_objects` registry against MinIO (drift repair).
 *
 *   - Objects present in MinIO but missing from the registry  -> inserted.
 *   - Active registry rows whose object is gone from MinIO     -> soft-deleted.
 *
 * The registry is best-effort, so run this periodically (or after incidents)
 * to keep the index/audit log accurate. Read-only against MinIO; only the
 * Postgres registry is modified.
 *
 * Usage:
 *   node -r dotenv/config scripts/reconcile-file-registry.mjs dotenv_config_path=.env.development
 */
import 'dotenv/config';
import { Client as MinioClient } from 'minio';
import pg from 'pg';

const BUCKET = process.env.MINIO_BUCKET || 'digitalfactory-files';

function minio() {
  const url = new URL(process.env.MINIO_ENDPOINT || 'http://localhost:9000');
  return new MinioClient({
    endPoint: url.hostname,
    port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 9000),
    useSSL: url.protocol === 'https:',
    accessKey: process.env.MINIO_ROOT_USER || '',
    secretKey: process.env.MINIO_ROOT_PASSWORD || '',
  });
}

function listAll(client) {
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream = client.listObjectsV2(BUCKET, '', true);
    stream.on('data', (obj) => {
      if (obj.name && !obj.name.endsWith('/')) {
        objects.push({ key: obj.name, size: obj.size || 0 });
      }
    });
    stream.on('end', () => resolve(objects));
    stream.on('error', reject);
  });
}

async function main() {
  const client = minio();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  if (!(await client.bucketExists(BUCKET))) {
    console.error(`Bucket "${BUCKET}" does not exist.`);
    process.exit(1);
  }

  const objects = await listAll(client);
  const liveKeys = new Set(objects.map((o) => o.key));

  let inserted = 0;
  for (const obj of objects) {
    const fileName = obj.key.split('/').pop() || obj.key;
    const entityType = obj.key.startsWith('shipments/') ? 'shipment_signature' : 'file_manager';
    const res = await pool.query(
      `INSERT INTO file_objects
         (bucket, object_key, file_name, size_bytes, entity_type, metadata, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       ON CONFLICT (object_key) DO UPDATE SET
         size_bytes = EXCLUDED.size_bytes,
         status = 'active',
         deleted_at = NULL,
         updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [BUCKET, obj.key, fileName, obj.size, entityType, JSON.stringify({ reconciled: true })],
    );
    if (res.rows[0]?.inserted) inserted++;
  }

  // Soft-delete active rows whose object no longer exists in MinIO.
  const active = await pool.query(
    `SELECT object_key FROM file_objects WHERE status = 'active'`,
  );
  let softDeleted = 0;
  for (const row of active.rows) {
    if (!liveKeys.has(row.object_key)) {
      await pool.query(
        `UPDATE file_objects SET status='deleted', deleted_at=now()
         WHERE object_key=$1 AND status='active'`,
        [row.object_key],
      );
      softDeleted++;
    }
  }

  await pool.end();
  console.log(
    `Reconcile done. objects=${objects.length} inserted=${inserted} soft-deleted=${softDeleted}`,
  );
}

main().catch((err) => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});
