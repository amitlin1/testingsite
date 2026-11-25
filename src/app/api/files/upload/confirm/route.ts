import { NextResponse } from 'next/server';
import { registerFileObject } from '@/lib/file-registry';
import { MAX_UPLOAD_BATCH } from '@/lib/directUpload/shared';
import { MAX_FILE_SIZE, confirmUploads, parseConfirmEntries } from '@/lib/directUpload/server';
import { readJsonObject } from '@/lib/http/request';
import { FileManagerKeys } from '@/lib/storage/keys';
import { errorResponse } from '@/lib/http/errors';

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

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, 'גוף הבקשה אינו JSON תקין');
    const folder = FileManagerKeys.normalizeFolder(body.path);
    if (!folder.ok) {
      return NextResponse.json({ error: folder.error }, { status: 400 });
    }
    const parsed = parseConfirmEntries(body.uploads, MAX_UPLOAD_BATCH);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { status, body: result } = await confirmUploads(parsed.entries, {
      accept: ({ objectKey, fileName }) =>
        FileManagerKeys.validName(fileName) && objectKey === FileManagerKeys.build(folder.path, fileName)
          ? null
          : 'מפתח קובץ לא תקין',
      maxBytes: MAX_FILE_SIZE,
      register: ({ objectKey, fileName }, info) =>
        registerFileObject({
          objectKey,
          fileName,
          contentType: info.contentType,
          sizeBytes: info.size,
          // No server-side sha256 for direct uploads; MinIO's ETag stands in.
          checksum: null,
          entityType: 'file_manager',
          metadata: { folder: folder.path || '/', etag: info.etag, uploadedVia: 'direct' },
        }),
    });
    return NextResponse.json(result, { status });
  } catch (error) {
    return errorResponse(error, 'שגיאה באימות ההעלאה');
  }
}
