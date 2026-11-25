import { NextResponse } from 'next/server';
import { prisma } from "@/lib/db";
import {
  getObjectStream,
  putObject,
  statObject,
} from '@/lib/storage';
import { registerFileObject } from '@/lib/file-registry';
import { hasAppSession } from '@/lib/auth/session-guard';
import { isTextEditable } from '@/lib/file-types';
import { ItemKeys } from '@/lib/storage/keys';
import { errorResponse } from '@/lib/http/errors';

export const runtime = 'nodejs';

const MAX_TEXT_SIZE_MB = parseInt(process.env.MAX_TEXT_EDIT_SIZE_MB || '5');
const MAX_TEXT_SIZE = MAX_TEXT_SIZE_MB * 1024 * 1024;

/**
 * Inline text editor backend for item attachments.
 *
 * Restricted on purpose to the text-editable files (@/lib/file-types) so we
 * never load a 100 MB binary into a textarea. .docx/.xlsx/etc. go through
 * OnlyOffice, not this route.
 *
 *   GET  → returns the raw UTF-8 body
 *   PUT  → overwrites the same object key with new UTF-8 content; MinIO
 *          versioning preserves the prior bytes.
 */

async function resolveKey(
  params: Promise<{ id: string; key: string[] }>,
): Promise<{ id: string; key: string }> {
  const { id, key } = await params;
  return { id, key: key.join('/') };
}

async function readStreamToString(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(`text file exceeds editable limit of ${MAX_TEXT_SIZE_MB}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; key: string[] }> },
) {
  if (!(await hasAppSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, key } = await resolveKey(context.params);
    if (!ItemKeys.belongs(key, id)) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }
    if (!isTextEditable(key)) {
      return NextResponse.json({ error: 'קובץ זה אינו ניתן לעריכה כטקסט' }, { status: 415 });
    }

    const stat = await statObject(key);
    if (!stat) {
      return NextResponse.json({ error: 'הקובץ לא נמצא' }, { status: 404 });
    }
    if (stat.size > MAX_TEXT_SIZE) {
      return NextResponse.json(
        { error: `הקובץ גדול מהמותר לעריכה (${MAX_TEXT_SIZE_MB}MB)` },
        { status: 413 },
      );
    }

    const stream = await getObjectStream(key);
    const content = await readStreamToString(stream, MAX_TEXT_SIZE);
    return NextResponse.json({ objectKey: key, content });
  } catch (error) {
    return errorResponse(error, 'שגיאה בקריאת הקובץ');
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; key: string[] }> },
) {
  if (!(await hasAppSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, key } = await resolveKey(context.params);
    if (!ItemKeys.belongs(key, id)) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }
    if (!isTextEditable(key)) {
      return NextResponse.json({ error: 'קובץ זה אינו ניתן לעריכה כטקסט' }, { status: 415 });
    }

    const body = (await request.json().catch(() => null)) as {
      content?: string;
      worker_id?: string | number;
    } | null;
    if (!body || typeof body.content !== 'string') {
      return NextResponse.json({ error: 'תוכן חסר' }, { status: 400 });
    }

    const buffer = Buffer.from(body.content, 'utf8');
    if (buffer.length > MAX_TEXT_SIZE) {
      return NextResponse.json(
        { error: `התוכן חורג מהגודל המרבי (${MAX_TEXT_SIZE_MB}MB)` },
        { status: 413 },
      );
    }

    // Preserve the registered file_name; fall back to the key's basename.
    const existing = await prisma.file_objects.findUnique({
      where: { object_key: key },
      select: { file_name: true, content_type: true },
    });
    const fileName = existing?.file_name ?? key.split('/').pop() ?? key;
    const contentType =
      existing?.content_type ?? 'text/plain; charset=utf-8';

    const stored = await putObject(key, buffer, contentType);

    await registerFileObject({
      objectKey: key,
      fileName,
      contentType,
      sizeBytes: stored.size,
      checksum: stored.checksum,
      entityType: 'item_attachment',
      entityId: id,
      metadata: { editedInline: true },
      updatedBy: body.worker_id ? String(body.worker_id) : null,
    });

    return NextResponse.json({ ok: true, size: stored.size });
  } catch (error) {
    return errorResponse(error, 'שגיאה בשמירת הקובץ');
  }
}
