import { NextResponse } from 'next/server';
import {
  buildFileManagerKey,
  contentTypeOf,
  isValidFileManagerName,
  normalizeFolderPath,
  parseUploadDescriptors,
  type PresignResponse,
} from '@/lib/directUpload/shared';
import { MAX_FILE_SIZE, MAX_FILE_SIZE_MB, issueTicket, readJson } from '@/lib/directUpload/server';

export const runtime = 'nodejs';

/**
 * POST /api/files/upload/presign — file manager, step 1 of a direct upload.
 *
 * Body (JSON): { files: [{ name, type, size }], path: "folder/sub/" | "" }
 *
 * Keys are `{path}{name}` exactly as the old multipart route built them: the
 * user's own file names, and re-uploading a name overwrites (MinIO versioning
 * keeps the previous bytes). No pending registry row is written here because
 * the key may already be a live file; ../confirm registers on success.
 */

type PresignBody = { files?: unknown; path?: unknown };

export async function POST(request: Request) {
  try {
    const body = await readJson<PresignBody>(request);
    if (!body) {
      return NextResponse.json({ error: 'גוף הבקשה אינו JSON תקין' }, { status: 400 });
    }

    const folder = normalizeFolderPath(body.path);
    if (!folder.ok) {
      return NextResponse.json({ error: folder.error }, { status: 400 });
    }
    const parsed = parseUploadDescriptors(body.files, MAX_FILE_SIZE, MAX_FILE_SIZE_MB);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const badName = parsed.files.find((f) => !isValidFileManagerName(f.name));
    if (badName) {
      return NextResponse.json({ error: `שם הקובץ ${badName.name} אינו תקין` }, { status: 400 });
    }

    const uploads = await Promise.all(
      parsed.files.map((file) =>
        issueTicket({
          key: buildFileManagerKey(folder.path, file.name),
          fileName: file.name,
          contentType: contentTypeOf(file),
          maxBytes: MAX_FILE_SIZE,
        }),
      ),
    );

    const res: PresignResponse = { uploads, maxBytes: MAX_FILE_SIZE };
    return NextResponse.json(res);
  } catch (error) {
    console.error('File manager presign error:', error);
    return NextResponse.json({ error: 'שגיאה בהכנת ההעלאה' }, { status: 500 });
  }
}
