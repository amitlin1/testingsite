/**
 * The look of the shipment documents (תעודות) — not of the item reports, which
 * print with lib/item-report/pdf-styles.
 * Colors are taken from the unit emblems (public/report-logos). Fonts are the
 * locally-bundled Rubik — the system is air-gapped, never load a web font here.
 * Design reference: docs/features/REPORT_TEMPLATE.md.
 */

export const REPORT_COLORS = {
    navy: "#1B2F6B",      // titles, table header, section marks
    red: "#C8302A",       // operational badge, emblem strip
    yellow: "#E9D93A",    // emblem strip only
    sky: "#2F8FC6",       // emblem strip only
    ink: "#141826",       // body text
    muted: "#4A5266",     // labels, footer
    label: "#2A3350",     // field-label text
    labelBg: "#EEF1F7",   // field-label / totals background
    border: "#C9D0DE",    // frames
    rowLine: "#DDE2EC",   // table row separators
    zebra: "#F6F8FB",     // odd table rows
} as const;

export const REPORT_FONT = `var(--font-rubik), "Rubik", "Arial", sans-serif`;
export const REPORT_MONO = `ui-monospace, "Cascadia Mono", "Consolas", "Courier New", monospace`;

/** Emblems in header order (RTL: the first pair sits on the right). */
export const REPORT_LOGOS = {
    right: ["/report-logos/emblem-red.png", "/report-logos/emblem-navy.png"],
    left: ["/report-logos/emblem-atom.jpg", "/report-logos/emblem-chain.png"],
} as const;

/** Unit line printed above every title. Empty string hides it. */
export const REPORT_ORG_NAME = "";

/** Classification marking printed top and bottom. Empty string hides it. */
export const REPORT_CLASSIFICATION = "";
