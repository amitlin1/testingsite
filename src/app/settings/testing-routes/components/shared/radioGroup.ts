import type * as React from "react";

/** The arrow keys of a radiogroup on the right-to-left screen: down and left go forward, up and right
 *  back; 0 for any other key, or with a modifier held (Alt + arrow is the browser's). */
export function radioArrowStep(e: React.KeyboardEvent): -1 | 0 | 1 {
  if (e.altKey || e.ctrlKey || e.metaKey) return 0;
  if (e.key === "ArrowDown" || e.key === "ArrowLeft") return 1;
  if (e.key === "ArrowUp" || e.key === "ArrowRight") return -1;
  return 0;
}

/** The item `step` places from index `i`, round the ring. */
export function ringStep<T>(items: readonly T[], i: number, step: number): T {
  return items[(((i + step) % items.length) + items.length) % items.length];
}
