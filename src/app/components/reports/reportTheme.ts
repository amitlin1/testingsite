/**
 * Shared look for every printed document TESTINGSITE produces (תעודות, דוחות).
 * Colors are taken from the unit emblems (public/report-logos). Fonts are the
 * locally-bundled Rubik — the system is air-gapped, never load a web font here.
 * Design reference: docs/REPORT_TEMPLATE.md.
 */
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";

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
    passBg: "#E4ECF8",
    passFg: "#1B3F7A",
    failBg: "#FBE6E4",
    failFg: "#A1231D",
    neutralBg: "#EEF0F3",
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

export type ReportStatus = "pass" | "fail" | "pending" | "none";

export const STATUS_STYLE: Record<ReportStatus, { bg: string; fg: string }> = {
    pass: { bg: REPORT_COLORS.passBg, fg: REPORT_COLORS.passFg },
    fail: { bg: REPORT_COLORS.failBg, fg: REPORT_COLORS.failFg },
    pending: { bg: REPORT_COLORS.neutralBg, fg: REPORT_COLORS.muted },
    none: { bg: "transparent", fg: "#8A93A8" },
};

export function formatReportDate(d: Date | string | null | undefined, withTime = false): string {
    if (!d) return "—";
    const date = typeof d === "string" ? new Date(d) : d;
    if (Number.isNaN(date.getTime())) return "—";
    const day = date.toLocaleDateString("he-IL", { timeZone: DISPLAY_TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
    if (!withTime) return day;
    const time = date.toLocaleTimeString("he-IL", { timeZone: DISPLAY_TIMEZONE, hour: "2-digit", minute: "2-digit" });
    return `${day} · ${time}`;
}
