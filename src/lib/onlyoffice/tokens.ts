import { signJwt, verifyJwt } from './jwt';

/**
 * The two tokens around an OnlyOffice edit: the download token the config
 * route hands the Document Server (it fetches the file without a browser
 * session), and the signed body OnlyOffice sends with each save callback.
 */

type DownloadClaims = { key?: string; purpose?: string };

/** A token that lets the cookieless Document Server download this one object for an hour. */
export function signDownloadToken(key: string): Promise<string> {
  return signJwt({ key, purpose: 'download' } satisfies DownloadClaims, 3600);
}

export async function verifyDownloadToken(token: string | null, key: string): Promise<boolean> {
  if (!token) return false;
  const claims = await verifyJwt<DownloadClaims>(token);
  return claims?.purpose === 'download' && claims.key === key;
}

/** What OnlyOffice posts to the save callback. */
export type CallbackBody = {
  key?: string;
  status?: number;
  url?: string;
  users?: string[];
  /** The signed copy of the body, when JWT is enabled and sent inline. */
  token?: string;
};

/**
 * The callback body as OnlyOffice signed it. With JWT_ENABLED it sends the JWT
 * either in `Authorization: Bearer <jwt>` (JWT_HEADER mode, the body embedded
 * under a `payload` claim) or as the body's `token` field (the token IS the
 * body). `verified` is null when no token verifies; `signed` says whether one
 * was sent at all.
 */
export async function verifyCallback(
  request: Request,
  rawBody: CallbackBody,
): Promise<{ verified: CallbackBody | null; signed: boolean }> {
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const token = bearer || rawBody.token || '';
  const signed = !!rawBody.token || !!request.headers.get('authorization');
  if (!token) return { verified: null, signed };
  const decoded = await verifyJwt<CallbackBody & { payload?: CallbackBody }>(token);
  return { verified: decoded ? (decoded.payload ?? decoded) : null, signed };
}
