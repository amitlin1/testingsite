"use client";
import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Alert,
  Skeleton,
  ConfirmDialog,
} from "@/components/ui";
import { Save as SaveIcon } from "@/components/ui/icons";

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
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

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

  // Opening (or another file) starts the load during render; the effect only
  // sets state from the reply.
  const loadKey = open ? contentUrl : null;
  const [seenLoadKey, setSeenLoadKey] = React.useState<string | null>(null);
  if (seenLoadKey !== loadKey) {
    setSeenLoadKey(loadKey);
    if (loadKey) {
      setError(null);
      setLoading(true);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
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
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  const discardAndClose = () => {
    setConfirmDiscard(false);
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="md"
        PaperProps={{ style: { height: "calc(100vh - 48px)" } }}
      >
        {/* The shared title (one size) with its one named × at the inline
            end; the file name is the quiet second line. */}
        <DialogTitle onClose={handleClose}>
          <span style={{ flex: 1, minWidth: 0 }}>
            עריכת קובץ
            <span
              dir="auto"
              style={{ display: "block", fontFamily: "var(--font-text)", fontSize: "var(--text-small)", fontWeight: 400, color: "var(--color-ink-muted-48)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={fileName}
            >
              {fileName}
            </span>
          </span>
        </DialogTitle>
        {/* Top divider only — DialogActions draws the line above the footer. */}
        <DialogContent style={{ borderTop: "1px solid var(--color-hairline)" }} sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden", py: 2 }}>
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {loading ? (
              // The editor's shape while the file loads: a field of text lines.
              <div
                aria-busy="true"
                aria-label="טוען את הקובץ"
                style={{ flex: 1, minHeight: 0, border: "1px solid var(--color-hairline)", borderRadius: "var(--r-sm)", padding: "var(--space-sm) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}
              >
                {[62, 48, 74, 36, 58, 70, 42, 54].map((w, i) => (
                  <Skeleton key={i} width={`${w}%`} height={12} />
                ))}
              </div>
            ) : (
              <TextField
                value={content}
                onChange={(e) => setContent(e.target.value)}
                multiline
                fullHeight
                fullWidth
                spellCheck={false}
                dir="ltr"
                InputProps={{
                  sx: {
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-body-sm)",
                    lineHeight: 1.55,
                  },
                }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={handleClose} disabled={saving}>
            ביטול
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !dirty}
            loading={saving}
            variant="contained"
            startIcon={<SaveIcon fontSize={18} />}
          >
            {saving ? "שומר..." : "שמור"}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title="יש שינויים שלא נשמרו"
        message="סגירת העורך תבטל את השינויים שביצעת בקובץ. האם לסגור בכל זאת?"
        confirmText="סגור בלי לשמור"
        cancelText="חזרה לעריכה"
        destructive
        onConfirm={discardAndClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
