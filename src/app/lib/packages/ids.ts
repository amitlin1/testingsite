/**
 * Item / package identifiers — docs/packages/PLAN.md §2.
 *
 * A new-format id is a fixed 16-digit number:
 *
 *   1 CCC ddMMyy NNNN SS
 *   │ │   │      │    └─ position inside the package: 00 = the package itself,
 *   │ │   │      │       01..99 = items in the order they were added
 *   │ │   │      └────── daily package counter (0001..9999)
 *   │ │   └───────────── intake date, server clock (TZ=Asia/Jerusalem)
 *   │ └───────────────── customer id, zero-padded to 3 digits
 *   └─────────────────── constant leading digit, so the customer's leading
 *                        zeros survive numeric storage and the width is fixed
 *
 * Max value 1,999,999,999,999,999 < 2^53, so the id stays exact as a JS
 * Number everywhere the app converts BigInt → Number. Ids created before this
 * format ("legacy") are shorter and follow no suffix rule: only
 * items.package_id is the truth about membership — the suffix is a
 * human-readable convention for labels and screens.
 */

export const ID_LEADING_DIGIT = "1";
export const ID_TOTAL_DIGITS = 16;
export const MAX_CUSTOMER_ID = 999;
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

/** The 14-digit prefix shared by a package and every item inside it. */
export function packageIdBase(customerId: number, datePart: string, counter: number): string {
  if (!Number.isInteger(customerId) || customerId < 1 || customerId > MAX_CUSTOMER_ID) {
    throw new RangeError(`customer id ${customerId} does not fit the 3-digit id field`);
  }
  if (!Number.isInteger(counter) || counter < 1 || counter > MAX_DAILY_PACKAGES) {
    throw new RangeError(`daily package counter ${counter} does not fit the 4-digit id field`);
  }
  if (!/^\d{6}$/.test(datePart)) {
    throw new RangeError(`date part "${datePart}" must be ddMMyy`);
  }
  return `${ID_LEADING_DIGIT}${String(customerId).padStart(3, "0")}${datePart}${String(counter).padStart(4, "0")}`;
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

/** True for ids minted by this module. Legacy ids are shorter. */
export function isNewFormatId(id: bigint | number | string): boolean {
  const s = String(id);
  return s.length === ID_TOTAL_DIGITS && s.startsWith(ID_LEADING_DIGIT) && /^\d+$/.test(s);
}

/** The shared prefix of a new-format id (everything but the position). */
export function baseOfId(id: bigint | number | string): string {
  const s = String(id);
  if (!isNewFormatId(s)) throw new RangeError(`${s} is not a new-format id`);
  return s.slice(0, ID_TOTAL_DIGITS - 2);
}

/** Display helper ONLY — the truth is items.package_id. */
export function displayPackageIdOf(id: bigint | number | string): bigint | null {
  return isNewFormatId(id) ? packageIdFromBase(baseOfId(id)) : null;
}

/** Display helper ONLY. 0 for a package, 1..99 for an item, null for legacy. */
export function displaySeqOf(id: bigint | number | string): number | null {
  return isNewFormatId(id) ? Number(String(id).slice(-2)) : null;
}
