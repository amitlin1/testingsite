/**
 * The photos of an item report, as the data URLs the PDF inlines — each made small first
 * (render.ts shrinkPhotoForPdf). A phone photo is ~7 MB; twenty of them inlined at full size made
 * the HTML over 100 MB, which took Chromium many seconds per report and could crash it ("Target
 * closed"). Only the report's copy is made small: the photo in MinIO stays as it was uploaded.
 *
 * A draft is rendered again on every download, so the small copies are kept in memory between
 * renders, checked against the object's etag. Server-only.
 */
import { getObjectBuffer, statObject, toDataUrl } from "@/lib/storage";
import { contentTypeFromName } from "@/lib/file-types";
import { mapWithConcurrency } from "@/lib/async";
import { shrinkPhotoForPdf } from "./render";

/** Already this small → inlined as it is (it cannot weigh the report down). */
const SMALL_ENOUGH_BYTES = 300 * 1024;
/** Photos fetched and made small at once (each holds a full photo in memory while it works). */
const CONCURRENCY = 3;
/** Characters of small data URLs kept between renders (~64 MB, ~150 photos). */
const CACHE_LIMIT = 64 * 1024 * 1024;

type Cached = { etag: string; url: string };
const globalForPhotos = globalThis as unknown as { __reportPhotoCache?: Map<string, Cached>; __reportPhotoCacheSize?: number };
const cache = (globalForPhotos.__reportPhotoCache ??= new Map<string, Cached>());

function remember(key: string, entry: Cached): void {
  if (entry.url.length > CACHE_LIMIT / 8) return;
  const old = cache.get(key);
  let size = (globalForPhotos.__reportPhotoCacheSize ?? 0) - (old?.url.length ?? 0) + entry.url.length;
  cache.delete(key);
  cache.set(key, entry);
  // Oldest first (a Map keeps insertion order; a hit re-inserts).
  for (const [k, v] of cache) {
    if (size <= CACHE_LIMIT) break;
    cache.delete(k);
    size -= v.url.length;
  }
  globalForPhotos.__reportPhotoCacheSize = size;
}

async function photoDataUrl(key: string): Promise<string | null> {
  try {
    const etag = (await statObject(key))?.etag ?? "";
    const hit = cache.get(key);
    if (hit && etag && hit.etag === etag) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.url;
    }
    const buf = await getObjectBuffer(key);
    const type = contentTypeFromName(key);
    const original = toDataUrl(buf, key);
    let url = original;
    if (type.startsWith("image/") && type !== "image/svg+xml" && buf.length > SMALL_ENOUGH_BYTES) {
      try {
        const small = await shrinkPhotoForPdf(original);
        if (small.startsWith("data:image/") && small.length < original.length) url = small;
      } catch (e) {
        console.error(`[item-report] photo ${key} could not be made small — it goes in as it is`, e);
      }
    }
    if (etag) remember(key, { etag, url });
    return url;
  } catch (e) {
    console.error(`[item-report] photo ${key} could not be read — it renders blank`, e);
    return null;
  }
}

/** key → data URL of each photo that could be read (the others render as a placeholder). */
export async function reportPhotoDataUrls(keys: readonly string[]): Promise<Record<string, string>> {
  const urls = await mapWithConcurrency(keys, CONCURRENCY, photoDataUrl);
  const out: Record<string, string> = {};
  keys.forEach((key, i) => {
    const url = urls[i];
    if (url) out[key] = url;
  });
  return out;
}
