import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { readJson } from '@/lib/directUpload/server';
import type { PresignResponse } from '@/lib/directUpload/shared';
import {
  MAX_IMAGE_SIZE,
  parseReferenceImageDescriptors,
  presignReferenceImages,
  resolvePhotoTypeIds,
} from '@/lib/reference-items';

export const runtime = 'nodejs';

/**
 * POST /api/settings/reference-items/images/presign — step 1 of a reference
 * image upload.
 *
 * Body (JSON):
 *   files            [{ name, type, size, photoType }]
 *   referenceItemId  the item being edited, or null/absent for a new item
 *
 * Answer: one ticket per file, same order, into the RU bucket. The browser
 * POSTs each file to MinIO and then sends the keys with the form save
 * (POST/PUT /api/settings/reference-items[/id]), which verifies them.
 */

type PresignBody = { files?: unknown; referenceItemId?: unknown };

export async function POST(request: Request) {
  try {
    const body = await readJson<PresignBody>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }

    const parsed = parseReferenceImageDescriptors(body.files);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    let referenceItemId: number | null = null;
    if (body.referenceItemId != null && body.referenceItemId !== '') {
      const n = Number(body.referenceItemId);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 });
      }
      const exists = await prisma.reference_items.findUnique({
        where: { reference_item_id: n },
        select: { reference_item_id: true },
      });
      if (!exists) {
        return NextResponse.json({ error: 'פריט הייחוס לא נמצא' }, { status: 404 });
      }
      referenceItemId = n;
    }

    // Unknown photo-type codes are refused here, before any ticket or row exists.
    try {
      await resolvePhotoTypeIds(parsed.files.map((f) => f.photoType));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'סוג תמונה לא תקין' },
        { status: 400 },
      );
    }

    const uploads = await presignReferenceImages(parsed.files, referenceItemId);
    const res: PresignResponse = { uploads, maxBytes: MAX_IMAGE_SIZE };
    return NextResponse.json(res);
  } catch (error) {
    console.error('Reference image presign error:', error);
    return NextResponse.json({ error: 'שגיאה בהכנת העלאת התמונות' }, { status: 500 });
  }
}
