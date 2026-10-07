"use client";
import React from "react";

/** Elements inside a handle that keep their own pointer behaviour. */
const INTERACTIVE = "button, a, input, textarea, select, label, [role='button'], [role='combobox'], [contenteditable='true'], [data-no-drag]";
/** Below this width dialogs fill the screen; nothing to drag. */
const MIN_WIDTH = 600;
/** How much of the dialog must stay on screen sideways / below the top edge. */
const KEEP_X = 120;
const KEEP_Y = 60;

/**
 * Lets a popup be moved with the mouse (or a finger) by its header.
 *
 *   const { ref, onPointerDown, style } = useDraggable(open);
 *   <div ref={ref} onPointerDown={onPointerDown} style={{ ...panelStyle, ...style }}>
 *     <header data-drag-handle>…</header>
 *
 * A drag starts only on an element inside `[data-drag-handle]`, and never on
 * a control within it (the close button, a search field). The popup stays
 * reachable: its top never leaves the screen and a strip of it stays inside
 * the sides. Every opening, and every window resize, puts it back in the
 * middle.
 *
 * Destructure the result: the React Compiler lint treats every field of an
 * object that holds a ref as a ref.
 *
 * `style` is a plain translate for a popup centred by its own layout (a flex
 * overlay). A popup centred by a transform of its own (the shared Dialog)
 * composes `offset` into that transform instead.
 */
export function useDraggable<T extends HTMLElement = HTMLDivElement>(open = true, enabled = true) {
  const ref = React.useRef<T>(null);
  const [offset, setOffsetState] = React.useState({ x: 0, y: 0 });
  // Read by the pointer handlers, which outlive the render that made them.
  const offsetRef = React.useRef(offset);
  const setOffset = React.useCallback((o: { x: number; y: number }) => { offsetRef.current = o; setOffsetState(o); }, []);

  React.useEffect(() => {
    if (open) setOffset({ x: 0, y: 0 });
  }, [open, setOffset]);

  React.useEffect(() => {
    const reset = () => setOffset({ x: 0, y: 0 });
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, [setOffset]);

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    // defaultPrevented: a popup nested inside this one already took the drag.
    if (!enabled || e.defaultPrevented || e.button !== 0 || window.innerWidth < MIN_WIDTH) return;
    const target = e.target as HTMLElement;
    const handle = target.closest("[data-drag-handle]");
    const el = ref.current;
    if (!el || !handle || !el.contains(handle) || target.closest(INTERACTIVE)) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
    const move = (ev: PointerEvent) => {
      const dx = Math.min(Math.max(ev.clientX - start.x, KEEP_X - rect.right), window.innerWidth - KEEP_X - rect.left);
      const dy = Math.min(Math.max(ev.clientY - start.y, -rect.top), window.innerHeight - KEEP_Y - rect.top);
      setOffset({ x: start.ox + dx, y: start.oy + dy });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      // A drag released over the backdrop ends in a click on the backdrop, and
      // most overlays close on that. Swallow the one click a real drag makes.
      if (ev.type === "pointerup" && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 3) {
        const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [enabled, setOffset]);

  const moved = offset.x !== 0 || offset.y !== 0;
  const style: React.CSSProperties = moved ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {};
  return { ref, offset, moved, onPointerDown, style };
}
