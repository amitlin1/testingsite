# Handoff: עיצוב מחדש למסך הבדיקה (Testing) — תצוגת "תור לבדיקה"

> קובץ ה‑HTML בחבילה (`Testing Screen Redesign.dc.html`) הוא **רפרנס עיצובי** — אב‑טיפוס אינטראקטיבי שמראה את המראה וההתנהגות הרצויים, לא קוד ייצור להעתקה. המשימה: **לשחזר את העיצוב בקוד האמיתי** בקובץ `src/app/testing/page.tsx` (ורכיב `ItemCard` שבתוכו), תוך שמירה מלאה על הפונקציונליות הקיימת. שינוי ויזואלי/פריסה בלבד — בלי לגעת ב‑data fetching, סטטוסים, טיימרים, פתיחת דיאלוגים, סריקה, היסטוריה או ה‑API.

---

## פרומפט מוכן להדבקה ב‑Claude Code

```
עצב מחדש את מסך הבדיקה (src/app/testing/page.tsx) כדי שיהיה ידידותי לעבודה בפס
הייצור, לפי מערכת העיצוב Shifthouse. אל תשנה לוגיקה, קריאות API, ניהול סטייט,
סטטוסים, טיימרים או פתיחת דיאלוגים — פריסה ועיצוב בלבד. הבעיה היום: כרטיס בודד
"מרחף" בתוך מרחב ריק ענק, בלי סדר עדיפויות ובלי מבט‑על. שנה כך:

1) הוסף רצועת סיכום (summary strip) מעל הרשת: 4 אריחים לבנים — "בתור"
   (מונה waiting), "בבדיקה" (מונה in-test), "הושלמו היום", "המתנה הארוכה ביותר"
   (הטיימר הגדול ביותר מבין הממתינים, בצבע ענבר). זה ממלא את הרוחב ונותן מבט‑על.
2) מיין את הפריטים לפי עדיפות: קודם ממתינים (waiting) לפי זמן המתנה יורד (הכי
   הרבה זמן קודם), אחר כך בבדיקה, אחר כך שהושלמו. סמן את הפריט הממתין הכי הרבה
   בסרט "עדיפות — ממתין הכי הרבה" (ענבר) ובמסגרת ענבר דקה + הילה רכה.
3) הגדל את הכרטיסים ועשה אותם ידידותיים למגע: #id ב‑24px/800, status כ‑pill עם
   נקודה צבעונית, שדות סריאלי/מק״ט/לקוח/שלב נוכחי ברשת 2×2, טיימר בצבע הסטטוס,
   וכפתור פעולה בגובה 48px: "התחל בדיקה" (ממתין) / "המשך בדיקה" (בבדיקה) /
   "הושלם" (ghost ירוק, disabled).
4) צבעי סטטוס לפי מערכת העיצוב במקום צבעי MUI הגנריים: ממתין ענבר #d97706,
   בבדיקה כחול #0066cc, הושלם ירוק #1f8a5b. כפתור הפעולה הראשי כחול #0066cc
   (לא כתום). הסר את אנימציית ה‑Grow ואת הצללים הכלליים — קלפים שטוחים עם
   hairline #e0e0e0.
5) רשת: grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap 16px.
6) השאר את סרגל התחנה העליון (TestingDock), בורר עמדה/עובד, סריקת ברקוד,
   סינון, היסטוריה, תגית "נסרק" ותפריט "פריטים מחוברים" — בדיוק כמו היום.

ראה מפרט מלא ורפרנס אינטראקטיבי ב‑Testing Screen Redesign.dc.html המצורף.
```

---

## מה משתנה בדיוק (ומה לא)

**לא נוגעים:** `useElapsedTime`, כל ה‑state וה‑`useEffect` של הדף, `handleStartTest`, `handleAddTestResult`, `handleRefreshItems`, `handleSubmitTestResult`, בורר העמדות/עובד (`TestingDock`), סריקה (`scannerOpen`), היסטוריה (`StationHistoryDialog` / `historyDialogOpen`), רזולוציית הדיאלוג מה‑REGISTRY (`getStartTestDialog`), `filteredItems`, `highlightedItemId`, `connected_items`, וכל השדות של `ItemRow`.

**משתנה — פריסה/עיצוב בלבד:**

### 1. סרגל צד (כבר קיים, לא לשנות)
ה‑`NavBar` הכהה מימין (`#15171a`, active `rgba(41,151,255,0.14)` + פס `#2997ff`) נשאר כמו שהוא. באב‑הטיפוס הוא משוחזר רק כדי להראות הקשר.

### 2. רצועת סיכום — רכיב חדש מעל הרשת
מעל ה‑Items Grid, לפני ה‑Control Bar (או אחריו), הוסף `Box` עם
`display:grid; gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))"; gap:"14px"`.
4 אריחים לבנים (`border:1px solid #e0e0e0; borderRadius:16px; p:"16px 18px"`), כל אחד: אייקון בריבוע צבע רך + מספר גדול (26px/800, tabular-nums) + label.
- **בתור** = `filteredItems.filter(status∈{2,4}).length` · ענבר.
- **בבדיקה** = `filteredItems.filter(status∈{1,5}).length` · כחול.
- **הושלמו היום** = מונה קיים אם יש; אחרת אפשר להשאיר placeholder עד שיחובר.
- **המתנה הארוכה ביותר** = ה‑`elapsedTime` הגדול ביותr מבין הממתינים (ענבר). אם קשה לחשב ברמת הדף (הטיימר חי ברמת הכרטיס), אפשר לגזור מ‑`queue_start_time` המוקדם ביותר.

### 3. מיון הרשת לפי עדיפות
לפני `.map`, מיין עותק של `filteredItems`:
```
const rank = (it) => (it.current_status===2||it.current_status===4) ? 0
                   : (it.current_status===1||it.current_status===5) ? 1 : 2;
const baseTime = (it) => new Date(it.queue_start_time || it.processing_start_time || 0).getTime();
const ordered = [...filteredItems].sort((a,b) => rank(a)-rank(b) || baseTime(a)-baseTime(b));
// הממתין הכי הרבה = ה‑waiting הראשון עם baseTime הקטן ביותר
```
הפריט הממתין הכי הרבה (`ordered.find(waiting)`) מקבל `priority`.

### 4. `ItemCard` — עיצוב מחדש (אותה חתימה, אותה לוגיקת onClick)
- **מיכל:** `Card elevation={0}`, `borderRadius:"16px"`, `border:"1px solid #e0e0e0"` (priority → `1.5px solid #d97706` + `boxShadow:"0 0 0 3px rgba(217,118,6,0.10)"`; highlighted/נסרק נשאר `#0066cc`). **הסר `<Grow>`** או השאר timeout קצר — ללא bounce.
- **סרט עדיפות:** כשה‑item הוא הממתין הכי הרבה — Chip ענבר "עדיפות — ממתין הכי הרבה" בפינה (`top:-11`), במקום/לצד תגית "נסרק".
- **כותרת:** `#{item_id}` 24px/800 letter-spacing −0.5px + `model` 13.5px משני; מימין status pill עם נקודה צבעונית + `item_status_desc`.
- **שדות:** רשת 2×2 (`gridTemplateColumns:"1fr 1fr"`, gap 14px 12px): סריאלי, מק״ט, לקוח, שלב נוכחי (עם אייקון). label 11.5px `#9a9aa0`, ערך 14.5px/600, מספרים tabular-nums.
- **טיימר:** בלוק `padding:"10px 13px"`, `borderRadius:11`, רקע רך של צבע הסטטוס, אייקון שעון + `${ממתין:|בבדיקה:} ${elapsedTime}`.
- **פריטים מחוברים:** כפתור/תפריט קיים נשאר — עצב אותו כ‑outline נייטרלי (`#d4d4dc`).
- **כפתור פעולה:** גובה 48px, `borderRadius:12`. ממתין → כחול מלא #0066cc "התחל בדיקה" + אייקון play; בבדיקה → כחול "המשך בדיקה"; הושלם → ghost ירוק disabled "הושלם". שמור את לוגיקת ה‑onClick הקיימת (isWaiting→hasWizard? onAddTestResult : onStartTest; isInTest→onAddTestResult).

### 5. Control Bar + Empty state
- Control Bar (שם עמדה + מונה + סינון + היסטוריה): התאם ל‑hairline/פינות של המערכת (borderRadius 14, border `#e0e0e0`, ללא צל), אבל ההתנהגות זהה. אפשר למזג את כותרת "התור לבדיקה" + "ממוינים לפי זמן המתנה" מעל הרשת.
- Empty state: אותו רעיון, אייקון בעיגול לבן + כותרת "אין פריטים תואמים בעמדה זו." + שורת עזר.

---

## Design tokens (Shifthouse)
- **Action Blue** `#0066cc` (hover `#0058b3`), focus `#0071e3`.
- סטטוס: ממתין ענבר `#d97706` (רקע `rgba(217,118,6,0.10)`), בבדיקה כחול `#0066cc` (רקע `rgba(0,102,204,0.10)`), הושלם ירוק `#1f8a5b` (רקע `rgba(31,138,91,0.10)`). **החלף את `#ff9800`/`#2196f3`/`#4caf50` הישנים.**
- טקסט `#1d1d1f` / משני `#7a7a7a` / עמום `#9a9aa0`. רקע דף `#f5f5f7`, קלף `#fff`, hairline `#e0e0e0`, מפריד רך `#f0f0f0`.
- פינות: קלף 16px, אריח סיכום 16px, כפתור פעולה 12px, pill `9999px`. אין צללים על קלפים.
- טיפוגרפיה: #id 24px/800 (−0.5px), מספר סיכום 26px/800, label שדה 11.5px, ערך 14.5px/600; מספרים tabular-nums.
- אייקונים: אותם אייקוני `@/components/ui/icons` (Science, Search, History, QrCode, AccessTime, Speed…), stroke ~1.75, ללא מילוי.
- ללא אימוג'י, ללא סימני קריאה. שעות `00:57:08`.

## Files
- `Testing Screen Redesign.dc.html` — אב‑הטיפוס האינטראקטיבי (סינון חי, toggle "שינוי עמדה ועובד", מיון עדיפות, סרט עדיפות). זה הרפרנס לפריסה, לפרופורציות ולצבעי הסטטוס.
