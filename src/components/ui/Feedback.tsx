"use client";
import React, { forwardRef, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";
import { sxToStyle, type SxInput } from "./sx";
import { TONE } from "./tones";

type Severity = "info" | "success" | "warning" | "error";

// A tinted band per severity: the icon carries the tone's ink, the text stays ink.
// (No coloured side stripe — the tint and the icon already say the severity.)
// The info band is a lighter tint than the tone's soft surface.
const SEVERITY: Record<Severity, { bg: string; border: string; role: "alert" | "status"; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }> }> = {
  info: { bg: "var(--color-primary-tint)", border: "var(--color-primary-border)", role: "status", Icon: Info },
  success: { bg: TONE.success.bg, border: "color-mix(in srgb, var(--color-success-ink) 22%, transparent)", role: "status", Icon: CheckCircle2 },
  warning: { bg: TONE.warning.bg, border: "var(--color-warning-border)", role: "alert", Icon: AlertTriangle },
  error: { bg: TONE.error.bg, border: "color-mix(in srgb, var(--color-destructive) 22%, transparent)", role: "alert", Icon: XCircle },
};

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  severity?: Severity;
  icon?: React.ReactNode | false;
  onClose?: (e: React.MouseEvent) => void;
  action?: React.ReactNode;
  sx?: SxInput;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { severity = "info", icon, onClose, action, sx, style, className, children, ...rest },
  ref,
) {
  const { bg, border, role, Icon } = SEVERITY[severity];
  const color = TONE[severity].ink;
  return (
    <div
      ref={ref}
      role={role}
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "var(--r-md)",
        padding: "12px 14px",
        fontSize: "var(--text-body-sm)",
        lineHeight: "var(--lh-body)",
        color: "var(--color-ink)",
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      {icon !== false && (
        <span style={{ flexShrink: 0, display: "inline-flex", color }}>
          {icon ?? <Icon size={18} strokeWidth={1.75} />}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="סגירה" className="sh-alert-close">
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
});

/* ------------------------------------------------------------ Snackbar --- */
export interface SnackbarProps {
  open?: boolean;
  autoHideDuration?: number | null;
  onClose?: (event?: unknown, reason?: string) => void;
  anchorOrigin?: { vertical: "top" | "bottom"; horizontal: "left" | "center" | "right" };
  message?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  sx?: SxInput;
}

export function Snackbar({ open, autoHideDuration, onClose, anchorOrigin, message, action, children, sx }: SnackbarProps) {
  // The timer must not restart when the parent re-renders with a new inline
  // onClose (a page with a 1-second clock would then never auto-hide).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open || !autoHideDuration) return;
    const t = setTimeout(() => onCloseRef.current?.(undefined, "timeout"), autoHideDuration);
    return () => clearTimeout(t);
  }, [open, autoHideDuration]);

  if (!open || typeof document === "undefined") return null;
  const vert = anchorOrigin?.vertical ?? "bottom";
  const horiz = anchorOrigin?.horizontal ?? "left";
  const pos: React.CSSProperties = {
    position: "fixed",
    zIndex: 1600,
    [vert]: 24,
    ...(horiz === "center"
      ? { left: "50%", transform: "translateX(-50%)" }
      : { [horiz === "right" ? "insetInlineEnd" : "insetInlineStart"]: 24 }),
  };
  return createPortal(
    <div role="status" aria-live="polite" className="sh-snackbar" style={{ ...pos, ...sxToStyle(sx) }}>
      {children ?? (
        <div style={{ background: "var(--color-ink)", color: "var(--color-on-dark)", padding: "12px 18px", borderRadius: "var(--r-md)", fontSize: "var(--text-body-sm)", display: "flex", alignItems: "center", gap: 12 }}>
          {message}
          {action}
        </div>
      )}
    </div>,
    document.body,
  );
}
