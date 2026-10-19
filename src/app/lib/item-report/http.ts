/** Small request helpers shared by the /api/item-reports routes. Server-only. */
import type { Session } from "next-auth";

export type RouteCtx<K extends string> = { params: Promise<Record<K, string>> };

/** "123" → 123n; anything else → null. */
export function parseItemId(raw: string | undefined): bigint | null {
  if (!raw || !/^\d{1,19}$/.test(raw)) return null;
  return BigInt(raw);
}

export function parseRouteId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** data:image/png;base64,… → its bytes (null unless it is a PNG / JPEG / WebP / SVG data URL). */
export function decodeImageDataUrl(dataUrl: unknown, maxBytes: number): { bytes: Buffer; ext: string; type: string } | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:(image\/(png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[3]!, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) return null;
  const ext = m[2] === "jpeg" ? "jpg" : m[2] === "svg+xml" ? "svg" : m[2]!;
  return { bytes, ext, type: m[1]! };
}

export function actorOf(session: Session): { username: string; name: string; number: string } {
  const u = session.user;
  return {
    username: u.preferredUsername || u.email || "",
    name: u.displayName || u.name || u.preferredUsername || "",
    number: u.employeeNumber ? String(u.employeeNumber) : "",
  };
}

export function pdfResponse(bytes: Buffer, filename: string, extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // A draft changes with every result; the final copy is MinIO's — never cache.
      "Cache-Control": "private, no-store",
      ...extra,
    },
  });
}
