import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
  serializeReferenceItem,
  referenceItemInclude,
  uploadReferenceImages,
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

// POST /api/settings/reference-items  (multipart/form-data)
// Fields: item_type_id, manufacturer_sku, manufacturer, name?, notes?,
//         images[] (files), primaryIndex? (index into images for the cover).
export async function POST(request: Request) {
  try {
    const form = await request.formData();

    const itemTypeId = Number(form.get('item_type_id'));
    const manufacturerSku = String(form.get('manufacturer_sku') ?? '').trim();
    const reference_weight = String(form.get('reference_weight') ?? '').trim();
    const manufacturer = String(form.get('manufacturer') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const referenceWeight = String(form.get('reference_weight') ?? '').trim();
    const notes = String(form.get('notes') ?? '').trim();
    const primaryIndex = Number(form.get('primaryIndex') ?? 0);
    const files = form.getAll('images').filter((f): f is File => f instanceof File);

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

    const imageRows = await uploadReferenceImages(created.reference_item_id, files);

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
