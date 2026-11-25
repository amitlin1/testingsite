import { NextResponse } from 'next/server';
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from '@/lib/http/request';
import { serializeReferenceItem, referenceItemWithMembersInclude } from '@/app/lib/reference-items/server';
import { saveReferenceItem } from '@/app/lib/reference-items/save';

export const runtime = 'nodejs';

// GET /api/settings/reference-items?itemTypeId=123
// The reference items (optionally of one item type), each with its images and
// cover URL, and a package reference's members with theirs. Members are never
// listed on their own. A failed read answers [] — a reported bug (the page's
// error band never shows); kept until the owner decides.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemTypeId = parseDbId(searchParams.get('itemTypeId'));

    const rows = await prisma.reference_items.findMany({
      where: {
        parent_reference_id: null,
        ...(itemTypeId != null ? { item_type_id: itemTypeId } : {}),
      },
      include: referenceItemWithMembersInclude,
      orderBy: { reference_item_id: 'desc' },
    });

    return NextResponse.json(rows.map(serializeReferenceItem));
  } catch (error) {
    console.error('Error fetching reference items:', error);
    return NextResponse.json([]);
  }
}

// POST /api/settings/reference-items  (JSON) — the body is described in
// app/lib/reference-items/save.ts.
export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, 'גוף הבקשה אינו JSON תקין');

    const id = await saveReferenceItem(null, body);
    const full = await prisma.reference_items.findUnique({
      where: { reference_item_id: id },
      include: referenceItemWithMembersInclude,
    });

    return NextResponse.json(serializeReferenceItem(full!), { status: 201 });
  } catch (error) {
    return errorResponse(error, 'שגיאה ביצירת פריט ייחוס');
  }
}
