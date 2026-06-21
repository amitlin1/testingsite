import { NextResponse } from 'next/server';
import { putObject, ensureBucket } from '@/lib/storage';
import { registerFileObject } from '@/lib/file-registry';

export const runtime = 'nodejs';

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '100');
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

// POST /api/files/upload  multipart/form-data: files[], path
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadPath = (formData.get('path') as string) || '';
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'לא נבחרו קבצים' }, { status: 400 });
    }

    await ensureBucket();
    const uploaded: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `הקובץ ${file.name} חורג מהגודל המרבי (${MAX_FILE_SIZE_MB}MB)` },
          { status: 400 },
        );
      }

      const objectKey = `${uploadPath}${file.name}`;
      const contentType = file.type || 'application/octet-stream';
      const buffer = Buffer.from(await file.arrayBuffer());

      const stored = await putObject(objectKey, buffer, contentType);

      await registerFileObject({
        objectKey,
        fileName: file.name,
        contentType,
        sizeBytes: stored.size,
        checksum: stored.checksum,
        entityType: 'file_manager',
        metadata: { folder: uploadPath || '/' },
      });

      uploaded.push(file.name);
    }

    return NextResponse.json({ uploaded });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'שגיאה בהעלאת קבצים' }, { status: 500 });
  }
}
