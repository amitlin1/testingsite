// Edge-safe JWT payload decoder. PORTABLE — copy verbatim.
//
// We read claims from the Keycloak access token in places where Node `Buffer`
// may not exist (middleware on the Edge runtime). `atob` + `TextDecoder` are
// available in every runtime Next supports.
//
// This does NOT verify the signature — it only extracts the payload. The token
// already passed the OAuth flow by the time it reaches us. Do NOT use this to
// authenticate an untrusted token.

export interface KeycloakAccessTokenPayload {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  sub?: string;
  exp?: number; // seconds
  iat?: number; // seconds
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
  scope?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  /** Custom realm attribute (מספר עובד), via the employeeNumber token mapper. */
  employee_number?: string;
  // The nested `profile` claim is supplied by a realm client-scope. Shape is
  // app/realm dependent — extend as needed.
  profile?: {
    display_name?: string;
    rank?: string;
    title?: string;
    service_type?: string;
    company?: string;
    base?: string;
  };
}

/** Decode a JWT's payload without verifying its signature. */
export function decodeJwtPayload<T = KeycloakAccessTokenPayload>(
  token: string,
): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    // JWTs use base64url; convert to standard base64 first.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const binary = atob(padded);
    // The payload bytes are UTF-8 (claims can contain non-ASCII).
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder("utf-8").decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
