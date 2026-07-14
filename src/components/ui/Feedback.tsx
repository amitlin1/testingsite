"use client";
import React, { forwardRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

type Severity = "info" | "success" | "warning" | "error";

const SEVERITY: Record<Severity, { color: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }> }> = {
  info: { color: "var(--color-primary)", Icon: Info },
  success: { color: "var(--color-status-approved)", Icon: CheckCircle2 },
  warning: { color: "var(--color-status-late)", Icon: AlertTriangle },
  error: { color: "var(--color-destructive)", Icon: XCircle },
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
  const { color, Icon } = SEVERITY[severity];
  return (
    <div
      ref={ref}
      role="alert"
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)",
        borderInlineStart: `3px solid ${color}`,
        borderRadius: "var(--r-sm)",
        padding: "14px 18px",
        fontSize: 15,
        lineHeight: 1.47,
        color: "var(--color-ink)",
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      {icon !== false && (
        <span style={{ flexShrink: 0, display: "inline-flex", color }}>
          {icon ?? <Icon size={20} strokeWidth={1.75} />}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-ink-muted-48)", display: "inline-flex", padding: 0, flexShrink: 0 }}
        >
          <X size={18} strokeWidth={1.75} />
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
    <div style={{ ...pos, ...sxToStyle(sx) }}>
      {children ?? (
        <div style={{ background: "var(--color-ink)", color: "#fff", padding: "12px 18px", borderRadius: "var(--r-sm)", fontSize: 15, display: "flex", alignItems: "center", gap: 12 }}>
          {message}
          {action}
        </div>
      )}
    </div>,
    document.body,
  );
}
