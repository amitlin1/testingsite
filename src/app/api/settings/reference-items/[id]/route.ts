import { NextResponse } from 'next/server';
import { prisma } from "@/lib/db";
import { errorCode } from "@/lib/errors";
import { errorResponse } from "@/lib/http/errors";
import { requireDbId, readJsonObject } from "@/lib/http/request";
import { serializeReferenceItem, referenceItemWithMembersInclude } from '@/app/lib/reference-items/server';
import { deleteReferenceItem, saveReferenceItem } from '@/app/lib/reference-items/save';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const idOf = async (params: Ctx['params']): Promise<number> => requireDbId((await params).id, 'מזהה לא תקין');

// PUT /api/settings/reference-items/[id]  (JSON) — the body is described in
// app/lib/reference-items/save.ts. A package reference's member is edited only
// through its package reference.
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const refId = await idOf(params);
    const body = await readJsonObject(request, 'גוף הבקשה אינו JSON תקין');

    await saveReferenceItem(refId, body);
    const full = await prisma.reference_items.findUnique({
      where: { reference_item_id: refId },
      include: referenceItemWithMembersInclude,
    });

    return NextResponse.json(serializeReferenceItem(full!));
  } catch (error) {
    return errorResponse(error, 'שגיאה בעדכון פריט ייחוס');
  }
}

// DELETE /api/settings/reference-items/[id] — removes the item, its image rows,
// and the corresponding objects in the RU bucket; a package reference takes
// its members (and their images) with it.
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const refId = await idOf(params);
    await deleteReferenceItem(refId);
    return NextResponse.json({ success: true, id: refId });
  } catch (error) {
    // Deleted meanwhile, between the existence check and the delete.
    if (errorCode(error) === 'P2025') return NextResponse.json({ error: 'פריט הייחוס לא נמצא' }, { status: 404 });
    return errorResponse(error, 'שגיאה במחיקת פריט ייחוס');
  }
}
