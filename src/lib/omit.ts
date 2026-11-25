/**
 * A copy of `obj` without `keys`. For dropping fields on purpose — a component's props it accepts
 * but does not act on, so they never reach the DOM element the rest is
 * spread on; or a record's fields that must not travel on (an answer's internal flag, a row's key
 * before a comparison) — without binding each one to a variable nobody reads.
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}
