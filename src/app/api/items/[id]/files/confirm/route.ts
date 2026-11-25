import { NextResponse } from 'next/server';
import { prisma } from "@/lib/db";
import { registerFileObject } from '@/lib/file-registry';
import { MAX_UPLOAD_BATCH } from '@/lib/directUpload/shared';
import {
  MAX_FILE_SIZE,
  confirmUploads,
  parseConfirmEntries,
  uploadedByOf,
} from '@/lib/directUpload/server';
import { parseItemId, readJsonObject } from '@/lib/http/request';
import { ItemKeys } from '@/lib/storage/keys';
import { errorResponse } from '@/lib/http/errors';

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const itemId = parseItemId(id);
    if (itemId == null) {
      return NextResponse.json({ error: 'מזהה פריט לא תקין' }, { status: 400 });
    }
    const item = await prisma.items.findUnique({
      where: { item_id: itemId },
      select: { item_id: true },
    });
    if (!item) {
      return NextResponse.json({ error: 'הפריט לא נמצא' }, { status: 404 });
    }

    const body = await readJsonObject(request, 'גוף הבקשה אינו JSON תקין');
    const parsed = parseConfirmEntries(body.uploads, MAX_UPLOAD_BATCH);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const workerId = uploadedByOf(body.worker_id);
    const replaced = body.replaced === true;

    const { status, body: result } = await confirmUploads(parsed.entries, {
      accept: ({ objectKey }) => (ItemKeys.belongs(objectKey, id) ? null : 'מפתח קובץ לא תקין'),
      maxBytes: MAX_FILE_SIZE,
      register: ({ objectKey, fileName }, info) =>
        registerFileObject({
          objectKey,
          fileName,
          contentType: info.contentType,
          sizeBytes: info.size,
          // The bytes never passed through this server, so there is no server-side
          // sha256. MinIO's ETag (MD5 of a single-part POST) is kept as the
          // integrity reference instead.
          checksum: null,
          entityType: 'item_attachment',
          entityId: id,
          metadata: {
            originalName: fileName,
            etag: info.etag,
            uploadedVia: 'direct',
            ...(replaced ? { replaced: true } : {}),
          },
          createdBy: workerId,
          updatedBy: workerId,
        }),
    });
    return NextResponse.json(result, { status });
  } catch (error) {
    return errorResponse(error, 'שגיאה באימות ההעלאה');
  }
}
