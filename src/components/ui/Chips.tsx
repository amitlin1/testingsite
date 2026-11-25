"use client";
import React, { forwardRef } from "react";
import { X } from "lucide-react";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";
import { TONE } from "./tones";

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

/** A tone's soft surface and its ink (tones.ts); `default` is ink on parchment. */
const chipColors = (color: ChipColor): { bg: string; fg: string } =>
  color === "default" ? { bg: "var(--color-canvas-parchment)", fg: "var(--color-ink)" } : { bg: TONE[color].bg, fg: TONE[color].ink };

export const Chip = forwardRef<HTMLDivElement, ChipProps>(function Chip(
  { label, color = "default", variant = "filled", size, icon, onDelete, onClick, disabled, clickable, sx, style, className, children, ...rest },
  ref,
) {
  const c = chipColors(color);
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
  // A clickable chip is a button for the keyboard too; its × is its own
  // named button, so removing never needs a mouse.
  const interactive = !!onClick && !disabled;
  return (
    <div
      ref={ref}
      className={className}
      style={{ ...base, ...sxToStyle(sx), ...style }}
      onClick={interactive ? onClick : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-disabled={disabled || undefined}
      onKeyDown={interactive ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(e as unknown as React.MouseEvent); }
      } : undefined}
      {...rest}
    >
      {icon}
      {label ?? children}
      {onDelete && (
        <button
          type="button"
          className="sh-chip-delete"
          aria-label={typeof label === "string" ? `הסר ${label}` : "הסר"}
          disabled={disabled}
          onClick={(e) => { e.stopPropagation(); onDelete(e); }}
        >
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
});

/* ---------------------------------------------------------- StatusPill --- */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  label: React.ReactNode;
  dotColor: string;
  sx?: SxInput;
}

export function StatusPill({ label, dotColor, sx, style, className, ...rest }: StatusPillProps) {
  return (
    <span
      className={cn(className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: "var(--text-fine)",
        fontWeight: 600,
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
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor }} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ Tag ---- */
export type TagTone = "primary" | "neutral" | "success" | "warning" | "danger";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
  /** sm = the artboard badge (11px, 3px 10px); md = 12px for denser lists. */
  size?: "sm" | "md";
  icon?: React.ReactNode;
}

/** The one small label pill (package / package-level-station / role badges):
 *  one shape and size per tone instead of a hand-rolled pill on every screen. */
export function Tag({ tone = "primary", size = "sm", icon, className, children, ...rest }: TagProps) {
  return (
    <span className={cn("sh-tag", `sh-tag--${size}`, `sh-tag--${tone}`, className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
