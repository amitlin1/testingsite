import { NextResponse } from 'next/server';
import { REFERENCE_BUCKET, serveObject } from '@/lib/storage';
import { hasAppSession } from '@/lib/auth/session-guard';

export const runtime = 'nodejs';

// GET /api/settings/reference-items/images/[...path]
// Streams a reference image inline from the dedicated RU bucket so <img> tags
// can render it. Scoped to REFERENCE_BUCKET only — it never reads other buckets.
export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!(await hasAppSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { path } = await context.params;
  const objectKey = path.map(decodeURIComponent).join('/');

  if (!objectKey || objectKey.includes('..')) {
    return NextResponse.json({ error: 'נתיב לא תקין' }, { status: 400 });
  }

  try {
    const res = await serveObject(objectKey, {
      bucket: REFERENCE_BUCKET,
      disposition: 'inline',
      filename: objectKey.split('/').pop() || 'image',
      cacheControl: 'private, max-age=3600',
    });
    return res ?? NextResponse.json({ error: 'התמונה לא נמצאה' }, { status: 404 });
  } catch (error) {
    console.error('Reference image download error:', error);
    return NextResponse.json({ error: 'שגיאה בטעינת התמונה' }, { status: 500 });
  }
}
