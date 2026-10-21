import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { readJson } from '@/lib/directUpload/server';
import { serializeReferenceItem, referenceItemWithMembersInclude } from '@/lib/reference-items';
import { ReferenceSaveError, deleteReferenceItem, saveReferenceItem } from '@/lib/reference-items-save';

export const runtime = 'nodejs';

// PUT /api/settings/reference-items/[id]  (JSON) — the body is described in
// lib/reference-items-save.ts. A package reference's member is edited only
// through its package reference.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const refId = Number(id);
    if (!Number.isFinite(refId)) {
      return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 });
    }

    const body = await readJson<Record<string, unknown>>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }

    await saveReferenceItem(refId, body);
    const full = await prisma.reference_items.findUnique({
      where: { reference_item_id: refId },
      include: referenceItemWithMembersInclude,
    });

    return NextResponse.json(serializeReferenceItem(full!));
  } catch (error) {
    if (error instanceof ReferenceSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating reference item:', error);
    const message = error instanceof Error ? error.message : 'שגיאה בעדכון פריט ייחוס';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/settings/reference-items/[id] — removes the item, its image rows,
// and the corresponding objects in the RU bucket; a package reference takes
// its members (and their images) with it.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const refId = Number(id);
    if (!Number.isFinite(refId)) {
      return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 });
    }

    await deleteReferenceItem(refId);
    return NextResponse.json({ success: true, id: refId });
  } catch (error) {
    if (error instanceof ReferenceSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'פריט הייחוס לא נמצא' }, { status: 404 });
    }
    console.error('Error deleting reference item:', error);
    return NextResponse.json({ error: 'שגיאה במחיקת פריט ייחוס' }, { status: 500 });
  }
}
