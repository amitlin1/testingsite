/**
 * Item / package identifiers — docs/features/packages/PLAN.md §2.
 *
 * A new-format id is a fixed 15-digit number:
 *
 *   CCC ddMMyy NNNN SS
 *   │   │      │    └─ position inside the package: 00 = the package itself,
 *   │   │      │       01..99 = items in the order they were added
 *   │   │      └────── daily package counter (0001..9999), shared by every
 *   │   │              customer — so the id is unique whatever the code
 *   │   └───────────── date the box was minted — its shipment's save
 *   │                  (boxes.ts) — server clock (TZ=Asia/Jerusalem)
 *   └───────────────── the customer's code (customers.customer_code): 3 digits,
 *                      never a leading 0 (numeric storage would drop it), so
 *                      the width is fixed. A code that does not fit refuses
 *                      the mint (idCustomerCode).
 *
 * Max value 999,311,299,999,999 < 2^53, so the id stays exact as a JS Number
 * everywhere the app converts BigInt → Number.
 *
 * Ids minted before 2026-11-01 are 16 digits — "1", the customer's internal id
 * zero-padded to 3, then the same tail. They are never minted again but read
 * everywhere as new-format (prefix, position, order). Ids older than both
 * ("legacy") are shorter and follow no suffix rule: only items.package_id is
 * the truth about membership — the suffix is a human-readable convention for
 * labels and screens.
 */
import { parseItemId } from "@/lib/http/request";

export const CUSTOMER_CODE_DIGITS = 3;
export const ID_TOTAL_DIGITS = CUSTOMER_CODE_DIGITS + 12;
/** The 16-digit ids minted before the customer code: read, never minted. */
const PREV_ID_TOTAL_DIGITS = 16;
const PREV_ID_LEADING_DIGIT = "1";
export const MAX_DAILY_PACKAGES = 9999;
export const MAX_PACKAGE_SEQ = 99;
export const PACKAGE_SEQ = 0;

export type IdDateParts = {
  /** ddMMyy as it appears inside the id. */
  datePart: string;
  /** yyyy-MM-dd — the daily_counters primary key for the same local day. */
  dateKey: string;
};

/** Both the id's date and the counter's day come from the same local clock,
 *  so they can never disagree around midnight. */
export function localDateParts(now: Date = new Date()): IdDateParts {
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year4 = String(now.getFullYear());
  return {
    datePart: `${day}${month}${year4.slice(-2)}`,
    dateKey: `${year4}-${month}-${day}`,
  };
}

const CUSTOMER_CODE_RE = new RegExp(`^[1-9]\\d{${CUSTOMER_CODE_DIGITS - 1}}$`);

export function idCustomerCode(code: string | null | undefined): string | null {
  const s = (code ?? "").trim();
  return CUSTOMER_CODE_RE.test(s) ? s : null;
}

export const CUSTOMER_CODE_RULE = `קוד לקוח חייב להיות מספר בן ${CUSTOMER_CODE_DIGITS} ספרות שלא מתחיל ב-0`;

export function packageIdBase(customerCode: string, datePart: string, counter: number): string {
  const code = idCustomerCode(customerCode);
  if (code == null) {
    throw new RangeError(`customer code "${customerCode}" does not fit the ${CUSTOMER_CODE_DIGITS}-digit id field`);
  }
  if (!Number.isInteger(counter) || counter < 1 || counter > MAX_DAILY_PACKAGES) {
    throw new RangeError(`daily package counter ${counter} does not fit the 4-digit id field`);
  }
  if (!/^\d{6}$/.test(datePart)) {
    throw new RangeError(`date part "${datePart}" must be ddMMyy`);
  }
  return `${code}${datePart}${String(counter).padStart(4, "0")}`;
}

export function packageIdFromBase(base: string): bigint {
  return BigInt(`${base}${String(PACKAGE_SEQ).padStart(2, "0")}`);
}

export function itemIdFromBase(base: string, seq: number): bigint {
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_PACKAGE_SEQ) {
    throw new RangeError(`package position ${seq} must be 1..${MAX_PACKAGE_SEQ}`);
  }
  return BigInt(`${base}${String(seq).padStart(2, "0")}`);
}

/** True for ids minted by this module — today's 15 digits or the previous 16.
 *  Legacy ids are shorter. */
export function isNewFormatId(id: bigint | number | string): boolean {
  const s = String(id);
  if (!/^\d+$/.test(s)) return false;
  return (s.length === ID_TOTAL_DIGITS && s[0] !== "0")
    || (s.length === PREV_ID_TOTAL_DIGITS && s.startsWith(PREV_ID_LEADING_DIGIT));
}

export function baseOfId(id: bigint | number | string): string {
  const s = String(id);
  if (!isNewFormatId(s)) throw new RangeError(`${s} is not a new-format id`);
  return s.slice(0, -2);
}

/**
 * Sorts ids in the order they were minted: yyMMdd + the day's counter. The id
 * itself does not sort that way — its date is ddMMyy and it starts with the
 * customer — so "the newest box" is never the largest id. Both widths end in
 * the same ddMMyy NNNN SS tail, so they sort together. Legacy ids sort before
 * every new-format one, by their own value.
 */
export function mintOrderKey(id: bigint | number | string): string {
  const s = String(id);
  if (!isNewFormatId(s)) return `0${s.padStart(PREV_ID_TOTAL_DIGITS, "0")}`;
  const tail = s.slice(-12);
  return `1${tail.slice(4, 6)}${tail.slice(2, 4)}${tail.slice(0, 2)}${tail.slice(6, 10)}`;
}

/*
 * The display half: how an id is written on screens and labels, and how a
 * scanned label is read back. Client-safe (its one import is pure).
 */

const POSITION_DIGITS = 2;
const groupsOf4 = (s: string) => s.replace(/(\d{4})(?=\d)/g, "$1 ");

/** An id for the eye: the shared head and the position apart, so the box's
 *  "00" and an item's "01".. stand out. Today's id → { head: "323 011126
 *  0001", suffix: "00" } (customer code, date, the day's counter); the
 *  previous 16-digit id → { head: "1005 1509 2600 03", suffix: "00" }. A
 *  legacy id has no position: head = the whole id, suffix = "". */
export function formatId(id: string | number | bigint): { head: string; suffix: string } {
  const s = String(id);
  if (s.length === ID_TOTAL_DIGITS) {
    const date = CUSTOMER_CODE_DIGITS + 6;
    return { head: `${s.slice(0, CUSTOMER_CODE_DIGITS)} ${s.slice(CUSTOMER_CODE_DIGITS, date)} ${s.slice(date, -POSITION_DIGITS)}`, suffix: s.slice(-POSITION_DIGITS) };
  }
  if (s.length === PREV_ID_TOTAL_DIGITS) {
    return { head: groupsOf4(s.slice(0, -POSITION_DIGITS)), suffix: s.slice(-POSITION_DIGITS) };
  }
  return { head: groupsOf4(s), suffix: "" };
}

/** formatId as one line of text: "323 011126 0001 00". */
export function formatIdText(id: string | number | bigint): string {
  const { head, suffix } = formatId(id);
  return `${head} ${suffix}`.trim();
}

/** A position inside the box, two digits: 1 → "01"; none → "—". */
export function seq2(n: number | null | undefined): string {
  return n == null ? "—" : String(n).padStart(POSITION_DIGITS, "0");
}

/** A label's barcode payload: the id alone. Labels printed before also
 *  carried "-sourceId"; idOfLabel still reads those by their id part. */
export function barcodeOf(id: string | number | bigint): string {
  return String(id);
}

/** The id a label (or a URL segment carrying one) names — "<id>" or "<id>-<source>", the id read
 *  as text so no digit is lost past 2^53 — or null when it names none. */
export function idOfLabel(label: string): bigint | null {
  const m = /^(\d{1,19})(?:-\d*)?$/.exec(label);
  return m ? parseItemId(m[1]) : null;
}

/** A label's id part as typed: "<id>-<source>" → "<id>", anything else as it is. Text, not a
 *  number: a 16-digit id is past Number's exact range. */
export const labelIdText = (label: string): string => label.split("-")[0];

/** A label printed with its source: "<id>-<source>", both numbers. */
export const isSourcedLabel = (text: string): boolean => /^\d+-\d+$/.test(text);

/** The id part of a scanned label ("<id>" or "<id>-<source>"), or null when
 *  the text does not look like a label at all. */
export function scannedLabelId(raw: string): string | null {
  const m = raw.trim().match(/^(\d{6,})(?:-\d+)?$/);
  return m ? m[1] : null;
}

const NEW_FORMAT_LABEL = new RegExp(`^\\d{${ID_TOTAL_DIGITS},${PREV_ID_TOTAL_DIGITS}}(-\\d+)?$`);
const BOX_POSITION = String(PACKAGE_SEQ).padStart(POSITION_DIGITS, "0");

/** A scanned label read for intake: "box" (an id of either width at the
 *  package position), "item" (an id of either width at an item's position),
 *  or null (not a box-format label). */
export function boxLabelKind(raw: string): "box" | "item" | null {
  const s = raw.trim();
  if (!NEW_FORMAT_LABEL.test(s)) return null;
  return s.split("-")[0].endsWith(BOX_POSITION) ? "box" : "item";
}
