"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Button,
  IconButton,
  Breadcrumbs,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ConfirmDialog,
  TextField,
  Snackbar,
  Alert,
  LinearProgress,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  Skeleton,
  Stack,
  Divider,
} from "@/components/ui";
import DataTable, { type Column } from "@/components/DataTable";
import { UploadFile as UploadFileIcon } from "@/components/ui/icons";
import { CreateNewFolder as CreateNewFolderIcon } from "@/components/ui/icons";
import { Refresh as RefreshIcon } from "@/components/ui/icons";
import { ViewModule as ViewModuleIcon } from "@/components/ui/icons";
import { ViewList as ViewListIcon } from "@/components/ui/icons";
import { MoreVert as MoreVertIcon } from "@/components/ui/icons";
import { Delete as DeleteIcon } from "@/components/ui/icons";
import { DriveFileRenameOutline as DriveFileRenameOutlineIcon } from "@/components/ui/icons";
import { Download as DownloadIcon } from "@/components/ui/icons";
import { Home as HomeIcon } from "@/components/ui/icons";
import { Inbox as InboxIcon } from "@/components/ui/icons";
import { CloudUpload as CloudUploadIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { Error as ErrorIcon } from "@/components/ui/icons";
import SettingsToolbar from "@/app/settings/components/SettingsToolbar";
import { FileIcon } from "@/app/components/files/FileIcon";
import { formatFileSize, formatDate } from "@/lib/minioFileUtils";
import { apiFetch } from "@/lib/api/client";
import { uploadFileManagerFile, mapWithConcurrency } from "@/lib/api/direct-upload";
import "./files.css";

interface FileItem {
  name: string;
  fullPath: string;
  size: number;
  lastModified: string;
  isFolder: boolean;
}

interface UploadFileState {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

/** The folder's entries, or null when they could not be read. */
async function readFiles(prefix: string): Promise<FileItem[] | null> {
  try {
    const res = await apiFetch(`/api/files?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return null;
  }
}

export default function FilesPage() {
  // Core state
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load is not an empty folder: it gets its own band and a retry.
  const [loadError, setLoadError] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [isDragging, setIsDragging] = useState(false);

  // Item action menu
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuItem, setMenuItem] = useState<FileItem | null>(null);

  // Dialogs
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFileStates, setUploadFileStates] = useState<UploadFileState[]>(
    []
  );
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Snackbar
  const [snack, setSnack] = useState({
    open: false,
    msg: "",
    severity: "success" as "success" | "error",
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ────────────────────────────────────────────────────────────
  const applyFiles = useCallback((list: FileItem[] | null) => {
    setLoadError(list === null);
    setFiles(list ?? []);
    setLoading(false);
  }, []);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    applyFiles(await readFiles(currentPath));
  }, [currentPath, applyFiles]);

  // Opening a folder starts its load during render; the effect only reads, and
  // applies the reply.
  const [loadingPath, setLoadingPath] = useState(currentPath);
  if (loadingPath !== currentPath) {
    setLoadingPath(currentPath);
    setLoading(true);
    setLoadError(false);
  }
  useEffect(() => {
    readFiles(currentPath).then(applyFiles);
  }, [currentPath, applyFiles]);

  // ── Breadcrumb ───────────────────────────────────────────────────────────────
  const pathSegments = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  const navigateTo = (index: number) => {
    setCurrentPath(pathSegments.slice(0, index + 1).join("/") + "/");
  };

  // ── Upload ───────────────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;

      const states: UploadFileState[] = selectedFiles.map((f) => ({
        file: f,
        progress: 0,
        status: "pending",
      }));
      setUploadFileStates(states);
      setUploadOpen(true);

      const patch = (index: number, changes: Partial<UploadFileState>) =>
        setUploadFileStates((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], ...changes };
          return next;
        });

      // Each file goes straight from the browser to MinIO (presigned POST); the
      // app only issues the ticket and records the result, so the bar tracks the
      // real transfer. A few at a time so a big drop does not open dozens of
      // connections at once. presign/confirm go through apiFetch, so an expired
      // session is refreshed like everywhere else.
      void mapWithConcurrency(selectedFiles, 3, async (file, index) => {
        patch(index, { status: "uploading" });
        try {
          await uploadFileManagerFile(currentPath, file, (loaded, total) =>
            patch(index, { progress: total > 0 ? Math.round((loaded / total) * 100) : 0 }),
          );
          patch(index, { progress: 100, status: "done" });
        } catch (e) {
          patch(index, {
            status: "error",
            error: e instanceof Error ? e.message : "שגיאה בהעלאה",
          });
        }
      });
    },
    [currentPath]
  );

  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    setUploadFileStates([]);
    fetchFiles();
  }, [fetchFiles]);

  // When every file has an outcome: a clean run closes the dialog by itself
  // after 1.5s with a success toast. If any file failed, the dialog stays open
  // (each failed file shows its error) with a summary toast; the user closes it.
  useEffect(() => {
    if (
      uploadFileStates.length > 0 &&
      uploadFileStates.every(
        (f) => f.status === "done" || f.status === "error"
      )
    ) {
      const failed = uploadFileStates.filter((f) => f.status === "error").length;
      const timer = setTimeout(() => {
        if (failed > 0) {
          setSnack({
            open: true,
            msg: `${failed} מתוך ${uploadFileStates.length} קבצים נכשלו בהעלאה`,
            severity: "error",
          });
          return;
        }
        closeUpload();
        setSnack({
          open: true,
          msg: "הקבצים הועלו בהצלחה",
          severity: "success",
        });
      }, failed > 0 ? 0 : 1500);
      return () => clearTimeout(timer);
    }
  }, [uploadFileStates, closeUpload]);

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) handleFileSelect(dropped);
  };

  // ── Download ─────────────────────────────────────────────────────────────────
  const handleDownload = (item: FileItem) => {
    const encodedPath = item.fullPath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const a = document.createElement("a");
    a.href = `/api/files/download/${encodedPath}`;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      const res = await apiFetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [deleteTarget.fullPath] }),
      });
      if (!res.ok) throw new Error("delete failed");
      setSnack({ open: true, msg: "הפריט נמחק בהצלחה", severity: "success" });
      fetchFiles();
    } catch {
      setSnack({ open: true, msg: "שגיאה במחיקת הפריט", severity: "error" });
    } finally {
      setActionLoading(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  // ── Rename ───────────────────────────────────────────────────────────────────
  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setActionLoading(true);
    try {
      const isFolder = renameTarget.isFolder;
      const fullPath = renameTarget.fullPath;
      const lastSlash = isFolder
        ? fullPath.lastIndexOf("/", fullPath.length - 2)
        : fullPath.lastIndexOf("/");
      const parentPath = lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "";
      const newPath = parentPath + renameName.trim() + (isFolder ? "/" : "");

      const res = await apiFetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath: fullPath, newPath }),
      });
      if (!res.ok) throw new Error("rename failed");
      setSnack({
        open: true,
        msg: "שם הפריט שונה בהצלחה",
        severity: "success",
      });
      fetchFiles();
    } catch {
      setSnack({ open: true, msg: "שגיאה בשינוי שם", severity: "error" });
    } finally {
      setActionLoading(false);
      setRenameOpen(false);
      setRenameTarget(null);
      setRenameName("");
    }
  };

  // ── Create Folder ────────────────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setActionLoading(true);
    try {
      const res = await apiFetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath + newFolderName.trim() + "/" }),
      });
      if (!res.ok) throw new Error("create folder failed");
      setSnack({
        open: true,
        msg: "התיקייה נוצרה בהצלחה",
        severity: "success",
      });
      fetchFiles();
    } catch {
      setSnack({ open: true, msg: "שגיאה ביצירת תיקייה", severity: "error" });
    } finally {
      setActionLoading(false);
      setNewFolderOpen(false);
      setNewFolderName("");
    }
  };

  // ── Context Menu ─────────────────────────────────────────────────────────────
  const handleMenuOpen = (
    e: React.MouseEvent<HTMLElement>,
    item: FileItem
  ) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuItem(item);
  };
  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuItem(null);
  };
  const openRename = (item: FileItem) => {
    setRenameTarget(item);
    setRenameName(item.name);
    setRenameOpen(true);
    handleMenuClose();
  };
  const openDelete = (item: FileItem) => {
    setDeleteTarget(item);
    setDeleteOpen(true);
    handleMenuClose();
  };

  // ── List columns ─────────────────────────────────────────────────────────────
  const openItem = (item: FileItem) => {
    if (item.isFolder) {
      setCurrentPath(item.fullPath);
    } else {
      handleDownload(item);
    }
  };

  const columns: Column<FileItem>[] = [
    {
      key: "name",
      header: "שם",
      cell: (item) => (
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <FileIcon name={item.name} isFolder={item.isFolder} sx={{ fontSize: 22 }} />
          <span style={{ fontWeight: item.isFolder ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.name}
          </span>
        </span>
      ),
    },
    { key: "size", header: "גודל", muted: true, nums: true, nowrap: true, cell: (item) => (item.isFolder ? "—" : formatFileSize(item.size)) },
    { key: "date", header: "תאריך שינוי", muted: true, nums: true, nowrap: true, cell: (item) => (item.isFolder ? "—" : formatDate(item.lastModified)) },
    {
      key: "actions",
      header: "פעולות",
      align: "center",
      width: 80,
      cell: (item) => (
        <IconButton size="small" aria-label={`פעולות עבור ${item.name}`} aria-haspopup="menu" onClick={(e) => handleMenuOpen(e, item)}>
          <MoreVertIcon fontSize={18} aria-hidden />
        </IconButton>
      ),
    },
  ];

  const uploadFinished =
    uploadFileStates.length > 0 &&
    uploadFileStates.every((f) => f.status === "done" || f.status === "error");
  const uploadFailed = uploadFileStates.filter((f) => f.status === "error").length;
  // Closing is offered once every file has an outcome and some failed (a
  // clean run closes by itself).
  const canCloseUpload = uploadFinished && uploadFailed > 0;
  const lastSegment = pathSegments.length - 1;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="files-page">
      <SettingsToolbar
        title="ניהול קבצים"
        subtitle="מאגר הקבצים המשותף: תיקיות, העלאה, הורדה ושינוי שם. אפשר גם לגרור קבצים אל הרשימה."
      />

      {/* Main Container — one flat card */}
      <div className="files-card">
        {/* Toolbar */}
        <div className="files-toolbar">
          {/* Breadcrumb */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Breadcrumbs separator="/" aria-label="מיקום בתיקיות">
              <button
                type="button"
                className="files-crumb"
                aria-current={currentPath === "" ? "page" : undefined}
                onClick={() => setCurrentPath("")}
              >
                <HomeIcon fontSize={16} aria-hidden />
                ראשי
              </button>
              {pathSegments.map((seg, i) => (
                <button
                  key={i}
                  type="button"
                  className="files-crumb"
                  aria-current={i === lastSegment ? "page" : undefined}
                  onClick={() => navigateTo(i)}
                >
                  {seg}
                </button>
              ))}
            </Breadcrumbs>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center" }}>
            <Button
              size="small"
              onClick={() => fileInputRef.current?.click()}
              startIcon={<UploadFileIcon fontSize={18} aria-hidden />}
            >
              העלאת קבצים
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setNewFolderOpen(true)}
              startIcon={<CreateNewFolderIcon fontSize={18} aria-hidden />}
            >
              תיקייה חדשה
            </Button>
            <Tooltip title="רענון">
              <IconButton size="small" aria-label="רענון" onClick={fetchFiles} disabled={loading}>
                <RefreshIcon fontSize={20} aria-hidden />
              </IconButton>
            </Tooltip>
            <Tooltip title={viewMode === "list" ? "תצוגת רשת" : "תצוגת רשימה"}>
              <IconButton
                size="small"
                aria-label={viewMode === "list" ? "תצוגת רשת" : "תצוגת רשימה"}
                onClick={() =>
                  setViewMode((v) => (v === "list" ? "grid" : "list"))
                }
              >
                {viewMode === "list" ? <ViewModuleIcon fontSize={20} aria-hidden /> : <ViewListIcon fontSize={20} aria-hidden />}
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {/* Content area with drag-and-drop */}
        <div
          className={"files-drop" + (isDragging ? " files-drop--over" : "")}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag cue: fades in (opacity), never moves the layout */}
          <div className="files-drop__overlay" aria-hidden>
            <CloudUploadIcon fontSize={56} />
            <span style={{ fontSize: "var(--text-lead)", fontWeight: 600 }}>שחרר קבצים כאן להעלאה</span>
          </div>

          {loadError ? (
            <div style={{ padding: "var(--space-md)", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-sm)" }}>
              <Alert severity="error">טעינת הקבצים נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
              <Button variant="outlined" color="inherit" size="small" onClick={fetchFiles}>נסה שוב</Button>
            </div>
          ) : !loading && files.length === 0 ? (
            /* Empty state */
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px var(--space-lg)", gap: "var(--space-xs)", textAlign: "center" }}>
              <InboxIcon fontSize={56} color="var(--color-ink-muted-48)" aria-hidden />
              <div style={{ fontSize: "var(--text-lead)", fontWeight: 600, color: "var(--color-ink)", marginTop: "var(--space-xs)" }}>
                התיקייה ריקה
              </div>
              <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                גרור קבצים לכאן או לחץ על &quot;העלאת קבצים&quot;
              </div>
            </div>
          ) : viewMode === "list" ? (
            /* ── List view: a row opens (Enter / Space too) ── */
            <DataTable<FileItem>
              columns={columns}
              rows={files}
              getRowKey={(item) => item.fullPath}
              onRowClick={openItem}
              loading={loading}
              loadingRows={6}
              minWidth={560}
              plain
            />
          ) : loading ? (
            <div className="files-grid" aria-busy="true" aria-label="טוען קבצים">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={132} />
              ))}
            </div>
          ) : (
            /* ── Grid view ── */
            <div className="files-grid">
              {files.map((item) => (
                <div key={item.fullPath} className="files-tile">
                  <button
                    type="button"
                    className="files-tile__open"
                    onClick={() => openItem(item)}
                    title={item.name}
                  >
                    <FileIcon name={item.name} isFolder={item.isFolder} sx={{ fontSize: 48 }} />
                    <span className="files-tile__name" style={{ fontWeight: item.isFolder ? 600 : 400 }}>
                      {item.name}
                    </span>
                    {!item.isFolder && (
                      <span style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", fontVariantNumeric: "tabular-nums" }}>
                        {formatFileSize(item.size)}
                      </span>
                    )}
                  </button>
                  <div style={{ padding: "0 4px 4px", display: "flex", justifyContent: "flex-end" }}>
                    <IconButton
                      size="small"
                      aria-label={`פעולות עבור ${item.name}`}
                      aria-haspopup="menu"
                      onClick={(e) => handleMenuOpen(e, item)}
                    >
                      <MoreVertIcon fontSize={18} aria-hidden />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden
        style={{ display: "none" }}
        onChange={(e) => {
          const selected = Array.from(e.target.files || []);
          if (selected.length > 0) handleFileSelect(selected);
          e.target.value = "";
        }}
      />

      {/* ── Context Menu ── */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        PaperProps={{ style: { minWidth: 160 } }}
      >
        {menuItem && !menuItem.isFolder && (
          <MenuItem
            onClick={() => {
              handleDownload(menuItem);
              handleMenuClose();
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize={18} aria-hidden />
            </ListItemIcon>
            הורדה
          </MenuItem>
        )}
        <MenuItem onClick={() => menuItem && openRename(menuItem)}>
          <ListItemIcon>
            <DriveFileRenameOutlineIcon fontSize={18} aria-hidden />
          </ListItemIcon>
          שינוי שם
        </MenuItem>
        <Divider />
        <MenuItem danger onClick={() => menuItem && openDelete(menuItem)}>
          <ListItemIcon style={{ color: "inherit" }}>
            <DeleteIcon fontSize={18} aria-hidden />
          </ListItemIcon>
          מחיקה
        </MenuItem>
      </Menu>

      {/* ── Upload Progress Dialog ──
          A clean run closes by itself; if any file failed it stays open with
          each file's error, and closes when the user says so. */}
      <Dialog open={uploadOpen} onClose={canCloseUpload ? closeUpload : undefined} maxWidth="sm" fullWidth>
        <DialogTitle onClose={canCloseUpload ? closeUpload : undefined}>העלאת קבצים</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {canCloseUpload && (
              <Alert severity="error">
                {uploadFailed} מתוך {uploadFileStates.length} קבצים נכשלו בהעלאה. הקבצים שהצליחו כבר נשמרו; את הכושלים אפשר להעלות שוב.
              </Alert>
            )}
            {uploadFileStates.map((f, i) => (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-xs)", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <FileIcon name={f.file.name} sx={{ fontSize: 18 }} />
                    <span style={{ fontSize: "var(--text-body-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.file.name}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    {f.status === "done" && <CheckCircleIcon fontSize={18} color="var(--color-success-ink)" aria-hidden />}
                    {f.status === "error" && <ErrorIcon fontSize={18} color="error" aria-hidden />}
                    <span
                      style={{
                        fontSize: "var(--text-fine)",
                        fontVariantNumeric: "tabular-nums",
                        color:
                          f.status === "error"
                            ? "var(--color-destructive)"
                            : f.status === "done"
                            ? "var(--color-success-ink)"
                            : "var(--color-ink-muted-48)",
                      }}
                    >
                      {f.status === "error"
                        ? "נכשל"
                        : f.status === "done"
                        ? "הושלם"
                        : `${f.progress}%`}
                    </span>
                  </div>
                </div>
                <LinearProgress
                  variant="determinate"
                  value={f.progress}
                  aria-label={`התקדמות ההעלאה של ${f.file.name}`}
                  color={
                    f.status === "error"
                      ? "error"
                      : f.status === "done"
                      ? "success"
                      : "primary"
                  }
                />
                {f.status === "error" && (
                  <div style={{ fontSize: "var(--text-fine)", color: "var(--color-destructive)", marginTop: 4 }}>
                    {f.error}
                  </div>
                )}
              </div>
            ))}
          </Stack>
        </DialogContent>
        {canCloseUpload && (
          <DialogActions>
            <Button onClick={closeUpload}>סגור</Button>
          </DialogActions>
        )}
      </Dialog>

      {/* ── New Folder Dialog ── */}
      <Dialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>יצירת תיקייה חדשה</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="שם התיקייה"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
            }}
          />
        </DialogContent>
        {/* Cancel first, the action last (DialogActions puts it at the end). */}
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setNewFolderOpen(false)}>ביטול</Button>
          <Button
            variant="contained"
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim()}
            loading={actionLoading}
          >
            יצירה
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Rename Dialog ── */}
      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>שינוי שם</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="שם חדש"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setRenameOpen(false)}>ביטול</Button>
          <Button
            variant="contained"
            onClick={handleRename}
            disabled={!renameName.trim()}
            loading={actionLoading}
          >
            שמירה
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <ConfirmDialog
        draggable={false}
        open={deleteOpen}
        title={deleteTarget?.isFolder ? "מחיקת תיקייה" : "מחיקת קובץ"}
        message={
          deleteTarget
            ? `למחוק את ${deleteTarget.isFolder ? "התיקייה" : "הקובץ"} "${deleteTarget.name}"?${deleteTarget.isFolder ? " כל תוכן התיקייה יימחק." : ""} פעולה זו אינה ניתנת לביטול.`
            : ""
        }
        confirmText="מחק"
        destructive
        busy={actionLoading}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />

      {/* ── Snackbar ── */}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </div>
  );
}
