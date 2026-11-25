import { NextResponse } from 'next/server';
import { hasAppSession } from '@/lib/auth/session-guard';
import { serveObject } from '@/lib/storage';
import { verifyDownloadToken } from '@/lib/onlyoffice/tokens';
import { errorResponse } from '@/lib/http/errors';

export const runtime = 'nodejs';

// GET /api/files/download/[...path]
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const fullPath = path.join('/');

  if (!fullPath || fullPath.includes('..')) {
    return NextResponse.json({ error: 'נתיב לא תקין' }, { status: 400 });
  }

  // Auth: a logged-in browser session (any role), OR the signed download
  // token the OnlyOffice config route issued for this key (the Document
  // Server fetches without cookies). This route's URL contains a dot, so the
  // edge middleware skips it — it must self-guard.
  const token = new URL(request.url).searchParams.get('dl');
  if (!(await hasAppSession()) && !(await verifyDownloadToken(token, fullPath))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await serveObject(fullPath, { disposition: 'attachment' });
    return res ?? NextResponse.json({ error: 'הקובץ לא נמצא' }, { status: 404 });
  } catch (error) {
    return errorResponse(error, 'שגיאה בהורדת הקובץ');
  }
}
