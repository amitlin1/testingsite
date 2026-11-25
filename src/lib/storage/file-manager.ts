import { copyObject, listFolder, listKeys, putFolderMarker, removeObject, removePrefix } from './index';
import { FileManagerKeys, type FolderPathParse } from './keys';
import { markFileObjectDeleted, markPrefixDeleted, renameFileObject } from '@/lib/file-registry';
import type { FileItem } from './contract';

/**
 * The file manager (/files): the user's own folders and files, kept under
 * their own names in the default bucket. A folder is a MinIO folder marker
 * (an empty object whose key ends with "/"). The routes under /api/files are
 * thin adapters over these operations; the path rules are FileManagerKeys.
 */

/** One folder level: folders first, then files, each by Hebrew collation. */
export async function listEntries(prefix: string): Promise<FileItem[]> {
  const now = new Date().toISOString();
  const items: FileItem[] = [];
  for (const entry of await listFolder(prefix)) {
    if (entry.isFolder) {
      const name = entry.key.slice(prefix.length).replace(/\/$/, '');
      if (name) items.push({ name, fullPath: entry.key, size: 0, lastModified: now, isFolder: true });
    } else if (entry.key !== prefix) {
      const name = entry.key.slice(prefix.length);
      if (name) {
        items.push({
          name,
          fullPath: entry.key,
          size: entry.size,
          lastModified: entry.lastModified ? entry.lastModified.toISOString() : now,
          isFolder: false,
        });
      }
    }
  }
  return items.sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.name.localeCompare(b.name, 'he');
  });
}

/** Create a folder (its marker). The path follows the same rules as an upload's folder. */
export async function createFolder(raw: string): Promise<FolderPathParse> {
  const folder = FileManagerKeys.normalizeFolder(raw);
  if (!folder.ok) return folder;
  if (folder.path === '') return { ok: false, error: 'נדרש נתיב תיקייה' };
  await putFolderMarker(folder.path);
  return folder;
}

/** Delete files, and folders ("a/b/") with everything under them; the registry rows go `deleted`. */
export async function deleteEntries(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (path.endsWith('/')) {
      await removePrefix(path);
      await markPrefixDeleted(path);
    } else {
      await removeObject(path);
      await markFileObjectDeleted(path);
    }
  }
}

/** Rename or move a file, or a folder with everything under it (copy, then delete, per object). */
export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  const keys = oldPath.endsWith('/') ? await listKeys(oldPath) : [oldPath];
  for (const key of keys) {
    const target = newPath + key.slice(oldPath.length);
    await copyObject(key, target);
    await removeObject(key);
    await renameFileObject(key, target);
  }
}
