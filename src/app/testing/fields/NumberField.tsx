"use client";
import * as React from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { NumberField as NumberFieldDef } from "@/app/lib/station-fields/schema";
import { numberRangeLine } from "./labels";
import "./number.css";

/**
 * The control of a `number` field (route-fields spec §4.7; artboards 14 and 6): a 44px input typed
 * left to right (inputMode decimal, tabular figures) joined to its unit box, and the range line —
 * "טווח מותר · עד 0.1 Ω", then "בטווח" / "מחוץ לטווח" / "יש להזין מספר" / "יש להזין ערך" as the
 * worker types (labels.ts numberRangeLine). The draft keeps the raw text; "," reads as "." when it
 * is evaluated (evaluate.ts parseNumberText).
 *
 * The row draws the line under the field's name (artboard 14) with <NumberRangeLine>, under the id
 * numberRangeLineId(id) that the input's aria-describedby points at.
 *
 * The line describes the input (aria-describedby); its errors are also announced once, as they
 * appear (spec §4.13): a polite region, always in the page, holds the line's words only while
 * they say something is wrong — so typing within one state says nothing new.
 */

/** The range line's id for a control id — what aria-describedby points at. */
export const numberRangeLineId = (controlId: string): string => `${controlId}-range`;

export interface NumberFieldProps {
  /** The input's id — the row's <label htmlFor>. */
  id: string;
  def: NumberFieldDef;
  /** FieldDraft.num: the text as typed. */
  value: string;
  onChange: (raw: string) => void;
  /** After a save attempt in artboard 14 (`tried`): an empty required field reads "יש להזין ערך". */
  showRequiredError?: boolean;
  /** More ids for aria-describedby (e.g. the field's help text under its name). */
  describedBy?: string;
}

/** The range line — under the field's name (artboard 14). Renders nothing when there is nothing to
 *  say (no range, nothing wrong). */
export function NumberRangeLine({ id, def, value, showRequiredError = false }: {
  id: string; def: NumberFieldDef; value: string; showRequiredError?: boolean;
}) {
  const line = numberRangeLine(def, value, showRequiredError);
  if (!line.visible) return null;
  return (
    <span id={id} className="tst-fx-num-range" data-tone={line.tone}>
      {line.icon === "ok" && <CircleCheck size={13} strokeWidth={1.75} aria-hidden />}
      {line.icon === "alert" && <CircleAlert size={13} strokeWidth={1.75} aria-hidden />}
      <span>
        {line.segments.map((seg, i) => (seg.ltr
          ? <span key={i} dir="ltr" className="tst-fx-num-ltr">{seg.text}</span>
          : <React.Fragment key={i}>{seg.text}</React.Fragment>))}
      </span>
    </span>
  );
}

export function NumberField({ id, def, value, onChange, showRequiredError = false, describedBy }: NumberFieldProps) {
  const line = numberRangeLine(def, value, showRequiredError);
  const unit = def.unit?.trim() ?? "";
  const described = [line.visible ? numberRangeLineId(id) : "", describedBy ?? ""].filter(Boolean).join(" ");
  return (
    <>
      <div dir="ltr" className="tst-fx-num-group" data-invalid={line.invalid ? "" : undefined}>
        <input
          id={id} className={unit ? "tst-fx-num-input tst-fx-num-input--unit" : "tst-fx-num-input"}
          inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)}
          aria-required={def.required || undefined} aria-invalid={line.invalid || undefined}
          aria-describedby={described || undefined} />
        {unit && <span className="tst-fx-num-unit">{unit}</span>}
      </div>
      <span className="sh-visually-hidden" aria-live="polite">{line.invalid ? line.text : ""}</span>
    </>
  );
}
