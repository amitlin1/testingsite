"use client";
import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  IconButton,
  Stack,
  Alert,
  CircularProgress,
  Typography,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import DescriptionIcon from "@mui/icons-material/Description";

type TextEditorModalProps = {
  open: boolean;
  onClose: () => void;
  itemId: number | string;
  objectKey: string;
  fileName: string;
  /** Worker id stamped onto updated_by when saving. */
  workerId: number | null;
  /** Called after a successful save so the parent can re-list. */
  onSaved?: () => void;
};

/**
 * Inline text editor for item attachments whose extension is "text-like"
 * (.txt/.md/.csv/.json/.log/.xml/...). Backed by
 * GET/PUT /api/items/[id]/files/content/[...key].
 */
export default function TextEditorModal({
  open,
  onClose,
  itemId,
  objectKey,
  fileName,
  workerId,
  onSaved,
}: TextEditorModalProps) {
  const [content, setContent] = React.useState<string>("");
  const [original, setOriginal] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty = content !== original;

  // URL-encode the catch-all segments; the backend joins with /.
  const contentUrl = React.useMemo(
    () =>
      `/api/items/${encodeURIComponent(String(itemId))}/files/content/` +
      objectKey
        .split("/")
        .map((s) => encodeURIComponent(s))
        .join("/"),
    [itemId, objectKey],
  );

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    fetch(contentUrl)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "שגיאה בטעינת הקובץ");
        }
        return r.json();
      })
      .then((j: { content: string }) => {
        if (cancelled) return;
        setContent(j.content ?? "");
        setOriginal(j.content ?? "");
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, contentUrl]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const r = await fetch(contentUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, worker_id: workerId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "שגיאה בשמירה");
      }
      setOriginal(content);
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty && !confirm("יש שינויים שלא נשמרו. האם לסגור בכל זאת?")) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        <DescriptionIcon color="primary" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="span" sx={{ fontWeight: 700 }} noWrap>
            עריכת קובץ
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {fileName}
          </Typography>
        </Box>
        <IconButton onClick={handleClose} sx={{ position: "absolute", left: 12, top: 12 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TextField
              value={content}
              onChange={(e) => setContent(e.target.value)}
              multiline
              minRows={16}
              maxRows={32}
              fullWidth
              spellCheck={false}
              dir="ltr"
              InputProps={{
                sx: {
                  fontFamily:
                    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                  fontSize: 14,
                  lineHeight: 1.55,
                },
              }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={handleClose} disabled={saving}>
          ביטול
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || loading || !dirty}
          variant="contained"
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
        >
          {saving ? "שומר..." : "שמור"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
