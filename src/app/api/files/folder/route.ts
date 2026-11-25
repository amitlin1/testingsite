import { NextResponse } from 'next/server';
import { createFolder } from '@/lib/storage/file-manager';
import { errorResponse } from '@/lib/http/errors';

export const runtime = 'nodejs';

// POST /api/files/folder  body: { path: string }
export async function POST(request: Request) {
  try {
    const { path } = (await request.json()) as { path: string };
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'נדרש נתיב תיקייה' }, { status: 400 });
    }
    const folder = await createFolder(path);
    if (!folder.ok) return NextResponse.json({ error: folder.error }, { status: 400 });
    return NextResponse.json({ ok: true, path: folder.path });
  } catch (error) {
    return errorResponse(error, 'שגיאה ביצירת תיקייה');
  }
}
