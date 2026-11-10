// Pure helpers for inspecting a report template (Puck Data). No rendering
// deps — safe to import anywhere (API routes, the history page, the editor).

import type { Data } from "@measured/puck";
import { CLOSING_SIGNATURE_BIND, FINAL_SIGNATURE_BIND } from "./types";

type PuckNodeLike = { type?: string; props?: Record<string, unknown> };

export function isTemplate(t: unknown): t is Data {
  return !!t && typeof t === "object" && Array.isArray((t as Data).content);
}

export function templateHasContent(t: unknown): boolean {
  return isTemplate(t) && t.content.length > 0;
}

function walk(node: unknown, visit: (n: PuckNodeLike) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as PuckNodeLike;
  visit(obj);
  for (const v of Object.values(obj.props ?? {})) {
    if (Array.isArray(v)) walk(v, visit);
  }
}

/** The template has a Signature block bound to `bind` that prints a drawn signature. */
function requiresSignature(t: unknown, bind: string): boolean {
  if (!isTemplate(t)) return false;
  let found = false;
  walk(t.content, (n) => {
    if (n.type !== "Signature" || n.props?.bind !== bind) return;
    const cells = n.props?.cells;
    // A block with no cells renders a signature cell (back-compat default).
    if (!Array.isArray(cells) || cells.length === 0) found = true;
    else if (cells.some((c) => (c as { kind?: string })?.kind === "signature")) found = true;
  });
  return found;
}

/** The template asks for the approver's final hand-drawn signature — the finished report stays a
 *  draft until it is given, and it locks the report. */
export function requiresFinalSignature(t: unknown): boolean {
  return requiresSignature(t, FINAL_SIGNATURE_BIND);
}

/** The template asks for a hand-drawn signature at the kit's closing (given with the closing
 *  result, before "סגור מארז"). It never holds the report back: a route that finishes elsewhere
 *  freezes with the spot blank. */
export function requiresClosingSignature(t: unknown): boolean {
  return requiresSignature(t, CLOSING_SIGNATURE_BIND);
}

/** The template prints photos (a Photos block, or StepDetails with its photos) — only then are
 *  they fetched. */
export function templateUsesPhotos(t: unknown): boolean {
  if (!isTemplate(t)) return false;
  let found = false;
  walk(t.content, (n) => {
    if (n.type === "Photos" || (n.type === "StepDetails" && n.props?.showPhotos !== false)) found = true;
  });
  return found;
}

/** Uploaded logo object keys referenced by the header (bundled emblems — paths
 *  starting with "/" — are not object keys). */
export function collectLogoKeys(t: unknown): string[] {
  if (!isTemplate(t)) return [];
  const props = ((t.root as { props?: { header?: Record<string, unknown> } } | undefined)?.props?.header ?? {}) as Record<string, unknown>;
  const keys = new Set<string>();
  for (const [k, val] of Object.entries(props)) {
    if (/logo$/i.test(k) && typeof val === "string" && val && !val.startsWith("/")) keys.add(val);
  }
  return [...keys];
}
