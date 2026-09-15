import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { registerFileObject } from '@/lib/file-registry';
import {
  MAX_UPLOAD_BATCH,
  keyBelongsToItem,
  type ConfirmResponse,
} from '@/lib/directUpload/shared';
import {
  MAX_FILE_SIZE,
  parseConfirmEntries,
  readJson,
  verifyUploaded,
  workerIdOf,
} from '@/lib/directUpload/server';

export const runtime = 'nodejs';

/**
 * POST /api/items/[id]/files/confirm — step 3 of a direct upload.
 *
 * Body (JSON): { uploads: [{ objectKey, fileName }], worker_id?, replaced? }
 *
 * For every key: it must live under this item, the object must exist in MinIO
 * and respect the size cap. Then the registry row is activated (the pending
 * row from presign carries the tags; a replace merges `replaced: true` into
 * the existing row). The response lists what was accepted and what was not,
 * per key — a partial batch is a 200 with both lists filled.
 */

type ConfirmBody = { uploads?: unknown; worker_id?: unknown; replaced?: unknown };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'מזהה פריט לא תקין' }, { status: 400 });
    }
    const item = await prisma.items.findUnique({
      where: { item_id: BigInt(id) },
      select: { item_id: true },
    });
    if (!item) {
      return NextResponse.json({ error: 'הפריט לא נמצא' }, { status: 404 });
    }

    const body = await readJson<ConfirmBody>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }
    const parsed = parseConfirmEntries(body.uploads, MAX_UPLOAD_BATCH);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const workerId = workerIdOf(body.worker_id);
    const replaced = body.replaced === true;

    const result: ConfirmResponse = { confirmed: [], failed: [] };
    let firstFailureStatus: number | null = null;

    for (const { objectKey, fileName } of parsed.entries) {
      if (!keyBelongsToItem(objectKey, id)) {
        result.failed.push({ objectKey, error: 'מפתח קובץ לא תקין' });
        firstFailureStatus ??= 400;
        continue;
      }
      const verified = await verifyUploaded(objectKey, MAX_FILE_SIZE);
      if (!verified.ok) {
        result.failed.push({ objectKey, error: verified.error });
        firstFailureStatus ??= verified.status;
        continue;
      }

      await registerFileObject({
        objectKey,
        fileName,
        contentType: verified.info.contentType,
        sizeBytes: verified.info.size,
        // The bytes never passed through this server, so there is no server-side
        // sha256. MinIO's ETag (MD5 of a single-part POST) is kept as the
        // integrity reference instead.
        checksum: null,
        entityType: 'item_attachment',
        entityId: id,
        metadata: {
          originalName: fileName,
          etag: verified.info.etag,
          uploadedVia: 'direct',
          ...(replaced ? { replaced: true } : {}),
        },
        createdBy: workerId,
        updatedBy: workerId,
      });
      result.confirmed.push({ objectKey, fileName });
    }

    const status = result.confirmed.length > 0 ? 200 : firstFailureStatus ?? 400;
    return NextResponse.json(
      status === 200 ? result : { ...result, error: result.failed[0]?.error ?? 'אימות ההעלאה נכשל' },
      { status },
    );
  } catch (error) {
    console.error('Item file confirm error:', error);
    return NextResponse.json({ error: 'שגיאה באימות ההעלאה' }, { status: 500 });
  }
}
