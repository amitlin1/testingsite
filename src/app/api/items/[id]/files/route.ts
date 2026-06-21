import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/app/lib/prisma';
import {
  ensureBucket,
  putObject,
  removeObject,
  statObject,
} from '@/lib/storage';
import {
  registerFileObject,
  markFileObjectDeleted,
} from '@/lib/file-registry';

export const runtime = 'nodejs';

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '100');
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Files attached to a specific item.
 *
 * All operations are namespaced under the object-key prefix `items/{itemId}/`
 * so listing, soft-delete and tamper-checks are O(prefix). The bytes live in
 * MinIO; `file_objects` is the queryable index (entity_type='item_attachment').
 */

const prefixFor = (itemId: string) => `items/${itemId}/`;

const sanitizeFilename = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');

/** Reject keys that don't belong to this item — prevents cross-item deletes via a forged ?key. */
function keyBelongsToItem(key: string, itemId: string): boolean {
  return key.startsWith(prefixFor(itemId)) && !key.includes('..');
}

async function ensureItemExists(itemId: bigint): Promise<boolean> {
  const row = await prisma.items.findUnique({
    where: { item_id: itemId },
    select: { item_id: true },
  });
  return row !== null;
}

// GET /api/items/[id]/files — list active attachments
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const itemId = BigInt(id);
    if (!(await ensureItemExists(itemId))) {
      return NextResponse.json({ error: 'הפריט לא נמצא' }, { status: 404 });
    }

    const rows = await prisma.file_objects.findMany({
      where: {
        entity_type: 'item_attachment',
        entity_id: String(id),
        status: 'active',
      },
      orderBy: { created_at: 'desc' },
    });

    const files = rows.map((r) => ({
      objectKey: r.object_key,
      fileName: r.file_name,
      contentType: r.content_type,
      size: Number(r.size_bytes),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      createdBy: r.created_by,
      updatedBy: r.updated_by,
    }));

    return NextResponse.json({ files });
  } catch (error) {
    console.error('List item files error:', error);
    return NextResponse.json({ error: 'שגיאה בטעינת קבצים' }, { status: 500 });
  }
}

// POST /api/items/[id]/files — multipart upload (files[], worker_id)
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const itemId = BigInt(id);
    if (!(await ensureItemExists(itemId))) {
      return NextResponse.json({ error: 'הפריט לא נמצא' }, { status: 404 });
    }

    const formData = await request.formData();
    const workerIdRaw = formData.get('worker_id');
    const workerId = workerIdRaw ? String(workerIdRaw) : null;
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'לא נבחרו קבצים' }, { status: 400 });
    }

    await ensureBucket();
    const uploaded: Array<{ objectKey: string; fileName: string }> = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `הקובץ ${file.name} חורג מהגודל המרבי (${MAX_FILE_SIZE_MB}MB)` },
          { status: 400 },
        );
      }

      const safeName = sanitizeFilename(file.name);
      const objectKey = `${prefixFor(id)}${randomUUID()}_${safeName}`;
      const contentType = file.type || 'application/octet-stream';
      const buffer = Buffer.from(await file.arrayBuffer());

      const stored = await putObject(objectKey, buffer, contentType);

      await registerFileObject({
        objectKey,
        fileName: file.name,
        contentType,
        sizeBytes: stored.size,
        checksum: stored.checksum,
        entityType: 'item_attachment',
        entityId: id,
        metadata: { originalName: file.name },
        createdBy: workerId,
        updatedBy: workerId,
      });

      uploaded.push({ objectKey, fileName: file.name });
    }

    return NextResponse.json({ uploaded });
  } catch (error) {
    console.error('Item file upload error:', error);
    return NextResponse.json({ error: 'שגיאה בהעלאת קבצים' }, { status: 500 });
  }
}

// DELETE /api/items/[id]/files?key=...&worker_id=...  (soft delete; bytes survive as MinIO version)
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'נדרש מפתח קובץ' }, { status: 400 });
    }
    if (!keyBelongsToItem(key, id)) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }

    await removeObject(key);
    await markFileObjectDeleted(key);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Item file delete error:', error);
    return NextResponse.json({ error: 'שגיאה במחיקת קובץ' }, { status: 500 });
  }
}

// PATCH /api/items/[id]/files?key=...  multipart: file, worker_id
// Replace bytes at an existing key. Versioning preserves the prior bytes.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    if (!key) {
      return NextResponse.json({ error: 'נדרש מפתח קובץ' }, { status: 400 });
    }
    if (!keyBelongsToItem(key, id)) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }

    // Confirm the object exists before overwriting — refuses to "replace" a deleted/missing file.
    if (!(await statObject(key))) {
      return NextResponse.json({ error: 'הקובץ המקורי לא נמצא' }, { status: 404 });
    }

    const formData = await request.formData();
    const workerIdRaw = formData.get('worker_id');
    const workerId = workerIdRaw ? String(workerIdRaw) : null;
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'לא נבחר קובץ חדש' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `הקובץ חורג מהגודל המרבי (${MAX_FILE_SIZE_MB}MB)` },
        { status: 400 },
      );
    }

    const contentType = file.type || 'application/octet-stream';
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await putObject(key, buffer, contentType);

    await registerFileObject({
      objectKey: key,
      fileName: file.name,
      contentType,
      sizeBytes: stored.size,
      checksum: stored.checksum,
      entityType: 'item_attachment',
      entityId: id,
      metadata: { originalName: file.name, replaced: true },
      updatedBy: workerId,
    });

    return NextResponse.json({
      ok: true,
      file: { objectKey: key, fileName: file.name },
    });
  } catch (error) {
    console.error('Item file replace error:', error);
    return NextResponse.json({ error: 'שגיאה בהחלפת קובץ' }, { status: 500 });
  }
}
