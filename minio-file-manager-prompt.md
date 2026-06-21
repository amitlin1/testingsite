# Claude Code Prompt — MinIO File Manager Page for DigitalFactory

## Context

This is an existing Next.js 14+ App Router project called **DigitalFactory**.

**Stack:**
- Next.js (App Router) with TypeScript
- MUI (Material UI) for all UI components
- Prisma ORM + PostgreSQL
- Docker Compose for deployment
- Nginx reverse proxy on port 8085
- basePath: `/DigitalFactory`
- Air-gapped production environment (no external internet)
- Auth is handled via `useAuth` hook from `AuthContext` — the user object contains `{ spiId, fullName, ... }`

## Task

Build a complete **File Manager** page at `/files` that lets users upload, download, browse, rename, and delete files — backed by a **MinIO** object storage container.

---

## Part 1 — MinIO Backend Setup

### 1.1 Docker Compose

Add a `minio` service to the existing `docker-compose.yml`:

```yaml
minio:
  image: minio/minio:latest
  container_name: digitalfactory-minio
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
  volumes:
    - minio_data:/data
  ports:
    - "9000:9000"   # API
    - "9001:9001"   # MinIO Console (admin only)
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "mc", "ready", "local"]
    interval: 30s
    timeout: 10s
    retries: 3
```

Add `minio_data` to the volumes section.

Add to `.env.prod` (remember `$$` escaping for `$` in passwords):

```
MINIO_ROOT_USER=digitalfactory-admin
MINIO_ROOT_PASSWORD=<strong-password>
MINIO_ENDPOINT=http://minio:9000
MINIO_BUCKET=digitalfactory-files
```

### 1.2 MinIO Client Library

Install the MinIO JS SDK:

```bash
npm install minio
```

Create a shared MinIO client at `src/lib/minio.ts`:

```typescript
import { Client } from 'minio';

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT?.replace('http://', '').split(':')[0] || 'minio',
  port: parseInt(process.env.MINIO_ENDPOINT?.split(':').pop() || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER || '',
  secretKey: process.env.MINIO_ROOT_PASSWORD || '',
});

export const BUCKET = process.env.MINIO_BUCKET || 'digitalfactory-files';

// Initialize bucket on first use
export async function ensureBucket() {
  const exists = await minioClient.bucketExists(BUCKET);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
  }
}

export default minioClient;
```

---

## Part 2 — API Routes

Create Next.js Route Handlers under `src/app/api/files/`.

### 2.1 `GET /api/files` — List files

**File:** `src/app/api/files/route.ts`

- Accept optional query param `prefix` (for folder navigation)
- Call `minioClient.listObjectsV2(BUCKET, prefix, false)` — the `false` means non-recursive (folder-level)
- Return JSON array of objects: `{ name, size, lastModified, isFolder }`
- Folders are detected by `prefix` entries (objects ending with `/`)
- Sort: folders first, then files alphabetically

### 2.2 `POST /api/files/upload` — Upload file(s)

**File:** `src/app/api/files/upload/route.ts`

- Accept `multipart/form-data` using Next.js `request.formData()`
- Accept a `path` field for target folder (e.g., `documents/`)
- Support multiple files in one request
- Store with key: `{path}{originalFilename}`
- Add user metadata: `x-amz-meta-uploaded-by: {spiId}`, `x-amz-meta-uploaded-at: {ISO date}`
- Return the list of uploaded file names
- Limit file size to 100MB per file (configurable via env var `MAX_FILE_SIZE_MB`)

### 2.3 `GET /api/files/download/[...path]` — Download a file

**File:** `src/app/api/files/download/[...path]/route.ts`

- Get the object from MinIO using the full path from params
- Stream the response using `minioClient.getObject()`
- Set proper headers: `Content-Disposition: attachment`, `Content-Type` from object metadata
- Handle 404 if object doesn't exist

### 2.4 `DELETE /api/files` — Delete file(s)

**File:** `src/app/api/files/route.ts` (DELETE handler)

- Accept JSON body: `{ paths: string[] }`
- Delete each object from MinIO
- For folders (paths ending with `/`), recursively list and delete all objects under that prefix
- Return success/failure per path

### 2.5 `PATCH /api/files` — Rename / Move

**File:** `src/app/api/files/route.ts` (PATCH handler)

- Accept JSON body: `{ oldPath: string, newPath: string }`
- MinIO doesn't support rename, so: copy to new key → delete old key
- For folders, recursively copy+delete all contents

### 2.6 `POST /api/files/folder` — Create folder

**File:** `src/app/api/files/folder/route.ts`

- Accept JSON body: `{ path: string }` (e.g., `documents/reports/`)
- Create a zero-byte object with trailing `/` as the key (MinIO folder convention)

---

## Part 3 — Frontend Page

### 3.1 Page Component

**File:** `src/app/files/page.tsx`

This is the main file manager page. Use MUI components throughout.

**Layout:**
- **Breadcrumb bar** at the top showing current path (e.g., Home > Documents > Reports), each segment is clickable for navigation
- **Toolbar** with action buttons:
  - "העלאת קבצים" (Upload Files) — opens file picker, supports multi-select
  - "תיקייה חדשה" (New Folder) — opens a dialog to name the folder
  - "רענון" (Refresh)
  - View toggle: Grid view / List view (use `ViewModule` and `ViewList` MUI icons)
- **Main content area:**
  - **List view (default):** MUI `Table` with columns: Icon | Name | Size | Modified Date | Actions
  - **Grid view:** MUI `Grid` with cards showing file icon, name, and size
  - Folders shown with `FolderIcon`, files with appropriate icons by extension (pdf, image, doc, xls, zip, code, generic)
  - Click on folder → navigate into it
  - Click on file → download it
  - Actions menu (three-dot `IconButton`) per item: Download, Rename, Delete
- **Empty state:** Friendly message with upload prompt when folder is empty
- **Drag & Drop zone:** The entire content area should accept drag-and-drop file uploads (use a `onDragOver`/`onDrop` handler with visual feedback — dashed border highlight)

**State Management:**
- `currentPath: string` — current folder prefix (starts as `""`)
- `files: FileItem[]` — list of files/folders in current path
- `loading: boolean`
- `selectedItems: string[]` — for bulk operations (optional, nice to have)
- `viewMode: 'list' | 'grid'`

**Type:**
```typescript
interface FileItem {
  name: string;        // just the filename, not full path
  fullPath: string;    // full MinIO key
  size: number;
  lastModified: Date;
  isFolder: boolean;
}
```

### 3.2 Upload Dialog/Progress

When uploading:
- Show a MUI `Dialog` or bottom `Snackbar` with upload progress
- Use `XMLHttpRequest` or `fetch` with progress tracking
- Show per-file progress bars
- Allow cancellation
- On complete, auto-refresh the file list

### 3.3 Helper: File Icons

Create `src/components/files/FileIcon.tsx`:
- Map file extensions to MUI icons:
  - `.pdf` → `PictureAsPdf`
  - `.jpg/.png/.gif/.webp` → `Image`
  - `.doc/.docx` → `Description`
  - `.xls/.xlsx` → `TableChart`
  - `.zip/.rar/.7z` → `FolderZip`
  - `.mp4/.avi/.mov` → `VideoFile`
  - folders → `Folder`
  - default → `InsertDriveFile`

### 3.4 Helper: Format Utilities

Create `src/lib/fileUtils.ts`:
- `formatFileSize(bytes: number): string` — e.g., "2.4 MB", "350 KB"
- `formatDate(date: Date): string` — localized Hebrew date format
- `getFileExtension(name: string): string`

---

## Part 4 — Nginx Configuration

Add a location block for MinIO API access (only needed if you want direct browser-to-MinIO for large uploads, otherwise skip):

```nginx
location /minio/ {
    proxy_pass http://localhost:9000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 200M;
}
```

Make sure the existing Next.js location block allows large uploads too:

```nginx
location /DigitalFactory/ {
    ...
    client_max_body_size 200M;
    ...
}
```

---

## Important Notes

1. **RTL:** The entire UI must be RTL (right-to-left). Use MUI's RTL support. All labels in Hebrew.
2. **basePath:** All API calls must account for basePath `/DigitalFactory`. Use relative paths or `next/navigation`.
3. **Auth:** Wrap the page with the existing auth check. Only authenticated users should access files.
4. **Error Handling:** Show MUI `Alert` components for errors. Handle network failures gracefully.
5. **Air-gap:** The MinIO image needs to be pre-pulled and pushed to `quay.service.idf` before deployment. Do NOT use any CDN resources.
6. **Sidebar:** Add a navigation link to the file manager in the existing app sidebar/navigation: icon `FolderCopy`, label "ניהול קבצים".
7. **Do NOT modify** any existing security templates, auth middleware, or Nginx blocks for IIS/NTLM.
8. **Follow existing project patterns** — check how other pages and API routes are structured before creating new ones.
