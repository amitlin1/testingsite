/**
 * What the app knows about a file from its name: its kind (the icon), whether
 * it opens in the text editor or in OnlyOffice, its content type, its size as
 * text, and the URL it downloads from. Client-safe; the routes that serve and
 * edit files read the same sets, so a file the panel offers to edit is one the
 * server accepts.
 */
import { withBasePath } from '@/lib/base-path';

/** Lower-case extension without the dot; '' when the name has none. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export type FileKind = 'pdf' | 'image' | 'doc' | 'sheet' | 'archive' | 'video' | 'audio' | 'code' | 'other';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']);

const KIND_OF_EXT = new Map<string, FileKind>([
  ['pdf', 'pdf'],
  ...[...IMAGE_EXTENSIONS].map((e): [string, FileKind] => [e, 'image']),
  ...(['doc', 'docx', 'odt'] as const).map((e): [string, FileKind] => [e, 'doc']),
  ...(['xls', 'xlsx', 'ods', 'csv'] as const).map((e): [string, FileKind] => [e, 'sheet']),
  ...(['zip', 'rar', '7z', 'tar', 'gz'] as const).map((e): [string, FileKind] => [e, 'archive']),
  ...(['mp4', 'avi', 'mov', 'mkv', 'wmv'] as const).map((e): [string, FileKind] => [e, 'video']),
  ...(['mp3', 'wav', 'flac', 'aac'] as const).map((e): [string, FileKind] => [e, 'audio']),
  ...(['js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'html', 'css', 'json', 'xml'] as const).map((e): [string, FileKind] => [e, 'code']),
]);

export function fileKind(name: string): FileKind {
  return KIND_OF_EXT.get(extOf(name)) ?? 'other';
}

export const isImage = (name: string): boolean => IMAGE_EXTENSIONS.has(extOf(name));

/** Opened in the inline text editor — never a binary loaded into a textarea. */
const TEXT_EDIT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv',
  'json', 'log', 'xml', 'yml', 'yaml',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx',
  'ini', 'conf', 'cfg', 'env', 'sql', 'sh',
]);

export const isTextEditable = (name: string): boolean => TEXT_EDIT_EXTENSIONS.has(extOf(name));

export type OfficeDocType = 'word' | 'cell' | 'slide';

/**
 * What OnlyOffice opens each document as. txt and csv are accepted by the
 * editor route too, but the panel sends them to the text editor instead.
 */
const OFFICE_DOC_TYPES = new Map<string, OfficeDocType>([
  ['docx', 'word'], ['doc', 'word'], ['odt', 'word'], ['rtf', 'word'], ['txt', 'word'],
  ['xlsx', 'cell'], ['xls', 'cell'], ['ods', 'cell'], ['csv', 'cell'],
  ['pptx', 'slide'], ['ppt', 'slide'], ['odp', 'slide'],
]);

export const officeDocTypeOf = (name: string): OfficeDocType | null => OFFICE_DOC_TYPES.get(extOf(name)) ?? null;

export const isOfficeEditable = (name: string): boolean => officeDocTypeOf(name) != null && !isTextEditable(name);

const CONTENT_TYPE_OF_EXT = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['pdf', 'application/pdf'],
]);

/** The content type to serve a file as when the object carries none. */
export function contentTypeFromName(name: string): string {
  return CONTENT_TYPE_OF_EXT.get(extOf(name)) ?? 'application/octet-stream';
}

/** An object key as URL path segments (each segment encoded, the slashes kept). */
export const encodeKeyPath = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

/** Where the browser downloads (or shows) an object of the default bucket. */
export const fileDownloadUrl = (key: string): string => withBasePath(`/api/files/download/${encodeKeyPath(key)}`);

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i > 0 && value < 10 ? 1 : 0)} ${sizes[i]}`;
}
