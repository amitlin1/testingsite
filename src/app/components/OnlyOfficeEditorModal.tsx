"use client";
import * as React from "react";
import {
  Dialog,
  DialogTitle,
  IconButton,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";

/**
 * In-browser editor for .docx/.xlsx/.pptx attachments using OnlyOffice DocsAPI.
 *
 * Architecture note (don't simplify this without understanding it):
 *
 * The DocEditor mutates the DOM inside the element you point it at — it removes
 * children, injects iframes, swaps wrappers, etc. If we hand it a React-owned
 * <div>, React later sees a tree it didn't render and crashes during unmount
 * with NotFoundError on insertBefore. So we:
 *
 *   1. Give React a single empty <Box ref={containerRef}/> with NO JSX children
 *      it might try to reconcile.
 *   2. Inside an effect we `document.createElement('div')` for OnlyOffice and
 *      appendChild it to the container — that child is invisible to React.
 *   3. On cleanup we destroyEditor() then removeChild() the placeholder,
 *      restoring the container to the empty state React expects.
 *
 * loading/error overlays are absolutely-positioned siblings of the container,
 * so toggling them never re-renders the container.
 */

type OnlyOfficeEditorModalProps = {
  open: boolean;
  onClose: () => void;
  itemId: number | string;
  objectKey: string;
  fileName: string;
  workerId: number | null;
  workerName?: string;
  /** Open in view-only mode (no edits possible). */
  viewOnly?: boolean;
  /** Called after the editor has closed so the parent can re-list. */
  onSaved?: () => void;
};

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        placeholderId: string,
        config: Record<string, unknown>,
      ) => { destroyEditor: () => void };
    };
  }
}

const ONLYOFFICE_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_ONLYOFFICE_PUBLIC_URL || "/onlyoffice"
).replace(/\/+$/, "");

const SCRIPT_ID = "onlyoffice-docs-api";
const SCRIPT_TIMEOUT_MS = 20_000;

/**
 * Resolve once `window.DocsAPI` exists. Robust against three subtle hang modes:
 *  1. Script tag already loaded but `window.DocsAPI` not yet set (synchronous tail still executing).
 *  2. Script tag exists but its `load` event already fired before we attached a listener.
 *  3. Script never loads (network/CSP/proxy issue). Without a timeout we'd spin forever.
 *
 * The fix is "set up the listeners AND poll AND time out", all racing the same promise.
 */
function loadDocsApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("server"));
  if (window.DocsAPI) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      err ? reject(err) : resolve();
    };

    // Race 1: polling — covers both "load already fired" and "script still
    // executing" cases without depending on event timing.
    const poll = setInterval(() => {
      if (window.DocsAPI) {
        console.log("[OnlyOffice] DocsAPI detected via poll");
        done();
      }
    }, 100);

    // Race 2: explicit timeout so the modal never spins forever.
    const timeout = setTimeout(() => {
      done(new Error(
        `OnlyOffice DocsAPI לא נטען (timeout ${SCRIPT_TIMEOUT_MS}ms). בדוק שהשרת באוויר ב-${ONLYOFFICE_PUBLIC_URL}.`,
      ));
    }, SCRIPT_TIMEOUT_MS);

    // Race 3: actually load the script if it isn't in the DOM yet.
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      console.log("[OnlyOffice] injecting DocsAPI script tag", `${ONLYOFFICE_PUBLIC_URL}/web-apps/apps/api/documents/api.js`);
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = `${ONLYOFFICE_PUBLIC_URL}/web-apps/apps/api/documents/api.js`;
      script.async = true;
      document.head.appendChild(script);
    } else {
      console.log("[OnlyOffice] DocsAPI script tag already in DOM, waiting");
    }
    script.addEventListener("load", () => {
      console.log("[OnlyOffice] DocsAPI script load event fired");
      // give DocsAPI a microtask to register itself
      queueMicrotask(() => {
        if (window.DocsAPI) done();
      });
    });
    script.addEventListener("error", (ev) => {
      console.error("[OnlyOffice] script load error", ev);
      done(new Error("OnlyOffice api.js לא נטען (script error)"));
    });
  });
}

const BUILD_TAG = "onlyoffice-modal/v7";

export default function OnlyOfficeEditorModal({
  open,
  onClose,
  objectKey,
  fileName,
  workerId,
  workerName,
  viewOnly = false,
  onSaved,
}: OnlyOfficeEditorModalProps) {
  const editorRef = React.useRef<{ destroyEditor: () => void } | null>(null);
  const placeholderRef = React.useRef<HTMLDivElement | null>(null);
  const sawSaveRef = React.useRef(false);

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // The container is tracked as STATE, not a ref, so React re-runs the editor
  // effect once the Box actually mounts. Refs alone are unreliable here because
  // MUI Dialog's portal can commit the inner subtree on a later cycle than the
  // outer component, leaving a ref still-null when a useEffect first fires.
  // A ref callback that flips state guarantees the effect re-runs at the right
  // moment, with no timing assumptions.
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);

  React.useEffect(() => {
    console.log(`[${BUILD_TAG}] effect fired`, { open, hasContainer: !!container });
    if (!open || !container) return;

    let cancelled = false;
    setError(null);
    setLoading(true);
    sawSaveRef.current = false;

    // Mint a fresh placeholder OUTSIDE React's tree so OnlyOffice has its own
    // sandbox to mutate. A unique id per mount avoids any collision with a
    // previous instance that may not have torn down yet.
    const placeholder = document.createElement("div");
    const uniqueId = `onlyoffice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    placeholder.id = uniqueId;
    placeholder.style.width = "100%";
    placeholder.style.height = "100%";
    container.appendChild(placeholder);
    placeholderRef.current = placeholder;

    const encodedPath = objectKey
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const params = new URLSearchParams({
      worker_id: workerId ? String(workerId) : "",
      worker_name: workerName || "",
      mode: viewOnly ? "view" : "edit",
    });

    (async () => {
      try {
        console.log("[OnlyOffice] modal effect start", { objectKey, uniqueId });
        await loadDocsApi();
        if (cancelled) return;
        console.log("[OnlyOffice] DocsAPI ready, fetching editor config…");

        const configUrl = `/api/onlyoffice/config/${encodedPath}?${params.toString()}`;
        const r = await fetch(configUrl);
        console.log("[OnlyOffice] config response", r.status);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `שגיאה בקבלת תצורת עורך (${r.status})`);
        }
        const config = await r.json();
        if (cancelled || !window.DocsAPI) return;
        console.log("[OnlyOffice] instantiating DocEditor", { documentType: config.documentType, fileType: config?.document?.fileType });

        editorRef.current = new window.DocsAPI.DocEditor(uniqueId, {
          ...config,
          width: "100%",
          height: "100%",
          events: {
            onAppReady: () => console.log("[OnlyOffice] onAppReady"),
            onDocumentReady: () => {
              console.log("[OnlyOffice] onDocumentReady");
              if (!cancelled) setLoading(false);
            },
            onDocumentStateChange: () => {
              sawSaveRef.current = true;
            },
            onError: (e: { data?: unknown }) => {
              // OnlyOffice's e.data is sometimes a string, sometimes an object
              // like { errorCode, errorDescription } — coerce to something
              // readable instead of letting it stringify as [object Object].
              console.error("[OnlyOffice] onError", e);
              if (cancelled) return;
              const d = e?.data;
              let msg: string;
              if (typeof d === "string") msg = d;
              else if (d && typeof d === "object") {
                const obj = d as { errorCode?: number; errorDescription?: string };
                msg = obj.errorDescription
                  ? `${obj.errorDescription}${obj.errorCode != null ? ` (קוד ${obj.errorCode})` : ""}`
                  : JSON.stringify(d);
              } else msg = "שגיאה לא ידועה";
              setError(`OnlyOffice: ${msg}`);
            },
            onWarning: (e: { data?: string }) => console.warn("[OnlyOffice] onWarning", e),
          },
        });
        // Drop the spinner the moment DocsAPI accepted the config; the editor
        // surfaces its own loading UI inside the iframe from here on. We also
        // clear it again on onDocumentReady above, defensively.
        if (!cancelled) setLoading(false);
      } catch (e) {
        console.error("[OnlyOffice] modal effect failed", e);
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();

    // Cleanup: tear OnlyOffice down THEN restore the container to empty so
    // React's reconciliation never sees the mutated tree.
    return () => {
      cancelled = true;
      const ed = editorRef.current;
      editorRef.current = null;
      try {
        ed?.destroyEditor();
      } catch {
        /* OnlyOffice sometimes throws on a half-initialised destroy */
      }
      const ph = placeholderRef.current;
      placeholderRef.current = null;
      if (ph && ph.parentNode) {
        try {
          ph.parentNode.removeChild(ph);
        } catch {
          /* the editor may have already detached it */
        }
      }
    };
    // Re-init only on actual file/identity change, not on every parent render.
  }, [open, container, objectKey, workerId, workerName, viewOnly]);

  const handleClose = () => {
    if (sawSaveRef.current) onSaved?.();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen
      // keepMounted={false} (the default) — when open flips to false, React
      // unmounts this whole subtree, our effect cleanup runs first, the
      // container is empty again, and React removes it without complaint.
      PaperProps={{ sx: { bgcolor: "#1e1e1e" } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          bgcolor: "#2b2b2b",
          color: "#fff",
          py: 1,
          pr: 6,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            {viewOnly ? "צפייה" : "עריכה"} — {fileName}{" "}
            <Typography component="span" variant="caption" sx={{ color: "#7cb342", ml: 1 }}>
              [v7]
            </Typography>
          </Typography>
        </Box>
        <IconButton
          onClick={handleClose}
          sx={{ position: "absolute", left: 12, top: 8, color: "#fff" }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <Box sx={{ position: "relative", flex: 1, minHeight: 0, height: "calc(100vh - 56px)" }}>
        {error && (
          <Alert severity="error" sx={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 2 }}>
            {error}
          </Alert>
        )}
        {loading && !error && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              zIndex: 1,
            }}
          >
            <CircularProgress color="inherit" />
          </Box>
        )}
        {/*
          React-owned container, intentionally empty. OnlyOffice's div is
          appended imperatively inside the effect above so React never sees it.
          Ref callback sets state so the editor effect waits for actual mount.
        */}
        <Box ref={setContainer as unknown as React.Ref<HTMLElement>} sx={{ width: "100%", height: "100%" }} />
      </Box>
    </Dialog>
  );
}
