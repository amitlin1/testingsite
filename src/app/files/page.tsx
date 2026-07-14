"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Typography,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Breadcrumbs,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Alert,
  LinearProgress,
  Tooltip,
  Card,
  CardActionArea,
  CardContent,
  Menu,
  MenuItem,
  ListItemIcon,
  CircularProgress,
  Stack,
  Divider,
  Link as MuiLink,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { FolderCopy as FolderCopyIcon } from "@/components/ui/icons";
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
import { FileIcon } from "@/app/components/files/FileIcon";
import { formatFileSize, formatDate } from "@/lib/minioFileUtils";

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

export default function FilesPage() {
  // Core state
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
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
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/files?prefix=${encodeURIComponent(currentPath)}`
      );
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch {
      setSnack({ open: true, msg: "שגיאה בטעינת קבצים", severity: "error" });
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

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

      selectedFiles.forEach((file, index) => {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("path", currentPath);

        setUploadFileStates((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], status: "uploading" };
          return next;
        });

        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadFileStates((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], progress: pct };
              return next;
            });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadFileStates((prev) => {
              const next = [...prev];
              next[index] = { ...next[index], progress: 100, status: "done" };
              return next;
            });
          } else {
            setUploadFileStates((prev) => {
              const next = [...prev];
              next[index] = {
                ...next[index],
                status: "error",
                error: "שגיאה בהעלאה",
              };
              return next;
            });
          }
        };
        xhr.onerror = () => {
          setUploadFileStates((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              status: "error",
              error: "שגיאת רשת",
            };
            return next;
          });
        };
        xhr.open("POST", "/api/files/upload");
        xhr.send(formData);
      });
    },
    [currentPath]
  );

  // Auto-close upload dialog when all done
  useEffect(() => {
    if (
      uploadFileStates.length > 0 &&
      uploadFileStates.every(
        (f) => f.status === "done" || f.status === "error"
      )
    ) {
      const timer = setTimeout(() => {
        setUploadOpen(false);
        setUploadFileStates([]);
        fetchFiles();
        const anyDone = uploadFileStates.some((f) => f.status === "done");
        if (anyDone) {
          setSnack({
            open: true,
            msg: "הקבצים הועלו בהצלחה",
            severity: "success",
          });
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [uploadFileStates, fetchFiles]);

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
      const res = await fetch("/api/files", {
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

      const res = await fetch("/api/files", {
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
      const res = await fetch("/api/files/folder", {
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        minHeight: "100%",
        bgcolor: "#f5f5f7",
        p: 3,
        direction: "rtl",
      }}
    >
      {/* Page Header */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 3, gap: 2 }}>
        <FolderCopyIcon sx={{ fontSize: 40, color: "primary.main" }} />
        <Typography
          variant="h4"
          fontWeight={700}
          sx={{ color: "text.primary", letterSpacing: "-0.3px" }}
        >
          ניהול קבצים
        </Typography>
      </Box>

      {/* Main Container */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 3,
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
        }}
      >
        {/* Toolbar */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "white",
            flexWrap: "wrap",
          }}
        >
          {/* Breadcrumb */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Breadcrumbs separator="/" maxItems={6}>
              <MuiLink
                component="button"
                onClick={() => setCurrentPath("")}
                underline="hover"
                color={currentPath === "" ? "text.primary" : "inherit"}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  cursor: "pointer",
                  border: "none",
                  background: "none",
                  p: 0,
                  fontFamily: "inherit",
                }}
              >
                <HomeIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" fontWeight={currentPath === "" ? 700 : 400}>
                  ראשי
                </Typography>
              </MuiLink>
              {pathSegments.map((seg, i) => (
                <MuiLink
                  key={i}
                  component="button"
                  onClick={() => navigateTo(i)}
                  underline="hover"
                  color={
                    i === pathSegments.length - 1 ? "text.primary" : "inherit"
                  }
                  sx={{
                    cursor: "pointer",
                    border: "none",
                    background: "none",
                    p: 0,
                    fontFamily: "inherit",
                  }}
                >
                  <Typography
                    variant="body2"
                    fontWeight={i === pathSegments.length - 1 ? 700 : 400}
                  >
                    {seg}
                  </Typography>
                </MuiLink>
              ))}
            </Breadcrumbs>
          </Box>

          {/* Action buttons */}
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <Button
              variant="contained"
              size="small"
              onClick={() => fileInputRef.current?.click()}
              sx={{ borderRadius: 2, textTransform: "none", display: "flex", gap: 1, px: 2 }}
            >
              <UploadFileIcon fontSize="small" />
              העלאת קבצים
            </Button>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setNewFolderOpen(true)}
              sx={{ borderRadius: 2, textTransform: "none", display: "flex", gap: 1, px: 2 }}
            >
              <CreateNewFolderIcon fontSize="small" />
              תיקייה חדשה
            </Button>
            <Tooltip title="רענון">
              <IconButton size="small" onClick={fetchFiles} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={viewMode === "list" ? "תצוגת רשת" : "תצוגת רשימה"}>
              <IconButton
                size="small"
                onClick={() =>
                  setViewMode((v) => (v === "list" ? "grid" : "list"))
                }
              >
                {viewMode === "list" ? <ViewModuleIcon /> : <ViewListIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Content area with drag-and-drop */}
        <Box
          sx={{
            minHeight: 420,
            bgcolor: "white",
            position: "relative",
            outline: isDragging
              ? "3px dashed #1976d2"
              : "3px dashed transparent",
            outlineOffset: "-3px",
            transition: "outline 0.15s ease",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                bgcolor: alpha("#1976d2", 0.06),
                pointerEvents: "none",
              }}
            >
              <CloudUploadIcon sx={{ fontSize: 56, color: "primary.main" }} />
              <Typography variant="h6" color="primary" fontWeight={700}>
                שחרר קבצים כאן להעלאה
              </Typography>
            </Box>
          )}

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
              <CircularProgress />
            </Box>
          ) : files.length === 0 ? (
            /* Empty state */
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                py: 10,
                gap: 2,
              }}
            >
              <InboxIcon sx={{ fontSize: 64, color: "text.disabled" }} />
              <Typography variant="h6" color="text.secondary">
                התיקייה ריקה
              </Typography>
              <Typography variant="body2" color="text.secondary">
                גרור קבצים לכאן או לחץ על &quot;העלאת קבצים&quot;
              </Typography>
            </Box>
          ) : viewMode === "list" ? (
            /* ── List view ── */
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: "#fafafa" }}>
                    <TableCell sx={{ fontWeight: 700, width: "50%" }}>
                      שם
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>גודל</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>תאריך שינוי</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, width: 60 }}>
                      פעולות
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {files.map((item) => (
                    <TableRow
                      key={item.fullPath}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => {
                        if (item.isFolder) {
                          setCurrentPath(item.fullPath);
                        } else {
                          handleDownload(item);
                        }
                      }}
                    >
                      <TableCell>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                          }}
                        >
                          <FileIcon
                            name={item.name}
                            isFolder={item.isFolder}
                            sx={{ fontSize: 22 }}
                          />
                          <Typography
                            variant="body2"
                            fontWeight={item.isFolder ? 600 : 400}
                          >
                            {item.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {item.isFolder ? "—" : formatFileSize(item.size)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {item.isFolder ? "—" : formatDate(item.lastModified)}
                        </Typography>
                      </TableCell>
                      <TableCell
                        align="center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconButton
                          size="small"
                          onClick={(e) => handleMenuOpen(e, item)}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            /* ── Grid view ── */
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 2,
                p: 2,
              }}
            >
              {files.map((item) => (
                <Card
                  key={item.fullPath}
                  elevation={0}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 2,
                    transition: "all 0.2s ease",
                    "&:hover": {
                      borderColor: "primary.main",
                      boxShadow: "0 4px 16px rgba(25,118,210,0.15)",
                      transform: "translateY(-2px)",
                    },
                  }}
                >
                  <CardActionArea
                    onClick={() => {
                      if (item.isFolder) {
                        setCurrentPath(item.fullPath);
                      } else {
                        handleDownload(item);
                      }
                    }}
                    sx={{ p: 2, textAlign: "center" }}
                  >
                    <FileIcon
                      name={item.name}
                      isFolder={item.isFolder}
                      sx={{ fontSize: 48 }}
                    />
                    <Typography
                      variant="caption"
                      display="block"
                      noWrap
                      title={item.name}
                      mt={1}
                      fontWeight={item.isFolder ? 600 : 400}
                    >
                      {item.name}
                    </Typography>
                    {!item.isFolder && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                      >
                        {formatFileSize(item.size)}
                      </Typography>
                    )}
                  </CardActionArea>
                  <Box
                    sx={{
                      px: 1,
                      pb: 0.5,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(e, item)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Card>
              ))}
            </Box>
          )}
        </Box>
      </Paper>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
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
        PaperProps={{ sx: { minWidth: 160, borderRadius: 2 } }}
      >
        {menuItem && !menuItem.isFolder && (
          <MenuItem
            onClick={() => {
              handleDownload(menuItem);
              handleMenuClose();
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            הורדה
          </MenuItem>
        )}
        <MenuItem onClick={() => menuItem && openRename(menuItem)}>
          <ListItemIcon>
            <DriveFileRenameOutlineIcon fontSize="small" />
          </ListItemIcon>
          שינוי שם
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => menuItem && openDelete(menuItem)}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          מחיקה
        </MenuItem>
      </Menu>

      {/* ── Upload Progress Dialog ── */}
      <Dialog open={uploadOpen} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <CloudUploadIcon color="primary" />
          העלאת קבצים
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {uploadFileStates.map((f, i) => (
              <Box key={i}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 0.5,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      minWidth: 0,
                    }}
                  >
                    <FileIcon name={f.file.name} sx={{ fontSize: 18 }} />
                    <Typography variant="body2" noWrap>
                      {f.file.name}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                    {f.status === "done" && (
                      <CheckCircleIcon
                        fontSize="small"
                        sx={{ color: "success.main" }}
                      />
                    )}
                    {f.status === "error" && (
                      <ErrorIcon fontSize="small" color="error" />
                    )}
                    <Typography
                      variant="caption"
                      color={
                        f.status === "error"
                          ? "error"
                          : f.status === "done"
                          ? "success.main"
                          : "text.secondary"
                      }
                    >
                      {f.status === "error"
                        ? f.error
                        : f.status === "done"
                        ? "הושלם"
                        : `${f.progress}%`}
                    </Typography>
                  </Box>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={f.progress}
                  color={
                    f.status === "error"
                      ? "error"
                      : f.status === "done"
                      ? "success"
                      : "primary"
                  }
                  sx={{ borderRadius: 1 }}
                />
              </Box>
            ))}
          </Stack>
        </DialogContent>
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
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewFolderOpen(false)}>ביטול</Button>
          <Button
            variant="contained"
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || actionLoading}
          >
            {actionLoading ? <CircularProgress size={18} /> : "יצירה"}
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
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameOpen(false)}>ביטול</Button>
          <Button
            variant="contained"
            onClick={handleRename}
            disabled={!renameName.trim() || actionLoading}
          >
            {actionLoading ? <CircularProgress size={18} /> : "שמירה"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>אישור מחיקה</DialogTitle>
        <DialogContent>
          <Typography>
            האם למחוק את &quot;{deleteTarget?.name}&quot;?
            {deleteTarget?.isFolder && " כל תוכן התיקייה יימחק לצמיתות."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>ביטול</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={actionLoading}
          >
            {actionLoading ? <CircularProgress size={18} /> : "מחיקה"}
          </Button>
        </DialogActions>
      </Dialog>

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
          sx={{ borderRadius: 2 }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
