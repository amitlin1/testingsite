import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNDRAWN_TEXT, SAVED_JUST_NOW, cellErrorsText, cellLabel, changesText, columnCoverageText, columnPickLabel, coverageText, draftPillText,
  editorFooterText, emptyCellLabel, fieldsText, filterChipText, issuesToFixText, kitRouteMissingText, kitSummaryText, lineRouteMissingText,
  lineSubText, mapErrorBarText, mapFooterText, notOnRouteTooltip, openKitText, publishedPillText, qtyText, routeOptionText,
  routesCountText, savedAgoText, selectedCellsText, seqText, setTagText, sharedCellLabel, sharedCellTooltip, sharedFilledText, sharedRowTitle,
} from "../labels";

test("the artboard scripts' singular / plural forms", () => {
  assert.equal(fieldsText(1), "שדה אחד");
  assert.equal(fieldsText(5), "5 שדות");
  assert.equal(fieldsText(0), "0 שדות");
  assert.equal(selectedCellsText(1), "תא אחד נבחר");
  assert.equal(selectedCellsText(4), "4 תאים נבחרו");
  assert.equal(changesText(1), "שינוי אחד");
  assert.equal(changesText(6), "6 שינויים");
  assert.equal(draftPillText(6), "טיוטה · 6 שינויים");
  assert.equal(draftPillText(1), "טיוטה · שינוי אחד");
  assert.equal(issuesToFixText(1), "בעיה אחת לתיקון");
  assert.equal(issuesToFixText(3), "3 בעיות לתיקון");
  assert.equal(routesCountText(14), "14 מסלולים");
  assert.equal(routesCountText(1), UNDRAWN_TEXT.routesOne);
  assert.equal(coverageText(15, 20), "כיסוי 15/20");
  assert.equal(columnCoverageText(5, 6), "מוגדרים 5/6");
  assert.equal(kitSummaryText(4, 5), "מארז · 4 סוגי פריטים · 5 יחידות");
  assert.equal(kitSummaryText(1, 1), "מארז · " + UNDRAWN_TEXT.kitKindsOne + " · " + UNDRAWN_TEXT.kitUnitsOne);
  assert.equal(publishedPillText(4), "מפורסם · גרסה 4");
});

test("the map's rows, cells and tooltips", () => {
  assert.equal(seqText(1, 1), "01");
  assert.equal(seqText(2, 3), "02–03");
  assert.equal(seqText(12, 12), "12");
  assert.equal(qtyText(2), "×2");
  assert.equal(lineSubText(1, 4), "מסלול 1 · 4 עמדות");
  assert.equal(lineSubText(2, 1), "מסלול 2 · " + UNDRAWN_TEXT.stationsOne);
  assert.equal(lineRouteMissingText(2), "לסוג הפריט אין מסלול מספר 2");
  assert.equal(kitRouteMissingText(1), "לסוג המארז אין מסלול מספר 1");
  assert.equal(routeOptionText("מארז עמדת עבודה", 1), "מארז עמדת עבודה · מסלול 1");
  assert.equal(columnPickLabel("חשמל"), "בחירת כל התאים בעמדה חשמל");
  assert.equal(filterChipText("ללא שדות", 5), "ללא שדות · 5");
  assert.equal(cellLabel("מכניקה", "מסך"), "מכניקה · מסך");
  assert.equal(sharedCellLabel("חשמל", "מסך", 3), "חשמל · מסך · 3 שדות משותפים");
  assert.equal(emptyCellLabel("חשמל", "מקלדת"), "חשמל · מקלדת · ללא שדות");
  assert.equal(cellErrorsText(1), "שגיאה אחת");
  assert.equal(cellErrorsText(2), "2" + UNDRAWN_TEXT.errorsSuffix);
  assert.equal(setTagText("חזותית בסיסית"), "ערכה: חזותית בסיסית");
  assert.equal(notOnRouteTooltip("מקלדת", "חשמל", 1), "מקלדת לא עוברת בעמדת חשמל במסלול 1");
  assert.equal(sharedRowTitle(["מארז ציוד היקפי"]), "משותף ל: מארז ציוד היקפי");
  assert.equal(sharedCellTooltip(1, "מסך", ["מארז עמדת עבודה"]), "הוגדר במסלול 1 של מסך · משותף עם מארז עמדת עבודה");
  assert.equal(sharedFilledText(3, "מסך", 1, ["מארז עמדת עבודה"]), "3 תאים כבר מלאים: מסך משתמש במסלול 1 שלו, שמוגדר גם במארז עמדת עבודה.");
  assert.equal(openKitText("מארז עמדת עבודה"), "פתח את מארז עמדת עבודה");
});

test("the map footer, as artboards 1 and 11 write it", () => {
  assert.equal(mapFooterText({ fields: 37, emptyCells: 5, errors: 1, sharedOnly: false }), "37 שדות · 5 תאים ללא שדות · שגיאה אחת");
  assert.equal(mapFooterText({ fields: 8, emptyCells: 13, errors: 0, sharedOnly: true }), "8 שדות משותפים · 13 תאים ללא שדות");
  assert.equal(mapFooterText({ fields: 1, emptyCells: 1, errors: 0, sharedOnly: false }), "שדה אחד · " + UNDRAWN_TEXT.emptyCellsOne);
});

test("the map's error bar: an empty option takes the artboard's wording", () => {
  assert.equal(mapErrorBarText("מכניקה", "מסך", { code: "OPTION_LABEL_EMPTY", message: "x" }, "ברגי VESA"), "מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'");
  assert.equal(mapErrorBarText("חשמל", "מחשב", { code: "FIELD_LABEL_EMPTY", message: "יש להזין שם לשדה" }, ""), "חשמל · מחשב: יש להזין שם לשדה");
});

test("the editor card's footer (artboard 2)", () => {
  assert.equal(editorFooterText(5, 4, 1), "5 שדות · 4 חובה · שורה אחת ללא שם · גרירה או Alt+חיצים לשינוי סדר");
  assert.equal(editorFooterText(1, 1, 0), "שדה אחד · חובה אחד · גרירה או Alt+חיצים לשינוי סדר");
  assert.equal(editorFooterText(3, 0, 2), "3 שדות · 0 חובה · 2 שורות ללא שם · גרירה או Alt+חיצים לשינוי סדר");
});

test("the save time as a relative time", () => {
  const t = Date.parse("2026-10-14T10:00:00.000Z");
  assert.equal(savedAgoText(t, t + 59_000), SAVED_JUST_NOW);
  assert.equal(savedAgoText(t, t - 5_000), SAVED_JUST_NOW, "clock skew reads as just now");
  assert.equal(savedAgoText(t, t + 60_000), UNDRAWN_TEXT.savedMinuteAgo);
  assert.equal(savedAgoText(t, t + 5 * 60_000), "נשמר אוטומטית לפני 5 דקות");
  assert.equal(savedAgoText(t, t + 60 * 60_000), UNDRAWN_TEXT.savedHourAgo);
  assert.equal(savedAgoText(t, t + 3 * 3600_000), "נשמר אוטומטית לפני 3 שעות");
  assert.equal(savedAgoText(t, t + 24 * 3600_000), UNDRAWN_TEXT.savedDayAgo);
  assert.equal(savedAgoText(t, t + 2 * 24 * 3600_000), "נשמר אוטומטית לפני יומיים", "two days: artboard 8's word");
  assert.equal(savedAgoText(t, t + 4 * 24 * 3600_000), "נשמר אוטומטית לפני 4 ימים");
});
