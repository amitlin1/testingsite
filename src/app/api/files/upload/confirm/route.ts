import { NextResponse } from 'next/server';
import { registerFileObject } from '@/lib/file-registry';
import {
  MAX_UPLOAD_BATCH,
  buildFileManagerKey,
  isValidFileManagerName,
  normalizeFolderPath,
  type ConfirmResponse,
} from '@/lib/directUpload/shared';
import { MAX_FILE_SIZE, parseConfirmEntries, readJson, verifyUploaded } from '@/lib/directUpload/server';

export const runtime = 'nodejs';

/**
 * POST /api/files/upload/confirm — file manager, step 3 of a direct upload.
 *
 * Body (JSON): { path: "folder/", uploads: [{ objectKey, fileName }] }
 *
 * Each key must be exactly `{path}{fileName}` — the client cannot register an
 * arbitrary key as a file-manager entry — and the object must exist in MinIO
 * within the size cap. Registered as entity_type='file_manager'.
 */

type ConfirmBody = { path?: unknown; uploads?: unknown };

export async function POST(request: Request) {
  try {
    const body = await readJson<ConfirmBody>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }
    const folder = normalizeFolderPath(body.path);
    if (!folder.ok) {
      return NextResponse.json({ error: folder.error }, { status: 400 });
    }
    const parsed = parseConfirmEntries(body.uploads, MAX_UPLOAD_BATCH);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result: ConfirmResponse = { confirmed: [], failed: [] };
    let firstFailureStatus: number | null = null;

    for (const { objectKey, fileName } of parsed.entries) {
      if (!isValidFileManagerName(fileName) || objectKey !== buildFileManagerKey(folder.path, fileName)) {
        result.failed.push({ objectKey, error: 'מפתח קובץ לא תקין' });
        firstFailureStatus ??= 400;
        continue;
      }
      const verified = await verifyUploaded(objectKey, MAX_FILE_SIZE);
      if (!verified.ok) {
        result.failed.push({ objectKey, error: verified.error });
        firstFailureStatus ??= verified.status;
        continue;
      }

      await registerFileObject({
        objectKey,
        fileName,
        contentType: verified.info.contentType,
        sizeBytes: verified.info.size,
        // No server-side sha256 for direct uploads; MinIO's ETag stands in.
        checksum: null,
        entityType: 'file_manager',
        metadata: { folder: folder.path || '/', etag: verified.info.etag, uploadedVia: 'direct' },
      });
      result.confirmed.push({ objectKey, fileName });
    }

    const status = result.confirmed.length > 0 ? 200 : firstFailureStatus ?? 400;
    return NextResponse.json(
      status === 200 ? result : { ...result, error: result.failed[0]?.error ?? 'אימות ההעלאה נכשל' },
      { status },
    );
  } catch (error) {
    console.error('File manager confirm error:', error);
    return NextResponse.json({ error: 'שגיאה באימות ההעלאה' }, { status: 500 });
  }
}
