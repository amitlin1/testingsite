"use client";
import * as React from "react";
import {
  Box,
  Typography,
  Stack,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Button,
  Paper,
  Divider,
  LinearProgress,
  Chip,
  Checkbox,
  FormControlLabel,
  alpha,
  useTheme,
} from "@/components/ui";
import { AttachFile as AttachFileIcon } from "@/components/ui/icons";
import { CloudUpload as CloudUploadIcon } from "@/components/ui/icons";
import { Download as DownloadIcon } from "@/components/ui/icons";
import { DeleteOutline as DeleteOutlineIcon } from "@/components/ui/icons";
import { OpenInNew as OpenInNewIcon } from "@/components/ui/icons";
import { SwapHoriz as SwapHorizIcon } from "@/components/ui/icons";
import { EditNote as EditNoteIcon } from "@/components/ui/icons";
import { FileIcon } from "@/app/components/files/FileIcon";
import { formatFileSize, formatDate } from "@/lib/minioFileUtils";
import WorkerPicker from "./WorkerPicker";
import { useTokenWorkerId } from "@/lib/hooks/useTokenWorkerId";
import TextEditorModal from "./TextEditorModal";
import OnlyOfficeEditorModal from "./OnlyOfficeEditorModal";
import { apiFetch } from "@/lib/api/client";

type ItemFile = {
  objectKey: string;
  fileName: string;
  contentType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  stationTypeId: number | null;
  isGlobal: boolean;
};

type ItemFilesPanelProps = {
  itemId: number | string;
  /**
   * Worker id stamped onto created_by/updated_by. When provided (testing page
   * use), no internal picker is shown. When omitted (ניהול פריטים use), the
   * panel renders its own WorkerPicker and requires it before uploads/edits.
   */
  workerId?: number | null;
  /** Optional cap on number of files shown before scroll. */
  maxHeight?: number | string;
  /** Tighter spacing for embedding inside dialogs. */
  compact?: boolean;
  /**
   * Current station's test_station_type_id. When set, the panel lists only files
   * uploaded at this station type (+ global files) and tags new uploads with it.
   * Omit (management view) → shows all files.
   */
  stationTypeId?: number | null;
};

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv",
  "json", "log", "xml", "yml", "yaml",
  "html", "htm", "css", "js", "ts", "tsx", "jsx",
  "ini", "conf", "cfg", "env", "sql", "sh",
]);

const ONLYOFFICE_EXTENSIONS = new Set([
  "docx", "doc", "odt", "rtf",
  "xlsx", "xls", "ods",
  "pptx", "ppt", "odp",
]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function isTextLike(name: string) {
  return TEXT_EXTENSIONS.has(extOf(name));
}
function isOfficeDoc(name: string) {
  return ONLYOFFICE_EXTENSIONS.has(extOf(name));
}
function isImage(name: string) {
  return IMAGE_EXTENSIONS.has(extOf(name));
}

function downloadUrl(objectKey: string): string {
  return (
    "/api/files/download/" +
    objectKey
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")
  );
}

export default function ItemFilesPanel({
  itemId,
  workerId: workerIdProp,
  maxHeight,
  compact = false,
  stationTypeId = null,
}: ItemFilesPanelProps) {
  const theme = useTheme();
  const [files, setFiles] = React.useState<ItemFile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  // When on (station context only), new uploads are marked global (shown at all stations).
  const [globalUpload, setGlobalUpload] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceInputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = React.useRef<ItemFile | null>(null);

  // Standalone worker (used when no workerId was passed in from a parent).
  const tokenWorkerId = useTokenWorkerId();
  const [internalWorkerId, setInternalWorkerId] = React.useState<number | null>(null);
  const effectiveWorkerId =
    workerIdProp !== undefined && workerIdProp !== null
      ? workerIdProp
      : (tokenWorkerId ?? internalWorkerId);
  const standalone = workerIdProp === undefined || workerIdProp === null;
  // Standalone mode: the logged-in user's worker id (from their token) is used
  // and the picker is locked — no manual self-selection.
  const workerLocked = standalone && tokenWorkerId != null;

  // Editor modal state
  const [textEditorFile, setTextEditorFile] = React.useState<ItemFile | null>(null);
  const [officeEditorFile, setOfficeEditorFile] = React.useState<ItemFile | null>(null);

  const listUrl = `/api/items/${encodeURIComponent(String(itemId))}/files`;

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = stationTypeId != null ? `${listUrl}?stationTypeId=${stationTypeId}` : listUrl;
      const r = await apiFetch(url);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "שגיאה בטעינת קבצים");
      }
      const j = (await r.json()) as { files: ItemFile[] };
      setFiles(j.files ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [listUrl, stationTypeId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const ensureWorker = (): boolean => {
    if (effectiveWorkerId == null) {
      setError("יש לבחור עובד לפני פעולה זו");
      return false;
    }
    return true;
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    if (!ensureWorker()) return;
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of arr) fd.append("files", f);
      fd.append("worker_id", String(effectiveWorkerId));
      if (stationTypeId != null) fd.append("station_type_id", String(stationTypeId));
      if (globalUpload) fd.append("is_global", "true");
      const r = await apiFetch(listUrl, { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "שגיאה בהעלאה");
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (file: ItemFile) => {
    if (!confirm(`למחוק את "${file.fileName}"?`)) return;
    setError(null);
    try {
      const r = await apiFetch(
        `${listUrl}?key=${encodeURIComponent(file.objectKey)}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "שגיאה במחיקה");
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const triggerReplace = (file: ItemFile) => {
    if (!ensureWorker()) return;
    replaceTargetRef.current = file;
    replaceInputRef.current?.click();
  };

  const handleReplace = async (file: File) => {
    const target = replaceTargetRef.current;
    if (!target) return;
    replaceTargetRef.current = null;
    if (!ensureWorker()) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("worker_id", String(effectiveWorkerId));
      const r = await apiFetch(
        `${listUrl}?key=${encodeURIComponent(target.objectKey)}`,
        { method: "PATCH", body: fd },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "שגיאה בהחלפת קובץ");
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleOpen = (file: ItemFile) => {
    if (isTextLike(file.fileName)) {
      setTextEditorFile(file);
    } else if (isOfficeDoc(file.fileName)) {
      setOfficeEditorFile(file);
    } else {
      window.open(downloadUrl(file.objectKey), "_blank", "noopener,noreferrer");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: compact ? 1 : 1.5 }}>
        <AttachFileIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          קבצים מצורפים
          {files.length > 0 && (
            <Typography component="span" color="text.secondary" sx={{ ml: 1, fontWeight: 500 }}>
              ({files.length})
            </Typography>
          )}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<CloudUploadIcon sx={{ ml: 1 }} />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading || (standalone && effectiveWorkerId == null)}
        >
          העלה קובץ
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={replaceInputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleReplace(f);
            e.target.value = "";
          }}
        />
      </Box>

      {stationTypeId != null && (
        <FormControlLabel
          control={<Checkbox size="small" checked={globalUpload} onChange={(e) => setGlobalUpload(e.target.checked)} />}
          label={<Typography variant="caption">קובץ גלובלי — יוצג בכל התחנות עבור פריט זה</Typography>}
          sx={{ mb: 1, ml: 0 }}
        />
      )}

      {standalone && (
        <Box sx={{ mb: 1.5 }}>
          <WorkerPicker
            value={effectiveWorkerId}
            onChange={setInternalWorkerId}
            label="עובד מבצע"
            required
            size="small"
            hideHeader={false}
            disabled={workerLocked}
            placeholder={workerLocked ? "מזוהה מההתחברות" : undefined}
          />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Drag-drop zone wraps the list. Visual cue only while a drag is active. */}
      <Paper
        variant="outlined"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        sx={{
          borderRadius: 2,
          borderStyle: dragging ? "dashed" : "solid",
          borderColor: dragging ? "primary.main" : "divider",
          bgcolor: dragging ? alpha(theme.palette.primary.main, 0.04) : "transparent",
          transition: "all 0.15s",
          maxHeight,
          overflow: "auto",
        }}
      >
        {uploading && <LinearProgress />}

        {loading && files.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : files.length === 0 ? (
          <Box sx={{ textAlign: "center", py: compact ? 3 : 5, px: 2, color: "text.secondary" }}>
            <CloudUploadIcon sx={{ fontSize: 36, opacity: 0.5, mb: 0.5 }} />
            <Typography variant="body2">אין קבצים מצורפים</Typography>
            <Typography variant="caption">גרור קבצים לכאן או לחץ "העלה קובץ"</Typography>
          </Box>
        ) : (
          <Stack divider={<Divider />}>
            {files.map((file) => (
              <Box
                key={file.objectKey}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 1.5,
                  py: 1,
                  "&:hover": { bgcolor: alpha(theme.palette.action.hover, 0.5) },
                }}
              >
                {/* Thumbnail for images; FileIcon for everything else */}
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: 1,
                    overflow: "hidden",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "action.hover",
                  }}
                >
                  {isImage(file.fileName) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={downloadUrl(file.objectKey)}
                      alt={file.fileName}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      loading="lazy"
                    />
                  ) : (
                    <FileIcon name={file.fileName} sx={{ fontSize: 28 }} />
                  )}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap title={file.fileName}>
                      {file.fileName}
                    </Typography>
                    {file.isGlobal && (
                      <Chip label="גלובלי" size="small" color="primary" variant="outlined"
                        sx={{ height: 18, fontSize: 10, flexShrink: 0, "& .MuiChip-label": { px: 0.75 } }} />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {formatFileSize(file.size)} • עודכן {formatDate(file.updatedAt)}
                    {file.updatedBy ? ` • עובד ${file.updatedBy}` : ""}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={0.5}>
                  {(isTextLike(file.fileName) || isOfficeDoc(file.fileName)) && (
                    <Tooltip title="ערוך">
                      <IconButton size="small" color="primary" onClick={() => handleOpen(file)}>
                        {isTextLike(file.fileName) ? (
                          <EditNoteIcon fontSize="small" />
                        ) : (
                          <OpenInNewIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title="הורד">
                    <IconButton
                      size="small"
                      component="a"
                      href={downloadUrl(file.objectKey)}
                      download={file.fileName}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="החלף">
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => triggerReplace(file)}
                        disabled={uploading}
                      >
                        <SwapHorizIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="מחק">
                    <IconButton size="small" color="error" onClick={() => handleDelete(file)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      {textEditorFile && (
        <TextEditorModal
          open
          onClose={() => setTextEditorFile(null)}
          itemId={itemId}
          objectKey={textEditorFile.objectKey}
          fileName={textEditorFile.fileName}
          workerId={effectiveWorkerId}
          onSaved={refresh}
        />
      )}
      {officeEditorFile && (
        <OnlyOfficeEditorModal
          open
          onClose={() => setOfficeEditorFile(null)}
          itemId={itemId}
          objectKey={officeEditorFile.objectKey}
          fileName={officeEditorFile.fileName}
          workerId={effectiveWorkerId}
          onSaved={refresh}
        />
      )}
    </Box>
  );
}
