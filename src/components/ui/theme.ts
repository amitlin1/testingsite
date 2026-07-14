"use client";
import { useEffect, useState } from "react";

/**
 * Compatibility theme object mirroring the old muiTheme shape (palette +
 * tokens + typography), but plain — no MUI. Values are RAW hex so alpha()
 * and other JS colour math keep working. Consumed via useTheme().
 */
export const tokens = {
  accent: "#0066cc",
  accentHover: "#0058b3",
  focusRing: "#0071e3",
  ink: "#1d1d1f",
  muted: "#7a7a7a",
  mutedSoft: "#9a9aa0",
  fieldLabel: "#555555",
  surface: { page: "#f5f5f7", card: "#ffffff", subtle: "#fafafc", rowHover: "#fafafc", selected: "#f3f8ff" },
  hairline: "#e0e0e0",
  status: { active: "#0066cc", pending: "#d97706", done: "#1f8a5b", destructive: "#bf3535" },
  radius: { field: 8, card: 14, pill: 9999 },
  shadow: {
    modal: "rgba(0,0,0,0.22) 3px 5px 30px",
    panel: "rgba(0,0,0,0.16) 0 12px 38px",
    card: "rgba(0,0,0,0.05) 0 1px 2px",
  },
} as const;

export interface Theme {
  direction: string;
  tokens: typeof tokens;
  palette: {
    mode: string;
    primary: { main: string; dark: string; light: string; contrastText: string };
    secondary: { main: string };
    success: { main: string };
    warning: { main: string };
    error: { main: string };
    info: { main: string };
    background: { default: string; paper: string };
    text: { primary: string; secondary: string; disabled: string };
    divider: string;
    grey: Record<number, string>;
    action: Record<string, string>;
    common: { black: string; white: string };
    [key: string]: unknown;
  };
  typography: { fontFamily: string; [key: string]: unknown };
  shape: { borderRadius: number };
  spacing: (n: number) => string;
  breakpoints: { up: (k?: unknown) => string; down: (k?: unknown) => string; between: (a?: unknown, b?: unknown) => string; only: (k?: unknown) => string };
  [key: string]: unknown;
}

export const theme: Theme = {
  direction: "rtl",
  tokens,
  palette: {
    mode: "light",
    primary: { main: "#0066cc", dark: "#0058b3", light: "#0071e3", contrastText: "#ffffff" },
    secondary: { main: "#455A64" },
    success: { main: "#1f8a5b" },
    warning: { main: "#d97706" },
    error: { main: "#bf3535" },
    info: { main: "#0066cc" },
    background: { default: "#f5f5f7", paper: "#ffffff" },
    text: { primary: "#1d1d1f", secondary: "#7a7a7a", disabled: "#9a9aa0" },
    divider: "#e0e0e0",
    grey: { 50: "#fafafa", 100: "#f5f5f5", 200: "#eeeeee", 300: "#e0e0e0", 400: "#bdbdbd", 500: "#9e9e9e", 600: "#757575", 700: "#616161", 800: "#424242", 900: "#212121" },
    action: { active: "rgba(0,0,0,0.54)", hover: "rgba(0,0,0,0.04)", selected: "rgba(0,0,0,0.08)", disabled: "rgba(0,0,0,0.26)", disabledBackground: "rgba(0,0,0,0.12)", focus: "rgba(0,0,0,0.12)" },
    common: { black: "#000000", white: "#ffffff" },
  },
  typography: { fontFamily: `var(--font-rubik), "Heebo", "Inter", "Segoe UI", "Arial", sans-serif` },
  shape: { borderRadius: 8 },
  spacing: (n: number) => `${n * 8}px`,
  breakpoints: { up: () => "", down: () => "", between: () => "", only: () => "" },
};

export function useTheme(): Theme {
  return theme;
}

/** SSR-safe useMediaQuery. Theme-function queries resolve to false (desktop). */
export function useMediaQuery(query?: string | ((t: Theme) => string)): boolean {
  const q = typeof query === "function" ? "" : query ?? "";
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (!q || typeof window === "undefined" || !window.matchMedia) return;
    const mm = window.matchMedia(q);
    setMatches(mm.matches);
    const handler = () => setMatches(mm.matches);
    mm.addEventListener("change", handler);
    return () => mm.removeEventListener("change", handler);
  }, [q]);
  return matches;
}

/** MUI colour helper: alpha("#0066cc", 0.1) → "rgba(0,102,204,0.1)". */
export function alpha(color: string, value: number): string {
  const c = (color || "").trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${value})`;
  }
  const rgbMatch = c.match(/^rgba?\(([^)]+)\)/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((s) => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${value})`;
  }
  return c;
}
