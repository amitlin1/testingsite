"use client";
import React from "react";
import { Play } from "lucide-react";
import type { PackageItemView } from "@/app/lib/packages/contract";
import type { QueueRow } from "@/app/lib/testing/contract";
import { packageRoleOf } from "@/app/lib/testing/popup-kind";
import { ItemStatus } from "@/lib/item-status";
import IdText from "@/app/components/IdText";
import { AMBER, BLUE, GREEN, GREY, HAIR, HAIR_2, INK, INK_2, MUTED } from "@/components/ui/colors";
import { seq2 } from "@/app/lib/packages/ids";
import { useNetSeconds } from "../clock";
import { StepBackButton } from "../stepBack";
import "@/components/ui/controls.css";
import "@/app/testing/package-stations.css";

/**
 * A box in a package-level station's queue — design/Testing Screen
 * Packages.dc.html (pkgCards): type, id, customer + shipment, wait, the
 * item mini-strip with "N פריטים בתכולה" / "N/M הגיעו לסגירה", an in-card
 * items list, and the 44px start button.
 *
 * At a closing station a manager may send one item of a waiting box back to
 * the test before the closing ("החזר" in the items list, api/testing/step-back):
 * the box then waits for that item again.
 */

/** The artboard's wait label: "12 דק׳" under an hour, "1:24 שע׳" after. A box waits minutes to
 *  hours; a seconds counter ticking on every card is noise. */
function waitLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}:${String(min).padStart(2, "0")} שע׳` : `${min} דק׳`;
}

export default function PackageQueueCard({ item, onBegin, starting, stepBackOf }: {
  /** The box's queue row (it carries `package`). */
  item: QueueRow;
  /** The host's begin (useTestWindow): start-test (the group start, PLAN §4) locks the box and its
   *  items before the wizard opens. */
  onBegin: (item: QueueRow) => void;
  /** Its start-test is on its way. */
  starting: boolean;
  /** "החזר" per item: the click, where the item may go back (a manager, a closing station, the box
   *  and the item waiting — queueModel boxItemStepBack). */
  stepBackOf: (item: PackageItemView) => (() => void) | null;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  // In test: the button continues the wizard. The card owns its clock, so its tick redraws it only.
  const inTest = item.current_status === ItemStatus.InTest;
  const wait = useNetSeconds(inTest ? item.processing_start_time : item.queue_start_time);
  const pkg = item.package;
  if (!pkg) return null;
  const role = packageRoleOf(item);
  const arrived = pkg.items.filter((it) => it.arrived_at_closing).length;
  const mini = pkg.items.map((it) => ({
    color: role === "opening" ? GREY : it.arrived_at_closing ? GREEN : it.state === "done" ? GREEN : AMBER,
    title: `${seq2(it.package_seq)} · ${it.item_type_desc} · ${role === "opening" ? "טרם נפתח" : it.arrived_at_closing ? "הגיע לסגירה" : `לא הגיע · ${it.station_name ?? "—"}`}`,
  }));
  const itemNote = role === "opening" ? `${pkg.items.length} פריטים בתכולה` : `${arrived}/${pkg.items.length} הגיעו לסגירה`;
  const cta = inTest ? (role === "opening" ? "המשך פתיחת מארז" : "המשך סגירת מארז") : role === "opening" ? "התחל פתיחת מארז" : "התחל סגירת מארז";

  return (
    <div style={{ background: "var(--color-canvas)", border: `1px solid ${inTest ? BLUE : HAIR}`, borderRadius: 14, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13, color: INK }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>{pkg.item_type_desc}</div>
          <div style={{ marginTop: 4 }}><IdText id={pkg.item_id} size={19} headColor={INK} letterSpacing=".3px" /></div>
          <div style={{ fontSize: 13, color: INK_2, marginTop: 6 }}>{pkg.customer_name ?? pkg.customer_code ?? "—"} · משלוח {pkg.shipment_code ?? "—"}</div>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: inTest ? BLUE : INK }}>{wait != null ? waitLabel(wait) : "—"}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{inTest ? "בבדיקה · נטו" : "בתור · נטו"}</div>
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
              <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>{role === "opening" ? "טרם נפתח" : it.arrived_at_closing ? "הגיע" : it.station_name ?? it.state_label}</span>
              <StepBackButton it={it} onClick={stepBackOf(it)} />
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <button type="button" onClick={() => onBegin(item)} disabled={starting} aria-busy={starting || undefined} className="pkg-cta">
        <Play size={20} strokeWidth={2} aria-hidden />{cta}
      </button>
    </div>
  );
}
