"use client";
import React, { forwardRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

type Severity = "info" | "success" | "warning" | "error";

// A tinted band per severity: the icon carries the colour, the text stays ink.
// (No coloured side stripe — the tint and the icon already say the severity.)
const SEVERITY: Record<Severity, { color: string; bg: string; border: string; role: "alert" | "status"; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }> }> = {
  info: { color: "var(--color-primary)", bg: "var(--color-primary-tint)", border: "var(--color-primary-border)", role: "status", Icon: Info },
  success: { color: "var(--color-success-ink)", bg: "var(--color-success-bg)", border: "color-mix(in srgb, var(--color-success-ink) 22%, transparent)", role: "status", Icon: CheckCircle2 },
  warning: { color: "var(--color-warning-ink)", bg: "var(--color-warning-bg)", border: "var(--color-warning-border)", role: "alert", Icon: AlertTriangle },
  error: { color: "var(--color-destructive)", bg: "var(--color-danger-bg)", border: "color-mix(in srgb, var(--color-destructive) 22%, transparent)", role: "alert", Icon: XCircle },
};

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  severity?: Severity;
  variant?: "standard" | "filled" | "outlined";
  icon?: React.ReactNode | false;
  onClose?: (e: React.MouseEvent) => void;
  action?: React.ReactNode;
  sx?: SxInput;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { severity = "info", variant: _v, icon, onClose, action, sx, style, className, children, ...rest },
  ref,
) {
  const { color, bg, border, role, Icon } = SEVERITY[severity];
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

export function AlertTitle({ children, style, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div style={{ fontWeight: 600, marginBottom: 2, ...style }} {...rest}>
      {children}
    </div>
  );
}

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
  useEffect(() => {
    if (!open || !autoHideDuration) return;
    const t = setTimeout(() => onClose?.(undefined, "timeout"), autoHideDuration);
    return () => clearTimeout(t);
  }, [open, autoHideDuration, onClose]);

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
