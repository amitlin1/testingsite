import { NextResponse } from 'next/server';
import minioClient, { BUCKET, ensureBucket } from '@/lib/minio';

export const runtime = 'nodejs';

// POST /api/files/folder  body: { path: string }
export async function POST(request: Request) {
  try {
    const { path } = (await request.json()) as { path: string };

    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'נדרש נתיב תיקייה' }, { status: 400 });
    }

    // Ensure the path ends with '/' (MinIO folder convention)
    const folderPath = path.endsWith('/') ? path : `${path}/`;

    if (folderPath.includes('..')) {
      return NextResponse.json({ error: 'נתיב לא תקין' }, { status: 400 });
    }

    await ensureBucket();

    // Create a zero-byte object with trailing slash as the folder marker
    await minioClient.putObject(BUCKET, folderPath, Buffer.alloc(0), 0, {
      'Content-Type': 'application/x-directory',
    });

    return NextResponse.json({ ok: true, path: folderPath });
  } catch (error) {
    console.error('Create folder error:', error);
    return NextResponse.json({ error: 'שגיאה ביצירת תיקייה' }, { status: 500 });
  }
}
