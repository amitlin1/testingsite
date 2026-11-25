import { TONE } from "./tones";

/**
 * Design-token colours by name, for inline styles (src/styles/tokens.css
 * holds the values; the status colours are the tones' ink / mark / bg, tones.ts).
 * Text uses the *_INK / INK names; AMBER and GREY are for dots and fills only
 * (amber is 3.2:1 on white, the grey 1.4:1 — not text).
 */

export const BLUE = TONE.primary.ink;
export const BLUE_SOFT = TONE.primary.bg;
export const INK = "var(--color-ink)";
export const INK_2 = "var(--color-ink-muted-70)";
export const MUTED = "var(--color-ink-muted-48)";
export const HAIR = "var(--color-hairline)";
export const HAIR_2 = "var(--color-divider-soft)";
export const PARCHMENT = "var(--color-canvas-parchment)";
export const AMBER = TONE.warning.mark;
export const AMBER_INK = TONE.warning.ink;
export const AMBER_BG = TONE.warning.bg;
export const AMBER_BORDER = "var(--color-warning-border)";
export const GREEN = TONE.success.ink;
export const GREEN_BG = TONE.success.bg;
export const RED = TONE.error.ink;
export const RED_BG = TONE.error.bg;
export const GREY = "var(--color-border-strong)";
