// A keyboard-wedge scanner on a Hebrew layout: the keys it presses come out as
// Hebrew letters and moved punctuation. usKeyChar reads the key back;
// fromHebrewLayout repairs text that already went through the layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHebrewLayout, usKeyChar } from "../scannerKeys";

// `key` is what the layout typed, `code` the physical key.
const press = (key: string, code: string, shiftKey = false, extra: Partial<KeyboardEvent> = {}) =>
  ({ key, code, shiftKey, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...extra }) as KeyboardEvent;

test("usKeyChar: a Hebrew layout's character becomes the key's US character", () => {
  assert.equal(usKeyChar(press("ג", "KeyD")), "d");
  assert.equal(usKeyChar(press("/", "KeyQ")), "q");
  assert.equal(usKeyChar(press(".", "Slash")), "/");
  assert.equal(usKeyChar(press(",", "Quote")), "'");
  assert.equal(usKeyChar(press("ץ", "Period")), ".");
});

test("usKeyChar: a character the key types on a US keyboard is left to the browser", () => {
  assert.equal(usKeyChar(press("d", "KeyD")), null);
  assert.equal(usKeyChar(press("D", "KeyD", true)), null);
  // Shift not reported (some input tools), Caps Lock: the layout's own case stands.
  assert.equal(usKeyChar(press("|", "Backslash")), null);
  assert.equal(usKeyChar(press("A", "KeyA")), null);
  assert.equal(usKeyChar(press("1", "Digit1")), null);
});

test("usKeyChar: leaves shortcuts, Alt codes, composition and unknown keys alone", () => {
  assert.equal(usKeyChar(press("ה", "KeyV", false, { ctrlKey: true })), null);
  assert.equal(usKeyChar(press("1", "Numpad1", false, { altKey: true })), null);
  assert.equal(usKeyChar(press("ש", "KeyA", false, { isComposing: true })), null);
  assert.equal(usKeyChar(press("Enter", "Enter")), null);
  assert.equal(usKeyChar(press("5", "Numpad5")), null);
});

test("fromHebrewLayout: a shipment barcode scanned on a Hebrew layout reads back as typed", () => {
  // "1|SH-15|323|19/10/2026|Dani Cohen 0501234567" on the Hebrew layout:
  const scanned = "1|SH-15|323|19.10.2026|Dשמן Cםיקמ 0501234567";
  assert.equal(fromHebrewLayout(scanned), "1|SH-15|323|19/10/2026|Dani Cohen 0501234567");
  assert.equal(fromHebrewLayout("O,Nקןך"), "O'Neil");
});

test("fromHebrewLayout: text with no Hebrew letters is left exactly as it is", () => {
  assert.equal(fromHebrewLayout("1|SH-15|323|19/10/2026|DANI 050"), "1|SH-15|323|19/10/2026|DANI 050");
});
