"use client";
import React from "react";
import { Play } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import PackageIdText from "@/app/components/packages/PackageIdText";
import { AMBER, BLUE, GREEN, GREY, HAIR, HAIR_2, INK, INK_2, MUTED, seq2 } from "@/app/components/packages/packageUi";
import "@/app/packages/packages.css";

/**
 * A box in a package-level station's queue — design/Testing Screen
 * Packages.dc.html (pkgCards): type, id, customer + shipment, wait, the
 * item mini-strip with "N פריטים בתכולה" / "N/M הגיעו לסגירה", an in-card
 * items list, and the 44px start button.
 */

/** The page's live "HH:MM:SS" → the artboard's wait label: "12 דק׳" under an
 *  hour, "1:24 שע׳" after. A box waits minutes to hours; a seconds counter
 *  ticking on every card is noise. Anything else is shown as given. */
function waitLabel(elapsed: string): string {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(elapsed);
  if (!m) return elapsed;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 0 ? `${h}:${String(min).padStart(2, "0")} שע׳` : `${min} דק׳`;
}

export default function PackageQueueCard({
  pkg, kind, wait, inTest, onStart, disabled,
}: {
  pkg: PackageView;
  kind: "open" | "close";
  /** Live elapsed time from the page's timer ("HH:MM:SS"), shown in minutes ("12 דק׳"). */
  wait: string;
  /** The box is already in test at this station: the button continues the wizard. */
  inTest: boolean;
  onStart: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const arrived = pkg.items.filter((it) => it.arrived_at_closing).length;
  const mini = pkg.items.map((it) => ({
    color: kind === "open" ? GREY : it.arrived_at_closing ? GREEN : it.state === "done" ? GREEN : AMBER,
    title: `${seq2(it.package_seq)} · ${it.item_type_desc} · ${kind === "open" ? "טרם נפתח" : it.arrived_at_closing ? "הגיע לסגירה" : `לא הגיע · ${it.station_name ?? "—"}`}`,
  }));
  const itemNote = kind === "open" ? `${pkg.items.length} פריטים בתכולה` : `${arrived}/${pkg.items.length} הגיעו לסגירה`;
  const cta = inTest ? (kind === "open" ? "המשך פתיחת מארז" : "המשך סגירת מארז") : kind === "open" ? "התחל פתיחת מארז" : "התחל סגירת מארז";

  return (
    <div style={{ background: "var(--color-canvas)", border: `1px solid ${inTest ? BLUE : HAIR}`, borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13, color: INK }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{pkg.item_type_desc}</div>
          <div style={{ marginTop: 4 }}><PackageIdText id={pkg.item_id} size={19} headColor={INK} letterSpacing=".3px" /></div>
          <div style={{ fontSize: 13, color: INK_2, marginTop: 6 }}>{pkg.customer_name ?? pkg.customer_code ?? "—"} · משלוח {pkg.shipment_code ?? "—"}</div>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: inTest ? BLUE : INK }}>{wait ? waitLabel(wait) : "—"}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{inTest ? "בבדיקה" : "בתור"}</div>
        </div>
      </div>
      <div style={{ height: 1, background: HAIR_2 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* Colour alone says nothing to a screen reader: the strip is one image named by every item's line. */}
        <div role="img" aria-label={mini.map((m) => m.title).join("; ")} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {mini.map((m, i) => <span key={i} title={m.title} style={{ width: 22, height: 9, borderRadius: 3, background: m.color }} />)}
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{itemNote}</div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={open ? listId : undefined}
          className="pkg-link pkg-link--hit" style={{ marginInlineStart: "auto", fontSize: 12.5 }}>
          {open ? "סגור" : "פריטים במארז"}
        </button>
      </div>
      {open && (
        <div id={listId} style={{ border: `1px solid ${HAIR}`, borderRadius: 12, overflow: "hidden" }}>
          {pkg.items.map((it) => (
            <div key={it.item_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${HAIR_2}` }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--color-canvas-parchment)", color: MUTED, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{seq2(it.package_seq)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.item_type_desc}</div>
                <div style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{it.makat ?? "—"} · {it.serial_no ?? "ללא סריאלי"}</div>
              </div>
              <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>{kind === "open" ? "טרם נפתח" : it.arrived_at_closing ? "הגיע" : it.station_name ?? it.state_label}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <button type="button" onClick={onStart} disabled={disabled} aria-busy={disabled || undefined} className="pkg-cta">
        <Play size={20} strokeWidth={2} aria-hidden />{cta}
      </button>
    </div>
  );
}
