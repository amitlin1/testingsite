import type React from "react";

/**
 * A barcode scanner is a keyboard: for every character of the code it
 * "presses" the key that types it on a US keyboard, and the operating system
 * turns that key into a character by the ACTIVE layout. On the Hebrew layout
 * the lowercase letter keys come out as Hebrew letters ("Dani" → "Dשמן";
 * Shift still gives Latin capitals) and some punctuation moves ("/" → ".",
 * "'" → ","). Our barcodes hold only US-keyboard characters, so a field that
 * takes scans reads the physical key (KeyboardEvent.code) instead.
 */

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const US_KEYS: Record<string, [string, string]> = {
  ...Object.fromEntries([...LETTERS].map((c) => [`Key${c.toUpperCase()}`, [c, c.toUpperCase()]])),
  Digit1: ["1", "!"], Digit2: ["2", "@"], Digit3: ["3", "#"], Digit4: ["4", "$"], Digit5: ["5", "%"],
  Digit6: ["6", "^"], Digit7: ["7", "&"], Digit8: ["8", "*"], Digit9: ["9", "("], Digit0: ["0", ")"],
  Space: [" ", " "], Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
  Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", "\""], Comma: [",", "<"], Period: [".", ">"],
  Slash: ["/", "?"], Backquote: ["`", "~"],
};

/**
 * What to type instead of what the layout made of this key: the key's US
 * character, or null to let the browser type its own. Null for anything
 * that is not a plain printable key (a shortcut, Alt codes, numpad,
 * composition), and when the layout already gave one of the key's US
 * characters — then its own shift / Caps Lock state stands, even from a
 * source that does not report Shift.
 */
export function usKeyChar(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return null;
  const pair = US_KEYS[e.code];
  if (!pair || e.key === pair[0] || e.key === pair[1]) return null;
  return pair[e.shiftKey ? 1 : 0];
}

/**
 * onKeyDown for a field that takes scans: when the layout would type
 * something other than the US key, type the US key instead. Goes through
 * setRangeText + an input event so React's onChange sees an ordinary edit.
 * Returns true when it took the key.
 */
export function typeAsUsKeyboard(e: React.KeyboardEvent<HTMLInputElement>): boolean {
  const ch = usKeyChar(e.nativeEvent);
  if (ch == null) return false;
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? el.value.length;
  el.setRangeText(ch, start, el.selectionEnd ?? start, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// The Hebrew (Standard) layout: the character each US key types → that key.
const FROM_HEBREW: Record<string, string> = {
  "/": "q", "'": "w", "ק": "e", "ר": "r", "א": "t", "ט": "y", "ו": "u", "ן": "i", "ם": "o", "פ": "p",
  "ש": "a", "ד": "s", "ג": "d", "כ": "f", "ע": "g", "י": "h", "ח": "j", "ל": "k", "ך": "l", "ף": ";", ",": "'",
  "ז": "z", "ס": "x", "ב": "c", "ה": "v", "נ": "b", "מ": "n", "צ": "m", "ת": ",", "ץ": ".", ".": "/",
};

/**
 * For text that already went through a Hebrew layout (pasted, or typed where
 * the key could not be read): when it holds Hebrew letters — which a barcode
 * of ours never does — every character goes back to the US key that typed it.
 */
export function fromHebrewLayout(text: string): string {
  if (!/[א-ת]/.test(text)) return text;
  return [...text].map((c) => FROM_HEBREW[c] ?? c).join("");
}
