"use client";
import React, { forwardRef } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import { cn } from "./utils";
import { sxToStyle, type SxInput } from "./sx";
import { useDraggable } from "./useDraggable";
import { IconButton } from "./IconButton";
import { X } from "lucide-react";

/** Whether the surrounding Dialog moves; its DialogTitle is the handle only then
 *  (a fixed delete confirmation shows no move cursor). */
const DraggableDialog = React.createContext(false);

/** True around a dialog kept alive but put away (the testing page parks a test window
 *  closed without a result): every Dialog inside shows nothing, while the components
 *  that render them stay mounted and keep what they hold. */
export const DialogParked = React.createContext(false);

/** Where the focus goes once a Dialog inside closes: the element this answers, when it is still on
 *  the page (null leaves the focus where it is). Radix hands the focus back to a Dialog's Trigger, and
 *  these dialogs have none, so without it the focus drops to the page. Reaches dialogs that other
 *  components render (ConfirmDialog); a Dialog's own `returnFocus` wins. */
export const DialogReturnFocus = React.createContext<(() => HTMLElement | null | undefined) | null>(null);

const MAXW: Record<string, number> = { xs: 444, sm: 600, md: 900, lg: 1200, xl: 1536 };

export interface DialogProps {
  open: boolean;
  onClose?: (event: unknown, reason?: "backdropClick" | "escapeKeyDown") => void;
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
  fullWidth?: boolean;
  fullScreen?: boolean;
  disableEscapeKeyDown?: boolean;
  children?: React.ReactNode;
  dir?: string;
  sx?: SxInput;
  PaperProps?: { sx?: SxInput; style?: React.CSSProperties; className?: string };
  /** Moved by its DialogTitle (or any `data-drag-handle` inside). Default on;
   *  delete confirmations turn it off. */
  draggable?: boolean;
  /** See DialogReturnFocus. */
  returnFocus?: () => HTMLElement | null | undefined;
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
  PaperProps: paper = {},
  draggable = true,
  returnFocus: ownReturnFocus,
}: DialogProps) {
  const inheritedReturnFocus = React.useContext(DialogReturnFocus);
  const returnFocus = ownReturnFocus ?? inheritedReturnFocus;
  const parked = React.useContext(DialogParked);
  const shown = open && !parked;
  const { ref: dragRef, onPointerDown: onDragStart, offset: dragOffset, moved: dragMoved } = useDraggable(shown, draggable && !fullScreen);
  // Radix reports WHAT closed the dialog (Escape / a press outside) before it
  // asks to close; remember it so onClose runs exactly once, with the reason.
  // (It used to run twice on a backdrop press — once as "backdropClick", then
  // again as "escapeKeyDown" — so a handler that commits ran twice and a
  // caller ignoring backdrop presses closed anyway.)
  const reasonRef = React.useRef<"backdropClick" | "escapeKeyDown">("escapeKeyDown");
  const contentStyle: React.CSSProperties = fullScreen
    ? { width: "100vw", height: "100vh", maxWidth: "100vw", maxHeight: "100vh", borderRadius: 0, top: 0, left: 0, transform: "none" }
    : {
        width: fullWidth ? "calc(100% - 48px)" : "auto",
        maxWidth: maxWidth ? MAXW[maxWidth] : undefined,
      };
  return (
    <RDialog.Root
      open={shown}
      onOpenChange={(o) => {
        if (o) return;
        const reason = reasonRef.current;
        reasonRef.current = "escapeKeyDown";
        onClose?.({}, reason);
      }}
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
          onEscapeKeyDown={(e) => {
            // An open combobox list owns Escape: it closes the list, not the
            // dialog (Radix listens before the field's own handler).
            const el = document.activeElement;
            const listOpen = el instanceof HTMLElement && el.getAttribute("role") === "combobox" && el.getAttribute("aria-expanded") === "true";
            if (disableEscapeKeyDown || listOpen) { e.preventDefault(); return; }
            reasonRef.current = "escapeKeyDown";
          }}
          onPointerDownOutside={() => { reasonRef.current = "backdropClick"; }}
          onCloseAutoFocus={returnFocus ? (e) => {
            e.preventDefault();
            const el = returnFocus();
            if (el?.isConnected) el.focus({ preventScroll: true });
          } : undefined}
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
  /** Renders the one close button every dialog shares, at the inline end. */
  onClose?: () => void;
}
export const DialogTitle = forwardRef<HTMLHeadingElement, DialogTitleProps>(function DialogTitle(
  { sx, style, className, children, onClose, ...rest },
  ref,
) {
  const draggable = React.useContext(DraggableDialog);
  return (
    <RDialog.Title ref={ref} data-drag-handle={draggable ? "" : undefined} className={cn("sh-dialog-title", className)} style={{ ...sxToStyle(sx), ...style }} {...rest}>
      {children}
      {onClose && (
        <IconButton className="sh-dialog-close" size="small" aria-label="סגירה" onClick={onClose}>
          <X size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      )}
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
        // Top only: DialogActions draws its own top border, so a bottom one
        // here doubled the line above the buttons.
        borderTop: dividers ? "1px solid var(--color-hairline)" : undefined,
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
    <p style={{ margin: 0, fontSize: "var(--text-body)", lineHeight: "var(--lh-body)", color: "var(--color-ink-muted-80)", ...sxToStyle(sx), ...style }} {...rest}>
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
