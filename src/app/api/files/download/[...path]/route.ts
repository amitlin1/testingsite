import { NextResponse } from 'next/server';
import minioClient, { BUCKET, ensureBucket } from '@/lib/minio';
import { hasAppSession } from '@/lib/auth/session-guard';
import { verifyJwt } from '@/lib/onlyoffice-jwt';

export const runtime = 'nodejs';

/** A short-lived signed token (issued by the OnlyOffice config route) bound to a
 *  specific object key — lets the cookieless OnlyOffice document server fetch
 *  that one file without a browser session. */
async function validDownloadToken(request: Request, fullPath: string): Promise<boolean> {
  try {
    const tok = new URL(request.url).searchParams.get('dl');
    if (!tok) return false;
    const payload = await verifyJwt<{ key?: string; purpose?: string }>(tok);
    return payload?.purpose === 'download' && payload.key === fullPath;
  } catch {
    return false;
  }
}

// GET /api/files/download/[...path]
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  if (!fullPath || fullPath.includes('..')) {
    return NextResponse.json({ error: 'נתיב לא תקין' }, { status: 400 });
  }

  // Auth: a logged-in browser session (any role), OR a valid signed download
  // token (cookieless OnlyOffice). This route's URL contains a dot, so the edge
  // middleware skips it — it must self-guard.
  if (!(await hasAppSession()) && !(await validDownloadToken(request, fullPath))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureBucket();

    // Get object metadata for Content-Type and size
    let stat: { size: number; metaData?: Record<string, string> };
    try {
      stat = await minioClient.statObject(BUCKET, fullPath);
    } catch {
      return NextResponse.json({ error: 'הקובץ לא נמצא' }, { status: 404 });
    }

    const nodeStream = await minioClient.getObject(BUCKET, fullPath);

    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err: Error) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    const filename = fullPath.split('/').pop() || 'file';
    const contentType =
      (stat.metaData?.['content-type'] as string) || 'application/octet-stream';

    return new Response(webStream, {
      headers: {
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'שגיאה בהורדת הקובץ' }, { status: 500 });
  }
}
