"use client";
import React from "react";
import { Check, CircleAlert } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { RefImg } from "./stationKit";
import { gramsOf, type RefMember } from "./packageReference";
import {
  AMBER_BG, AMBER_BORDER, AMBER_INK, GREEN, GREEN_BG, HAIR, MUTED,
} from "@/app/components/packages/packageUi";

/**
 * Scanning a label against the reference items (/settings/reference-items),
 * shared by the package opening and closing wizards: the box label among the
 * package type's reference items, an item's label among its own type's.
 * A box label that finds a package reference also brings its members — the
 * reference item expected for each content line (packageReference.ts).
 */

export type RefLookup = {
  hasRU: boolean;
  referenceItemId: number | null;
  name: string | null;
  refWeight: number | null;
  imagesByType: Record<string, RefImg[]>;
  /** A package reference's members, one per content line (empty otherwise). */
  members: RefMember[];
};
export const NO_REF: RefLookup = { hasRU: false, referenceItemId: null, name: null, refWeight: null, imagesByType: {}, members: [] };

type LookupMember = { item_type_id?: unknown; referenceItem?: { manufacturer_sku?: unknown; name?: unknown } | null; referenceWeight?: unknown; imagesByType?: unknown };

async function lookupReference(sku: string, itemTypeId: number): Promise<RefLookup> {
  const qs = new URLSearchParams({ sku, itemTypeId: String(itemTypeId) });
  const res = await apiFetch(`/api/testing/reference-lookup?${qs.toString()}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.hasRU) return NO_REF;
  const members: LookupMember[] = Array.isArray(d.packageMembers) ? d.packageMembers : [];
  return {
    hasRU: true,
    referenceItemId: typeof d.referenceItem?.reference_item_id === "number" ? d.referenceItem.reference_item_id : null,
    name: d.referenceItem?.name ?? null,
    refWeight: gramsOf(d.referenceWeight),
    imagesByType: (d.imagesByType ?? {}) as Record<string, RefImg[]>,
    members: members.map((m) => ({
      itemTypeId: Number(m.item_type_id),
      sku: String(m.referenceItem?.manufacturer_sku ?? ""),
      name: typeof m.referenceItem?.name === "string" ? m.referenceItem.name : null,
      refWeight: gramsOf(m.referenceWeight),
      imagesByType: (m.imagesByType ?? {}) as Record<string, RefImg[]>,
    })),
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
 * Under a manufacturer-SKU field: the item's serial when it has one, and where
 * the SKU came from. A scan carries on from the station before — `prev`, the
 * SKU its reference item was found by — and changing it is flagged; the
 * worker may still go on. Where `prev` comes from elsewhere (the opening: the
 * package reference's member) `filledNote` says so, and `flagChange={false}`
 * leaves the change to a verdict that already says it.
 */
export function SkuPrefillNote({ value, prev, serial, filledNote = "הושלם מהסריקה בעמדה הקודמת", flagChange = true }: {
  value: string; prev?: string | null; serial?: string | null; filledNote?: string; flagChange?: boolean;
}) {
  const p = prev?.trim() ?? "";
  const s = serial?.trim() ?? "";
  const v = value.trim();
  const changed = flagChange && p !== "" && v !== "" && v !== p;
  if (!s && !p) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      {s && (
        <div style={{ fontSize: "var(--text-body-sm)", color: MUTED }}>
          מספר סריאלי: <bdi dir="ltr" style={{ fontWeight: 600, color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{s}</bdi>
        </div>
      )}
      {p && v === p && <div style={{ fontSize: "var(--text-small)", color: MUTED }}>{filledNote}</div>}
      {changed && (
        <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 9, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: "var(--r-md)", padding: "10px 14px" }}>
          <span aria-hidden style={{ color: AMBER_INK, display: "inline-flex", marginTop: 1 }}><CircleAlert size={18} strokeWidth={2} /></span>
          <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, color: AMBER_INK }}>
            המק״ט שונה ממק״ט פריט הייחוס שנסרק קודם (<bdi dir="ltr">{p}</bdi>).
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The scan input, then what the lookup said about exactly the text in it:
 * green when a reference item was found, amber when not (the worker may still
 * go on), grey while it is being looked up.
 *
 * A scanner types the label and presses Enter at once, before the lookup has
 * answered; that Enter is remembered and `onSubmit` runs when the answer
 * arrives. Key the field by what is being scanned so a new box / item starts
 * clean. `prev` / `serial` / `filledNote` / `flagChange` go to SkuPrefillNote, under it all.
 * `verdict`, when given, decides the answer's tone and words instead of
 * found / missing (an item checked against its package reference).
 */
export function ScanField({ label, placeholder, value, onChange, lookup, found, missing, verdict, onSubmit, prev, serial, filledNote, flagChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  lookup: { checking: boolean; ref: RefLookup | null };
  found: (ref: RefLookup) => string; missing: string;
  verdict?: (ref: RefLookup) => { tone: "ok" | "warn"; text: string };
  onSubmit: () => void;
  prev?: string | null; serial?: string | null; filledNote?: string; flagChange?: boolean;
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
  const said = ref == null ? null : verdict ? verdict(ref) : { tone: ref.hasRU ? "ok" as const : "warn" as const, text: ref.hasRU ? found(ref) : missing };
  const tone = said == null ? "wait" : said.tone;
  const fieldId = React.useId();
  return (
    <div style={{ maxWidth: 420, marginTop: 20 }}>
      <label htmlFor={fieldId} style={{ display: "block", fontSize: "var(--text-small)", color: MUTED, marginBottom: 7 }}>{label}</label>
      {/* A code: LTR, kept at the reading edge (testing.css .tst-ref-scan). The
          edge follows focus (.sh-input ring), not whether the field has text. */}
      <input id={fieldId} className="sh-input tst-ref-scan" dir="ltr" value={value} onChange={(e) => { setPending(false); onChange(e.target.value); }} autoFocus placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") { if (lookup.checking) setPending(true); else onSubmit(); } }} />
      {/* The lookup's answer for exactly this text, announced as it arrives. */}
      <div role="status" aria-live="polite">
        {value.trim() !== "" && (
          <div style={{ display: "flex", alignItems: "center", gap: 9, background: tone === "ok" ? GREEN_BG : tone === "warn" ? AMBER_BG : "var(--color-canvas-parchment)", border: `1px solid ${tone === "ok" ? "color-mix(in srgb, var(--color-status-approved) 22%, transparent)" : tone === "warn" ? AMBER_BORDER : HAIR}`, borderRadius: "var(--r-md)", padding: "12px 14px", marginTop: 12 }}>
            {tone !== "wait" && <span aria-hidden style={{ color: tone === "ok" ? GREEN : AMBER_INK, display: "inline-flex" }}>{tone === "ok" ? <Check size={18} strokeWidth={2} /> : <CircleAlert size={18} strokeWidth={2} />}</span>}
            <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 600, color: tone === "ok" ? GREEN : tone === "warn" ? AMBER_INK : MUTED }}>
              {said == null ? "מחפש פריט ייחוס…" : said.text}
            </div>
          </div>
        )}
      </div>
      <SkuPrefillNote value={value} prev={prev} serial={serial} filledNote={filledNote} flagChange={flagChange} />
    </div>
  );
}
