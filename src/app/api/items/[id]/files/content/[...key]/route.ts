import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
  ensureBucket,
  getObjectStream,
  putObject,
  statObject,
} from '@/lib/storage';
import { registerFileObject } from '@/lib/file-registry';

export const runtime = 'nodejs';

const MAX_TEXT_SIZE_MB = parseInt(process.env.MAX_TEXT_EDIT_SIZE_MB || '5');
const MAX_TEXT_SIZE = MAX_TEXT_SIZE_MB * 1024 * 1024;

/**
 * Inline text editor backend for item attachments.
 *
 * Restricted on purpose to "text-like" files so we never load a 100 MB binary
 * into a textarea. .docx/.xlsx/etc. go through OnlyOffice, not this route.
 *
 *   GET  → returns the raw UTF-8 body
 *   PUT  → overwrites the same object key with new UTF-8 content; MinIO
 *          versioning preserves the prior bytes.
 */

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv',
  'json', 'log', 'xml', 'yml', 'yaml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx',
  'ini', 'conf', 'cfg', 'env', 'sql', 'sh',
]);

function isTextLikeKey(key: string): boolean {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return false;
  return TEXT_EXTENSIONS.has(key.slice(dot + 1).toLowerCase());
}

function keyBelongsToItem(key: string, itemId: string): boolean {
  return key.startsWith(`items/${itemId}/`) && !key.includes('..');
}

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

// GET — fetch text body
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; key: string[] }> },
) {
  try {
    const { id, key } = await resolveKey(context.params);
    if (!keyBelongsToItem(key, id)) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }
    if (!isTextLikeKey(key)) {
      return NextResponse.json({ error: 'קובץ זה אינו ניתן לעריכה כטקסט' }, { status: 415 });
    }

    await ensureBucket();
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
    console.error('Read text content error:', error);
    return NextResponse.json({ error: 'שגיאה בקריאת הקובץ' }, { status: 500 });
  }
}

// PUT — overwrite text body
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; key: string[] }> },
) {
  try {
    const { id, key } = await resolveKey(context.params);
    if (!keyBelongsToItem(key, id)) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }
    if (!isTextLikeKey(key)) {
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
    console.error('Write text content error:', error);
    return NextResponse.json({ error: 'שגיאה בשמירת הקובץ' }, { status: 500 });
  }
}
