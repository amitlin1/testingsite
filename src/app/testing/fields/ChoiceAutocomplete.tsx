"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { Autocomplete, TextField } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { TONE_WORD, type ChoiceOption } from "@/app/lib/station-fields/schema";
import { choiceCountText } from "./labels";
import { ToneDot } from "./ToneDot";
import "./choice.css";

/**
 * ChoiceAutocomplete — the control of a `choice_row` field in the worker
 * popups (route-fields spec §4.6; artboards 12–18, the row as in artboards 5/6).
 *
 * Built on the dense SearchableCombobox, so the 44px trigger, the portaled
 * list, ↑ / ↓ / Enter / Esc and "one list open at a time" (a list opens on
 * focus and closes on blur) are the shared primitive's. What it adds:
 *  - the closed trigger: the value's tone dot and label, "בחר…" while empty,
 *    "יש לבחור ערך" in red when `invalid` (artboard 14 after a save attempt),
 *    a value in the fail tone in red 600;
 *  - option rows: tone dot, the label (the typed match in 600) with the tone
 *    word for assistive tech, and a key box on the first four;
 *  - the list footer: "{N} אפשרויות" / "{k} מתוך {N}" and the window's key hint;
 *  - keys 1–4: with `typeToFilter`, a lone digit typed into the search picks
 *    that option (artboard 12 `setQuery`); without it (artboards 17/18) the
 *    field is pick-only and its trigger takes 1–4 while the list is open;
 *  - with `highlightFirst`, an empty field's list opens on its first row.
 * After a keyboard pick (1–4, or Enter on a highlighted row) `onPicked` runs
 * once the new value has rendered, so the host can move focus on from it.
 */

/** The control's own words — each one drawn in an artboard. */
export const CHOICE_TEXT = {
  /** Artboards 12–18: the closed trigger without a value. */
  empty: "בחר…",
  /** Artboard 14 (`emptyText`): a required choice still empty after a save attempt. */
  pickError: "יש לבחור ערך",
  /** Artboards 12/14 (`noMatch`) — the primitive's own default as well. */
  noOptions: "אין אפשרויות",
} as const;

/** The list footer's count (labels.ts). */
export { choiceCountText };

/** Keys 1–4 reach the first four options. */
const KEY_COUNT = 4;

/** The option index a lone digit picks: "2" → 1, while 1 ≤ n ≤ min(4, options). Else -1. */
function digitIndex(text: string, count: number): number {
  const t = text.trim();
  if (!/^[1-9]$/.test(t)) return -1;
  const n = Number(t);
  return n <= Math.min(KEY_COUNT, count) ? n - 1 : -1;
}

/** The search in the trigger's text. The chosen value's label — what a closed
 *  field shows — is no search: the list opens full. */
function searchOf(text: string, valueLabel: string): string {
  return text === valueLabel ? "" : text.trim();
}

/** Case-insensitive "includes" on the label, as the primitive's default filter. */
function filterChoices(options: ChoiceOption[], search: string): ChoiceOption[] {
  if (!search) return options;
  const q = search.toLowerCase();
  return options.filter((o) => o.label.toLowerCase().includes(q));
}

/** The label around its first match of `search`, for the 600 highlight. */
function splitMatch(label: string, search: string): [string, string, string] | null {
  if (!search) return null;
  const lower = label.toLowerCase();
  const q = search.toLowerCase();
  const at = lower.indexOf(q);
  // Lower-casing that changes a length would put the slice in the wrong place.
  if (at < 0 || lower.length !== label.length || q.length !== search.length) return null;
  return [label.slice(0, at), label.slice(at, at + search.length), label.slice(at + search.length)];
}

/** Latin / digit runs ("1–4", "Enter") set LTR inside the Hebrew hint, so they never flip. */
const LTR_RUN = /([0-9A-Za-z]+(?:[–-][0-9A-Za-z]+)*)/;
function ltrRuns(text: string): React.ReactNode[] {
  return text.split(LTR_RUN).map((part, i) => (i % 2 === 1 ? <span key={i} dir="ltr">{part}</span> : part));
}

const sameOption = (a: ChoiceOption, b: ChoiceOption) => a.id === b.id;

/**
 * Selects the row the open list shows at `index` exactly as a pointer does:
 * the primitive then sets the value, closes the list and resets the text. A
 * row's id is the listbox id (the input's aria-controls, set while the list
 * is open) + "-" + its index. False when that row is not on screen.
 */
function clickRow(input: HTMLInputElement | null, index: number): boolean {
  const listId = input?.getAttribute("aria-controls");
  const row = listId ? document.getElementById(listId + "-" + index) : null;
  if (!row) return false;
  row.click();
  return true;
}

/** A press anywhere on the field box (the dot, the padding, between chips) goes
 *  to the input, so the whole 44px box opens the list. The input and the arrow
 *  keep their own handling; presses inside the portaled list are not ours. */
function pressToInput(e: React.MouseEvent<HTMLDivElement>) {
  const target = e.target as Element;
  if (!e.currentTarget.contains(target) || target.closest("input, svg")) return;
  const input = e.currentTarget.querySelector("input");
  if (!input) return;
  e.preventDefault();
  input.focus();
  input.click();
}

/** One option row's content (inside the dense row's check slot). */
function OptionRow({ option, index, search, selected }: {
  option: ChoiceOption; index: number; search: string; selected: boolean;
}) {
  const parts = splitMatch(option.label, search);
  return (
    <span className={selected ? "tst-fx-choice-opt tst-fx-choice-opt--sel" : "tst-fx-choice-opt"}>
      <ToneDot tone={option.tone} />
      <span className="tst-fx-choice-label">
        {parts ? <>{parts[0]}<b>{parts[1]}</b>{parts[2]}</> : option.label}
        {/* The row's name carries its tone word: "לא דולקת · כשל". */}
        <span className="sh-visually-hidden">{" · " + TONE_WORD[option.tone]}</span>
      </span>
      {index >= 0 && index < KEY_COUNT && (
        <span className="tst-fx-choice-key" dir="ltr" aria-hidden="true">{index + 1}</span>
      )}
    </span>
  );
}

/** The list footer: the count, and the key hint at the inline end. */
function ListFooter({ listLabel, count, hint }: { listLabel: string; count: string; hint: string }) {
  // The primitive's listbox has no name of its own, and this row is the one
  // node the control renders inside it: it names the list after the field
  // (spec §4.6) each time the list mounts.
  const listShown = React.useCallback(
    (el: HTMLDivElement | null) => {
      el?.closest<HTMLElement>('[role="listbox"]')?.setAttribute("aria-label", listLabel);
    },
    [listLabel],
  );
  return (
    <div ref={listShown} className="tst-fx-choice-foot">
      <span className="tst-fx-choice-count">{count}</span>
      <span className="tst-fx-choice-hint">{ltrRuns(hint)}</span>
    </div>
  );
}

/** What a host can do with the control (React 19 `ref` prop). */
export interface ChoiceAutocompleteHandle {
  /** Focuses the trigger, which opens its list (the primitive opens on focus). */
  focus: () => void;
}

export interface ChoiceAutocompleteProps {
  /** The trigger input's id — the row's <label htmlFor> points at it. */
  id: string;
  /** The field label: the trigger's and the list's accessible name. */
  label: string;
  options: ChoiceOption[];
  /** OptionId, or null while nothing is chosen. An id not among `options` shows as empty. */
  value: string | null;
  onChange: (id: string | null) => void;
  required: boolean;
  /** A required choice still empty after a save attempt (artboard 14): "יש לבחור ערך" in red. */
  invalid: boolean;
  /** false in artboards 17/18: no typing — the trigger opens the list and takes 1–4. */
  typeToFilter: boolean;
  /** The search prompt while the list is open: "הקלד לסינון או 1–4…" / "הקלד לסינון…". */
  placeholderOpen: string;
  /** The footer's key hint: "1–4 בחירה מהירה" / "1–4 · Enter בחירה" / "1–4 בחירה". */
  footerHint: string;
  /** Artboards 12, 13, 15, 16 (`hlIdx = list[0]`): while nothing is chosen, the
   *  list opens on its first row, so Enter right after opening takes it. A
   *  chosen value keeps the primitive's rule — no row until ↓ / ↑ or typing —
   *  so Enter never swaps a value for the first option. Artboard 14 highlights
   *  only while typing (the primitive's own rule); 17/18 draw no highlight. */
  highlightFirst?: boolean;
  /** After a keyboard pick (1–4, or Enter on a highlighted row), once the new
   *  value has rendered: the host moves focus to the row's required note or to
   *  the next row. Not after a pointer pick — a tap must not open the next list. */
  onPicked?: () => void;
  /** More ids that describe the trigger (help text, a row message); kept with the control's own. */
  "aria-describedby"?: string;
  ref?: React.Ref<ChoiceAutocompleteHandle>;
}

export default function ChoiceAutocomplete({
  id, label, options, value, onChange, required, invalid, typeToFilter, placeholderOpen, footerHint,
  highlightFirst = false, onPicked, "aria-describedby": describedBy, ref,
}: ChoiceAutocompleteProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;
  const valueLabel = selected?.label ?? "";
  const [open, setOpen] = React.useState(false);
  // The trigger's text, controlled so a lone digit can pick instead of
  // filtering. While closed the primitive holds it at the chosen label.
  const [query, setQuery] = React.useState(valueLabel);
  const search = typeToFilter ? searchOf(query, valueLabel) : "";
  const shown = filterChoices(options, search);
  const searching = typeToFilter && open;

  // A keyboard pick runs onPicked after the commit that shows it, so the host
  // decides where focus goes from the new value (a required note appears).
  const viaKey = React.useRef(false);
  const [keyPicks, setKeyPicks] = React.useState(0);
  const notifyPicked = React.useEffectEvent(() => onPicked?.());
  React.useEffect(() => {
    if (keyPicks > 0) notifyPicked();
  }, [keyPicks]);

  React.useImperativeHandle(ref, () => ({ focus: () => rootRef.current?.querySelector("input")?.focus() }), []);
  const inputEl = () => rootRef.current?.querySelector("input") ?? null;

  const handleChange = (o: ChoiceOption | null) => {
    onChange(o ? o.id : null);
    if (viaKey.current) {
      viaKey.current = false;
      setKeyPicks((n) => n + 1);
    }
  };

  /** Picks options[index] from the keyboard. `row` is where the open list shows
   *  it: clicking that row selects through the primitive, as a pointer would.
   *  When the row is not on screen the value is set directly, and the list
   *  closes once the host moves focus on. */
  const pickByKey = (index: number, row: number) => {
    viaKey.current = true;
    const clicked = row >= 0 && clickRow(inputEl(), row);
    viaKey.current = false;
    if (clicked) return;
    const o = options[index];
    setQuery(typeToFilter ? "" : o.label);
    onChange(o.id);
    setKeyPicks((n) => n + 1);
  };

  const handleInput = (_e: React.SyntheticEvent | null, text: string, reason: string) => {
    if (reason === "input") {
      // Artboard 12 `setQuery`: a lone digit picks, anything else filters.
      const n = digitIndex(text, options.length);
      if (n >= 0) {
        pickByKey(n, shown.indexOf(options[n]));
        return;
      }
    }
    setQuery(text);
  };

  const handleOpen = React.useCallback(() => {
    setOpen(true);
    // A search starts empty, under its placeholder (artboard 12) — unless the
    // keystroke that opened the list is already in it.
    if (typeToFilter) setQuery((q) => (q === valueLabel ? "" : q));
  }, [typeToFilter, valueLabel]);
  const handleClose = React.useCallback(() => setOpen(false), []);

  const filterOptions = React.useCallback(
    (opts: ChoiceOption[], state: { inputValue: string }) =>
      typeToFilter ? filterChoices(opts, searchOf(state.inputValue, valueLabel)) : opts,
    [typeToFilter, valueLabel],
  );

  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Enter on a highlighted row is a keyboard pick too (artboard 5: "Enter לשורה הבאה").
    viaKey.current = e.key === "Enter";
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    viaKey.current = false;
    if (typeToFilter || e.ctrlKey || e.metaKey || e.altKey) return;
    // Pick-only trigger (artboards 17/18): 1–4 while its list is open; Enter
    // and Space open the list, as on a button.
    if (open) {
      const n = digitIndex(e.key, options.length);
      if (n < 0) return;
      e.preventDefault();
      pickByKey(n, n);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputEl()?.click();
    }
  };

  const errId = id + "-err";
  // Artboard 14 marks the empty field only while its list is closed.
  const showError = invalid && !open;
  const className = [
    "tst-fx-choice",
    !typeToFilter && "tst-fx-choice--static",
    searching && "tst-fx-choice--search",
    showError && "tst-fx-choice--invalid",
    selected?.tone === "fail" && !searching && "tst-fx-choice--fail",
  ].filter(Boolean).join(" ");

  return (
    <div ref={rootRef} className={className} onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown} onMouseDown={pressToInput}>
      <SearchableCombobox<ChoiceOption>
        id={id}
        ariaLabel={label}
        dense
        disableClearable
        options={options}
        value={selected}
        onChange={handleChange}
        isOptionEqualToValue={sameOption}
        filterOptions={filterOptions}
        inputValue={query}
        onInputChange={handleInput}
        onOpen={handleOpen}
        onClose={handleClose}
        placeholder={searching ? placeholderOpen : showError ? CHOICE_TEXT.pickError : CHOICE_TEXT.empty}
        error={showError}
        noOptionsText={CHOICE_TEXT.noOptions}
        startIcon={selected && !searching ? <ToneDot tone={selected.tone} /> : undefined}
        renderOptionContent={(o, isSelected) => (
          <OptionRow option={o} index={options.indexOf(o)} search={search} selected={isSelected} />
        )}
        listFooter={<ListFooter listLabel={label} count={choiceCountText(shown.length, options.length, search !== "")} hint={footerHint} />}
        // An empty field's list opens on its first row, so Enter picks it at once (artboards
        // 12/13/15/16). A filled field opens on nothing: Enter must not swap its value.
        autoHighlight={highlightFirst && selected == null}
        inputAttributes={{
          readOnly: typeToFilter ? undefined : true,
          "aria-required": required || undefined,
          "aria-invalid": invalid || undefined,
          "aria-describedby": [describedBy, invalid ? errId : ""].filter(Boolean).join(" ") || undefined,
        }}
      />
      <span id={errId} className="sh-visually-hidden" aria-live="polite">{invalid ? CHOICE_TEXT.pickError : ""}</span>
    </div>
  );
}
export { ChoiceAutocomplete };

export interface MultiChoiceAutocompleteProps extends Omit<ChoiceAutocompleteProps, "value" | "onChange" | "onPicked"> {
  /** The chosen OptionIds; reported back in option order. */
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * multi_choice (spec §4.6 — no artboard draws it): the same field with the
 * primitive's `multiple` and its chips. Keys 1–4 toggle option n and the list
 * stays open; rows, footer, states and keyboard are ChoiceAutocomplete's.
 */
export function MultiChoiceAutocomplete({
  id, label, options, value, onChange, required, invalid, typeToFilter, placeholderOpen, footerHint,
  "aria-describedby": describedBy, ref,
}: MultiChoiceAutocompleteProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const chosen = options.filter((o) => value.includes(o.id));
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const search = typeToFilter ? query.trim() : "";
  const shown = filterChoices(options, search);
  const searching = typeToFilter && open;

  React.useImperativeHandle(ref, () => ({ focus: () => rootRef.current?.querySelector("input")?.focus() }), []);
  const inputEl = () => rootRef.current?.querySelector("input") ?? null;

  const report = (ids: Set<string>) => onChange(options.filter((o) => ids.has(o.id)).map((o) => o.id));
  const toggle = (index: number) => {
    const ids = new Set(value);
    const optionId = options[index].id;
    if (ids.has(optionId)) ids.delete(optionId);
    else ids.add(optionId);
    report(ids);
  };

  const handleInput = (_e: React.SyntheticEvent | null, text: string, reason: string) => {
    if (reason === "input") {
      const n = digitIndex(text, options.length);
      if (n >= 0) {
        toggle(n);
        setQuery("");
        return;
      }
    }
    setQuery(text);
  };
  const handleOpen = React.useCallback(() => setOpen(true), []);
  // `multiple` keeps typed text when the list closes; a search never outlives its list.
  const handleClose = React.useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  const filterOptions = React.useCallback(
    (opts: ChoiceOption[], state: { inputValue: string }) => (typeToFilter ? filterChoices(opts, state.inputValue.trim()) : opts),
    [typeToFilter],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (typeToFilter || e.ctrlKey || e.metaKey || e.altKey) return;
    if (open) {
      const n = digitIndex(e.key, options.length);
      if (n < 0) return;
      e.preventDefault();
      toggle(n);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputEl()?.click();
    }
  };

  const errId = id + "-err";
  const showError = invalid && !open;
  const className = [
    "tst-fx-choice tst-fx-choice--multi",
    !typeToFilter && "tst-fx-choice--static",
    searching && "tst-fx-choice--search",
    showError && "tst-fx-choice--invalid",
  ].filter(Boolean).join(" ");
  const inputAttributes: React.InputHTMLAttributes<HTMLInputElement> = {
    readOnly: typeToFilter ? undefined : true,
    "aria-required": required || undefined,
    "aria-invalid": invalid || undefined,
    "aria-describedby": [describedBy, invalid ? errId : ""].filter(Boolean).join(" ") || undefined,
  };

  return (
    <div ref={rootRef} className={className} onKeyDown={onKeyDown} onMouseDown={pressToInput}>
      <Autocomplete<ChoiceOption>
        id={id}
        multiple
        disableClearable
        fullWidth
        options={options}
        value={chosen}
        onChange={(_e, next: ChoiceOption[]) => report(new Set(next.map((o) => o.id)))}
        isOptionEqualToValue={sameOption}
        filterOptions={filterOptions}
        inputValue={query}
        onInputChange={handleInput}
        onOpen={handleOpen}
        onClose={handleClose}
        noOptionsText={<span className="sh-combo-empty">{CHOICE_TEXT.noOptions}</span>}
        listFooter={
          <ListFooter listLabel={label} count={choiceCountText(shown.length, options.length, search !== "")} hint={footerHint} />
        }
        renderOption={(props, o, { selected: isSelected }) => {
          // SearchableCombobox's dense row: its tint and check mark the selection.
          const { key, style: _selectedText, className: _itemClass, ...li } = props;
          return (
            <li key={key} {...li} className="sh-select-item sh-combo-option">
              <span className="sh-combo-check">{isSelected && <Check size={15} strokeWidth={1.75} />}</span>
              <span className="sh-combo-text">
                <OptionRow option={o} index={options.indexOf(o)} search={search} selected={isSelected} />
              </span>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={searching ? placeholderOpen : chosen.length > 0 ? undefined : showError ? CHOICE_TEXT.pickError : CHOICE_TEXT.empty}
            error={showError}
            wrapClassName="tst-fx-choice-multi"
            inputProps={{ ...inputAttributes, ...params.inputProps, "aria-label": label }}
          />
        )}
      />
      <span id={errId} className="sh-visually-hidden" aria-live="polite">{invalid ? CHOICE_TEXT.pickError : ""}</span>
    </div>
  );
}
