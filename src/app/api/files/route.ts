import { NextResponse } from 'next/server';
import minioClient, { BUCKET, ensureBucket } from '@/lib/minio';
import { copyObject, removeObject, removePrefix, listKeys } from '@/lib/storage';
import {
  markFileObjectDeleted,
  markPrefixDeleted,
  renameFileObject,
} from '@/lib/file-registry';

export const runtime = 'nodejs';

export interface FileItem {
  name: string;
  fullPath: string;
  size: number;
  lastModified: string;
  isFolder: boolean;
}

// GET /api/files?prefix=...
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get('prefix') || '';

  try {
    await ensureBucket();
    const items: FileItem[] = [];

    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = minioClient.listObjectsV2(BUCKET, prefix, false) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stream.on('data', (obj: any) => {
        if (obj.prefix) {
          const rawName = (obj.prefix as string).slice(prefix.length);
          const folderName = rawName.replace(/\/$/, '');
          if (folderName) {
            items.push({
              name: folderName,
              fullPath: obj.prefix,
              size: 0,
              lastModified: new Date().toISOString(),
              isFolder: true,
            });
          }
        } else if (obj.name && obj.name !== prefix) {
          const fileName = (obj.name as string).slice(prefix.length);
          if (fileName) {
            items.push({
              name: fileName,
              fullPath: obj.name,
              size: obj.size || 0,
              lastModified: obj.lastModified
                ? new Date(obj.lastModified).toISOString()
                : new Date().toISOString(),
              isFolder: false,
            });
          }
        }
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    items.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name, 'he');
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('Error listing files:', error);
    return NextResponse.json({ error: 'שגיאה בטעינת קבצים' }, { status: 500 });
  }
}

// DELETE /api/files  body: { paths: string[] }
export async function DELETE(request: Request) {
  try {
    const { paths } = (await request.json()) as { paths: string[] };
    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json({ error: 'נדרש לפחות נתיב אחד' }, { status: 400 });
    }

    for (const itemPath of paths) {
      if (itemPath.endsWith('/')) {
        // Delete folder recursively (objects + marker) and soft-delete in registry
        await removePrefix(itemPath);
        try {
          await removeObject(itemPath);
        } catch {
          /* folder marker may not exist */
        }
        await markPrefixDeleted(itemPath);
      } else {
        await removeObject(itemPath);
        await markFileObjectDeleted(itemPath);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Delete error:', error);
    return NextResponse.json({ error: 'שגיאה במחיקת קבצים' }, { status: 500 });
  }
}

// PATCH /api/files  body: { oldPath: string, newPath: string }
export async function PATCH(request: Request) {
  try {
    const { oldPath, newPath } = (await request.json()) as {
      oldPath: string;
      newPath: string;
    };
    if (!oldPath || !newPath) {
      return NextResponse.json({ error: 'נדרשים נתיב ישן וחדש' }, { status: 400 });
    }

    if (oldPath.endsWith('/')) {
      // Rename/move folder — copy+delete every object, then repoint registry rows
      const keys = await listKeys(oldPath, true);
      for (const key of keys) {
        const newObjPath = newPath + key.slice(oldPath.length);
        await copyObject(key, newObjPath);
        await removeObject(key);
        await renameFileObject(key, newObjPath);
      }

      // Handle the folder marker if it exists
      try {
        await copyObject(oldPath, newPath);
        await removeObject(oldPath);
      } catch {
        /* folder marker may not exist */
      }
    } else {
      await copyObject(oldPath, newPath);
      await removeObject(oldPath);
      await renameFileObject(oldPath, newPath);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Rename error:', error);
    return NextResponse.json({ error: 'שגיאה בשינוי שם' }, { status: 500 });
  }
}
