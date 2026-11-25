/**
 * The kit's tone vocabulary (src/styles/tokens.css holds the values). Each tone has
 *   ink   text, and a fill under white text: the AA-safe shade;
 *   mark  an icon, a dot, a bar: the plain status colour (amber is 3.2:1 on white — never text);
 *   bg    the tone's soft surface (a chip, a badge).
 * `sx`, Typography and Chip colour text with `ink`; icons, progress bars and dots use `mark`.
 */

export type Tone = "primary" | "secondary" | "success" | "warning" | "error" | "info";

export const TONE: Record<Tone, { ink: string; mark: string; bg: string }> = {
  primary: { ink: "var(--color-primary)", mark: "var(--color-primary)", bg: "var(--color-primary-soft)" },
  secondary: { ink: "var(--color-ink-muted-80)", mark: "var(--color-ink-muted-80)", bg: "var(--color-canvas-parchment)" },
  success: { ink: "var(--color-success-ink)", mark: "var(--color-status-approved)", bg: "var(--color-success-bg)" },
  warning: { ink: "var(--color-warning-ink)", mark: "var(--color-status-late)", bg: "var(--color-warning-bg)" },
  error: { ink: "var(--color-destructive)", mark: "var(--color-destructive)", bg: "var(--color-danger-bg)" },
  info: { ink: "var(--color-primary)", mark: "var(--color-primary)", bg: "var(--color-primary-soft)" },
};

/** Each tone's ink (or mark), by tone name and as its MUI-style `.main`. */
export function toneColors(use: "ink" | "mark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, t] of Object.entries(TONE)) {
    out[name] = t[use];
    out[`${name}.main`] = t[use];
  }
  return out;
}
