/**
 * The bucket's key layout: every family of object keys the app writes, in one
 * place (docs/architecture/STORAGE.md). Pure — no MinIO, no Node APIs — so routes, the
 * browser and the tests all read the same rules. The .mjs scripts
 * (reconcile-file-registry) cannot import
 * TypeScript and copy the prefixes they need from here.
 */

/** A key never climbs out of its prefix. */
const noTraversal = (key: string): boolean => !key.includes('..');

/** Filesystem-safe file name for embedding in an object key. */
export const sanitizeFilename = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');

const itemPrefix = (itemId: string | number): string => `items/${itemId}/`;

/** Item attachments: `items/{itemId}/{uploadId}_{safeName}`. */
export const ItemKeys = {
  build: (itemId: string | number, fileName: string, uploadId: string): string =>
    `${itemPrefix(itemId)}${uploadId}_${sanitizeFilename(fileName)}`,
  /** The key lives under this item — a forged key never reaches another item's files. */
  belongs: (key: string, itemId: string | number): boolean =>
    key.startsWith(itemPrefix(itemId)) && noTraversal(key),
  /** The item an attachment key belongs to; null for any other key. */
  itemIdOf: (key: string): string | null =>
    noTraversal(key) ? (/^items\/(\d+)\//.exec(key)?.[1] ?? null) : null,
};

const LOGO_PREFIX = 'reports/logos/';

/** Item reports: the frozen PDF, the drawn signatures, the header logos. */
export const ReportKeys = {
  pdf: (itemId: bigint, version: number): string => `reports/items/${itemId}/v${version}.pdf`,
  signature: (itemId: bigint): string => `reports/items/${itemId}/signature-${crypto.randomUUID()}.png`,
  logo: (ext: string): string => `${LOGO_PREFIX}${crypto.randomUUID()}.${ext}`,
  isLogo: (key: string): boolean => key.startsWith(LOGO_PREFIX) && noTraversal(key),
};

/** Shipment signatures: `shipments/{shipmentId}/{filename}` (the DB keeps the filename only). */
export const ShipmentKeys = {
  signature: (shipmentId: number | string, filename: string): string => `shipments/${shipmentId}/${filename}`,
};

const REFERENCE_PREFIX = 'reference-items';

/** Filesystem-safe object-key segment derived from an uploaded image name. */
function safeReferenceName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'image';
  return base.replace(/[^\w.-]+/g, '_').slice(0, 200) || 'image';
}

/** Reference-item images, in REFERENCE_BUCKET. */
export const ReferenceKeys = {
  /**
   * `reference-items/{itemId|new}/{ts}-{shortId}-{safeName}`. Images for a NOT-YET
   * created reference item are keyed under "new" — the id does not exist until the
   * form is saved, and nothing lists this bucket by prefix.
   */
  build: (referenceItemId: number | null, fileName: string, uploadId: string, now: number = Date.now()): string => {
    const owner = referenceItemId != null ? String(referenceItemId) : 'new';
    return `${REFERENCE_PREFIX}/${owner}/${now}-${uploadId.slice(0, 8)}-${safeReferenceName(fileName)}`;
  },
  is: (key: string): boolean => key.startsWith(`${REFERENCE_PREFIX}/`) && noTraversal(key),
};

export type FolderPathParse = { ok: true; path: string } | { ok: false; error: string };

/**
 * The file manager keeps the user's own names, at the bucket root and below
 * (re-uploading a name overwrites; versioning keeps the previous bytes).
 */
export const FileManagerKeys = {
  /** A folder: '' for the root, otherwise 'a/b/' (trailing slash, no leading slash, no `..` segment). */
  normalizeFolder(raw: unknown): FolderPathParse {
    if (raw == null || raw === '') return { ok: true, path: '' };
    if (typeof raw !== 'string') return { ok: false, error: 'נתיב לא תקין' };
    let path = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (path === '') return { ok: true, path: '' };
    if (path.split('/').some((seg) => seg === '..')) return { ok: false, error: 'נתיב לא תקין' };
    if (!path.endsWith('/')) path += '/';
    return { ok: true, path };
  },
  /** An entry name: a single path segment, nothing that could escape the folder. */
  validName: (name: string): boolean =>
    name.trim() !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'),
  build: (folderPath: string, fileName: string): string => `${folderPath}${fileName}`,
  /** The path of an entry renamed in place (a folder keeps its trailing slash). */
  renamed(fullPath: string, isFolder: boolean, newName: string): string {
    const lastSlash = isFolder ? fullPath.lastIndexOf('/', fullPath.length - 2) : fullPath.lastIndexOf('/');
    const parent = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : '';
    return parent + newName + (isFolder ? '/' : '');
  },
};
