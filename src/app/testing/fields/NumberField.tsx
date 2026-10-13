"use client";
import * as React from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { NumberField as NumberFieldDef } from "@/app/lib/station-fields/schema";
import { numberRangeLine, type NumberRangeLine as RangeLine } from "./labels";
import "./number.css";

/**
 * The control of a `number` field (route-fields spec §4.7; artboards 14 and 6): a 44px input typed
 * left to right (inputMode decimal, tabular figures) joined to its unit box, and the range line —
 * "טווח מותר · עד 0.1 Ω", then "בטווח" / "מחוץ לטווח" / "יש להזין מספר" / "יש להזין ערך" as the
 * worker types (labels.ts numberRangeLine). The draft keeps the raw text; "," reads as "." when it
 * is evaluated (evaluate.ts parseNumberText).
 *
 * Where the line goes is the row's call: under the input ("below", the default), beside it
 * ("beside", artboard 6), or under the field's name (artboard 14) — rangeLine="external", and the
 * row renders <NumberRangeLine> there with the same id (numberRangeLineId).
 *
 * The line describes the input (aria-describedby); its errors are also announced once, as they
 * appear (spec §4.13): a polite region, always in the page, holds the line's words only while
 * they say something is wrong — so typing within one state says nothing new.
 */

export type RangeLinePlacement = "below" | "beside" | "external";

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
  rangeLine?: RangeLinePlacement;
  /** Default numberRangeLineId(id); with rangeLine="external", give <NumberRangeLine> the same. */
  rangeLineId?: string;
  /** More ids for aria-describedby (e.g. the field's help text under its name). */
  describedBy?: string;
  disabled?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  ref?: React.Ref<HTMLInputElement>;
}

export interface NumberRangeLineProps {
  id: string;
  def: NumberFieldDef;
  value: string;
  showRequiredError?: boolean;
  /** 13 in artboard 14 (the default), 14 beside the input (artboard 6). */
  iconSize?: number;
  className?: string;
}

function RangeLineView({ id, line, iconSize, className }: { id: string; line: RangeLine; iconSize: number; className?: string }) {
  return (
    <span id={id} className={className ? `tst-fx-num-range ${className}` : "tst-fx-num-range"} data-tone={line.tone}>
      {line.icon === "ok" && <CircleCheck size={iconSize} strokeWidth={1.75} aria-hidden />}
      {line.icon === "alert" && <CircleAlert size={iconSize} strokeWidth={1.75} aria-hidden />}
      <span>
        {line.segments.map((s, i) => (s.ltr
          ? <span key={i} dir="ltr" className="tst-fx-num-ltr">{s.text}</span>
          : <React.Fragment key={i}>{s.text}</React.Fragment>))}
      </span>
    </span>
  );
}

/** The range line on its own — for a row that draws it under the field's name (artboard 14).
 *  Renders nothing when there is nothing to say (no range, nothing wrong). */
export function NumberRangeLine({ id, def, value, showRequiredError = false, iconSize = 13, className }: NumberRangeLineProps) {
  const line = numberRangeLine(def, value, showRequiredError);
  return line.visible ? <RangeLineView id={id} line={line} iconSize={iconSize} className={className} /> : null;
}

export function NumberField({
  id, def, value, onChange, showRequiredError = false, rangeLine = "below", rangeLineId, describedBy,
  disabled, onKeyDown, onBlur, ref,
}: NumberFieldProps) {
  const line = numberRangeLine(def, value, showRequiredError);
  const lineId = rangeLineId ?? numberRangeLineId(id);
  const unit = def.unit?.trim() ?? "";
  const described = [line.visible ? lineId : "", describedBy ?? ""].filter(Boolean).join(" ");

  const control = (
    <div dir="ltr" className="tst-fx-num-group" data-invalid={line.invalid ? "" : undefined}>
      <input
        ref={ref} id={id} className={unit ? "tst-fx-num-input tst-fx-num-input--unit" : "tst-fx-num-input"}
        inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)}
        aria-required={def.required || undefined} aria-invalid={line.invalid || undefined}
        aria-describedby={described || undefined}
        disabled={disabled} onKeyDown={onKeyDown} onBlur={onBlur} />
      {unit && <span className="tst-fx-num-unit">{unit}</span>}
    </div>
  );
  const announce = <span className="sh-visually-hidden" aria-live="polite">{line.invalid ? line.text : ""}</span>;
  if (rangeLine === "external") return <>{control}{announce}</>;
  return (
    <div className={`tst-fx-num tst-fx-num--${rangeLine}`}>
      {control}
      {line.visible && <RangeLineView id={lineId} line={line} iconSize={rangeLine === "beside" ? 14 : 13} />}
      {announce}
    </div>
  );
}

export default NumberField;
