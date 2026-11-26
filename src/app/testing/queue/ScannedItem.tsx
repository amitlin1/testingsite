"use client";
import * as React from "react";
import { ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui";
import { ArrowBack as ArrowBackIcon, PlayArrowRounded as PlayArrowRoundedIcon } from "@/components/ui/icons";
import IdText from "@/app/components/IdText";
import type { QueueRow } from "@/app/lib/testing/contract";
import { TONE_DOT, isInTestStatus, isWaitingStatus, toneOfStatus } from "@/lib/item-status";
import { useNetSeconds } from "../clock";
import { ctaLabel, statusText } from "./ItemRow";
import { customerLabel, shipmentLabel, waitLabel } from "./treeModel";

/** Where a row sits: "לקוח 410 › משלוח 7731". */
export const placeOf = (item: QueueRow) => `${customerLabel(item.customer_code)} › ${shipmentLabel(item.shipment_code)}`;

/**
 * After a scan (design: מסך בדיקה — עיצוב מחדש כעץ, artboard ScanFocus): the band that says what
 * was scanned and where it sits. The tree has opened on its customer and shipment; "כל המשלוח"
 * widens to that shipment, "חזרה לתור" (or Escape in the scan field) back to the whole queue.
 */
export function ScanBand({ item, movedTo, noun, onShowShipment, onBack }: {
  item: QueueRow;
  /** The scan moved the screen to the item's station: its name. */
  movedTo: string | null;
  /** "הפריט" / "המארז". */
  noun: string;
  onShowShipment: () => void;
  onBack: () => void;
}) {
  return (
    <div role="status" className="tst-band tst-band--info">
      <ScanBarcode size={24} strokeWidth={1.75} aria-hidden style={{ color: "var(--color-primary)", flexShrink: 0 }} />
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>נסרק — מוצג רק {noun === "המארז" ? "המארז הזה" : "הפריט הזה"}</div>
        <div className="tst-band-sub">
          {movedTo ? `${noun} ממתין בעמדה ${movedTo}, והמסך עבר אליה. ` : ""}
          העץ נפתח על {placeOf(item)}. Esc בשדה הסריקה או &quot;חזרה לתור&quot; מחזירים את כל התור.
        </div>
      </div>
      <button type="button" className="tst-btn-quiet" onClick={onShowShipment}>כל המשלוח</button>
      <button type="button" className="tst-btn-quiet" onClick={onBack}>חזרה לתור</button>
    </div>
  );
}

/** The scanned item alone, big, with the one button. */
export default function ScannedItem({ item, boxMatesHere, onBegin, starting, onStepBack }: {
  item: QueueRow;
  /** Other rows of the same box in this queue. */
  boxMatesHere: number;
  onBegin: (item: QueueRow) => void;
  starting: boolean;
  onStepBack?: () => void;
}) {
  const isInTest = isInTestStatus(item.current_status);
  const isWaiting = isWaitingStatus(item.current_status);
  const elapsed = useNetSeconds(isInTest ? item.processing_start_time : isWaiting ? item.queue_start_time : null);
  const totalSteps = Math.max(item.route_steps?.length || 1, 1);
  const currentStep = item.current_route_step ?? 1;
  const cta = ctaLabel(item);

  return (
    <section aria-label="הפריט שנסרק" className="tst-scanned">
      <div style={{ flex: "1 1 420px", minWidth: 0 }}>
        <div className="tst-row-status" style={{ fontSize: "var(--text-body)" }}>
          <span aria-hidden className="tst-dot" style={{ background: TONE_DOT[toneOfStatus(item.current_status)] }} />
          <span>{statusText(item)} · {placeOf(item)}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <IdText id={item.item_id} size={30} headColor="var(--color-ink)" weight={600} letterSpacing="var(--ls-caption)" />
        </div>
        <div className="tst-scanned-type">{[item.item_type_desc, item.model].filter(Boolean).join(" · ") || "—"}</div>
        <dl className="tst-scanned-facts">
          <div><dt>סריאלי</dt><dd><bdi dir="ltr">{item.serial_no || "—"}</bdi></dd></div>
          <div><dt>מק״ט</dt><dd><bdi dir="ltr">{item.makat || "—"}</bdi></dd></div>
          <div><dt>שלב במסלול</dt><dd><bdi dir="ltr">{currentStep} / {totalSteps}</bdi></dd></div>
          <div><dt>{isInTest ? "בבדיקה · נטו" : "ממתין · נטו"}</dt><dd className="tst-num">{elapsed != null ? waitLabel(elapsed) : "—"}</dd></div>
          {item.package_id != null && (
            <div><dt>באותה קופסה בתור</dt><dd>{boxMatesHere === 0 ? "אין עוד" : boxMatesHere === 1 ? "עוד פריט אחד" : `עוד ${boxMatesHere} פריטים`}</dd></div>
          )}
        </dl>
        {onStepBack && (
          <button type="button" className="tst-step-back" style={{ marginTop: 14 }} onClick={onStepBack}>
            <ArrowBackIcon sx={{ fontSize: 12 }} aria-hidden />
            חזרה לבדיקה הקודמת
          </button>
        )}
      </div>
      {cta && (
        <div style={{ flex: "0 1 300px", display: "flex", flexDirection: "column", gap: 10 }}>
          <Button
            className="tst-scanned-cta"
            variant={isInTest ? "outlined" : "contained"}
            disabled={starting}
            onClick={() => onBegin(item)}
            startIcon={isInTest ? undefined : <PlayArrowRoundedIcon sx={{ fontSize: 26 }} aria-hidden />}
          >
            {isInTest ? "המשך בדיקה" : cta === "התחל" ? "התחל בדיקה" : cta}
          </Button>
          <div className="tst-band-sub" style={{ textAlign: "center" }}>סריקה נוספת מחליפה פריט</div>
        </div>
      )}
    </section>
  );
}
