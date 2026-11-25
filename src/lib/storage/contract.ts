/**
 * The file routes' wire types, shared by the browser and the routes. Client-safe: no MinIO, no
 * prisma (file-manager.ts, file-registry.ts and the routes return these shapes).
 */

/** An entry of a folder, as GET /api/files lists it (the file manager, /files). */
export interface FileItem {
  name: string;
  fullPath: string;
  size: number;
  lastModified: string;
  isFolder: boolean;
}

/**
 * The classification an item attachment carries in its row's metadata: set at presign (the
 * pending row), kept through every later write (file-registry's merge), read by the item's file
 * list.
 */
export interface FileTags {
  /** test_station_type_id the file was taken at; null = untagged. */
  stationTypeId: number | null;
  /** Shown at every station of the item. */
  isGlobal: boolean;
  /** photo_types.code of the capture; null = untagged. */
  photoType: string | null;
}

/** An item attachment, as GET /api/items/[id]/files lists it. */
export interface ItemFile extends FileTags {
  objectKey: string;
  fileName: string;
  contentType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}
