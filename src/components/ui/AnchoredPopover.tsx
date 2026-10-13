"use client";
import React from "react";
import * as RPopover from "@radix-ui/react-popover";

/* =============================================================================
   AnchoredPopover — a floating panel placed against an element. A thin wrapper
   over @radix-ui/react-popover (route-fields spec §5.3): the `Popover` in
   Misc.tsx is a bare portal with no focus handling and no Escape, so anything
   a person types into, or that opens inside a popup dialog, uses this one.

   - Placed on `side` of the anchor (below by default) and flipped to the other
     side when there is no room; kept `collisionPadding` px inside the viewport.
   - role="dialog" (name it with aria-label / aria-labelledby). Focus moves in
     when it opens — `onOpenAutoFocus` may preventDefault and focus something
     else — and Tab cycles inside it while it is open.
   - Escape closes it and only it: the key stops here, so a dialog around it
     stays open. A press or focus outside closes it too (`onInteractOutside`
     sees that first). Non-modal: the page around it is not hidden or blocked.
   - It sits on the Autocomplete list's layer (z-index 1450, ui/Autocomplete),
     above every popup dialog (1300), and works inside a modal ui/Dialog (the
     dialog stands aside for it: focus trap, outside clicks, Escape).

   `trigger` is wired as the Radix trigger: a click toggles the popover, and
   aria-haspopup="dialog", aria-expanded and aria-controls are set on it. It
   must be one element that takes a ref (a <button>). `anchorRef` places the
   popover against another element instead (a field, a row). Pass at least one.
   ========================================================================== */

type ContentProps = React.ComponentPropsWithoutRef<typeof RPopover.Content>;
type VirtualRef = NonNullable<React.ComponentPropsWithoutRef<typeof RPopover.Anchor>["virtualRef"]>;

/** The Autocomplete list's layer: above the dialogs (ui.css, 1300). */
const LAYER = 1450;

export interface AnchoredPopoverProps
  extends Pick<
    ContentProps,
    | "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding"
    | "className" | "style" | "aria-label" | "aria-labelledby"
    | "onOpenAutoFocus" | "onCloseAutoFocus" | "onEscapeKeyDown" | "onInteractOutside"
  > {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opens it (see above). */
  trigger?: React.ReactElement;
  /** The element it is placed against, when that is not the trigger. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export function AnchoredPopover({
  open, onOpenChange, trigger, anchorRef, children,
  side = "bottom", align = "start", sideOffset = 6, collisionPadding = 8,
  style, onEscapeKeyDown, ...content
}: AnchoredPopoverProps) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>}
      {anchorRef && <RPopover.Anchor virtualRef={anchorRef as VirtualRef} />}
      <RPopover.Portal>
        <RPopover.Content
          {...content}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          // Radix copies the content's z-index onto its positioned wrapper.
          style={{ zIndex: LAYER, ...style }}
          onEscapeKeyDown={(e) => {
            // Only the popover closes; nothing under it (a dialog, a station shell) sees the key.
            e.stopPropagation();
            onEscapeKeyDown?.(e);
          }}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
