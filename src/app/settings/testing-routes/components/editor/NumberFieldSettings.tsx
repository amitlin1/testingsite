"use client";
import * as React from "react";
import { ChevronUp } from "lucide-react";
import { Button, MenuItem, Select, Switch, cn } from "@/components/ui";
import { UNDRAWN_TEXT as FIELDS_UNDRAWN_TEXT } from "@/app/lib/station-fields/labels";
import type { NumberField } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import { UNDRAWN_TEXT, NUMBER_SETTINGS_TEXT, NUMBER_UNITS } from "../../lib/labels";
import {
  formatDecimal, numberPreviewMessage, numberRangeInverted, parseDecimalText, toleranceNegative, withHelp,
  withNumberSetting, withUnit, type NumberSettingKey,
} from "../../lib/numberText";
import "./editor-popovers.css";

export { numberPreviewMessage, numberSummaryParts, numberSummaryText } from "../../lib/numberText";
export type { NumberPreviewMessage } from "../../lib/numberText";

/**
 * The expanded number row (artboard 3 `gnd-settings`, spec §5.6): the settings of a `number` field,
 * opened in place under its row (180ms) on pearl — a two-column grid of יחידה, מינימום, מקסימום, ערך
 * ייחוס, סטייה מותרת ±%, the 'ערך מחוץ לטווח נחשב "לא תקין"' switch, the worker's help text, and
 * "סגור הגדרות".
 *
 * Every edit is reported at once (onChange with the whole field). Numbers are typed as text: a ","
 * reads as "."; an emptied input removes the setting (undefined); text that is not a number removes
 * it too and says so under the input once focus leaves it (undrawn). Clearing the reference
 * value removes the tolerance with it (tol_pct only exists next to ref).
 *
 * `id` is the panel's id — the row's summary button points at it (aria-controls) — and the prefix
 * of every control's id.
 */

export interface NumberFieldSettingsProps {
  id: string;
  field: NumberField;
  onChange(next: NumberField): void;
  onClose(): void;
}

/** What a decimal input shows and reports. The typed text is kept as long as the field still holds
 *  what it reported, so "0." or "-" survive mid-typing; an outside change of the value shows that
 *  value instead. */
function useDecimalText(value: number | undefined, report: (v: number | undefined) => void) {
  const [typed, setTyped] = React.useState<{ text: string; value: number | undefined } | null>(null);
  const [focused, setFocused] = React.useState(false);
  const text = typed && Object.is(typed.value, value) ? typed.text : formatDecimal(value);
  const parsed = parseDecimalText(text);
  return {
    text,
    /** Not a number — shown once the input is left (mid-typing "-" is not an error yet). */
    notNumeric: parsed === null && !focused,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const next = parseDecimalText(raw) ?? undefined;
      setTyped({ text: raw, value: next });
      if (!Object.is(next, value)) report(next);
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      // A number reads back the way it is stored ("0,5" → "0.5"); text that is not one stays.
      if (parseDecimalText(text) !== null) setTyped(null);
    },
  };
}

export function NumberFieldSettings({ id, field, onChange, onClose }: NumberFieldSettingsProps) {
  const set = (key: NumberSettingKey) => (v: number | undefined) => onChange(withNumberSetting(field, key, v));
  const min = useDecimalText(field.min, set("min"));
  const max = useDecimalText(field.max, set("max"));
  const ref = useDecimalText(field.ref, set("ref"));
  const tol = useDecimalText(field.tol_pct, set("tol_pct"));

  const unit = field.unit?.trim() ?? "";
  const hasRef = field.ref != null;
  const inverted = numberRangeInverted(field);
  const tolNegative = hasRef && toleranceNegative(field);
  // The artboard's one unit, plus the field's own when it is another (the unit list is not verified).
  const units = unit && !NUMBER_UNITS.some((u) => u.value === unit) ? [...NUMBER_UNITS, { value: unit, name: "" }] : NUMBER_UNITS;

  const ids = {
    unit: `${id}-unit`,
    min: `${id}-min`,
    max: `${id}-max`,
    ref: `${id}-ref`,
    tol: `${id}-tol`,
    oor: `${id}-oor`,
    help: `${id}-help`,
  };
  const err = (key: string) => `${id}-${key}-error`;
  const describedBy = (...parts: (string | false)[]) => parts.filter(Boolean).join(" ") || undefined;

  /** A min / max input: LTR, the unit as a suffix at the box's right edge. */
  const rangeInput = (key: "min" | "max", t: ReturnType<typeof useDecimalText>, invalid: boolean, errorId: string | false) => (
    <div className="rf-nfs__affix">
      <input
        id={ids[key]}
        dir="ltr"
        inputMode="decimal"
        autoComplete="off"
        className={cn("sh-input rf-nfs__input rf-nfs__input--num", unit && "rf-nfs__input--suffixed", invalid && "sh-input--error")}
        placeholder={NUMBER_SETTINGS_TEXT.emptyValue}
        value={t.text}
        onChange={t.onChange}
        onFocus={t.onFocus}
        onBlur={t.onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(errorId)}
      />
      {unit && <span className="rf-nfs__suffix" dir="ltr" aria-hidden="true">{unit}</span>}
    </div>
  );

  return (
    <div id={id} className="rf-nfs">
      {/* יחידה */}
      <div className="rf-nfs__cell">
        <span className="rf-nfs__label" aria-hidden="true">{NUMBER_SETTINGS_TEXT.unit}</span>
        <Select
          label={NUMBER_SETTINGS_TEXT.unit}
          value={unit}
          placeholder={NUMBER_SETTINGS_TEXT.emptyValue}
          onChange={(e) => onChange(withUnit(field, String(e.target.value ?? "")))}
          className="rf-nfs__select"
          fullWidth
        >
          {units.map((u) => (
            <MenuItem key={u.value} value={u.value}>
              <span dir="ltr" className="rf-ltr">{u.value}</span>
              {u.name ? " " + u.name : null}
            </MenuItem>
          ))}
        </Select>
      </div>

      {/* מינימום */}
      <div className="rf-nfs__cell">
        <label htmlFor={ids.min} className="rf-nfs__label">{NUMBER_SETTINGS_TEXT.min}</label>
        {rangeInput("min", min, min.notNumeric, min.notNumeric && err("min"))}
        {min.notNumeric && <span id={err("min")} className="rf-nfs__help rf-nfs__help--error">{UNDRAWN_TEXT.numberNotNumeric}</span>}
      </div>

      {/* מקסימום */}
      <div className="rf-nfs__cell">
        <label htmlFor={ids.max} className="rf-nfs__label">{NUMBER_SETTINGS_TEXT.max}</label>
        {rangeInput("max", max, max.notNumeric || inverted, (max.notNumeric || inverted) && err("max"))}
        {max.notNumeric ? (
          <span id={err("max")} className="rf-nfs__help rf-nfs__help--error">{UNDRAWN_TEXT.numberNotNumeric}</span>
        ) : inverted ? (
          <span id={err("max")} className="rf-nfs__help rf-nfs__help--error">{FIELDS_UNDRAWN_TEXT.numberRange}</span>
        ) : null}
      </div>

      {/* ערך ייחוס */}
      <div className="rf-nfs__cell">
        <label htmlFor={ids.ref} className="rf-nfs__label">{NUMBER_SETTINGS_TEXT.ref}</label>
        <input
          id={ids.ref}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          className={cn("sh-input rf-nfs__input rf-nfs__input--ref", ref.notNumeric && "sh-input--error")}
          placeholder={NUMBER_SETTINGS_TEXT.refPlaceholder}
          value={ref.text}
          onChange={ref.onChange}
          onFocus={ref.onFocus}
          onBlur={ref.onBlur}
          aria-invalid={ref.notNumeric || undefined}
          aria-describedby={describedBy(ref.notNumeric && err("ref"))}
        />
        {ref.notNumeric && <span id={err("ref")} className="rf-nfs__help rf-nfs__help--error">{UNDRAWN_TEXT.numberNotNumeric}</span>}
      </div>

      {/* סטייה מותרת ±% — only next to a reference value */}
      <div className="rf-nfs__cell">
        <label htmlFor={ids.tol} className={cn("rf-nfs__label", !hasRef && "rf-nfs__label--off")}>{NUMBER_SETTINGS_TEXT.tol}</label>
        {hasRef ? (
          <input
            id={ids.tol}
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            className={cn("sh-input rf-nfs__input rf-nfs__input--num", (tol.notNumeric || tolNegative) && "sh-input--error")}
            placeholder={NUMBER_SETTINGS_TEXT.tolPlaceholder}
            value={tol.text}
            onChange={tol.onChange}
            onFocus={tol.onFocus}
            onBlur={tol.onBlur}
            aria-invalid={tol.notNumeric || tolNegative || undefined}
            aria-describedby={describedBy(`${ids.tol}-note`, (tol.notNumeric || tolNegative) && err("tol"))}
          />
        ) : (
          <input
            id={ids.tol}
            disabled
            className="sh-input rf-nfs__input"
            placeholder={NUMBER_SETTINGS_TEXT.emptyValue}
            value=""
            readOnly
            aria-describedby={`${ids.tol}-note`}
          />
        )}
        <span id={`${ids.tol}-note`} className="rf-nfs__help">
          {hasRef ? NUMBER_SETTINGS_TEXT.tolHelpOn : NUMBER_SETTINGS_TEXT.tolHelpOff}
        </span>
        {hasRef && (tol.notNumeric || tolNegative) && (
          <span id={err("tol")} className="rf-nfs__help rf-nfs__help--error">
            {tol.notNumeric ? UNDRAWN_TEXT.numberNotNumeric : FIELDS_UNDRAWN_TEXT.numberRange}
          </span>
        )}
      </div>

      {/* ערך מחוץ לטווח נחשב "לא תקין" */}
      <div className="rf-nfs__switch">
        <Switch
          id={ids.oor}
          checked={field.out_of_range_fail}
          onChange={(_e, checked) => onChange({ ...field, out_of_range_fail: checked })}
        />
        <label htmlFor={ids.oor}>{NUMBER_SETTINGS_TEXT.outOfRangeFail}</label>
      </div>

      {/* טקסט עזרה לעובד */}
      <div className="rf-nfs__cell rf-nfs__cell--wide">
        <label htmlFor={ids.help} className="rf-nfs__label">{NUMBER_SETTINGS_TEXT.help}</label>
        <input
          id={ids.help}
          dir="auto"
          autoComplete="off"
          className="sh-input rf-nfs__input"
          placeholder={NUMBER_SETTINGS_TEXT.helpPlaceholder}
          value={field.help ?? ""}
          maxLength={LIMITS.help}
          onChange={(e) => onChange(withHelp(field, e.target.value))}
          aria-describedby={`${ids.help}-note`}
        />
        <span id={`${ids.help}-note`} className="rf-nfs__help">{NUMBER_SETTINGS_TEXT.helpNote}</span>
      </div>

      <div className="rf-nfs__actions">
        <Button variant="text" onClick={onClose} startIcon={<ChevronUp size={16} strokeWidth={1.75} aria-hidden />}>
          {NUMBER_SETTINGS_TEXT.close}
        </Button>
      </div>
    </div>
  );
}

/** The live preview's line under a number field (artboard 3 `rangeMsg`): "בטווח · עד 0.1 Ω" and the
 *  rest of numberPreviewMessage, numbers with their unit isolated left to right. `value` is the
 *  number typed into the preview (null while nothing is). */
export function NumberPreviewLine({ field, value, id, className }: { field: NumberField; value: number | null; id?: string; className?: string }) {
  const m = numberPreviewMessage(field, value);
  return (
    <span id={id} className={cn("rf-num-preview", className)} data-tone={m.tone}>
      {m.segments.map((s, i) => (s.ltr
        ? <span key={i} dir="ltr" className="rf-ltr">{s.text}</span>
        : <React.Fragment key={i}>{s.text}</React.Fragment>))}
    </span>
  );
}

export default NumberFieldSettings;
