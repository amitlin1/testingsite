import { NextResponse } from 'next/server';
import {
  getObjectStream,
  statObject,
  nodeToWebStream,
  contentTypeFromName,
  REFERENCE_BUCKET,
} from '@/lib/storage';

export const runtime = 'nodejs';

// GET /api/settings/reference-items/images/[...path]
// Streams a reference image inline from the dedicated RU bucket so <img> tags
// can render it. Scoped to REFERENCE_BUCKET only — it never reads other buckets.
export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const objectKey = path.map(decodeURIComponent).join('/');

  if (!objectKey || objectKey.includes('..')) {
    return NextResponse.json({ error: 'נתיב לא תקין' }, { status: 400 });
  }

  try {
    const stat = await statObject(objectKey, REFERENCE_BUCKET);
    if (!stat) {
      return NextResponse.json({ error: 'התמונה לא נמצאה' }, { status: 404 });
    }

    const nodeStream = await getObjectStream(objectKey, REFERENCE_BUCKET);
    const contentType =
      (stat.metaData?.['content-type'] as string) || contentTypeFromName(objectKey);
    const filename = objectKey.split('/').pop() || 'image';

    return new Response(nodeToWebStream(nodeStream), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Reference image download error:', error);
    return NextResponse.json({ error: 'שגיאה בטעינת התמונה' }, { status: 500 });
  }
}
