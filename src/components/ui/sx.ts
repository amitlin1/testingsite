import type { CSSProperties } from "react";

/**
 * Minimal MUI-`sx`-compatible → React inline-style translator, backed by
 * Shifthouse tokens. This is the adapter that lets us swap MUI imports for
 * ui/ components with little churn: the used subset of `sx` keeps working.
 *
 * Not a full clone of MUI's system. It covers the property surface this app
 * actually uses. Nested selectors (`&:hover`, `& .foo`, `@media`) cannot be
 * expressed as inline styles and are dropped — handle those per component or
 * per screen when migrating.
 */

export type SxInput = Record<string, unknown> | undefined | false | null;

const SPACE = 8; // MUI spacing unit (this app's theme uses the default 8px)

// MUI theme color paths → Shifthouse token vars.
const COLOR_TOKENS: Record<string, string> = {
  primary: "var(--color-primary)",
  "primary.main": "var(--color-primary)",
  "primary.dark": "var(--color-primary-hover)",
  "primary.light": "var(--color-primary-focus)",
  secondary: "var(--color-ink-muted-80)",
  "secondary.main": "var(--color-ink-muted-80)",
  error: "var(--color-destructive)",
  "error.main": "var(--color-destructive)",
  success: "var(--color-status-approved)",
  "success.main": "var(--color-status-approved)",
  warning: "var(--color-status-late)",
  "warning.main": "var(--color-status-late)",
  info: "var(--color-primary)",
  "info.main": "var(--color-primary)",
  "text.primary": "var(--color-ink)",
  "text.secondary": "var(--color-ink-muted-48)",
  "text.disabled": "var(--color-ink-muted-48)",
  divider: "var(--color-hairline)",
  "background.paper": "var(--color-canvas)",
  "background.default": "var(--color-canvas-parchment)",
  "common.white": "#ffffff",
  "common.black": "#000000",
};

export function resolveColor(v: unknown): unknown {
  if (typeof v === "string" && COLOR_TOKENS[v]) return COLOR_TOKENS[v];
  return v;
}

// Numeric values that must stay unitless.
const UNITLESS = new Set([
  "fontWeight", "lineHeight", "opacity", "zIndex", "flex", "flexGrow",
  "flexShrink", "order", "aspectRatio", "flexOrder", "columnCount", "fontVariationSettings",
]);

// Spacing-scaled props (number × 8px). Directional ones map to logical CSS
// so they auto-flip under dir="rtl" — matching MUI's rtl behaviour.
const SPACING_MAP: Record<string, string | string[]> = {
  m: "margin", margin: "margin",
  mt: "marginTop", marginTop: "marginTop",
  mb: "marginBottom", marginBottom: "marginBottom",
  ml: "marginInlineStart", mr: "marginInlineEnd",
  mx: "marginInline", my: "marginBlock",
  marginX: "marginInline", marginY: "marginBlock",
  p: "padding", padding: "padding",
  pt: "paddingTop", paddingTop: "paddingTop",
  pb: "paddingBottom", paddingBottom: "paddingBottom",
  pl: "paddingInlineStart", pr: "paddingInlineEnd",
  px: "paddingInline", py: "paddingBlock",
  paddingX: "paddingInline", paddingY: "paddingBlock",
  gap: "gap", rowGap: "rowGap", columnGap: "columnGap",
  marginInlineStart: "marginInlineStart", marginInlineEnd: "marginInlineEnd",
  paddingInlineStart: "paddingInlineStart", paddingInlineEnd: "paddingInlineEnd",
};

const COLOR_PROPS = new Set([
  "color", "backgroundColor", "bgcolor", "borderColor", "caretColor",
  "outlineColor", "fill", "stroke", "borderTopColor", "borderBottomColor",
  "borderLeftColor", "borderRightColor",
]);

function scaledSpace(v: unknown): string | number {
  if (typeof v === "number") return v * SPACE + "px";
  return v as string | number;
}

function borderValue(v: unknown): unknown {
  if (typeof v === "number") return v === 0 ? "none" : `${v}px solid var(--color-hairline)`;
  return v;
}

function numberToUnit(key: string, v: number): string | number {
  if (UNITLESS.has(key)) return v;
  if (key === "borderRadius") return v * SPACE + "px"; // MUI shape.borderRadius = 8
  return v + "px";
}

/** Translate one MUI `sx` object into a flat React style object. */
function translateOne(sx: Record<string, unknown>): CSSProperties {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(sx)) {
    if (raw == null) continue;
    // Selectors / media / nested objects can't be inline styles — skip.
    if (key.startsWith("&") || key.startsWith("@") || key.startsWith(":") ||
        (typeof raw === "object" && !Array.isArray(raw))) {
      continue;
    }
    // Responsive array values → take the last (largest breakpoint) entry.
    let value: unknown = Array.isArray(raw) ? raw[raw.length - 1] : raw;

    if (key in SPACING_MAP) {
      out[SPACING_MAP[key] as string] = scaledSpace(value);
      continue;
    }
    if (key === "bgcolor") { out.backgroundColor = resolveColor(value); continue; }
    if (COLOR_PROPS.has(key)) { out[key] = resolveColor(value); continue; }
    if (key === "border") { out.border = borderValue(value); continue; }
    if (typeof value === "number") { out[key] = numberToUnit(key, value); continue; }
    out[key] = value;
  }
  return out as CSSProperties;
}

/** Merge one or more `sx` inputs into a single style object. */
export function sxToStyle(...inputs: SxInput[]): CSSProperties {
  let acc: CSSProperties = {};
  for (const input of inputs) {
    if (!input) continue;
    acc = { ...acc, ...translateOne(input as Record<string, unknown>) };
  }
  return acc;
}

// MUI "system" props usable directly on Box (e.g. <Box display="flex" gap={1}>).
const LAYOUT_PROPS = new Set([
  "display", "flexDirection", "alignItems", "alignContent", "alignSelf",
  "justifyContent", "justifyItems", "justifySelf", "flexWrap", "flex",
  "flexGrow", "flexShrink", "flexBasis", "order", "width", "height",
  "minWidth", "maxWidth", "minHeight", "maxHeight", "position", "top",
  "bottom", "overflow", "overflowX", "overflowY", "textAlign", "boxShadow",
  "fontWeight", "fontSize", "fontFamily", "fontStyle", "lineHeight",
  "letterSpacing", "borderRadius", "boxSizing", "whiteSpace", "textOverflow",
  "cursor", "zIndex", "gridTemplateColumns", "gridTemplateRows", "gridColumn",
  "gridRow", "gridGap", "gridAutoFlow", "opacity", "visibility", "inset",
]);

const SYSTEM_PROP_KEYS = new Set<string>([
  ...Object.keys(SPACING_MAP), ...COLOR_PROPS, ...LAYOUT_PROPS, "border", "bgcolor",
]);

type SpaceVal = number | string;
/** MUI system props usable directly on Box/Stack (typed, no `any` index sig). */
export interface SystemProps {
  m?: SpaceVal; mt?: SpaceVal; mb?: SpaceVal; ml?: SpaceVal; mr?: SpaceVal; mx?: SpaceVal; my?: SpaceVal;
  p?: SpaceVal; pt?: SpaceVal; pb?: SpaceVal; pl?: SpaceVal; pr?: SpaceVal; px?: SpaceVal; py?: SpaceVal;
  gap?: SpaceVal; rowGap?: SpaceVal; columnGap?: SpaceVal;
  display?: CSSProperties["display"];
  flexDirection?: CSSProperties["flexDirection"];
  alignItems?: CSSProperties["alignItems"];
  alignContent?: CSSProperties["alignContent"];
  alignSelf?: CSSProperties["alignSelf"];
  justifyContent?: CSSProperties["justifyContent"];
  flexWrap?: CSSProperties["flexWrap"];
  flex?: CSSProperties["flex"];
  flexGrow?: CSSProperties["flexGrow"];
  flexShrink?: CSSProperties["flexShrink"];
  width?: SpaceVal; height?: SpaceVal;
  minWidth?: SpaceVal; maxWidth?: SpaceVal; minHeight?: SpaceVal; maxHeight?: SpaceVal;
  position?: CSSProperties["position"];
  top?: SpaceVal; bottom?: SpaceVal;
  overflow?: CSSProperties["overflow"]; overflowX?: CSSProperties["overflowX"]; overflowY?: CSSProperties["overflowY"];
  textAlign?: CSSProperties["textAlign"];
  boxShadow?: CSSProperties["boxShadow"];
  fontWeight?: CSSProperties["fontWeight"];
  fontSize?: SpaceVal;
  fontFamily?: CSSProperties["fontFamily"];
  lineHeight?: CSSProperties["lineHeight"];
  letterSpacing?: SpaceVal;
  borderRadius?: SpaceVal;
  border?: SpaceVal;
  borderColor?: string;
  bgcolor?: string;
  whiteSpace?: CSSProperties["whiteSpace"];
  cursor?: CSSProperties["cursor"];
  zIndex?: CSSProperties["zIndex"];
  opacity?: CSSProperties["opacity"];
}

/**
 * Split a props bag into a translated style object (from MUI system props +
 * sx) and the remaining props to spread onto the DOM element.
 */
export function splitSystemProps<T extends Record<string, unknown>>(
  props: T,
): { style: CSSProperties; rest: Record<string, unknown> } {
  const systemObj: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  let sx: SxInput;
  let styleProp: CSSProperties | undefined;
  for (const [k, v] of Object.entries(props)) {
    if (k === "sx") sx = v as SxInput;
    else if (k === "style") styleProp = v as CSSProperties;
    else if (SYSTEM_PROP_KEYS.has(k)) systemObj[k] = v;
    else rest[k] = v;
  }
  return { style: { ...sxToStyle(systemObj, sx), ...styleProp }, rest };
}
