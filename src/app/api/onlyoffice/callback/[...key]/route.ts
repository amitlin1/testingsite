import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { putObject } from '@/lib/storage';
import { registerFileObject } from '@/lib/file-registry';
import { verifyJwt } from '@/lib/onlyoffice-jwt';

export const runtime = 'nodejs';

/**
 * Save callback hit by the OnlyOffice Document Server.
 *
 * OnlyOffice posts here at well-known points in the editor lifecycle:
 *   1  document being edited        (heartbeat — no save needed)
 *   2  document ready for saving    (assembled edits available at body.url)
 *   3  saving error
 *   4  closed with no changes
 *   6  force-save                   (same as 2 but a forcesave call)
 *   7  force-save error
 *
 * We only act on status 2 and 6: fetch the produced file from ONLYOFFICE_INTERNAL_URL,
 * push it into MinIO under the SAME object key (versioning preserves the prior bytes),
 * then refresh the file_objects row.
 *
 * OnlyOffice expects { error: 0 } back on success — anything else makes it
 * retry, and eventually leave the file in a "needs save" state.
 */

const INTERNAL_URL = (process.env.ONLYOFFICE_INTERNAL_URL || 'http://onlyoffice').replace(/\/+$/, '');

type CallbackBody = {
  key?: string;
  status?: number;
  url?: string;
  users?: string[];
  token?: string; // JWT signed copy of the body — sent when JWT is enabled
  // OnlyOffice may also embed everything under .payload — defensive parse below.
};

/**
 * OnlyOffice with JWT_ENABLED sends the JWT in either:
 *   - `Authorization: Bearer <jwt>` header  (JWT_HEADER mode)
 *   - the `token` field on the body
 * We accept both and require one of them to verify against our secret.
 */
async function extractAndVerifyToken(
  request: Request,
  body: CallbackBody,
): Promise<CallbackBody | null> {
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const token = bearer || body.token || '';
  if (!token) return null;
  // jose returns the signed payload — for the header form OnlyOffice embeds the
  // full body under a `payload` claim; for the inline form the token IS the body.
  const decoded = await verifyJwt<CallbackBody & { payload?: CallbackBody }>(token);
  if (!decoded) return null;
  return decoded.payload ?? decoded;
}

function rewriteToInternal(url: string): string {
  // OnlyOffice ships the file URL using whatever host it knows itself as.
  // When the DocServer lives next to us on the prod-network, we always pull
  // via the internal hostname regardless of what URL it sent.
  try {
    const u = new URL(url);
    return `${INTERNAL_URL}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  try {
    const { key: keyParts } = await context.params;
    const objectKey = keyParts.join('/');

    // Same anti-tamper check as everywhere else: key must live under items/.
    if (!objectKey.match(/^items\/\d+\//) || objectKey.includes('..')) {
      return NextResponse.json({ error: 1, message: 'invalid key' });
    }

    const rawBody = (await request.json()) as CallbackBody;
    const body = (await extractAndVerifyToken(request, rawBody)) ?? rawBody;

    // If JWT is enforced on the OnlyOffice side, refuse unsigned callbacks.
    if (process.env.ONLYOFFICE_JWT_SECRET && body === rawBody && !rawBody.token && !request.headers.get('authorization')) {
      return NextResponse.json({ error: 1, message: 'token required' }, { status: 401 });
    }

    const status = body.status ?? 0;

    // 2 = ready to save, 6 = ready to force-save. All other statuses are
    // ack-only (1 heartbeat, 4 closed without changes, 3/7 errors).
    if (status !== 2 && status !== 6) {
      return NextResponse.json({ error: 0 });
    }

    const downloadUrl = body.url;
    if (!downloadUrl) {
      console.error('OnlyOffice callback: status=2/6 but no url');
      return NextResponse.json({ error: 1, message: 'no url' });
    }

    // Pull the produced file directly off the internal network.
    const fetchUrl = rewriteToInternal(downloadUrl);
    const upstream = await fetch(fetchUrl);
    if (!upstream.ok) {
      console.error('OnlyOffice callback fetch failed', upstream.status, fetchUrl);
      return NextResponse.json({ error: 1, message: 'fetch failed' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    // Reuse the existing object key — MinIO versioning keeps the prior bytes.
    const existing = await prisma.file_objects.findUnique({
      where: { object_key: objectKey },
      select: { file_name: true, entity_id: true },
    });
    const fileName = existing?.file_name ?? objectKey.split('/').pop() ?? 'file';
    const entityId = existing?.entity_id ?? objectKey.split('/')[1] ?? null;

    const stored = await putObject(objectKey, buffer, contentType);

    // OnlyOffice tells us who edited via users[]; we fall back to the worker_id
    // we baked into the callback URL when the config was issued.
    const { searchParams } = new URL(request.url);
    const workerFromQuery = searchParams.get('worker_id');
    const workerFromBody = Array.isArray(body.users) ? body.users[0] : undefined;
    const updatedBy = workerFromBody || workerFromQuery || null;

    await registerFileObject({
      objectKey,
      fileName,
      contentType,
      sizeBytes: stored.size,
      checksum: stored.checksum,
      entityType: 'item_attachment',
      entityId,
      metadata: { editedInOnlyOffice: true, status },
      updatedBy,
    });

    return NextResponse.json({ error: 0 });
  } catch (error) {
    console.error('OnlyOffice callback error:', error);
    return NextResponse.json({ error: 1, message: 'internal' });
  }
}
