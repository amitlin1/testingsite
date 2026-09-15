import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { removeObject } from '@/lib/storage';
import { markFileObjectDeleted } from '@/lib/file-registry';
import { keyBelongsToItem } from '@/lib/directUpload/shared';

export const runtime = 'nodejs';

/**
 * Files attached to a specific item.
 *
 * All operations are namespaced under the object-key prefix `items/{itemId}/`
 * so listing, soft-delete and tamper-checks are O(prefix). The bytes live in
 * MinIO; `file_objects` is the queryable index (entity_type='item_attachment').
 *
 * Uploads and replacements do NOT pass through this server: the browser asks
 * ./presign for a ticket, POSTs the file straight to MinIO, then reports the
 * key to ./confirm. This route only lists and deletes.
 */

async function ensureItemExists(itemId: bigint): Promise<boolean> {
  const row = await prisma.items.findUnique({
    where: { item_id: itemId },
    select: { item_id: true },
  });
  return row !== null;
}

// GET /api/items/[id]/files — list active attachments
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const itemId = BigInt(id);
    if (!(await ensureItemExists(itemId))) {
      return NextResponse.json({ error: 'הפריט לא נמצא' }, { status: 404 });
    }

    // Optional station scope: when provided, return only files uploaded at this
    // station type, plus files marked global. Omit it (management view) → all files.
    const searchParams = new URL(request.url).searchParams;
    const stationTypeParam = searchParams.get('stationTypeId');
    const stationTypeId =
      stationTypeParam != null && stationTypeParam !== '' ? Number(stationTypeParam) : null;
    // Optional photo-type scope (photo_types.code, e.g. "package"/"product"):
    // each wizard screen lists only photos captured for its own group.
    const photoTypeParam = searchParams.get('photoType');
    const photoType = photoTypeParam != null && photoTypeParam !== '' ? photoTypeParam : null;

    // status='active' only: rows still 'pending' (ticket issued, upload not yet
    // confirmed) and soft-deleted rows never show up.
    const rows = await prisma.file_objects.findMany({
      where: {
        entity_type: 'item_attachment',
        entity_id: String(id),
        status: 'active',
      },
      orderBy: { created_at: 'desc' },
    });

    let files = rows.map((r) => {
      const meta = (r.metadata ?? {}) as {
        stationTypeId?: number | null;
        isGlobal?: boolean;
        photoType?: string | null;
      };
      return {
        objectKey: r.object_key,
        fileName: r.file_name,
        contentType: r.content_type,
        size: Number(r.size_bytes),
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        createdBy: r.created_by,
        updatedBy: r.updated_by,
        stationTypeId: meta.stationTypeId ?? null,
        isGlobal: !!meta.isGlobal,
        photoType: meta.photoType ?? null,
      };
    });

    if (stationTypeId != null) {
      // Strict scoping: a station shows only files tagged to its type, plus files
      // explicitly marked global. Untagged files (incl. legacy) show only in the
      // unfiltered management view.
      files = files.filter((f) => f.isGlobal || f.stationTypeId === stationTypeId);
    }
    if (photoType != null) {
      // Strict scoping (same policy as stationTypeId): untagged files show only
      // in unfiltered views.
      files = files.filter((f) => f.photoType === photoType);
    }

    return NextResponse.json({ files });
  } catch (error) {
    console.error('List item files error:', error);
    return NextResponse.json({ error: 'שגיאה בטעינת קבצים' }, { status: 500 });
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
