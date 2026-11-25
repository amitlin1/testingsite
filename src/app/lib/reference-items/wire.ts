/**
 * Reference items — the client-safe half: the JSON the settings page and the stations read, and
 * the rules the form and the server share. No prisma.
 */
import { encodeKeyPath } from "@/lib/file-types";

/** Max size per reference image ("עד 50MB לתמונה"). */
export const MAX_IMAGE_SIZE_MB = 50;
export const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/** The route that streams a reference image from the RU bucket (api/settings/reference-items/images/[...path]). */
const IMAGE_ROUTE = "/api/settings/reference-items/images/";

/** The browser-facing URL of an object in the RU bucket. */
export function imageUrl(objectKey: string): string {
  return IMAGE_ROUTE + encodeKeyPath(objectKey);
}

/**
 * A reference weight is grams: a plain positive number ("500", "12.5"). The stations read it with
 * Number(), so a value like "0.5kg" never compared — every weighing against it failed. Empty is
 * allowed (no reference weight).
 */
export function parseReferenceWeight(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) {
    return { ok: false, error: "המשקל הוא מספר בגרמים, למשל 500." };
  }
  return { ok: true, value: String(Number(s)) };
}

export interface ReferenceImageJson {
  id: number;
  file_name: string;
  sort_order: number;
  /** The station type the image is for; null = not assigned to a station (an older upload). */
  station_type_id: number | null;
  url: string;
  is_primary: boolean;
}

/** A reference item as GET /api/settings/reference-items and the reference lookup answer it. */
export interface ReferenceItemJson {
  reference_item_id: number;
  item_type_id: number;
  /** Grams, as stored. */
  reference_weight: string | null;
  item_type_desc: string | null;
  manufacturer_sku: string;
  manufacturer: string;
  name: string | null;
  notes: string | null;
  primary_image_id: number | null;
  parent_reference_id: number | null;
  images: ReferenceImageJson[];
  /** By station type id: each station shows only its own type's images (unassigned ones are in none). */
  images_by_station: Record<string, ReferenceImageJson[]>;
  cover_url: string | null;
  image_count: number;
  created_at: string;
  updated_at: string;
  /** A package reference's members, one per content line (empty for any other item). */
  members: ReferenceItemJson[];
}
