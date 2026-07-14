"use client";
import React, { forwardRef } from "react";
import { X } from "lucide-react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

/* --------------------------------------------------------------- Chip ---- */
type ChipColor = "default" | "primary" | "secondary" | "error" | "success" | "warning" | "info";

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "color" | "onClick"> {
  label?: React.ReactNode;
  color?: ChipColor;
  variant?: "filled" | "outlined";
  size?: "small" | "medium";
  icon?: React.ReactNode;
  onDelete?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  clickable?: boolean;
  sx?: SxInput;
}

const CHIP_COLORS: Record<ChipColor, { bg: string; fg: string; border?: string }> = {
  default: { bg: "var(--color-canvas-parchment)", fg: "var(--color-ink)" },
  primary: { bg: "rgba(0,102,204,.08)", fg: "var(--color-primary)" },
  secondary: { bg: "var(--color-canvas-parchment)", fg: "var(--color-ink-muted-80)" },
  error: { bg: "rgba(191,53,53,.10)", fg: "var(--color-destructive)" },
  success: { bg: "rgba(31,138,91,.12)", fg: "var(--color-status-approved)" },
  warning: { bg: "rgba(217,119,6,.12)", fg: "var(--color-status-late)" },
  info: { bg: "rgba(0,102,204,.08)", fg: "var(--color-primary)" },
};

export const Chip = forwardRef<HTMLDivElement, ChipProps>(function Chip(
  { label, color = "default", variant = "filled", size, icon, onDelete, onClick, disabled, clickable, sx, style, className, children, ...rest },
  ref,
) {
  const c = CHIP_COLORS[color];
  const outlined = variant === "outlined";
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: outlined ? "transparent" : c.bg,
    color: c.fg,
    border: outlined ? `1px solid ${color === "default" ? "var(--color-hairline)" : c.fg}` : "1px solid transparent",
    borderRadius: "var(--r-xs)",
    padding: size === "small" ? "3px 8px" : "6px 12px",
    fontSize: size === "small" ? 12 : 14,
    fontWeight: color === "default" ? 400 : 600,
    cursor: onClick || clickable ? "pointer" : "default",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
  return (
    <div ref={ref} className={className} style={{ ...base, ...sxToStyle(sx), ...style }} onClick={onClick} {...rest}>
      {icon}
      {label ?? children}
      {onDelete && (
        <X
          size={14}
          strokeWidth={1.75}
          style={{ color: "var(--color-ink-muted-48)", cursor: "pointer", flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); onDelete(e); }}
        />
      )}
    </div>
  );
});

/* -------------------------------------------------------------- Badge ---- */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  badgeContent?: React.ReactNode;
  color?: "default" | "primary" | "error" | "success" | "warning" | "secondary";
  max?: number;
  showZero?: boolean;
  invisible?: boolean;
  overlap?: "rectangular" | "circular";
  anchorOrigin?: { vertical: "top" | "bottom"; horizontal: "left" | "right" };
  sx?: SxInput;
}

const BADGE_BG: Record<string, string> = {
  default: "var(--color-ink-muted-48)",
  primary: "var(--color-primary)",
  error: "var(--color-destructive)",
  success: "var(--color-status-approved)",
  warning: "var(--color-status-late)",
  secondary: "var(--color-ink-muted-80)",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { badgeContent, color = "default", max = 99, showZero, invisible, anchorOrigin, sx, style, children, ...rest },
  ref,
) {
  const num = typeof badgeContent === "number" ? badgeContent : undefined;
  const hidden = invisible || (num === 0 && !showZero) || badgeContent == null || badgeContent === "";
  const display = num !== undefined && num > max ? `${max}+` : badgeContent;
  const vert = anchorOrigin?.vertical ?? "top";
  const horiz = anchorOrigin?.horizontal ?? "right";
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", ...sxToStyle(sx), ...style }} {...rest}>
      {children}
      {!hidden && (
        <span
          style={{
            position: "absolute",
            [vert]: -6,
            [horiz === "right" ? "insetInlineEnd" : "insetInlineStart"]: -6,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: BADGE_BG[color],
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {display}
        </span>
      )}
    </span>
  );
});

/* ---------------------------------------------------------- StatusPill --- */
type StatusKind = "on" | "late" | "absent" | "approved";
const STATUS_DOT: Record<StatusKind, string> = {
  on: "var(--color-status-on)",
  late: "var(--color-status-late)",
  absent: "var(--color-status-absent)",
  approved: "var(--color-status-approved)",
};

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: React.ReactNode;
  status?: StatusKind;
  dotColor?: string;
  sx?: SxInput;
}

export function StatusPill({ label, status = "on", dotColor, sx, style, className, ...rest }: StatusPillProps) {
  return (
    <span
      className={cn(className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.6px",
        textTransform: "uppercase",
        color: "var(--color-ink)",
        background: "var(--color-canvas-parchment)",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--r-pill)",
        padding: "5px 11px",
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor ?? STATUS_DOT[status] }} />
      {label}
    </span>
  );
}
