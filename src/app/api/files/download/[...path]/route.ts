import { NextResponse } from 'next/server';
import minioClient, { BUCKET, ensureBucket } from '@/lib/minio';

export const runtime = 'nodejs';

// GET /api/files/download/[...path]
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  if (!fullPath || fullPath.includes('..')) {
    return NextResponse.json({ error: 'נתיב לא תקין' }, { status: 400 });
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
