import { NextResponse } from 'next/server';
import { prisma } from "@/lib/db";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import type { PresignResponse } from '@/lib/directUpload/shared';
import {
  parseReferenceImageDescriptors,
  presignReferenceImages,
  checkStationTypeIds,
} from '@/app/lib/reference-items/server';
import { MAX_IMAGE_SIZE } from '@/app/lib/reference-items/wire';

export const runtime = 'nodejs';

/**
 * POST /api/settings/reference-items/images/presign — step 1 of a reference
 * image upload.
 *
 * Body (JSON):
 *   files            [{ name, type, size, stationTypeId }] — the station type each image is for
 *   referenceItemId  the item being edited, or null/absent for a new item
 *
 * Answer: one ticket per file, same order, into the RU bucket. The browser
 * POSTs each file to MinIO and then sends the keys with the form save
 * (POST/PUT /api/settings/reference-items[/id]), which verifies them.
 */

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, 'גוף הבקשה אינו JSON תקין');

    const parsed = parseReferenceImageDescriptors(body.files);
    if (!parsed.ok) throw new HttpError(400, parsed.error);

    let referenceItemId: number | null = null;
    if (body.referenceItemId != null && body.referenceItemId !== '') {
      const n = parseDbId(body.referenceItemId);
      if (n == null) throw new HttpError(400, 'מזהה לא תקין');
      const exists = await prisma.reference_items.findUnique({
        where: { reference_item_id: n },
        select: { reference_item_id: true },
      });
      if (!exists) throw new HttpError(404, 'פריט הייחוס לא נמצא');
      referenceItemId = n;
    }

    // Unknown station types are refused here, before any ticket or row exists.
    await checkStationTypeIds(parsed.files.map((f) => f.stationTypeId));

    const uploads = await presignReferenceImages(parsed.files, referenceItemId);
    const res: PresignResponse = { uploads, maxBytes: MAX_IMAGE_SIZE };
    return NextResponse.json(res);
  } catch (error) {
    return errorResponse(error, 'שגיאה בהכנת העלאת התמונות');
  }
}
