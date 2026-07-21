import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  serializeReferenceItem,
  referenceItemInclude,
  uploadReferenceImages,
  deleteReferenceImages,
  pairFilesWithTypes,
} from '@/lib/reference-items';

export const runtime = 'nodejs';

// PUT /api/settings/reference-items/[id]  (multipart/form-data)
// Fields: item_type_id, manufacturer_sku, manufacturer, name?, notes?,
//         keepImageIds (JSON array of existing image ids to keep),
//         images[] (new files), primaryKey ("<existingImageId>" | "new:<index>").
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const refId = Number(id);
    if (!Number.isFinite(refId)) {
      return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 });
    }

    const existing = await prisma.reference_items.findUnique({
      where: { reference_item_id: refId },
      include: { images: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'פריט הייחוס לא נמצא' }, { status: 404 });
    }

    const form = await request.formData();
    const itemTypeId = Number(form.get('item_type_id'));
    const manufacturerSku = String(form.get('manufacturer_sku') ?? '').trim();
    const referenceWeight = String(form.get('reference_weight') ?? '').trim();
    const manufacturer = String(form.get('manufacturer') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const notes = String(form.get('notes') ?? '').trim();
    const primaryKey = String(form.get('primaryKey') ?? '').trim();
    const files = form.getAll('images').filter((f): f is File => f instanceof File);

    let keepImageIds: number[] = [];
    try {
      const parsed = JSON.parse(String(form.get('keepImageIds') ?? '[]'));
      if (Array.isArray(parsed)) keepImageIds = parsed.map(Number).filter(Number.isFinite);
    } catch {
      keepImageIds = existing.images.map((i) => i.reference_item_image_id);
    }

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

    // Pair new files with photo types BEFORE mutating anything, so a bad type
    // can't half-apply the update (deletions run only after this passes).
    let uploads: Awaited<ReturnType<typeof pairFilesWithTypes>>;
    try {
      uploads = await pairFilesWithTypes(form, files);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'סוג תמונה לא תקין' },
        { status: 400 },
      );
    }

    // Remove images the user dropped from the form.
    const toDelete = existing.images.filter(
      (img) => !keepImageIds.includes(img.reference_item_image_id),
    );
    await deleteReferenceImages(toDelete);

    // Upload any new files, appended after the highest existing sort order.
    const maxSort = existing.images.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const newImageRows = await uploadReferenceImages(refId, uploads, maxSort + 1);

    // Resolve the cover from primaryKey: an existing image id, or "new:<index>".
    let primaryImageId: number | null = null;
    if (primaryKey.startsWith('new:')) {
      const idx = Number(primaryKey.slice(4));
      primaryImageId = newImageRows[idx]?.reference_item_image_id ?? null;
    } else if (primaryKey) {
      const asId = Number(primaryKey);
      if (keepImageIds.includes(asId)) primaryImageId = asId;
    }
    if (primaryImageId === null) {
      // Fall back to any surviving/new image so the card always has a cover.
      const survivingPrimary = keepImageIds.includes(existing.primary_image_id ?? -1)
        ? existing.primary_image_id
        : null;
      primaryImageId =
        survivingPrimary ??
        keepImageIds[0] ??
        newImageRows[0]?.reference_item_image_id ??
        null;
    }

    await prisma.reference_items.update({
      where: { reference_item_id: refId },
      data: {
        item_type_id: itemTypeId,
        manufacturer_sku: manufacturerSku,
        manufacturer,
        name: name || null,
        reference_weight: referenceWeight || null,
        notes: notes || null,
        primary_image_id: primaryImageId,
      },
    });

    const full = await prisma.reference_items.findUnique({
      where: { reference_item_id: refId },
      include: referenceItemInclude,
    });

    return NextResponse.json(serializeReferenceItem(full!));
  } catch (error) {
    console.error('Error updating reference item:', error);
    const message = error instanceof Error ? error.message : 'שגיאה בעדכון פריט ייחוס';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/settings/reference-items/[id] — removes the item, its image rows,
// and the corresponding objects in the RU bucket.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const refId = Number(id);
    if (!Number.isFinite(refId)) {
      return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 });
    }

    const existing = await prisma.reference_items.findUnique({
      where: { reference_item_id: refId },
      include: { images: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'פריט הייחוס לא נמצא' }, { status: 404 });
    }

    // Clear image bytes + registry first, then the row (cascade covers the
    // image rows, but we delete explicitly so object removal is bundled).
    await deleteReferenceImages(existing.images);
    await prisma.reference_items.delete({ where: { reference_item_id: refId } });

    return NextResponse.json({ success: true, id: refId });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'פריט הייחוס לא נמצא' }, { status: 404 });
    }
    console.error('Error deleting reference item:', error);
    return NextResponse.json({ error: 'שגיאה במחיקת פריט ייחוס' }, { status: 500 });
  }
}
