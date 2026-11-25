/** A drawn signature or an uploaded image sent as `data:image/…;base64,…`. */
export type DecodedImage = { bytes: Buffer; ext: string; type: string };

/** The bytes of a PNG / JPEG / WebP / SVG data URL of at most `maxBytes`; null for anything else. */
export function decodeImageDataUrl(dataUrl: unknown, maxBytes: number): DecodedImage | null {
  if (typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/(png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[3]!, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes) return null;
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2] === 'svg+xml' ? 'svg' : m[2]!;
  return { bytes, ext, type: m[1]! };
}
