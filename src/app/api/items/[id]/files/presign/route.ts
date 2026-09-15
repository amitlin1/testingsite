import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { statObject } from '@/lib/storage';
import { registerPendingFileObject } from '@/lib/file-registry';
import {
  buildItemObjectKey,
  contentTypeOf,
  keyBelongsToItem,
  parseUploadDescriptors,
  type PresignResponse,
} from '@/lib/directUpload/shared';
import {
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  issueTicket,
  newUploadId,
  readJson,
  workerIdOf,
} from '@/lib/directUpload/server';

export const runtime = 'nodejs';

/**
 * POST /api/items/[id]/files/presign — step 1 of a direct upload.
 *
 * Body (JSON):
 *   files            [{ name, type, size }]  what the browser is about to send
 *   worker_id        who is uploading (tagged on the registry row)
 *   station_type_id  test_station_type_id the file was taken at, or null
 *   is_global        true → visible at every station for this item
 *   photo_type       photo_types.code the capture belongs to, or null
 *   replace_key      (optional) an EXISTING key to overwrite instead of minting
 *                    a new one — exactly one file; versioning keeps the old bytes
 *
 * Answer: one ticket per file, same order. The browser POSTs each file to
 * MinIO with its ticket, then calls ../confirm. Nothing here reads file bytes.
 */

type PresignBody = {
  files?: unknown;
  worker_id?: unknown;
  station_type_id?: unknown;
  is_global?: unknown;
  photo_type?: unknown;
  replace_key?: unknown;
};

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

    const body = await readJson<PresignBody>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }

    const parsed = parseUploadDescriptors(body.files, MAX_FILE_SIZE, MAX_FILE_SIZE_MB);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const workerId = workerIdOf(body.worker_id);

    // ---- replace: re-sign an existing key, no new registry row ----
    if (typeof body.replace_key === 'string' && body.replace_key !== '') {
      const key = body.replace_key;
      if (parsed.files.length !== 1) {
        return NextResponse.json({ error: 'להחלפה יש לשלוח קובץ אחד בלבד' }, { status: 400 });
      }
      if (!keyBelongsToItem(key, id)) {
        return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
      }
      // Refuses to "replace" a deleted/missing file — same rule the old PATCH had.
      if (!(await statObject(key))) {
        return NextResponse.json({ error: 'הקובץ המקורי לא נמצא' }, { status: 404 });
      }
      const file = parsed.files[0];
      const ticket = await issueTicket({
        key,
        fileName: file.name,
        contentType: contentTypeOf(file),
        maxBytes: MAX_FILE_SIZE,
      });
      const res: PresignResponse = { uploads: [ticket], maxBytes: MAX_FILE_SIZE };
      return NextResponse.json(res);
    }

    // ---- new attachments ----
    const stationTypeRaw = body.station_type_id;
    const stationTypeId =
      stationTypeRaw != null &&
      String(stationTypeRaw) !== '' &&
      Number.isFinite(Number(stationTypeRaw))
        ? Number(stationTypeRaw)
        : null;
    const isGlobal = body.is_global === true || String(body.is_global ?? '') === 'true';
    const photoType =
      typeof body.photo_type === 'string' && body.photo_type.trim() !== ''
        ? body.photo_type.trim()
        : null;

    const uploads = await Promise.all(
      parsed.files.map(async (file) => {
        const objectKey = buildItemObjectKey(id, file.name, newUploadId());
        const contentType = contentTypeOf(file);
        // The classification tags live on the pending row from the start, so
        // the confirm step only has to name the key.
        await registerPendingFileObject({
          objectKey,
          fileName: file.name,
          contentType,
          sizeBytes: file.size,
          entityType: 'item_attachment',
          entityId: id,
          metadata: { originalName: file.name, stationTypeId, isGlobal, photoType },
          createdBy: workerId,
          updatedBy: workerId,
        });
        return issueTicket({ key: objectKey, fileName: file.name, contentType, maxBytes: MAX_FILE_SIZE });
      }),
    );

    const res: PresignResponse = { uploads, maxBytes: MAX_FILE_SIZE };
    return NextResponse.json(res);
  } catch (error) {
    console.error('Item file presign error:', error);
    return NextResponse.json({ error: 'שגיאה בהכנת ההעלאה' }, { status: 500 });
  }
}
