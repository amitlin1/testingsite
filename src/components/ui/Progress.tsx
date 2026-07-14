"use client";
import React, { forwardRef } from "react";
import { sxToStyle, type SxInput } from "./sx";

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
      style={{ height: 6, width: "100%", background: "var(--color-canvas-parchment)", borderRadius: "var(--r-pill)", overflow: "hidden", ...sxToStyle(sx), ...style }}
      {...rest}
    >
      <div
        style={
          variant === "determinate"
            ? { width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", background: color, transition: "width .3s ease" }
            : { width: "40%", height: "100%", background: color, borderRadius: "var(--r-pill)", animation: "sh-indeterminate 1.4s ease-in-out infinite" }
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
      style={{
        display: "inline-block",
        width: dim,
        height: dim,
        border: `${border}px solid var(--color-hairline)`,
        borderTopColor: color,
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
