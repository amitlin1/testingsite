"use client";
import React from "react";
import { Check, CircleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { RefImg } from "./stationKit";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, FOCUS, GREEN, GREEN_BG, HAIR, MUTED, fieldInput,
} from "@/app/components/packages/packageUi";

/**
 * Scanning a label against the reference items (/settings/reference-items),
 * shared by the package opening and closing wizards: the box label among the
 * package type's reference items, an item's label among its own type's.
 */

export type RefLookup = { hasRU: boolean; name: string | null; refWeight: number | null; imagesByType: Record<string, RefImg[]> };
export const NO_REF: RefLookup = { hasRU: false, name: null, refWeight: null, imagesByType: {} };

async function lookupReference(sku: string, itemTypeId: number): Promise<RefLookup> {
  const qs = new URLSearchParams({ sku, itemTypeId: String(itemTypeId) });
  const res = await apiFetch(`/api/testing/reference-lookup?${qs.toString()}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.hasRU) return NO_REF;
  return {
    hasRU: true,
    name: d.referenceItem?.name ?? null,
    refWeight: d.referenceWeight != null && d.referenceWeight !== "" ? Number(d.referenceWeight) : null,
    imagesByType: (d.imagesByType ?? {}) as Record<string, RefImg[]>,
  };
}

/** Looks a scanned SKU up among one item type's reference items while the
 *  worker types, settling 250 ms after the last keystroke. `ref` is the answer
 *  for exactly the current text; `checking` is true until it arrives, so a
 *  step never moves on with the answer for an older scan. */
export function useReferenceLookup(sku: string, itemTypeId: number | null | undefined, enabled: boolean) {
  const key = enabled && sku.trim() !== "" && itemTypeId != null ? `${itemTypeId}|${sku.trim()}` : "";
  const [res, setRes] = React.useState<{ key: string; ref: RefLookup } | null>(null);
  React.useEffect(() => {
    if (!key) return;
    const cut = key.indexOf("|");
    const typeId = Number(key.slice(0, cut));
    const text = key.slice(cut + 1);
    let live = true;
    const t = setTimeout(() => {
      lookupReference(text, typeId).catch(() => NO_REF).then((ref) => { if (live) setRes({ key, ref }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key]);
  const ref = key !== "" && res?.key === key ? res.ref : null;
  return { checking: key !== "" && ref == null, ref };
}

/**
 * The scan input, then what the lookup said about exactly the text in it:
 * green when a reference item was found, amber when not (the worker may still
 * go on), grey while it is being looked up.
 *
 * A scanner types the label and presses Enter at once, before the lookup has
 * answered; that Enter is remembered and `onSubmit` runs when the answer
 * arrives. Key the field by what is being scanned so a new box / item starts
 * clean.
 */
export function ScanField({ label, placeholder, value, onChange, lookup, found, missing, onSubmit }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  lookup: { checking: boolean; ref: RefLookup | null };
  found: (ref: RefLookup) => string; missing: string;
  onSubmit: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const submitRef = React.useRef(onSubmit);
  React.useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
  React.useEffect(() => {
    if (!pending || lookup.checking) return;
    setPending(false);
    submitRef.current();
  }, [pending, lookup.checking]);

  const ref = lookup.ref;
  const tone = ref == null ? "wait" : ref.hasRU ? "ok" : "warn";
  return (
    <div style={{ maxWidth: 420, marginTop: 20 }}>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 7 }}>{label}</div>
      <input value={value} onChange={(e) => { setPending(false); onChange(e.target.value); }} autoFocus placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") { if (lookup.checking) setPending(true); else onSubmit(); } }}
        style={{ ...fieldInput, height: 52, borderRadius: 11, fontSize: 17, fontVariantNumeric: "tabular-nums", letterSpacing: 1, borderColor: value.trim() === "" ? HAIR : FOCUS }} />
      {value.trim() !== "" && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, background: tone === "ok" ? GREEN_BG : tone === "warn" ? AMBER_BG : "#f5f5f7", border: `1px solid ${tone === "ok" ? "rgba(31,138,91,0.22)" : tone === "warn" ? AMBER_BORDER : HAIR}`, borderRadius: 11, padding: "12px 14px", marginTop: 12 }}>
          {tone !== "wait" && <span style={{ color: tone === "ok" ? GREEN : AMBER_INK, display: "inline-flex" }}>{tone === "ok" ? <Check size={18} strokeWidth={2} /> : <CircleAlert size={18} strokeWidth={2} />}</span>}
          <div style={{ fontSize: 14, fontWeight: 600, color: tone === "ok" ? GREEN : tone === "warn" ? AMBER_INK : MUTED }}>
            {ref == null ? "מחפש פריט ייחוס…" : ref.hasRU ? found(ref) : missing}
          </div>
        </div>
      )}
    </div>
  );
}
