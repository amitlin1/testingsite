"use client";
import * as React from "react";

/**
 * Reordering a list by HTML5 drag and drop (spec §5.16; no DnD library — spec §11.10): the item
 * dragged, and where a drop on the item under the pointer would land — before or after it, by the
 * half of the item the pointer is in. The caller starts the drag from its own handle (start) and
 * spreads targetProps on every item.
 */

export type ReorderDrop<K> = { from: K; to: K; after: boolean };

/** In the lower half of the item: a drop lands after it. */
const isAfter = (e: React.DragEvent<HTMLElement>) => {
  const box = e.currentTarget.getBoundingClientRect();
  return e.clientY > box.top + box.height / 2;
};

export function useReorderDrag<K extends string | number>(onDrop: (drop: ReorderDrop<K>) => void) {
  const [drag, setDrag] = React.useState<{ from: K; over: K | null; after: boolean } | null>(null);
  const end = React.useCallback(() => setDrag(null), []);

  return {
    /** A drag is under way. */
    active: drag != null,
    /** The drag started from `from`'s handle. */
    start: (from: K) => setDrag({ from, over: null, after: false }),
    end,
    dragging: (key: K) => drag?.from === key,
    /** Where a drop on `key` lands, while the pointer is over another item than the one dragged. */
    dropAt: (key: K): "before" | "after" | null => (drag && drag.over === key && drag.from !== key ? (drag.after ? "after" : "before") : null),
    targetProps: (key: K) => ({
      // Cancelling dragenter makes the item the drop target wherever the pointer enters it (HTML drag
      // and drop): without it a drop that ends on one of its buttons falls through to the page and
      // nothing moves.
      onDragEnter: (e: React.DragEvent<HTMLElement>) => {
        if (drag) e.preventDefault();
      },
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const after = isAfter(e);
        if (drag.over !== key || drag.after !== after) setDrag({ ...drag, over: key, after });
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        const to = e.relatedTarget as Node | null;
        if (to && e.currentTarget.contains(to)) return;
        setDrag((d) => (d && d.over === key ? { ...d, over: null } : d));
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        if (!drag) return;
        e.preventDefault();
        if (drag.from !== key) onDrop({ from: drag.from, to: key, after: isAfter(e) });
        end();
      },
    }),
  };
}
