/** Join truthy class names. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Pick the effective value from a MUI responsive prop ({xs,sm,md,...} or array). */
export function lastResponsive<T>(v: T | Record<string, T> | T[]): T {
  if (Array.isArray(v)) return v[v.length - 1];
  if (v && typeof v === "object") {
    const vals = Object.values(v as Record<string, T>);
    return vals[vals.length - 1];
  }
  return v as T;
}
