"use client";
import React, { forwardRef } from "react";
import { sxToStyle, type SxInput } from "./sx";

/** MUI colour names → tokens. Anything else (a var(), a hex) is used as is;
 *  passing "success" straight to `background` was invalid CSS, so the bar
 *  never painted. */
const PROGRESS_COLOR: Record<string, string> = {
  primary: "var(--color-primary)",
  info: "var(--color-primary)",
  secondary: "var(--color-ink-muted-80)",
  success: "var(--color-status-approved)",
  warning: "var(--color-status-late)",
  error: "var(--color-destructive)",
  inherit: "currentColor",
};
const progressColor = (c: string) => PROGRESS_COLOR[c] ?? c;

/* ---------------------------------------------------- LinearProgress ----- */
export interface LinearProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "determinate" | "indeterminate";
  value?: number;
  color?: string;
  sx?: SxInput;
}

export const LinearProgress = forwardRef<HTMLDivElement, LinearProgressProps>(function LinearProgress(
  { variant = "indeterminate", value = 0, color = "var(--color-primary)", sx, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={variant === "determinate" ? 0 : undefined}
      aria-valuemax={variant === "determinate" ? 100 : undefined}
      aria-valuenow={variant === "determinate" ? Math.round(Math.min(100, Math.max(0, value))) : undefined}
      style={{ height: 6, width: "100%", background: "var(--color-canvas-parchment)", borderRadius: "var(--r-pill)", overflow: "hidden", ...sxToStyle(sx), ...style }}
      {...rest}
    >
      <div
        className={variant === "determinate" ? "sh-progress-fill" : "sh-progress-indeterminate"}
        style={
          variant === "determinate"
            // Scaled, not resized: transform animates off the layout path. The
            // origin is the reading edge (ui.css .sh-progress-fill).
            ? { width: "100%", height: "100%", background: progressColor(color), transform: `scaleX(${Math.min(100, Math.max(0, value)) / 100})`, transition: "transform var(--dur-slow) var(--ease-out)" }
            : { width: "40%", height: "100%", background: progressColor(color), borderRadius: "var(--r-pill)", animation: "sh-indeterminate 1.4s ease-in-out infinite" }
        }
      />
    </div>
  );
});

/* -------------------------------------------------- CircularProgress ----- */
export interface CircularProgressProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: number | string;
  thickness?: number;
  color?: string;
  variant?: "determinate" | "indeterminate";
  value?: number;
  sx?: SxInput;
}

export const CircularProgress = forwardRef<HTMLSpanElement, CircularProgressProps>(function CircularProgress(
  { size = 40, thickness, color = "var(--color-primary)", sx, style, ...rest },
  ref,
) {
  const dim = typeof size === "number" ? size : parseInt(size, 10) || 40;
  const border = thickness ?? Math.max(2, Math.round(dim / 12));
  return (
    <span
      ref={ref}
      role="progressbar"
      aria-label={rest["aria-hidden"] ? undefined : rest["aria-label"] ?? "טוען"}
      style={{
        display: "inline-block",
        width: dim,
        height: dim,
        border: `${border}px solid var(--color-hairline)`,
        borderTopColor: progressColor(color),
        borderRadius: "50%",
        animation: "sh-spin 0.8s linear infinite",
        boxSizing: "border-box",
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    />
  );
});
