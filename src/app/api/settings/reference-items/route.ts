import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { readJson } from '@/lib/directUpload/server';
import { serializeReferenceItem, referenceItemWithMembersInclude } from '@/lib/reference-items';
import { ReferenceSaveError, saveReferenceItem } from '@/lib/reference-items-save';

export const runtime = 'nodejs';

// GET /api/settings/reference-items?itemTypeId=123
// Returns the reference items (optionally filtered by item type), each with its
// images + resolved cover URL, and a package reference's members with theirs.
// Members are never listed on their own. Returns [] on error so the page never
// crashes.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemTypeIdRaw = searchParams.get('itemTypeId');
    const itemTypeId = itemTypeIdRaw ? Number(itemTypeIdRaw) : undefined;

    const rows = await prisma.reference_items.findMany({
      where: {
        parent_reference_id: null,
        ...(itemTypeId && Number.isFinite(itemTypeId) ? { item_type_id: itemTypeId } : {}),
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
// lib/reference-items-save.ts.
export async function POST(request: Request) {
  try {
    const body = await readJson<Record<string, unknown>>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }

    const id = await saveReferenceItem(null, body);
    const full = await prisma.reference_items.findUnique({
      where: { reference_item_id: id },
      include: referenceItemWithMembersInclude,
    });

    return NextResponse.json(serializeReferenceItem(full!), { status: 201 });
  } catch (error) {
    if (error instanceof ReferenceSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating reference item:', error);
    const message = error instanceof Error ? error.message : 'שגיאה ביצירת פריט ייחוס';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
