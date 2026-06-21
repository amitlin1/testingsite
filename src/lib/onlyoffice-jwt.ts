import { SignJWT, jwtVerify } from 'jose';

/**
 * HS256 JWT helpers for the OnlyOffice Document Server.
 *
 * Uses `jose` (the de-facto JWT lib for the Next/serverless ecosystem) so we
 * inherit its audited Web-Crypto implementation, constant-time signature
 * checks, and easy upgrade path to asymmetric keys (RS256/ES256) later if
 * we ever need them. OnlyOffice currently signs/verifies with HS256 + the
 * shared secret in ONLYOFFICE_JWT_SECRET.
 */

const RAW_SECRET = process.env.ONLYOFFICE_JWT_SECRET || '';

function secretKey(): Uint8Array {
  if (!RAW_SECRET) {
    throw new Error('ONLYOFFICE_JWT_SECRET is not configured');
  }
  return new TextEncoder().encode(RAW_SECRET);
}

/**
 * Sign a JSON payload with HS256.
 * OnlyOffice does not require iat/exp claims, but we set them anyway so tokens
 * can't be replayed indefinitely.
 */
export async function signJwt(
  payload: Record<string, unknown>,
  expiresInSeconds = 3600,
): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secretKey());
}

/** Verify a JWT and return its payload, or null if signature/exp invalid. */
export async function verifyJwt<T = Record<string, unknown>>(
  token: string,
): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
    });
    return payload as T;
  } catch {
    return null;
  }
}
