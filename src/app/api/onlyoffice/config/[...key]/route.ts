import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { statObject } from '@/lib/storage';
import { signJwt } from '@/lib/onlyoffice-jwt';
import { hasAppSession } from '@/lib/auth/session-guard';

export const runtime = 'nodejs';

/**
 * Returns a signed editor config that the browser feeds into DocsAPI.DocEditor.
 *
 * The config tells OnlyOffice:
 *   - which file to fetch (URL into our /api/files/download route)
 *   - where to POST when the user saves (our /api/onlyoffice/callback route)
 *   - who the active user is (worker_id from the page-level picker)
 *
 * The whole config is HS256-signed with ONLYOFFICE_JWT_SECRET so OnlyOffice
 * refuses configs we didn't issue.
 */

// The URL OnlyOffice's SERVER uses to reach this app — it fetches the source
// document and POSTs saves back. That is a back-channel call between two
// containers, NOT something the browser follows, so it must be an address the
// onlyoffice container can actually open.
//
// On an air-gapped host reached by IP, APP_PUBLIC_URL is the host's LAN IP, and
// a container cannot connect back to it (Windows Firewall drops inbound LAN
// traffic arriving from the docker bridge). The document would never load and
// saves would silently fail. APP_INTERNAL_URL points at nginx over the compose
// network instead. Falls back to APP_PUBLIC_URL when unset. See auth.ts.
const APP_INTERNAL_URL = (
  process.env.APP_INTERNAL_URL ||
  process.env.APP_PUBLIC_URL ||
  'http://localhost'
).replace(/\/+$/, '');

// Browser-reachable DocServer origin, handed to the client in the response so it
// knows where to load DocsAPI (api.js) from. Deliberately resolved HERE and not
// from a NEXT_PUBLIC_* var in the component: `next build` inlines NEXT_PUBLIC_*
// into the static bundle, which would pin the built image to a single
// environment — fatal for an air-gapped tar built here and run in production.
// Route handlers read process.env at request time, so one image fits any env.
const DOC_SERVER_URL = (process.env.ONLYOFFICE_PUBLIC_URL || '/onlyoffice').replace(/\/+$/, '');

const EXT_TO_DOCTYPE: Record<string, 'word' | 'cell' | 'slide'> = {
  docx: 'word', doc: 'word', odt: 'word', rtf: 'word', txt: 'word',
  xlsx: 'cell', xls: 'cell', ods: 'cell', csv: 'cell',
  pptx: 'slide', ppt: 'slide', odp: 'slide',
};

function extOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? '' : key.slice(dot + 1).toLowerCase();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  // Browser-only route (mints a signed editor config). Its dotted URL bypasses
  // the middleware, so require a session here.
  if (!(await hasAppSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { key: keyParts } = await context.params;
    const objectKey = keyParts.join('/');

    // Path must live under items/{id}/ — anything else is rejected.
    const match = objectKey.match(/^items\/(\d+)\//);
    if (!match || objectKey.includes('..')) {
      return NextResponse.json({ error: 'מפתח קובץ לא תקין' }, { status: 400 });
    }

    const ext = extOf(objectKey);
    const documentType = EXT_TO_DOCTYPE[ext];
    if (!documentType) {
      return NextResponse.json(
        { error: `סוג קובץ לא נתמך לעריכה ב-OnlyOffice (${ext || 'unknown'})` },
        { status: 415 },
      );
    }

    // Make sure the object actually exists before handing OnlyOffice a URL.
    if (!(await statObject(objectKey))) {
      return NextResponse.json({ error: 'הקובץ לא נמצא' }, { status: 404 });
    }

    const row = await prisma.file_objects.findUnique({
      where: { object_key: objectKey },
      select: { file_name: true, updated_at: true, checksum_sha256: true },
    });
    const fileName = row?.file_name ?? objectKey.split('/').pop() ?? 'file';

    // The url query gives the caller a chance to identify the editing user
    // (the worker_id picked on the testing page or in the panel).
    const { searchParams } = new URL(request.url);
    const workerId = searchParams.get('worker_id') || '';
    const workerName = searchParams.get('worker_name') || `Worker ${workerId || '?'}`;
    const mode = searchParams.get('mode') === 'view' ? 'view' : 'edit';

    // document.key must:
    //   - change whenever the bytes change (so OnlyOffice doesn't serve cached)
    //   - match OnlyOffice's strict regex [0-9a-zA-Z_=.-]+
    // Underscore is allowed, colon is NOT — colons silently break the WebSocket
    // coauthoring URL and surface as a generic "no permissions" error.
    const docKeyRaw = `${row?.checksum_sha256 ?? 'nochk'}_${row?.updated_at?.getTime() ?? Date.now()}`;
    const docKey = docKeyRaw.replace(/[^0-9a-zA-Z_=.-]/g, '_').slice(0, 128);

    const encodedPath = objectKey.split('/').map(encodeURIComponent).join('/');
    const dlToken = await signJwt({ key: objectKey, purpose: 'download' }, 3600);
    // Both URLs are consumed by the OnlyOffice SERVER, never by the browser, so
    // both use the internal address (see APP_INTERNAL_URL above).
    const documentUrl = `${APP_INTERNAL_URL}/api/files/download/${encodedPath}?dl=${encodeURIComponent(dlToken)}`;
    const callbackUrl = `${APP_INTERNAL_URL}/api/onlyoffice/callback/${encodedPath}?worker_id=${encodeURIComponent(workerId)}`;

    const config = {
      document: {
        fileType: ext,
        key: docKey || `${objectKey}-fallback`,
        title: fileName,
        url: documentUrl,
        permissions: {
          edit: mode === 'edit',
          download: true,
          print: true,
        },
      },
      documentType,
      editorConfig: {
        mode,
        lang: 'he',
        callbackUrl,
        user: {
          id: workerId || 'anonymous',
          name: workerName,
        },
        customization: {
          forcesave: true,
          autosave: true,
        },
      },
    };

    const token = await signJwt(config as Record<string, unknown>);

    // `_docServerUrl` is transport-only: it is NOT part of the signed `config`,
    // and the client strips it before handing the rest to DocsAPI.DocEditor.
    // Passing an unsigned extra field through to OnlyOffice would break its
    // token check (it validates the signature against the config it receives).
    return NextResponse.json({ ...config, token, _docServerUrl: DOC_SERVER_URL });
  } catch (error) {
    console.error('OnlyOffice config error:', error);
    return NextResponse.json({ error: 'שגיאה ביצירת תצורת עורך' }, { status: 500 });
  }
}
