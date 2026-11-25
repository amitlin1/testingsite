"use client";
import * as React from "react";
import {
  Box,
  Typography,
  Stack,
  IconButton,
  Tooltip,
  Alert,
  Button,
  Paper,
  Divider,
  LinearProgress,
  Skeleton,
  Tag,
  Checkbox,
  FormControlLabel,
  ConfirmDialog,
} from "@/components/ui";
import { AttachFile as AttachFileIcon } from "@/components/ui/icons";
import { CloudUpload as CloudUploadIcon } from "@/components/ui/icons";
import { Download as DownloadIcon } from "@/components/ui/icons";
import { DeleteOutline as DeleteOutlineIcon } from "@/components/ui/icons";
import { OpenInNew as OpenInNewIcon } from "@/components/ui/icons";
import { SwapHoriz as SwapHorizIcon } from "@/components/ui/icons";
import { EditNote as EditNoteIcon } from "@/components/ui/icons";
import { FileIcon } from "@/app/components/files/FileIcon";
import { fileDownloadUrl, formatFileSize, isImage, isOfficeEditable, isTextEditable } from "@/lib/file-types";
import { formatMoment } from "@/app/lib/datetime";
import WorkerPicker from "./WorkerPicker";
import { useWorkerLock } from "@/app/components/useWorkerLock";
import TextEditorModal from "./TextEditorModal";
import OnlyOfficeEditorModal from "./OnlyOfficeEditorModal";
import { sendJson } from "@/lib/api/client";
import { failureText } from "@/app/components/failureText";
import { listItemFiles, uploadItemFiles, replaceItemFile } from "@/lib/api/direct-upload";
import type { ItemFile } from "@/lib/storage/contract";
import "./ItemFilesPanel.css";
import Image from "next/image";

type ItemFilesPanelProps = {
  itemId: number | string;
  /**
   * Worker id stamped onto created_by/updated_by. A number (testing page use)
   * hides the internal picker. Omitted or null (ניהול פריטים use), the panel
   * renders its own WorkerPicker and requires it before uploads/edits.
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

type FilesRead = { files: ItemFile[]; error: null } | { files: null; error: string };

/** The item's files, or the error to show instead. */
async function readFiles(itemId: number | string, stationTypeId: number | null): Promise<FilesRead> {
  try {
    return { files: await listItemFiles(itemId, { stationTypeId }), error: null };
  } catch (e) {
    return { files: null, error: failureText(e, "שגיאה בטעינת קבצים") };
  }
}

export default function ItemFilesPanel({
  itemId,
  workerId: workerIdProp,
  maxHeight,
  compact = false,
  stationTypeId = null,
}: ItemFilesPanelProps) {
  const [files, setFiles] = React.useState<ItemFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  // 0–100 across the whole batch while files stream to MinIO; null = no byte count yet.
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  // When on (station context only), new uploads are marked global (shown at all stations).
  const [globalUpload, setGlobalUpload] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceInputRef = React.useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = React.useRef<ItemFile | null>(null);

  const lock = useWorkerLock();
  const tokenWorkerId = lock.tokenWorkerId;
  const [internalWorkerId, setInternalWorkerId] = React.useState<number | null>(null);
  const standalone = workerIdProp === undefined || workerIdProp === null;
  // Standalone mode: the logged-in worker (from their token), locked — only someone who may act
  // for others starts from themselves and may pick someone else (the testing screen's rule).
  const workerLocked = standalone && lock.locked;
  const effectiveWorkerId =
    workerIdProp !== undefined && workerIdProp !== null
      ? workerIdProp
      : workerLocked ? tokenWorkerId : (internalWorkerId ?? tokenWorkerId);

  const [textEditorFile, setTextEditorFile] = React.useState<ItemFile | null>(null);
  const [officeEditorFile, setOfficeEditorFile] = React.useState<ItemFile | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ItemFile | null>(null);

  const listUrl = `/api/items/${encodeURIComponent(String(itemId))}/files`;
  const filesKey = `${itemId}|${stationTypeId ?? ""}`;

  const applyFiles = React.useCallback((read: FilesRead) => {
    if (read.files) setFiles(read.files);
    else setError(read.error);
    setLoading(false);
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    applyFiles(await readFiles(itemId, stationTypeId));
  }, [itemId, stationTypeId, applyFiles]);

  // A new list (on mount, or another item / station) starts loading during
  // render; the effect only reads, and applies the result in its callback.
  const [loadingKey, setLoadingKey] = React.useState(filesKey);
  if (loadingKey !== filesKey) {
    setLoadingKey(filesKey);
    setLoading(true);
    setError(null);
  }
  React.useEffect(() => {
    readFiles(itemId, stationTypeId).then(applyFiles);
  }, [itemId, stationTypeId, applyFiles]);

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
    setUploadProgress(0);
    // Files go straight from the browser to MinIO; the app only issues tickets
    // and records the result, so this progress is the real transfer.
    const totalBytes = arr.reduce((sum, f) => sum + f.size, 0);
    const sent = new Array<number>(arr.length).fill(0);
    try {
      const results = await uploadItemFiles(itemId, arr, {
        workerId: effectiveWorkerId,
        stationTypeId,
        isGlobal: globalUpload,
        onProgress: (index, loaded) => {
          sent[index] = loaded;
          if (totalBytes > 0) {
            const done = sent.reduce((sum, n) => sum + n, 0);
            setUploadProgress(Math.min(100, Math.round((done / totalBytes) * 100)));
          }
        },
      });
      const failed = results.filter((r) => r.error);
      if (failed.length === 1) {
        setError(`${failed[0].fileName}: ${failed[0].error}`);
      } else if (failed.length > 1) {
        setError(`${failed.length} קבצים לא הועלו — ${failed[0].error}`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleDelete = async (file: ItemFile) => {
    setPendingDelete(null);
    setError(null);
    try {
      await sendJson(`${listUrl}?key=${encodeURIComponent(file.objectKey)}`, "DELETE");
      await refresh();
    } catch (e) {
      setError(failureText(e, "שגיאה במחיקה"));
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
    setUploadProgress(0);
    try {
      // Same key, new bytes, uploaded straight to MinIO; versioning keeps the old ones.
      await replaceItemFile(itemId, target.objectKey, file, effectiveWorkerId, (loaded, total) =>
        setUploadProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null),
      );
      await refresh();
    } catch (e) {
      setError(failureText(e, "שגיאה בהחלפת קובץ"));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleOpen = (file: ItemFile) => {
    if (isTextEditable(file.fileName)) {
      setTextEditorFile(file);
    } else if (isOfficeEditable(file.fileName)) {
      setOfficeEditorFile(file);
    } else {
      window.open(fileDownloadUrl(file.objectKey), "_blank", "noopener,noreferrer");
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
        {/* Decorative glyph: muted — blue stays the colour of what you can press. */}
        <AttachFileIcon fontSize={18} style={{ color: "var(--color-ink-muted-48)" }} aria-hidden />
        <Typography variant="subtitle1" component="h3" sx={{ flex: 1 }}>
          קבצים מצורפים
          {files.length > 0 && (
            <span style={{ marginInlineStart: "var(--space-xs)", fontWeight: 400, color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums" }}>
              ({files.length})
            </span>
          )}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<CloudUploadIcon fontSize={16} />}
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
          sx={{ mb: 1 }}
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
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        // The edge is drawn here in full (not Paper's outlined shorthand plus
        // longhand overrides), and only named properties transition — the
        // drag cue changes the edge and the wash, nothing else.
        style={{
          borderRadius: "var(--r-md)",
          border: `1px ${dragging ? "dashed" : "solid"} ${dragging ? "var(--color-primary)" : "var(--color-hairline)"}`,
          backgroundColor: dragging ? "color-mix(in srgb, var(--color-primary) 4%, transparent)" : "transparent",
          transition: "border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out)",
          maxHeight,
          overflow: "auto",
        }}
      >
        {uploading && (
          <LinearProgress
            variant={uploadProgress == null ? "indeterminate" : "determinate"}
            value={uploadProgress ?? 0}
          />
        )}

        {loading && files.length === 0 ? (
          // The list's own shape while it loads: thumbnail + name + meta.
          <Stack divider={<Divider />} aria-busy="true" aria-label="טוען קבצים">
            {Array.from({ length: 3 }).map((_, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1 }}>
                <Skeleton variant="rounded" width={44} height={44} style={{ flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Skeleton width="45%" height={14} />
                  <Skeleton width="70%" height={11} style={{ marginTop: 6 }} />
                </Box>
              </Box>
            ))}
          </Stack>
        ) : files.length === 0 ? (
          <Box sx={{ textAlign: "center", py: compact ? 3 : 5, px: 2, color: "text.secondary" }}>
            <CloudUploadIcon sx={{ fontSize: 36, opacity: 0.5, mb: 0.5 }} />
            <Typography variant="body2">אין קבצים מצורפים</Typography>
            <Typography variant="caption">גרור קבצים לכאן או לחץ &quot;העלה קובץ&quot;</Typography>
          </Box>
        ) : (
          <Stack divider={<Divider />}>
            {files.map((file) => (
              <Box
                key={file.objectKey}
                className="items-file-row"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 1.5,
                  py: 1,
                }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "var(--r-sm)",
                    overflow: "hidden",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "var(--color-canvas-parchment)",
                  }}
                >
                  {isImage(file.fileName) ? (
                    <Image
                      src={fileDownloadUrl(file.objectKey)}
                      alt={file.fileName}
                      width={0}
                      height={0}
                      unoptimized
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
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
                      <Tag tone="primary" style={{ flexShrink: 0 }}>גלובלי</Tag>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {formatFileSize(file.size)} • עודכן {formatMoment(file.updatedAt)}
                    {file.updatedBy ? ` • עובד ${file.updatedBy}` : ""}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={0.5}>
                  {(isTextEditable(file.fileName) || isOfficeEditable(file.fileName)) && (
                    <Tooltip title="ערוך">
                      <IconButton size="small" color="primary" aria-label={"ערוך את " + file.fileName} onClick={() => handleOpen(file)}>
                        {isTextEditable(file.fileName) ? (
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
                      href={fileDownloadUrl(file.objectKey)}
                      download={file.fileName}
                      aria-label={"הורד את " + file.fileName}
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
                        aria-label={"החלף את " + file.fileName}
                      >
                        <SwapHorizIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="מחק">
                    <IconButton size="small" color="error" aria-label={"מחק את " + file.fileName} onClick={() => setPendingDelete(file)}>
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
          objectKey={officeEditorFile.objectKey}
          fileName={officeEditorFile.fileName}
          workerId={effectiveWorkerId}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={pendingDelete != null}
        title="מחיקת קובץ"
        message={pendingDelete ? `הקובץ "${pendingDelete.fileName}" יימחק לצמיתות. להמשיך?` : undefined}
        confirmText="מחק"
        destructive
        onConfirm={() => { if (pendingDelete) void handleDelete(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </Box>
  );
}
