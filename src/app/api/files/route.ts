import { NextResponse } from 'next/server';
import { deleteEntries, listEntries, renameEntry } from '@/lib/storage/file-manager';
import { errorResponse } from '@/lib/http/errors';

export const runtime = 'nodejs';

// GET /api/files?prefix=...
export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get('prefix') || '';
  try {
    return NextResponse.json(await listEntries(prefix));
  } catch (error) {
    return errorResponse(error, 'שגיאה בטעינת קבצים');
  }
}

// DELETE /api/files  body: { paths: string[] }
export async function DELETE(request: Request) {
  try {
    const { paths } = (await request.json()) as { paths: string[] };
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: 'נדרש לפחות נתיב אחד' }, { status: 400 });
    }
    await deleteEntries(paths);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 'שגיאה במחיקת קבצים');
  }
}

// PATCH /api/files  body: { oldPath: string, newPath: string }
export async function PATCH(request: Request) {
  try {
    const { oldPath, newPath } = (await request.json()) as { oldPath: string; newPath: string };
    if (!oldPath || !newPath) {
      return NextResponse.json({ error: 'נדרשים נתיב ישן וחדש' }, { status: 400 });
    }
    await renameEntry(oldPath, newPath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 'שגיאה בשינוי שם');
  }
}
