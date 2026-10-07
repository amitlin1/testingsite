"use client";
import React, { forwardRef } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";
import { useDraggable } from "./useDraggable";

/** Whether the surrounding Dialog moves; its DialogTitle is the handle only then
 *  (a fixed delete confirmation shows no move cursor). */
const DraggableDialog = React.createContext(false);

const MAXW: Record<string, number> = { xs: 444, sm: 600, md: 900, lg: 1200, xl: 1536 };

export interface DialogProps {
  open: boolean;
  onClose?: (event: unknown, reason?: "backdropClick" | "escapeKeyDown") => void;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
  fullWidth?: boolean;
  fullScreen?: boolean;
  disableEscapeKeyDown?: boolean;
  scroll?: "paper" | "body";
  children?: React.ReactNode;
  dir?: string;
  sx?: SxInput;
  PaperProps?: { sx?: SxInput; style?: React.CSSProperties; className?: string };
  slotProps?: { paper?: { sx?: SxInput; style?: React.CSSProperties; className?: string } };
  "aria-labelledby"?: string;
  /** Moved by its DialogTitle (or any `data-drag-handle` inside). Default on;
   *  delete confirmations turn it off. */
  draggable?: boolean;
}

export function Dialog({
  open,
  onClose,
  maxWidth = "sm",
  fullWidth,
  fullScreen,
  disableEscapeKeyDown,
  children,
  dir = "rtl",
  sx,
  PaperProps,
  slotProps,
  draggable = true,
}: DialogProps) {
  const paper = { ...slotProps?.paper, ...PaperProps };
  const { ref: dragRef, onPointerDown: onDragStart, offset: dragOffset, moved: dragMoved } = useDraggable(open, draggable && !fullScreen);
  const contentStyle: React.CSSProperties = fullScreen
    ? { width: "100vw", height: "100vh", maxWidth: "100vw", maxHeight: "100vh", borderRadius: 0, top: 0, left: 0, transform: "none" }
    : {
        width: fullWidth ? "calc(100% - 48px)" : "auto",
        maxWidth: maxWidth ? MAXW[maxWidth] : undefined,
      };
  return (
    <RDialog.Root
      open={open}
      onOpenChange={(o) => { if (!o) onClose?.({}, "escapeKeyDown"); }}
    >
      <RDialog.Portal>
        <RDialog.Overlay className="sh-dialog-overlay" />
        <RDialog.Content
          ref={dragRef}
          onPointerDown={onDragStart}
          dir={dir}
          className={cn("sh-dialog-content", paper.className)}
          style={{
            ...contentStyle, ...sxToStyle(sx), ...sxToStyle(paper.sx), ...paper.style,
            // Centred by translate(-50%, -50%) in ui.css; the drag adds to it.
            ...(dragMoved ? { transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` } : {}),
          }}
          onEscapeKeyDown={(e) => { if (disableEscapeKeyDown) e.preventDefault(); }}
          onPointerDownOutside={(e) => { onClose?.(e, "backdropClick"); }}
          aria-describedby={undefined}
        >
          <DraggableDialog.Provider value={draggable && !fullScreen}>{children}</DraggableDialog.Provider>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  sx?: SxInput;
}
export const DialogTitle = forwardRef<HTMLHeadingElement, DialogTitleProps>(function DialogTitle(
  { sx, style, className, children, ...rest },
  ref,
) {
  const draggable = React.useContext(DraggableDialog);
  return (
    <RDialog.Title ref={ref} data-drag-handle={draggable ? "" : undefined} className={cn("sh-dialog-title", className)} style={{ ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </RDialog.Title>
  );
});

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  dividers?: boolean;
  sx?: SxInput;
}
export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  { dividers, sx, style, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("sh-dialog-body", className)}
      style={{
        borderTop: dividers ? "1px solid var(--color-hairline)" : undefined,
        borderBottom: dividers ? "1px solid var(--color-hairline)" : undefined,
        ...sxToStyle(sx),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});

export function DialogContentText({ sx, style, children, ...rest }: React.HTMLAttributes<HTMLParagraphElement> & { sx?: SxInput }) {
  return (
    <p style={{ margin: 0, fontSize: 17, lineHeight: 1.47, color: "var(--color-ink-muted-80)", ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </p>
  );
}

export interface DialogActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  sx?: SxInput;
}
export const DialogActions = forwardRef<HTMLDivElement, DialogActionsProps>(function DialogActions(
  { sx, style, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn("sh-dialog-actions", className)} style={{ ...sxToStyle(sx), ...style }} {...rest}>
      {children}
    </div>
  );
});

/** Radix close, if a dialog wants the built-in close affordance. */
export const DialogClose = RDialog.Close;
