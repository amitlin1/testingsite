import { apiFetch } from "@/lib/api/client";
import type { RefImg } from "@/app/testing/fields/PhotoUploader";
import type { RefSource } from "@/app/lib/test-results/details";

/**
 * The reference items (/settings/reference-items) a station compares against, as
 * GET /api/testing/reference-lookup answers them — no React, so the popups, the package wizards
 * and the tests share it.
 *
 * Two clients read that answer, each with its own weight rule (B9, an open owner decision):
 *   - the item popups (PhotoStation, TemplateStation): lookupItemReference — a weight counts only
 *     when it is above 0 (positiveGramsOf);
 *   - the package wizards: lookupReference — any number is a weight (gramsOf), and a package
 *     reference brings its members.
 */

/** The reference images a lookup answered for one station type (imagesByStation): the station type
 *  is the reference set (docs/features/popup-templates/PLAN.md §5ג). */
export function stationImagesOf(imagesByStation: unknown, stationTypeId: number): RefImg[] {
  if (imagesByStation == null || typeof imagesByStation !== "object") return [];
  const list = (imagesByStation as Record<string, unknown>)[String(stationTypeId)];
  return Array.isArray(list) ? (list as RefImg[]) : [];
}

/** The package wizards' weight rule: a stored reference weight as grams; anything that is not a
 *  number is no weight. */
export function gramsOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The item popups' weight rule: a stored reference weight as grams when it is above 0. */
export function positiveGramsOf(v: unknown): number | null {
  const n = v == null ? NaN : Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const lookupUrl = (sku: string, itemTypeId: number | null) => {
  const qs = new URLSearchParams({ sku });
  if (itemTypeId != null) qs.set("itemTypeId", String(itemTypeId));
  return `/api/testing/reference-lookup?${qs.toString()}`;
};

/** The item popups' lookup: whether the SKU has a reference item, its images at this station and
 *  its weight. Reads the body whatever the status (B11: a server error reads as "no reference"). */
export async function lookupItemReference(sku: string, itemTypeId: number | null, stationTypeId: number) {
  const res = await apiFetch(lookupUrl(sku, itemTypeId));
  const d = await res.json();
  return {
    hasRU: !!d.hasRU,
    images: stationImagesOf(d.imagesByStation, stationTypeId),
    /** The reference item's weight in grams; null when it has none. */
    refWeight: positiveGramsOf(d.referenceWeight),
  };
}

// ---- the package wizards -----------------------------------------------------------------------

/** A package reference's member, as the reference lookup answers it. */
export type RefMember = {
  itemTypeId: number;
  sku: string;
  name: string | null;
  refWeight: number | null;
  /** Its reference images at the station the lookup was made at. */
  images: RefImg[];
};

/** What the lookup of one scanned SKU found. */
export type FoundReference = {
  hasRU: boolean;
  name: string | null;
  refWeight: number | null;
  images: RefImg[];
};

export type RefLookup = FoundReference & {
  referenceItemId: number | null;
  /** A package reference's members, one per content line (empty otherwise). */
  members: RefMember[];
};
export const NO_REF: RefLookup = { hasRU: false, referenceItemId: null, name: null, refWeight: null, images: [], members: [] };

type LookupMember = { item_type_id?: unknown; referenceItem?: { manufacturer_sku?: unknown; name?: unknown } | null; referenceWeight?: unknown; imagesByStation?: unknown };

/** The package wizards' lookup: the SKU among one item type's reference items, with a package
 *  reference's members. Any answer but a found reference is NO_REF. */
export async function lookupReference(sku: string, itemTypeId: number, stationTypeId: number): Promise<RefLookup> {
  const res = await apiFetch(lookupUrl(sku, itemTypeId));
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.hasRU) return NO_REF;
  const members: LookupMember[] = Array.isArray(d.packageMembers) ? d.packageMembers : [];
  return {
    hasRU: true,
    referenceItemId: typeof d.referenceItem?.reference_item_id === "number" ? d.referenceItem.reference_item_id : null,
    name: d.referenceItem?.name ?? null,
    refWeight: gramsOf(d.referenceWeight),
    images: stationImagesOf(d.imagesByStation, stationTypeId),
    members: members.map((m) => ({
      itemTypeId: Number(m.item_type_id),
      sku: String(m.referenceItem?.manufacturer_sku ?? ""),
      name: typeof m.referenceItem?.name === "string" ? m.referenceItem.name : null,
      refWeight: gramsOf(m.referenceWeight),
      images: stationImagesOf(m.imagesByStation, stationTypeId),
    })),
  };
}

/**
 * The package reference at the opening station (spec: ייחוס מארז, §3.4). The box label finds a
 * package reference: a reference item of the package type that holds one member reference item
 * per content line. Each item's scan is then weighed against the member expected for its type:
 *
 *   scanned = expected SKU                   → the member            "package"
 *   different, and a reference item has it   → that reference item   "scan"
 *   different, and nothing has it            → the member            "package_fallback"
 *   no member for the type / no package ref  → what the scan found ("scan"), or none ("none")
 *
 * The worker may go on in every case; the source and the expected SKU are saved on the item's
 * result.
 */
export type ItemReference = {
  source: RefSource;
  tone: "ok" | "warn";
  text: string;
  hasRU: boolean;
  name: string | null;
  refWeight: number | null;
  images: RefImg[];
  expectedSku: string | null;
};

const describe = (name: string | null, images: RefImg[], refWeight: number | null) =>
  `${name ? ` · ${name}` : ""} · ${images.length} תמונות ייחוס${refWeight != null ? ` · ${refWeight} גר׳` : ""}`;

/** Which reference an item is compared against, given what was scanned on it, the member its
 *  package reference expects for its type (null when there is none), and what the lookup of the
 *  scanned SKU found. */
export function resolveItemReference(scanned: string, expected: RefMember | null, found: FoundReference, typeDesc: string): ItemReference {
  const sku = scanned.trim();
  const fromMember = (m: RefMember) => ({ hasRU: true, name: m.name, refWeight: m.refWeight, images: m.images });
  const fromFound = { hasRU: found.hasRU, name: found.name, refWeight: found.refWeight, images: found.images };

  if (expected && sku === expected.sku.trim()) {
    return { source: "package", tone: "ok", expectedSku: expected.sku, ...fromMember(expected),
      text: `תואם לייחוס המארז${describe(expected.name, expected.images, expected.refWeight)}` };
  }
  if (expected && found.hasRU) {
    return { source: "scan", tone: "warn", expectedSku: expected.sku, ...fromFound,
      text: `המק״ט שונה מהמצופה בייחוס המארז (${expected.sku}). נמצא פריט ייחוס למק״ט שנסרק${found.name ? `: ${found.name}` : ""}, וההשוואה תהיה מולו. אפשר להמשיך.` };
  }
  if (expected) {
    return { source: "package_fallback", tone: "warn", expectedSku: expected.sku, ...fromMember(expected),
      text: `המק״ט שונה מהמצופה בייחוס המארז (${expected.sku}), ולא נמצא לו פריט ייחוס. ההשוואה תהיה מול הפריט הצפוי${expected.name ? `: ${expected.name}` : ""}. אפשר להמשיך.` };
  }
  if (found.hasRU) {
    return { source: "scan", tone: "ok", expectedSku: null, ...fromFound,
      text: `נמצא פריט ייחוס${describe(found.name, found.images, found.refWeight)}` };
  }
  return { source: "none", tone: "warn", expectedSku: null, ...fromFound,
    text: `לא נמצא פריט ייחוס של ${typeDesc} עם המק״ט הזה — אפשר להמשיך, הצילום והשקילה יהיו ללא ייחוס` };
}
