"use client";
import * as React from "react";
import { Close as CloseIcon, Check as CheckIcon } from "@/components/ui/icons";
import { PASS_FAIL_WORD } from "@/app/lib/station-fields/labels";
import "./pass-fail.css";

/** A pass / fail answer as the popups keep it: "" until one is chosen. */
export type PassFailValue = "" | "pass" | "fail";

/** Pass / fail toggle pair (aria-pressed). `labelledBy` names the group — the
 *  question it answers. size "row" is the pair inside a station-field row
 *  (route-fields artboard 14: 44px, 14px/600), where pressing the chosen button
 *  again clears it (`onClear`). `invalid` edges both buttons red with no text
 *  (artboard 14 `pfErr`; the row supplies the words for assistive tech via
 *  `describedBy`). */
export function PassFail({ value, onChange, labelledBy, size = "lg", invalid = false, onClear, describedBy }: {
  value: PassFailValue; onChange: (v: "pass" | "fail") => void; labelledBy?: string;
  size?: "lg" | "row"; invalid?: boolean; onClear?: () => void; describedBy?: string;
}) {
  const row = size === "row";
  const opt = (v: "pass" | "fail") => (
    <button key={v} type="button" onClick={() => (row && onClear && value === v ? onClear() : onChange(v))} aria-pressed={value === v}
      className={`tst-passfail tst-passfail--${v} sh-press${row ? " tst-passfail--row" : ""}${invalid ? " tst-passfail--invalid" : ""}`}>
      {v === "pass" ? <CheckIcon sx={{ fontSize: row ? 16 : 20 }} aria-hidden /> : <CloseIcon sx={{ fontSize: row ? 16 : 20 }} aria-hidden />}
      {PASS_FAIL_WORD[v]}
    </button>
  );
  return <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} style={{ display: "flex", gap: row ? 6 : 12 }}>{opt("pass")}{opt("fail")}</div>;
}
