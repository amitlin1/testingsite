import type { RefImg } from "./stationKit";

/**
 * The package reference at the opening station (spec: ייחוס מארז, §3.4).
 *
 * The box label finds a package reference: a reference item of the package
 * type that holds one member reference item per content line. Each item's
 * scan is then weighed against the member expected for its type:
 *
 *   scanned = expected SKU                   → the member            "package"
 *   different, and a reference item has it   → that reference item   "scan"
 *   different, and nothing has it            → the member            "package_fallback"
 *   no member for the type / no package ref  → as before: what the scan found ("scan"), or none ("none")
 *
 * The worker may go on in every case; the source and the expected SKU are
 * saved on the item's result.
 */

/** A package reference's member, as the reference lookup answers it. */
export type RefMember = {
  itemTypeId: number;
  sku: string;
  name: string | null;
  refWeight: number | null;
  /** Its reference images at the station the lookup was made at. */
  images: RefImg[];
};

/** What the lookup of one scanned SKU answered (referenceScan.tsx RefLookup). */
export type FoundReference = {
  hasRU: boolean;
  name: string | null;
  refWeight: number | null;
  images: RefImg[];
};

/** Where an item's reference came from — saved on its result. */
export type RefSource = "package" | "scan" | "package_fallback" | "none";

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

/** A stored reference weight as grams; anything that is not a number is no weight. */
export function gramsOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const describe = (name: string | null, images: RefImg[], refWeight: number | null) =>
  `${name ? ` · ${name}` : ""} · ${images.length} תמונות ייחוס${refWeight != null ? ` · ${refWeight} גר׳` : ""}`;

/**
 * Which reference an item is compared against, given what was scanned on it,
 * the member its package reference expects for its type (null when there is
 * none), and what the lookup of the scanned SKU found.
 */
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
