import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { readJson } from '@/lib/directUpload/server';
import {
  serializeReferenceItem,
  referenceItemInclude,
  parseReferenceImageUploads,
  verifyReferenceImageUploads,
  attachReferenceImages,
} from '@/lib/reference-items';

export const runtime = 'nodejs';

// GET /api/settings/reference-items?itemTypeId=123
// Returns the reference items (optionally filtered by item type), each with its
// images + resolved cover URL. Returns [] on error so the page never crashes.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemTypeIdRaw = searchParams.get('itemTypeId');
    // const referenceWeight = searchParams.get('referenceWeight');
    const itemTypeId = itemTypeIdRaw ? Number(itemTypeIdRaw) : undefined;

    const rows = await prisma.reference_items.findMany({
      where: itemTypeId && Number.isFinite(itemTypeId) ? { item_type_id: itemTypeId } : undefined,
      include: referenceItemInclude,
      orderBy: { reference_item_id: 'desc' },
    });

    return NextResponse.json(rows.map(serializeReferenceItem));
  } catch (error) {
    console.error('Error fetching reference items:', error);
    return NextResponse.json([]);
  }
}

// POST /api/settings/reference-items  (JSON)
// Fields: item_type_id, manufacturer_sku, manufacturer, name?, reference_weight?,
//         notes?, images ([{ objectKey, fileName, photoType }] — already uploaded
//         to MinIO through images/presign), primaryIndex? (index into images for
//         the cover).
type CreateBody = {
  item_type_id?: unknown;
  manufacturer_sku?: unknown;
  manufacturer?: unknown;
  name?: unknown;
  reference_weight?: unknown;
  notes?: unknown;
  images?: unknown;
  primaryIndex?: unknown;
};

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

export async function POST(request: Request) {
  try {
    const body = await readJson<CreateBody>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }

    const itemTypeId = Number(body.item_type_id);
    const manufacturerSku = str(body.manufacturer_sku);
    const manufacturer = str(body.manufacturer);
    const name = str(body.name);
    const referenceWeight = str(body.reference_weight);
    const notes = str(body.notes);
    const primaryIndex = Number(body.primaryIndex ?? 0);

    if (!itemTypeId || !Number.isFinite(itemTypeId)) {
      return NextResponse.json({ error: 'יש לבחור סוג פריט.' }, { status: 400 });
    }
    if (!manufacturerSku) {
      return NextResponse.json({ error: 'יש להזין מק״ט יצרן.' }, { status: 400 });
    }
    if (!manufacturer) {
      return NextResponse.json({ error: 'יש להזין יצרן.' }, { status: 400 });
    }

    const itemType = await prisma.item_types.findUnique({ where: { item_type_id: itemTypeId } });
    if (!itemType) {
      return NextResponse.json({ error: 'סוג הפריט לא נמצא.' }, { status: 400 });
    }

    // Verify every uploaded image (exists in MinIO, is an image, has a valid
    // photo type) BEFORE creating the row, so a bad upload can't leave an
    // orphan reference item behind.
    let verified: Awaited<ReturnType<typeof verifyReferenceImageUploads>>;
    try {
      verified = await verifyReferenceImageUploads(parseReferenceImageUploads(body.images));
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'תמונה לא תקינה' },
        { status: 400 },
      );
    }

    const created = await prisma.reference_items.create({
      data: {
        item_type_id: itemTypeId,
        manufacturer_sku: manufacturerSku,
        manufacturer,
        name: name || null,
        reference_weight: referenceWeight || null,
        notes: notes || null,
      },
      select: { reference_item_id: true },
    });

    const imageRows = await attachReferenceImages(created.reference_item_id, verified);

    // Resolve the cover: the chosen upload index (falls back to the first image).
    if (imageRows.length > 0) {
      const idx = Number.isFinite(primaryIndex) && imageRows[primaryIndex] ? primaryIndex : 0;
      await prisma.reference_items.update({
        where: { reference_item_id: created.reference_item_id },
        data: { primary_image_id: imageRows[idx].reference_item_image_id },
      });
    }

    const full = await prisma.reference_items.findUnique({
      where: { reference_item_id: created.reference_item_id },
      include: referenceItemInclude,
    });

    return NextResponse.json(serializeReferenceItem(full!), { status: 201 });
  } catch (error) {
    console.error('Error creating reference item:', error);
    const message = error instanceof Error ? error.message : 'שגיאה ביצירת פריט ייחוס';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
