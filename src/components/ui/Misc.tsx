"use client";
import React, { forwardRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";

/* ---------------------------------------------------------------- Fab ---- */
export interface FabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  color?: "default" | "primary" | "secondary" | "error" | "inherit";
  size?: "small" | "medium" | "large";
  variant?: "circular" | "extended";
  href?: string;
  component?: React.ElementType;
  sx?: SxInput;
}
export const Fab = forwardRef<HTMLButtonElement, FabProps>(function Fab(
  { color = "primary", size = "large", variant = "circular", href, component, sx, style, className, children, type, ...rest },
  ref,
) {
  const dim = size === "small" ? 40 : size === "medium" ? 48 : 56;
  const bg = color === "primary" ? "var(--color-primary)" : color === "error" ? "var(--color-destructive)" : color === "inherit" ? "var(--color-ink)" : "var(--color-canvas)";
  const fg = color === "default" ? "var(--color-ink)" : "#fff";
  const Component = (component || (href ? "a" : "button")) as React.ElementType;
  return (
    <Component
      ref={ref}
      href={href}
      type={Component === "button" ? type || "button" : undefined}
      className={cn("sh-press", className)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        width: variant === "extended" ? undefined : dim, height: dim,
        padding: variant === "extended" ? "0 20px" : 0,
        borderRadius: variant === "extended" ? "var(--r-pill)" : "50%",
        background: bg, color: fg, border: color === "default" ? "1px solid var(--color-hairline)" : "none",
        cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 15,
        ...sxToStyle(sx), ...style,
      }}
      {...rest}
    >
      {children}
    </Component>
  );
});

/* ------------------------------------------------------------- Avatar ---- */
export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  variant?: "circular" | "rounded" | "square";
  sx?: SxInput;
}
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { src, alt, variant = "circular", sx, style, children, ...rest },
  ref,
) {
  const radius = variant === "circular" ? "50%" : variant === "rounded" ? "var(--r-sm)" : 0;
  return (
    <div
      ref={ref}
      style={{
        width: 40, height: 40, borderRadius: radius, overflow: "hidden", flexShrink: 0,
        background: "var(--color-canvas-parchment)", color: "var(--color-ink-muted-80)",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600,
        ...sxToStyle(sx), ...style,
      }}
      {...rest}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- design-system primitive
          taking an arbitrary caller-supplied URL; next/image needs known dimensions
          and a configured remote host. */}
      {src ? <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : children}
    </div>
  );
});

/* -------------------------------------------------------------- Link ----- */
export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  underline?: "none" | "hover" | "always";
  color?: string;
  component?: React.ElementType;
  sx?: SxInput;
}
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { underline = "hover", color = "var(--color-primary)", component: Component = "a", sx, style, className, children, ...rest },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn("sh-link", underline === "always" && "sh-link--always", underline === "none" && "sh-link--none", className)}
      style={{ color, textDecoration: underline === "always" ? "underline" : "none", cursor: "pointer", ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </Component>
  );
});

/* --------------------------------------------------- CardActionArea ----- */
export interface CardActionAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  disabled?: boolean;
  component?: React.ElementType;
  href?: string;
  sx?: SxInput;
}
export const CardActionArea = forwardRef<HTMLDivElement, CardActionAreaProps>(function CardActionArea(
  { disabled, component, href, sx, style, className, children, ...rest },
  ref,
) {
  const Component = (component || (href ? "a" : "div")) as React.ElementType;
  return (
    <Component
      ref={ref}
      href={href}
      className={cn("sh-card-action", className)}
      aria-disabled={disabled || undefined}
      style={{ display: "block", width: "100%", cursor: disabled ? "not-allowed" : "pointer", textAlign: "inherit", ...sxToStyle(sx), ...style }}
      {...rest}
    >
      {children}
    </Component>
  );
});

/* --------------------------------------------------- Grow / Fade -------- */
export interface TransitionProps {
  in?: boolean;
  timeout?: number | { enter?: number; exit?: number };
  unmountOnExit?: boolean;
  appear?: boolean;
  mountOnEnter?: boolean;
  children: React.ReactElement;
  style?: React.CSSProperties;
}
function makeTransition(kind: "fade" | "grow") {
  return forwardRef<HTMLElement, TransitionProps>(function Transition({ in: inProp = true, unmountOnExit, children, style }, ref) {
    if (unmountOnExit && !inProp) return null;
    const t: React.CSSProperties = {
      transition: "opacity .2s ease, transform .2s ease",
      opacity: inProp ? 1 : 0,
      transform: kind === "grow" ? (inProp ? "scale(1)" : "scale(0.85)") : undefined,
      transformOrigin: "center",
    };
    return React.cloneElement(children, {
      ref,
      style: { ...t, ...(children.props as { style?: React.CSSProperties }).style, ...style },
    } as Record<string, unknown>);
  });
}
export const Fade = makeTransition("fade");
export const Grow = makeTransition("grow");

/* ------------------------------------------------------------ Popover ---- */
export interface PopoverProps {
  open: boolean;
  anchorEl?: HTMLElement | null;
  onClose?: (event: unknown, reason?: string) => void;
  anchorOrigin?: { vertical: "top" | "center" | "bottom"; horizontal: "left" | "center" | "right" };
  transformOrigin?: { vertical: "top" | "center" | "bottom"; horizontal: "left" | "center" | "right" };
  children?: React.ReactNode;
  id?: string;
  disableRestoreFocus?: boolean;
  keepMounted?: boolean;
  sx?: SxInput;
  PaperProps?: { sx?: SxInput; style?: React.CSSProperties };
}
export function Popover({ open, anchorEl, onClose, anchorOrigin, children, sx, PaperProps }: PopoverProps) {
  if (!open || !anchorEl || typeof document === "undefined") return null;

  // anchorEl is already in the DOM (it is the element the caller clicked), so it
  // can be measured here rather than in a layout effect: one render pass instead
  // of two, and no state. This also removes the old effect's `anchorOrigin`
  // dependency — every caller passes it as an inline object literal, so the
  // effect re-ran and re-set state on every single parent render.
  const r = anchorEl.getBoundingClientRect();
  const vertical = anchorOrigin?.vertical ?? "bottom";
  const top = vertical === "top" ? r.top : vertical === "center" ? r.top + r.height / 2 : r.bottom + 4;

  return createPortal(
    <>
      <div onClick={(e) => { e.stopPropagation(); onClose?.(e, "backdropClick"); }} style={{ position: "fixed", inset: 0, zIndex: 1400 }} />
      <div
        style={{
          position: "fixed", top, insetInlineStart: r.left, zIndex: 1401,
          background: "var(--color-canvas)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-md)", overflow: "hidden",
          ...sxToStyle(sx), ...sxToStyle(PaperProps?.sx), ...PaperProps?.style,
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/* ------------------------------------------------------------ Stepper ---- */
export interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  activeStep?: number;
  alternativeLabel?: boolean;
  orientation?: "horizontal" | "vertical";
  sx?: SxInput;
}
export const Stepper = forwardRef<HTMLDivElement, StepperProps>(function Stepper(
  { activeStep = 0, alternativeLabel, orientation = "horizontal", sx, style, children, ...rest },
  ref,
) {
  const steps = React.Children.toArray(children).filter(React.isValidElement);
  const vertical = orientation === "vertical";
  return (
    <div ref={ref} style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: vertical ? "stretch" : "center", gap: 0, ...sxToStyle(sx), ...style }} {...rest}>
      {steps.map((step, i) => {
        const completed = (step as React.ReactElement<any>).props.completed ?? i < activeStep;
        const active = (step as React.ReactElement<any>).props.active ?? i === activeStep;
        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{ flex: vertical ? undefined : 1, height: vertical ? 24 : 0, width: vertical ? 0 : "auto", borderTop: vertical ? undefined : "1px solid var(--color-hairline)", borderInlineStart: vertical ? "1px solid var(--color-hairline)" : undefined, margin: vertical ? "0 0 0 15px" : "0 8px", alignSelf: alternativeLabel ? "flex-start" : "center" }} />
            )}
            {React.cloneElement(step as React.ReactElement<any>, { index: i, active, completed })}
          </React.Fragment>
        );
      })}
    </div>
  );
});

export interface StepProps extends React.HTMLAttributes<HTMLDivElement> {
  completed?: boolean;
  active?: boolean;
  index?: number;
  sx?: SxInput;
}
export const Step = forwardRef<HTMLDivElement, StepProps>(function Step(
  { completed, active, index, sx, style, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", ...sxToStyle(sx), ...style }} {...rest}>
      {React.Children.map(children, (c) => (React.isValidElement(c) ? React.cloneElement(c as React.ReactElement<any>, { active, completed, index }) : c))}
    </div>
  );
});

export interface StepLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  completed?: boolean;
  index?: number;
  icon?: React.ReactNode;
  optional?: React.ReactNode;
  sx?: SxInput;
}
export const StepLabel = forwardRef<HTMLDivElement, StepLabelProps>(function StepLabel(
  { active, completed, index = 0, icon, optional, sx, style, children, ...rest },
  ref,
) {
  const on = active || completed;
  return (
    <div ref={ref} style={{ display: "inline-flex", alignItems: "center", gap: 8, ...sxToStyle(sx), ...style }} {...rest}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, background: on ? "var(--color-primary)" : "var(--color-canvas-parchment)", color: on ? "#fff" : "var(--color-ink-muted-48)", border: on ? "none" : "1px solid var(--color-hairline)", flexShrink: 0 }}>
        {icon ?? (completed ? "✓" : index + 1)}
      </span>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 15, fontWeight: active ? 600 : 400, color: on ? "var(--color-ink)" : "var(--color-ink-muted-48)" }}>{children}</span>
        {optional && <span style={{ fontSize: 12, color: "var(--color-ink-muted-48)" }}>{optional}</span>}
      </span>
    </div>
  );
});

export const StepConnector = () => null;
