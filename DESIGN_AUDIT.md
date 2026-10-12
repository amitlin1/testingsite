# ביקורת עיצוב ו-UI — שלב 1 (ביקורת בלבד, בלי שינויי קוד)

- **תאריך:** 2026-10-11
- **ענף:** `design/ui-polish-audit` (נפתח מ-`main` אחרי pull, `c198a6a`)
- **היקף:** כל המסכים החיים (פריטים, בדיקות, מארזים, משלוחים, דשבורד, היסטוריית פריט, הגדרות, קבצים, דפי התחברות), מעטפת האפליקציה, ורכיבי הבסיס ב-`src/components/ui`.
- **שיטה:** קריאה ידנית של הקוד וספירות grep. כל מספר שורה בדוח נבדק מול הקוד. לא הורצו שרת הפיתוח ולא דפדפן, ולכן ממצאים שתלויים ברינדור מסומנים "לאמת בדפדפן".

---

## 0. הערות פתיחה

1. **אין MUI בפרויקט ולא יהיה.** הפרומפט המקורי מדבר על `createTheme` ו-component overrides של MUI. כאן התפקידים האלה ממופים למערכת הפנימית "Shifthouse":

   | תפקיד בפרומפט | המקבילה בפרויקט |
   |---|---|
   | `createTheme` (palette, typography, spacing, shape) | `src/styles/tokens.css`, נחשף ל-Tailwind דרך `@theme inline` ב-`src/app/globals.css` |
   | אובייקט theme ב-JS | `src/components/ui/theme.ts`: עותק hex גולמי של הטוקנים, ו-palette בצורה של MUI לתאימות לאחור |
   | component overrides | `src/components/ui/ui.css`: מחלקות `.sh-*` עם מצבי hover, focus ו-active |
   | ספריית הרכיבים | `src/components/ui/*` (Button, TextField, Dialog, Table וכו'), מיובאת דרך `@/components/ui` |
   | `sx` / system props | `src/components/ui/sx.ts`: מתרגם `sx` לסטייל inline (ראו 2.9, זה מקור לבאגים רבים) |

   כל ההמלצות בדוח הזה נשענות על השכבות האלה. אף המלצה לא מוסיפה ספרייה.

2. **ה-skills.**
   - **`impeccable` 4.5.2** (מנוע 0.1.14) הותקן ב-`.claude/` של הפרויקט, יחד עם hook של הגלאי ב-`.claude/settings.local.json`.
     - `impeccable context`: אין PRODUCT.md ואין DESIGN.md. הקוד הקיים הוא סמכות העיצוב, ולכן ביקורת ממוקדת מותרת בלי `init`.
     - `impeccable detect src` (הגלאי הסטטי, כל הכללים): ממצא אחד בלבד. `overused-font` על `font-family: Arial` ב-`reports/ReportKit.tsx:34`, שהוא fallback בערכת ההדפסה, ולכן לא רלוונטי.
     - הגלאי הסטטי מחפש דפוסי "slop" ב-CSS ו-HTML. הוא לא מזהה את מה שמאפיין את הקוד הזה: hex בתוך אובייקטי `style`, `sx` שנבלע, וניגודיות ברמת הטוקן.
     - מצב ה-URL של הגלאי (סריקת דף מרונדר: ניגודיות, גלישה, אזורי לחיצה) לא הורץ, כי הוא דורש את האפליקציה רצה עם התחברות Keycloak.
     - הממצאים בדוח הם לכן ידניים ומאומתים מול הקוד.
   - **`emil-design-eng`** לא מותקן. ההנחיות שלו נקראו משכפול של הריפו (`emilkowalski/skills`, `skills/emil-design-eng/SKILL.md`).

3. **מצב המסך:** זה ממשק עבודה ("Operate" בלשון impeccable): טבלאות צפופות, דיאלוגים ועמדות סריקה שמשתמשים בהם כל היום. הסטנדרט שנגזר מזה הוא עקביות, סריקוּת וממשק שלא מפריע למשימה. אין כאן מקום ל"ביטוי".

4. **קוד מת:** 22 קבצים ב-`src/app/components/dashboard/` (4,357 שורות) לא נגישים מאף נתיב. (`reports/TestResultsReportDocument.tsx` גם לא מיובא עדיין, אבל הוא נוסף היום כחלק מתבנית הדוחות, `docs/REPORT_TEMPLATE.md`, ולכן הוא לא קוד מת.) בדקתי: כל מי שמייבא אותם הוא בעצמו קובץ מת. אלה מסכי הדשבורד מתקופת MUI, וכן ארבעת `*HistoryDialog` ש-`HistoryOverlay` כבר החליף. **הם לא נכללים בממצאים.** בספירות הם מצוינים בנפרד.

---

## 1. תקציר

### 1.1 ציון בריאות (לפי תבנית ה-audit של impeccable)

| # | ממד | ציון | הממצא המרכזי |
|---|---|---|---|
| 1 | נגישות | **1/4** | זרימות מרכזיות לא עובדות במקלדת: שורות בטבלת הפריטים, בחירת סוג עמדה, אשף סגירת מארז ומיון בדשבורד. בכ-35 שדות קלט אין סימון פוקוס. גוון הטקסט המשני של המערכת נכשל ב-AA. |
| 2 | ביצועים | **3/4** | הגרפים בדשבורד כבר לא מונפשים, ויש מעט אנימציות. החריגים: הסרגל הצדי מנפיש `margin` ו-`width`, ותור הבדיקות מהבהב עם skeleton בכל רענון. |
| 3 | Theming | **2/4** | הטוקנים קיימים אבל יש שלושה מקורות מקבילים, כ-930 ערכי hex מקודדים (כ-234 מהם בקוד מת), ושש פלטות מקומיות. |
| 4 | רספונסיביות | **2/4** | כ-20 ערכים רספונסיביים ב-`sx` נבלעים בשקט, ובגללם גרידים קורסים לעמודה אחת. פאנל הסריקה בעמדה נגיש רק ב-hover. |
| 5 | שלמות המימוש | **1/4** | שתי מערכות רכיבים מקבילות (`.sh-*` מול `.shx-*`). שכבת `sx` שבולעת hover ו-media בשקט. 26 אייקונים מוצגים בגודל שגוי. כפתורי אשף שנראים פעילים כשהם מושבתים. |
| | **סה״כ** | **9/20** | **Poor.** אבל רוב החוב מכני: הוא נובע משכבת התאימות ומהעתקות, לא מכיוון עיצובי שגוי. השפה החזותית (כחול אחד, משטחים שטוחים, Rubik) קוהרנטית בכוונה, ותיקון הבסיס יפתור חלק גדול מהבעיות בבת אחת. |

### 1.2 עשרת הממצאים החמורים

1. **פונט שגוי בשורות הפעולה הראשיות.** המחלקות `.shx-btn` ו-`.shx-input` וגם `EditItemDialog` מבקשים `'Heebo','Inter'`. אף אחד מהפונטים האלה לא ארוז באפליקציה (רשת סגורה), ולכן בפועל הם מוצגים ב-**Segoe UI**. זה פוגע בכפתור "קליטת מארז" ובשדה החיפוש במסך הפריטים, בכפתור "הוסף" ובחיפוש בכל 9 דפי ההגדרות, ובכפתור "משלוח חדש". (`src/styles/shifthouse.css:28`)
2. **שכבת `sx` בולעת בשקט hover, focus ו-layout:**
   - כ-70 סלקטורים מקוננים (`&:hover`, `& .Mui…`) לא עושים כלום. בגלל זה **לסרגל הניווט הצדי אין hover בכלל**, ול-`SettingsSubNav` אין קו תחתון לטאב הפעיל.
   - כ-20 ערכים רספונסיביים (`{xs, md}`) נמחקים לגמרי. בגלל זה הגריד של עמדות בדיקה (`330px 1fr`), הטופס בפריטי ייחוס, ושלושת טופסי המשלוח (חדש, עריכה, החזרה) קורסים לעמודה אחת.
3. **ניגודיות ברמת הטוקן.**
   - `--color-ink-muted-48` `#7a7a7a` הוא הטקסט המשני של כל המערכת: יחס 4.29:1 על לבן, ו-3.94:1 על parchment (בכל כותרת עמודה בכל טבלה).
   - `--color-ink-muted-40` `#9a9aa0` (2.80:1) משמש לנתונים אמיתיים.
   - הענבר `#d97706` כטקסט: 3.19:1. הירוק `#1f8a5b`: 4.33:1.
   - גבולות שדות קלט: 1.32:1.
4. **כ-35 שדות קלט בלי שום סימון פוקוס** (`outline:none` בלי תחליף). זה כולל את שדות הסריקה ואת כל טפסי המארזים. בשדות הסריקה, צבע הגבול משתנה לפי *הערך* ולא לפי הפוקוס.
5. **זרימות שלא אפשריות במקלדת:** פתיחת פריט מהטבלה הראשית, בחירת סוג עמדה (ובלעדיה אי אפשר לנהל עמדות), עריכת פריט ייחוס, פתיחת תיקייה בקבצים, סיום אשף סגירת מארז, מיון ופתיחת היסטוריה בדשבורד.
6. **כפתורי האשף בעמדות.** `bgcolor` inline דורס את מצבי `:disabled` ו-`:hover`. כפתור "המשך" מושבת מציג אפור על כחול (1.30:1), וכפתור הסיום אפור על ירוק (1.01:1). שניהם נראים פעילים. (`stationKit.tsx:438-446`)
7. **כשל נראה כמו "אין נתונים".** שגיאת טעינה בפריטים, בתור הבדיקות, במשלוחים, במארזים, בפריטי ייחוס ובמסלולים מוצגת כרשימה ריקה. בדשבורד, בזמן טעינה מוצג "0 פעילים" ו"אין משלוחים פתוחים. יום שקט.". זה מפר את כלל "לא מזייפים מספר".
8. **זרימת הסריקה נכשלת בשקט:**
   - הודעת שגיאת סריקה מוצגת כטקסט רגיל, כי `error.light` לא ממופה ל-`sx`.
   - שדה הסריקה מושבת בזמן טעינה ומאבד פוקוס, ולכן הסריקה הבאה לא נכנסת לשום שדה.
   - 26 אייקונים עם `sx={{fontSize}}` מוצגים כולם ב-24px.
9. **RTL:**
   - חיצי "חזור" ו"המשך" באשפי העמדות הפוכים.
   - חץ "חזרה למארזים" הפוך.
   - חיצי החודש ב"שעות עבודה" מוחלפים.
   - חץ ה-select בפילטרי הדשבורד יושב מעל הטקסט.
   - "3 / 5" מוצג כ-"5 / 3", גם על מדבקת ברקוד מודפסת.
10. **8 מודלים בנויים ידנית במסכי המארזים, ועוד 4 במסכים אחרים**, בלי `role="dialog"`, בלי לכידת פוקוס ובלי Escape מדורג:
    - Esc בדיאלוג פנימי סוגר את האשף שמתחתיו ומשחרר את הקופסה.
    - גרירת בחירת טקסט אל מחוץ לשדה סוגרת את הדיאלוג ומאבדת קלט.

### 1.3 החלטות שנדרשות ממך לפני שלב 2

| # | החלטה | ההמלצה שלי |
|---|---|---|
| D1 | להכהות את הטקסט המשני (`#7a7a7a` ל-`#6e6e73`) ואת דיו הענבר והירוק. השינוי נראה בכל המסכים ובארטבורדים. | כן. בלי זה אין AA. |
| D2 | סולם טיפוגרפי למוצר. הטוקנים הנוכחיים (17/21/24/28/34/40/56) הועתקו ממערכת שיווקית של Apple, ובפועל הקוד משתמש ב-11.5 עד 14px. | סולם מוצר: 11/12/13/14/15/17/20/24/30, כטוקנים לפי תפקיד, עם השמות הישנים כ-alias. כפתורים ושדות ב-15px במקום 17px. |
| D3 | סדר הכפתורים בדיאלוג. `ui.css` שם את הפעולה הראשית בתחילת השורה (ימין). הארטבורדים, `packages` ו-`reference-items` שמים אותה בסוף. | לפי הארטבורד (פעולה ראשית בסוף), אחיד בכל המערכת. |
| D4 | התנגשויות עם הארטבורדים, ראו §5. | החלטה פרטנית לכל אחת. |
| D5 | ממצאים מחוץ לשכבה הוויזואלית, ראו §4 (באגים לוגיים שהתגלו בדרך). | לטפל בנפרד, לא בענף הזה. |
| D6 | שינויים ב-`Autocomplete.tsx`. לפי הסיכום הקודם, כל שינוי שם דורש את אישורך. | אגע בו רק אם תאשר. רוב התיקונים אפשריים בלעדיו. |
| D7 | למחוק את 22 קבצי הדשבורד המתים. | כן, בצעד נפרד. `TestResultsReportDocument` נשאר: הוא חדש ומיועד לשימוש. |
| D8 | להתחיל ב"תיקונים מהירים" (צעד A0 ב-§7) לפני שלב הבסיס. | כן. אלה 10 תיקונים קטנים ומבודדים עם השפעה גבוהה. |

---

## 2. מצב מערכת העיצוב היום

### 2.1 השכבות

| שכבה | קובץ | מה יש בה | בעיה |
|---|---|---|---|
| טוקנים | `src/styles/tokens.css` | צבעים, `--fs-*`, `--space-*`, `--r-*`, צל, תנועה, layout | סולם הטיפוגרפיה, הריווח וה-layout כמעט לא בשימוש: `--fs-*` ו-`--space-*` מופיעים רק ב-`command-palette.css`. `--topnav-h:44` כשהסרגל העליון בפועל 56px. `--sidebar-w:248` כשהרוחב בפועל 240px. `.sh-press` מוגדר ולא בשימוש. |
| גשר ל-Tailwind | `src/app/globals.css` `@theme inline` | חושף את הטוקנים כ-utilities | **0 שימושים ב-utilities של Tailwind בקומפוננטות.** העיצוב כולו בנוי מכ-1,551 אובייקטי `style={{}}` וכ-948 שימושי `sx`. |
| Theme ב-JS | `src/components/ui/theme.ts` | עותק hex של הטוקנים, palette בצורת MUI, `alpha()` | עותק כפול שעלול להתפצל מהמקור. `secondary.main: #455A64` הוא שארית MUI. `breakpoints.*` מחזירים מחרוזת ריקה. `alpha()` לא יודע לעבוד עם `var()`. |
| מערכת מקבילה | `src/styles/shifthouse.css` (`.shx-*`, `--shx-*`) | טבלה, שדות, כפתורים, scrollbar | עותק שלישי של הצבעים. פונט Heebo שלא ארוז. כפתור עם scale 0.97 מול 0.95 ב-`.sh-btn`. פוקוס של גבול 1px בלבד. בשימוש ב-12 קבצים. |
| פלטות מקומיות | `packageUi.ts` (23 קבועים), `stationKit.tsx:28-37`, `testing/page.tsx:108-112`, `dashboard.css` (`--dash-*`), `command-palette.css` (`--cp-*`), `work-hours/ui.tsx:6-15`, `reference-items/page.tsx:72-82`, `settings/packages/page.tsx:71-79`, `items/[id]/history/page.tsx:95-102`, `navBar.tsx:41-44` | צבעים חסרים בטוקנים: ענבר דיו/רקע/גבול, כחול רך `#e6efff`, רקעי הצלחה ושגיאה, אפור `#d4d4dc`, `#444` | אלה בעצם תפקידים שחסרים במקור. כל מסך המציא אותם מחדש, בגוונים שונים (ראו CO-3). |

### 2.2 צבע

**מה קיים:** כחול פעולה אחד (`#0066cc`), parchment כרקע עמוד, לבן לכרטיסים, דיו `#1d1d1f`, שני גווני טקסט משני, שני קווי הפרדה, ארבעה צבעי סטטוס (on/late/absent/approved) ואדום להרס.

**תפקידים שחסרים** (ולכן הומצאו מקומית):
- צבע בחירה וכחול רך: `#e6efff` ×14. היום יש ארבעה ערכים שונים לבחירה.
- דיו ענבר, רקע ענבר וגבול ענבר: חמישה גווני דיו ושלושה רקעים.
- רקע הצלחה ורקע שגיאה.
- גבול חזק לשדות ולכפתורים משניים: `#d4d4dc` ו-`#c7c7cf`.
- דיו משני: `#444` ו-`#5a5a5f`.
- צבעי הסרגל הצדי הכהה: `#15171a` ו-`#b8bcc2`.
- רמפת גרפים: `--dash-ramp-*`.

**ניגודיות** (חושבה לפי WCAG):

| זוג | יחס | נדרש | מצב |
|---|---|---|---|
| `#7a7a7a` (muted-48) על לבן | 4.29 | 4.5 | ❌ טקסט משני בכל המערכת |
| `#7a7a7a` על `#f5f5f7` | 3.94 | 4.5 | ❌ כותרות עמודה ב-11.5px |
| `#9a9aa0` (muted-40) על לבן | 2.80 | 4.5 | ❌ בשימוש לנתונים, תאריכים ומספרים סידוריים |
| `#a3a3ab` (placeholder בפלטת הפקודות) | ~2.5 | 4.5 | ❌ |
| `#d97706` (status-late) כטקסט | 3.19 | 4.5 | ❌ |
| לבן על `#d97706` | 3.19 | 4.5 | ❌ |
| `#1f8a5b` (approved) על לבן, ולבן עליו | 4.33 | 4.5 | ❌ |
| `#a86a1a` על `#fdf3e6` | 4.04 | 4.5 | ❌ |
| `#e0e0e0` גבול שדה על לבן | 1.32 | 3.0 | ❌ גבול רכיב (WCAG 1.4.11) |
| `#d2d2d7` מסילת מתג כבוי | 1.51 | 3.0 | ❌ |
| `#0066cc` על לבן | 5.57 | 4.5 | ✅ |
| טבעת פוקוס `#0071e3` | 4.70 | 3.0 | ✅ |
| `#555` תווית שדה | 7.46 | 4.5 | ✅ |

**הצעה:**
- `--color-ink-muted-48` ל-`#6e6e73` (5.07 על לבן, 4.66 על parchment).
- `--color-ink-muted-40` רק ל-placeholder ולמצב disabled.
- דיו ענבר `#9a5b06` (5.42, כבר בשימוש ב-`TestingDock`).
- דיו ירוק `#17784f` (5.47).
- גבול שדה: כדי לעמוד ב-3:1 מול לבן צריך לפחות `#949499` (3.02:1; 2.77:1 על parchment), וזה נראה כבד יחסית. `#b0b0b8` (2.15:1) הוא פשרה ויזואלית שלא עומדת בתקן. שאלה פתוחה (§1.3).

### 2.3 טיפוגרפיה

- **פונט:** Rubik variable, ארוז מקומית דרך `next/font/local` (`layout.tsx:8-22`). זה טוב. החריגים:
  - `.shx-*` ו-`EditItemDialog` מבקשים Heebo, ובפועל מקבלים Segoe UI.
  - שלושה מקומות במארזים מבקשים `'Inter', monospace` (הארטבורד מציין Inter), ובפועל מקבלים monospace של מערכת ההפעלה.
  - `StationHistoryDialog:305` ו-`TextEditorModal:178` משתמשים ב-stack מונוספייס משלהם.
- **שלושה סולמות שלא מדברים זה עם זה:**
  1. `tokens.css`: 10/12/14/17/18/21/24/28/34/40/56 (מערכת שיווקית; body 17).
  2. `Typography.tsx`: 11/12/14/16/18/20/24/28/32.
  3. `ui.css`: כפתורים, שדות, select ותפריט ב-17px; גוף דיאלוג 17; כותרת דיאלוג 24; טבלה 14 ו-11.5.
- **מה שהקוד עושה בפועל:** 36 גדלים מספריים שונים inline. השכיחים: 14 (×125), 12.5 (×117), 13 (×105), 11.5 (×102), 12 (×87), 15 (×57), 13.5 (×55). חצאי פיקסלים (9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5) מופיעים יותר מ-300 פעמים.
- **המסקנה:** הסולם האמיתי של המוצר הוא 11 עד 15px לממשק צפוף, ו-20 עד 34px לכותרות. הטוקנים לא מתארים אותו, ולכן מתעלמים מהם. רכיבי הבסיס ב-17px נראים "גדולים" ליד תוכן ב-13px, וכל מסך דורס אותם.
- **משקלים:** הטוקנים קובעים 300/400/600/700 ("NO 500"). בפועל יש 8 שימושים ב-500 ו-6 ב-800.
- **מספרים:** `tabular-nums` בשימוש רחב (124 מקומות), וזה טוב. החריג: ערכי KPI בדשבורד. ספרות Rubik פרופורציונליות כברירת מחדל ('1' = 398 יחידות, '0' = 616), ולכן הרצועה הכהה "רועדת" בכל רענון של 60 שניות.

### 2.4 ריווח ורדיוסים

- **ריווח:** הטוקנים הם 4/8/12/**17**/24/32/48/80. בפועל 16 מופיע פי 14 יותר מ-17. גם 10 (הקצב הדה-פקטו בדשבורד ובמארזים), 6, 14, 18 ו-20 שכיחים. במסכים הידניים, כ-61% מערכי הריווח לא על הסולם.
- **`sx` מכפיל מספרים ב-8:** `borderRadius: 3` הופך ל-24px, `borderRadius: 4` ל-32px, ו-`p: 1.2` ל-9.6px. בגלל זה יש דיאלוגים ברדיוס 24 ו-32 לצד 18.
- **רדיוסים:** הטוקנים הם 5/8/11/18/pill. בפועל יש כ-17 ערכים: 10 (×21), 12 (×18), 14 (×22), 16 (×9) ועוד. ארבעה רדיוסי כרטיס שונים: `Paper` 11, `Card` 18, `.shx` 16, `dash-card` 14.

### 2.5 עומק

החוק "בלי צללים" (`ui.css`) נשמר ברוב המקומות. החריגים:
- `--shadow-product` נועד לתמונות בלבד, ומשמש כצל דיאלוג ב-`EditItemDialog`, ב-`packageUi.SHADOW` (לפי הארטבורד) וב-`settings/packages`.
- `PopUpTestDialog` עם זכוכית `blur(24px)` וזוהר צבעוני.
- `files/page.tsx` עם צל דקורטיבי.

### 2.6 תנועה

- **טוקנים:** `--ease-press`, `--ease-page` (≈ `ease`), `--t-press:90ms`, `--t-page:200ms`. אין עקומת ease-out חזקה. אין טוקני משך לפי תפקיד.
- **מה שקיים בפועל** מאופק, וזה טוב: רוב המעברים בין 120 ל-200ms, על מאפיינים מוגדרים. כל 19 סדרות ה-recharts החיות מוגדרות `isAnimationActive={false}`.
- **בעיות:**
  - `prefers-reduced-motion` קיים **רק** ב-`command-palette.css`.
  - אין gating של hover (`@media (hover:hover)`).
  - שלושה ערכי press שונים (0.92, 0.95, 0.97) ועוד 0.96 בהיסטוריה.
  - הסרגל הצדי מנפיש `margin` ו-`width`.
  - Ctrl+K מונפש (180ms), למרות שזו פעולה ממקלדת שחוזרת עשרות פעמים ביום.
  - לדיאלוגים, לתפריטים ולטולטיפים אין כניסה ויציאה בכלל. זה מקובל לפי emil, אבל כדאי לשקול 150 עד 200ms לדיאלוגים.

### 2.7 רכיבי הבסיס: כיסוי מצבים

| רכיב | מה טוב | מה חסר |
|---|---|---|
| `Button` | hover, focus-visible, active, disabled | `color="warning"/"secondary"/"info"` מוצגים כ-primary. אין `loading`. 17px. `bgcolor` inline דורס את כל המצבים. |
| `IconButton` | focus-visible, hover | אין `aria-label` כברירת מחדל (גם לא דרך טולטיפ). hover שקוף לגמרי על הרקע הכהה של הסרגל. |
| `TextField` / `.sh-input` | טבעת פוקוס 3px | 17px. `margin="dense"` נבלע. `<label>` לא מקושר ל-input (אין `htmlFor`/`id` אוטומטי). |
| `Select` | Radix, מקלדת | 17px. |
| `Dialog` | Radix: פוקוס, Esc, גרירה | בלי אנימציה. כותרת 24 קבועה. אין מקום קבוע לכפתור סגירה. |
| `ConfirmDialog` | destructive, busy | `autoFocus` על כפתור האישור **גם כשהפעולה הרסנית**: Enter מוחק. |
| `Table` | `.sh-table` | `TableRow hover` מוסיף מחלקה `sh-row-hover` שלא קיימת. `selected` הוא `#fafafc`, כמעט בלתי נראה. `TableSortLabel` הוא `span role=button` בלי tabIndex ומקלדת, עם ▲▼ כגליפים. |
| `Tabs` | `aria-selected` | בלי focus-visible. בלי ניווט חיצים. רווח 28 מחוץ לסולם. |
| `Tooltip` | Radix | Provider נפרד לכל טולטיפ, ולכן אין "skip delay" בין טולטיפים סמוכים. |
| `Menu` | מיקום מוקפד ל-RTL | בלי ניווט חיצים ובלי העברת פוקוס לתפריט. Radix DropdownMenu כבר מותקן ולא בשימוש. |
| `Chip` | | `div` עם `onClick` בלי role ומקלדת. ה-× למחיקה הוא SVG עם `onClick`, בלי שם נגיש. |
| `StatusPill` | | 10px, `uppercase` ו-letter-spacing. אין לזה משמעות בעברית, וזה פוגע בקריאוּת. |
| `Alert` | אייקון וצבע לפי חומרה | פס צבעוני 3px בצד (impeccable אוסר). `role="alert"` גם להודעות מידע. `aria-label="close"` באנגלית. |
| `Snackbar` | | בלי `role="status"`/`aria-live`. בלי כניסה ויציאה. |
| `Skeleton` | | `#eee` מקודד. בלי reduced-motion. ה-shimmer שוכפל 3 פעמים במסכים, בשמות keyframe שונים. |
| `LinearProgress` | | מנפיש `width`. `color="primary"` הופך ל-CSS לא תקין, **ולכן המילוי לא נצבע** (במסך הקבצים). בלי `aria-valuenow`. |
| `Fade`/`Grow` | | `Grow` מתחיל מ-`scale(0.85)` מהמרכז (emil: 0.95, ומנקודת המוצא). |
| `Switch` | RTL תקין | בלי focus-visible. מסילה כבויה 1.51:1. |
| Icons (`icons.tsx`) | משפחה אחת (lucide, קו 1.75) | `sx.fontSize` לא משפיע: הגודל נקבע רק מה-prop `fontSize`, ולכן כל 26 האייקונים עם `sx={{fontSize}}` יוצאים 24px. `ArrowBack` ו-`ArrowForward` לא מתהפכים ב-RTL. |

### 2.8 איפה ערכים מקודדים

| אזור | hex גולמי | הערות |
|---|---|---|
| פריטים + מעטפת + היסטוריה | 146 | 21 מהם שאריות MUI (`#455A64` ×11 ב-`StationHistoryDialog`) |
| בדיקות + מארזים | 257 + 69 `rgba` | 0 שימושים ב-`var(--…)` ב-TS/TSX של האזור. שלוש פלטות JS מקבילות. |
| משלוחים + דשבורד (חי) | 26 במסכים | הדשבורד החי נקי כמעט לגמרי. בנוסף 22 ב-print, שזה מקובל. |
| הגדרות + קבצים + התחברות | 215 | כ-80% הם עותק מדויק של טוקן |
| קוד מת (דשבורד ישן) | 234 | 153 שאריות MUI |
| `theme.ts` + `ui/*` | ~40 | במכוון, לחישובי `alpha()` |

### 2.9 שכבת `sx`: מה נבלע בשקט

`sx.ts:107-108` מדלג על כל מפתח שמתחיל ב-`&`, `@` או `:`, ועל כל ערך שהוא אובייקט. בפועל:

| דפוס | כמות | דוגמאות | תוצאה |
|---|---|---|---|
| `"&:hover": {…}` ו-`"& .Mui…"` | ~70 מפתחות ב-19 קבצים | `navBar.tsx:74-83, 227, 293-299, 410`, `PopUpTestDialog.tsx` (15), `reference-items` (9), `SettingsSubNav.tsx:64-66, 91-93` | אין hover לסרגל, ל-sub-nav ולכרטיסים. סלקטורים של MUI שאין להם יותר משמעות. |
| `{ xs: …, md: … }` | ~20 | `test-stations/page.tsx:48`, `reference-items/page.tsx:651, 678`, `ShipmentInsertPopup.tsx:467…` (×13 בשלושת הפופאפים), `TestingDock.tsx:118, 142` | גרידים קורסים. הסתרה רספונסיבית לא עובדת. |
| נתיבי theme שלא ממופים | `action.hover`, `error.light`, `error.contrastText` | `ItemDialog:201`, `ItemFilesPanel:421`, `testing/page.tsx:1595` | CSS לא תקין, ולכן אין רקע ואין צבע. |
| `sx={{fontSize}}` על אייקון | 26 | `testing/page.tsx:211, 1382`, `stationKit.tsx:288`, `TestingDock.tsx:138` | 24px קבוע |
| `textTransform:"none"`, `boxShadow:"none"`, `disableElevation` | עשרות | | no-op. רעש מתקופת MUI. |

---

## 3. ממצאים לפי קטגוריה

### מקרא עקרונות (המקור בסוגריים)

| קוד | עיקרון |
|---|---|
| **TY** | משפחה אחת וסולם תפקידים קבוע, צעדים של ~1.125–1.2, בלי גדלים חד-פעמיים (impeccable: typeset, operate) |
| **ROLE** | אותו תפקיד נראה זהה בכל מסך (impeccable: typeset, polish) |
| **TOK** | צבע רק מטוקנים סמנטיים, בלי hex גולמי (impeccable: audit/Theming, colorize) |
| **CON** | ניגודיות: טקסט ≥4.5:1, טקסט גדול, אייקונים וגבולות רכיב ≥3:1 (impeccable: craft-floor) |
| **ACC** | צבע הפעולה רק לפעולה, בחירה ומצב, לא לקישוט (impeccable: operate) |
| **SP** | סולם ריווח מתועד; צפוף בתוך קבוצה ומרווח בין קבוצות (impeccable: layout) |
| **HI** | היררכיה: מבחן הפזילה; בלי כרטיס בתוך כרטיס, בלי פס צבע בצד >1px, בלי eyebrow, בלי טקסט בגרדיאנט (impeccable: craft-floor, Refuse) |
| **AFF** | אותה אפורדנס, אותו מראה; לכל רכיב default/hover/focus/active/disabled/loading/error (impeccable: operate) |
| **PRIM** | להשתמש ברכיב המשותף ולא בהעתק ידני (impeccable: polish) |
| **ST** | skeleton לטעינה; מצב ריק שמלמד; שגיאה שאומרת מה קרה ומה עושים (impeccable: operate, harden) |
| **HON** | לא לזייף מספר (כלל הפרויקט) / "misleading state" (impeccable: polish) |
| **M-FREQ** | לא להנפיש פעולות מקלדת או פעולות שחוזרות עשרות פעמים ביום (emil) |
| **M-PROP** | להנפיש רק transform ו-opacity; לא `transition: all` (emil) |
| **M-EASE** | ease-out מותאם, מתחת ל-300ms, יציאה מהירה מכניסה (emil) |
| **M-PRESS** | `:active` scale ~0.97 אחיד (emil) |
| **M-RED** | לכל אנימציה מסלול `prefers-reduced-motion`; hover תחת `(hover:hover)` (emil, impeccable) |
| **R-LOG** | מאפיינים לוגיים במקום left/right |
| **R-ICON** | אייקוני כיוון מתהפכים ב-RTL |
| **R-BIDI** | מספרים, קודים ו-"a / b" מבודדים (`dir="ltr"`, `<bdi>`) |
| **A-KEY** | כל פעולה אפשרית במקלדת |
| **A-FOC** | פוקוס נראה |
| **A-NAME** | שם נגיש ותוויות מקושרות |
| **A-TGT** | אזור לחיצה ≥32–44px (עמדות מגע) |

השפעה: **H** = גבוהה, **M** = בינונית, **L** = נמוכה.

### 3.1 טיפוגרפיה

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| TY-1 | `src/styles/shifthouse.css:28, 49, 59`; משתמשים: `ItemsToolbar.tsx:63, 77`, `SettingsToolbar.tsx:82, 97-98`, `ShipmentTable.tsx:345, 385, 413, 423, 432`, `testing-routes/page.tsx:206, 248`, `StationsTable:178`, `StationTypesTable:168`, `work-hours/page.tsx:271, 413`; `EditItemDialog.tsx:140, 208` (`fontFamily: var(--shx-font)`) | `--shx-font:'Heebo','Inter',system-ui`. Heebo ו-Inter לא ארוזים, ולכן הטקסט מוצג ב-Segoe UI ליד Rubik באותה שורה. | TY | מיידי: `--shx-font: var(--font-text)`. בהמשך להעביר ל-`Button`/`TextField` ולמחוק את `shifthouse.css`. | **H** |
| TY-2 | כל המערכת: 36 גדלים, כולל חצאי פיקסלים. דוגמאות: `items/[id]/history/page.tsx:593, 633, 655`, `command-palette.css:60, 68, 199`, `testing/page.tsx:282, 293, 399`, `dashboard.css:92, 114`, `DataCard.tsx:84`, `settings/packages/page.tsx` (27), `work-hours/page.tsx` (23) | אין סולם. 13px ו-15px הם השניים השכיחים ביותר בהגדרות, ואין להם טוקן. זו הסיבה שמתעלמים מהסולם. | TY | סולם מוצר (D2) כטוקני תפקיד, ואז מיפוי: 9–10.5→micro, 11–11.5→fine, 12–12.5→small, 13–13.5→dense, 14–14.5→body-sm, 15–15.5→body, 16–17→lead. | **H** |
| TY-3 | רכיבי בסיס ב-17px: `ui.css:41, 57, 73` (כפתור), `:136, 191` (שדה), `:222, 252` (select), `:308` (תפריט 15), `:363` (גוף דיאלוג); `Dialog.tsx:125` | פער מול תוכן ב-13–14px, ולכן מסכים דורסים (`fontSize: 15` על כפתורים, `height: 42` על שדות). | TY, ROLE | כפתור ושדה ב-15px, גובה 40; dense ב-13–14px, גובה 34–36; גוף דיאלוג 15. | **M** |
| TY-4 | כותרת עמוד: `ItemsToolbar:57` (34/700), `SettingsToolbar:56` (34), `settings/packages:306` ו-`reference-items:397` (30, לפי הארטבורד), `history:505` (32), `DashboardHeader.tsx:62` (23, ב-`div` ולא `h1`), `files/page.tsx:356` (h4 = 20) | אותו תפקיד בחמישה גדלים. בדשבורד ובבדיקות אין `h1` בכלל. | ROLE | רכיב `PageHeader` אחד (30/700, תת-כותרת 15 muted, לפי `Settings.dc.html:45-46`) כ-`<h1>`. | M |
| TY-5 | כותרות דיאלוג: `.sh-dialog-title` 24, `ItemDialog:109` 18, `EditItemDialog:144` 20, `h6` 16 בתוך `DialogTitle` (`testing/page.tsx:1437, 1490, 1517, 1581`, `ItemLabelsDialog:62`, `TextEditorModal:145`), חבילות 19–21, `PopUpTestDialog:142` h4/800 | שבעה סגנונות | ROLE | `DialogTitle` בלבד, בגודל אחד (20/600). להסיר את ה-`Typography` הפנימי. | M |
| TY-6 | ערכי KPI: `SummaryStrip:93` (26/800), `history:532` (20/700), `TopStatsBar.tsx:125` (28), `KpisTab.tsx:199` (30), `HistoryOverlay.tsx:512` (24), `packages.css:14` (26/700), `PackageOpenWizard.tsx:451` (30) | שבעה גדלים לתפקיד אחד. בדשבורד אין `tabular-nums`, ולכן המספרים רועדים ברענון. | ROLE, TY | טוקן `--text-kpi` עם `tabular-nums`. | M |
| TY-7 | תוויות שדה: `.sh-field-label` 14/600; `FieldLabel:21` ו-`SearchableCombobox:139` 13/600 `#555`; `FieldCaption` 13/600 `#333`; `users:545` 13.5; `packages` 12–12.5/400; `work-hours` 12/400; `DashboardSidebar:512` 11/400; `ShipmentTable:19-25` 12/600 | שבעה סגנונות תווית | ROLE | `.sh-field-label` אחד (13/600 `--color-ink-muted-80`). | M |
| TY-8 | משקלים: 500 ×8 (`ItemFilesPanel:295`, `StationHistoryDialog:166, 181`…); 800 ×6 (`SummaryStrip:93`, `PopUpTestDialog:142`, `testing/page.tsx:248, 258, 541, 1383`) | מחוץ לסולם 300/400/600/700 | TY | 600 או 700 | L |
| TY-9 | `StatusPill` (`Chips.tsx:146`, 10px uppercase); `stationKit.tsx:356, 399`; eyebrows בחבילות (לפי הארטבורד) | `uppercase` ו-letter-spacing על עברית לא עושים כלום, ופוגעים בקריאוּת. 10px לנתונים. | TY | 12px בלי uppercase. בחבילות: ראו §5. | L |
| TY-10 | letter-spacing: -0.2 / -0.3 / -0.4 / -0.5 / -0.6 / -0.8px במסכים, מול טוקן -0.374 | ערכים חד-פעמיים | TOK | `--ls-display` / `--ls-caption` | L |

### 3.2 צבע

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| CO-1 | `tokens.css:36-37` ושימושים: 141 בבדיקות ובמארזים, כ-25 `#9a9aa0` בהגדרות, 16 בהיסטוריה, כל כותרות הטבלאות (`ui.css:504`, `shifthouse.css:34`, `dashboard.css:94`) | ניגודיות נכשלת (ראו 2.2) | CON | D1: להכהות את הטוקן במקור. muted-40 רק ל-placeholder ו-disabled. | **H** |
| CO-2 | `tokens.css:46-48` | ענבר (3.19) וירוק (4.33) כטקסט ועם טקסט לבן עליהם. הדשבורד: `#a86a1a` על tint (4.04). | CON | `--color-warning-ink`, `--color-success-ink` כהים; לבן רק על גוון כהה. | M |
| CO-3 | פלטות מקומיות (2.1). בחירה: `#e6efff`, `#f7fbff`, `#f3f8ff`, `rgba(0,102,204,.07)`. דיו ענבר: `#a86a1a`, `#9a5b06`, `#8a5a00`, `#d97706`, `#e65100`. רקע ענבר: `#fdf3e6`, `#fff7e6`, `rgba(217,118,6,.1)`. רקע הצלחה: `#eaf5ef` ו-`rgba(31,138,91,.04–.1)`. | אותו מצב סמנטי בגוונים שונים | TOK, ROLE | טוקנים חדשים: `--color-selected-bg`, `--color-primary-soft`, `--color-warning-ink/-bg/-border`, `--color-success-ink/-bg`, `--color-danger-bg`, `--color-border-strong`, `--color-ink-secondary`, `--color-nav-*`. הפלטות המקומיות יפנו אליהם. | M |
| CO-4 | `StationHistoryDialog` (`#455A64` ×11, `#1976d2`), `PopUpTestDialog` (`#1976d2`, `#42a5f5`), `testing/page.tsx:1444, 1450, 1496-1497, 1523` (`#4caf50`, `#ff9800`, `#e65100`), `files/page.tsx:484, 505, 638`, `FileIcon.tsx:20-74`, `#fafafa`/`#f5f5f5` בפופאפי משלוח ובשעות עבודה; `theme.ts:60` `secondary.main` | שאריות של פלטת MUI | TOK | טוקנים, `Alert`/`Chip` | M |
| CO-5 | `FileIcon.tsx:20-74` | פלטת 400 של MUI על קו של אייקון outline. 7 מתוך 10 צבעים מתחת ל-3:1 (`#ffd54f` 1.4:1). | CON | גוונים כהים יותר, או גליף ניטרלי עם סיומת הקובץ | M |
| CO-6 | `ItemTable.tsx:212` (`current_status === 2` כחול) מול `history:379` (1/5 כחול); `SummaryStrip`: ענבר ל"בתור", ירוק ל"הושלמו"; "בתור" מול "ממתין" | אותו סטטוס בצבעים ובשמות שונים בין מסכים | ROLE | מפת סטטוס→גוון אחת (ליד `status-names.ts`) שכולם קוראים ממנה | M |
| CO-7 | `KpisTab.tsx:136, 152`, `HistoryOverlay.tsx:794`, `TopStatsBar.tsx:63, 71`; `ShipmentTable.tsx:365` (ענבר ל"מוכנים לשליחה") | צבעי מצב שמוחלים בלי תלות בערך (העמדה העמוסה תמיד אדומה). ענבר על מצב חיובי. | ACC | דיו muted, אלא אם פונקציית סף (`queueAgeTone`) קובעת אחרת. לבדוק מול מדריך הדשבורד, שאינו בריפו. | M |
| CO-8 | גרפים: `StatusDonut.tsx:23-30, 63, 67`, `StatusTrendChart.tsx:203-212`, `HistoryStateChart.tsx:77-112`, `ThroughputBarChart.tsx:37, 65` | ramp-4/ramp-5 1.12:1 ביניהם, ramp-5 על לבן 1.37:1, בלי מפריד בין פרוסות. ramp-4 משמש לשלוש משמעויות. | CON, ROLE | מפריד 1–2px בצבע הקנבס, `paddingAngle={1}`, ramp-5 כהה יותר, מפת `STATE_COLOR` אחת | M |
| CO-9 | כחול כקישוט: אייקונים בכותרות (`ItemFilesPanel:291`, `WorkerPicker:95`, `PopUpTestDialog:176…`, `test-stations:82`, `testing-routes:244`, `files:354`), אריחי KPI כחולים, קוד משלוח בכחול שאינו קישור (`ShipmentsTab.tsx:163`) | מדלל את "כחול = לחיץ" | ACC | `--color-ink-muted-48` לגליפים דקורטיביים | L |
| CO-10 | `command-palette.css:13-23` | `--cp-ink-placeholder: #a3a3ab` (~2.5:1). ההערה שם ("יש רק muted אחד") כבר לא נכונה. | CON, TOK | להפנות לטוקן | L |

### 3.3 ריווח ופריסה

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| SP-1 | `settings/test-stations/page.tsx:48`, `reference-items/page.tsx:651, 678`, `ShipmentInsertPopup.tsx:467, 496, 517, 542, 562`, `ShipmentUpdatePopup.tsx:205, 227, 247, 271, 290`, `ShipmentSendPopup.tsx:220, 239, 258`, `TestingDock.tsx:118, 142` | ערכים רספונסיביים ב-`sx` נמחקים: master–detail של העמדות, טופס פריטי הייחוס ושלושת טופסי המשלוח קורסים. | SP | מחלקת CSS עם `grid-template-columns` ו-`@media` (כמו `packages.css`), או `repeat(auto-fit, minmax(260px, 1fr))` | **H** |
| SP-2 | `ItemsToolbar.tsx:81, 100` (חיפוש 42px, r10, 14px) ליד combobox (40px, r8, 17px); `SettingsToolbar:97` (42, r10) מול `StationsTable:177` (38, r9); `reference-items:511` (46); `ShipmentTable.tsx:404` (42 מול 40) | שורת הפילטרים העמוסה ביותר באפליקציה: גבהים, רדיוסים, גדלים ופונטים שונים | AFF | גובה אחד לשורת פילטרים (40, או 44 לפי `.sh-combo--dense`), `SearchInput` | **H** |
| SP-3 | 5 מסגרות עמוד בהגדרות (`CrudTable:159`, `test-stations:38`, `packages:302`, `reference-items:382`, `users:427`, `work-hours:264`, `files:348`); `page.tsx:8` (24) מול `history:500` | כל דף מוסיף padding משלו מעל `settings/layout.tsx:34` | SP | Page shell אחד: max 1180, padding רק ב-layout | M |
| SP-4 | רדיוסים: `navBar` 9px/7px, `AppShell:173` 9px; `sx` ×8: `TextEditorModal:140`, `ItemLabelsDialog:58` (24), `PopUpTestDialog:111` (32), `testing/page.tsx:333, 1433, 1486, 1513, 1576` (24), `files:368` (24); כרטיסים 11/14/16/18 | כ-17 רדיוסים מול סולם של 5 | SP, TOK | `--r-*` בלבד. להחליט אם להוסיף 14 כ-`--r-card`. | M |
| SP-5 | ריווח: 16 (×14) מול טוקן 17; 10 כקצב דה-פקטו; שברים ב-`sx` (`gap: 1.25` = 10, `px: 2.25` = 18, `p: 1.2` = 9.6) | ~61% מחוץ לסולם | SP | `--space-md: 16`, להוסיף 10 אם זה מכוון, ולקבע ערכים לסולם | M |
| SP-6 | `testing/page.tsx:1433, 1486, 1513` (`PaperProps sx={{ p: 2 }}`) | padding כפול מעל `.sh-dialog-*`, ולכן שורת הפעולות "צפה" ולא נוגעת בקצוות | SP | להסיר | M |
| SP-7 | `ItemTable.tsx:271-278` (DataTable בלי `maxHeight`) | בטבלה הראשית (מאות שורות) הכותרת נגללת ונעלמת | HI | `maxHeight`, וכך `stickyHeader` פעיל | M |
| SP-8 | `testing/page.tsx:1191, 1200` (`Container xl` 1536) מול `TestingDock.tsx:88, 168` (1280) | קצוות הדוק לא מיושרים לעמוד מעל ~1330px | SP | קבוע רוחב אחד (1280, לפי הארטבורד) | M |
| SP-9 | `StationTypesTable.tsx:233-269` | `margin="dense"` נבלע, ולכן השדות בדיאלוג צמודים בלי רווח | SP | עמודת flex עם `gap` | M |
| SP-10 | `PackageWizardShell.tsx:67`, `PackageIntakeDialog.tsx:243-245` | הארטבורד מגדיר layout מסך מלא מתחת ל-760px, והוא לא מומש | SP | לנייד את חוקי `@media (max-width:760px)` ל-`packages.css` | M |
| SP-11 | `ShipmentTable.tsx:460` `minWidth={1360}` (בארטבורד 1180); `TimesTab.tsx:400` `height: 190` (בערך 2 שורות טבלה) | פריסה צפופה מדי או רחבה מדי | SP | 1180 / `flex: 1` | L |
| SP-12 | `work-hours/page.tsx:383` | סדר הסטיילים `borderTop`, אחריו `border:"none"`, אחריו `borderTopStyle:"solid"`. התוצאה היא כנראה גבול 3px בצבע הדיו. **לאמת בדפדפן.** | SP | `borderTop` בלבד | M |

### 3.4 היררכיה

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| HI-1 | `navBar.tsx:270, 338` (`pathname === link.href`); `AppShell.tsx:24-32` | התאמה מדויקת של הנתיב, ולכן אין פריט פעיל ב-`/dashboard/tests/*` (8 דפים), ב-`/packages/[id]` וב-`/items/[id]/history`. אין רשומת meta ל-`/packages`, ולכן הסרגל העליון כותב שם "דוחות וניהול פריטים". למסך הבית יש שלושה שמות. | HI | התאמת prefix הארוך ביותר, ושם אחד לכל נתיב מ-`lib/routes` | **H** |
| HI-2 | `ItemTable.tsx:240-249` לפני `ItemsToolbar` בשורה 251 | רצועת ה-KPI (26/800, אריחים צבעוניים) מעל ה-h1 ומעל הפעולה הראשית. הכותרת מוצגת פעמיים (בסרגל העליון וב-h1). | HI | כותרת ופעולה קודם, אריחים שקטים יותר; האריחים כמסנני toggle (כבר נתמך) | M |
| HI-3 | `ShipmentTable.tsx:357-370` | 8 אריחים זהים, בעוד שבארטבורד יש 4. שישה מהם מסננים ושניים סטטיים, ונראים אותו דבר. | HI, AFF | ראו §5 | M |
| HI-4 | כרטיס בתוך כרטיס: `history:586 > 622-628`, `SectionCard > MyPackageCard > list`; `HistoryOverlay.tsx:499-613`; `testing/page.tsx:1458, 1496, 1529` (Card בתוך דיאלוג) | 2–3 רמות קינון | HI | משטח אחד עם קווי הפרדה | M |
| HI-5 | פס צבע בצד: `testing/page.tsx:233` (5px על ItemCard), `JobHealthStrip.tsx:118` (3px), `users/page.tsx:468` (3px), `Alert` (3px), `DataTable:107` (שורה נבחרת 3px) | impeccable אוסר. ב-ItemCard הסטטוס מוצג ארבע פעמים בכל שורה. | HI | להסיר, ולהשאיר נקודה ותווית. בשורה נבחרת: tint. | M |
| HI-6 | `PopUpTestDialog.tsx:142` (טקסט בגרדיאנט עם `textShadow`), `:113-116` (זכוכית `blur(24px)`), `:318, 358` (זוהר) | קישוט שאסור | HI | `Dialog` שטוח, `DialogTitle` רגיל | M |
| HI-7 | `ItemDialog:223-231` ("סגור" הוא הכפתור המלא, "היסטוריה מלאה" outlined); `ItemTable:197` (כפתור QR ממולא בכל שורה) | הבקרה הבולטת אינה הפעולה העיקרית | HI | "סגור" כ-text; QR כ-ghost icon | L–M |
| HI-8 | eyebrow: `stationKit.tsx:72, 356, 399` (בכחול), `HistoryOverlay.tsx:388-390` | impeccable אוסר eyebrow | HI | לשלב בשורת המטא | L |
| HI-9 | `ItemTable.tsx:138-141` מול `151-159` | פריטים שהושלמו מוסתרים כברירת מחדל אבל נספרים ב"סה״כ", ואין לכך הסבר על המסך | HI | רמז "N פריטים שהושלמו מוסתרים · הצג" | L–M |
| HI-10 | `StationsTab.tsx:253` מול `:257` | הכותרת מבטיחה "ניצולת", והגוף אומר שהיא לא מוצגת | HON | "עומס ושעות עבודה לפי עמדה" | L |

### 3.5 רכיבים

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| CM-1 | `navBar.tsx` (ראו 2.9), `Layout.tsx:166, 174` | **לסרגל הצדי אין hover.** האייקונים נשארים `#7a7a7a` גם על הפריט הפעיל הלבן. אין הבדל משקל בין פעיל ללא פעיל. | AFF | מחלקה `.sh-nav-item` ב-`ui.css`: `:hover` (מוגבל ל-hover media), `[aria-current="page"]`, `:focus-visible`, אייקון `color: inherit` | **H** |
| CM-2 | `.shx-*` מול `.sh-*` במסך הבית (`DataTable:76-77`, `ItemsToolbar`, `EditItemDialog`, `ItemTable`) ובהגדרות ובמשלוחים | שתי מערכות רכיבים. press בגדלים 0.97/0.95/0.92/0.96. כפתור icon של 36px עם רקע מול 40px שקוף. | PRIM, AFF | להעביר ל-`Button`/`IconButton`/`TextField`/`sh-table` ולמחוק את `shifthouse.css` | **H** |
| CM-3 | `stationKit.tsx:84-93, 245-262, 403, 438-446`, `TestingDock.tsx:221-229`, `testing/page.tsx:306-314`, `EditItemDialog.tsx:229, 249` | `bgcolor`/`background` inline על `Button` דורס את `:hover` ו-`:disabled`. "המשך" מושבת: 1.30:1. סיום: 1.01:1. בכפתורי המחיקה באדום אין hover ואין disabled. | AFF, CON | `color="success"`/`"error"`, `variant="dark"`; בלי `bgcolor` | **H** |
| CM-4 | מודלים ידניים: `EditItemDialog:139-260`, `settings/packages:500-529`, `HistoryOverlay.tsx:337-372`, 8 במארזים (`PackageWizardShell`, `PackageDecisionDialog`, `PackageDeleteDialog`, `PackageEditDialog`, `LastItemDialog`, `PackageLabelsDialog`, `PackageRelabelDialog`, `PackageIntakeDialog`) | בלי `role="dialog"`, בלי לכידת פוקוס ובלי החזרתו. Esc מדורג שבור (מחזיר קופסה). סגירה ב-mouseup על הרקע אחרי גרירת בחירה מאבדת קלט. ב-`EditItemDialog` אין בדיקת שינויים. | PRIM, A-KEY | `ui/Dialog` (Radix; תומך בגרירה) עם className למראה של הארטבורד; `ConfirmDialog` במקום `PackageDeleteDialog` | **H** |
| CM-5 | `packageUi.ts:105-116` (`pillPrimary` / `pillGhost` / `fieldInput`, 55 שימושים), 60 `<button>` גולמיים במארזים | סטייל inline לא יכול לבטא מצבים. כל מצבי hover/press/focus שהארטבורד מגדיר (`.prs:active`, hover `#0058b3`, `.row-h:hover`, focus `#0071e3`) **לא מומשו**. | AFF | מחלקות `.pkg-pill`, `--ghost`, `--danger`, `.pkg-field`, `.pkg-row` ב-`packages.css`, כמו התקדים של `.sh-combo--dense` | M–H |
| CM-6 | כפתורים ראשיים בהגדרות: `SettingsToolbar:82`, `StationsTable:164`, `StationTypesTable:154`, `packages:311, 492, 525`, `reference-items:422`, `files:441` | ≥13 כפתורים, 5 גדלים, 2 פונטים. `work-hours/page.tsx:271` הוא `shx-btn` בלי variant, ולכן מוצג כטקסט ללא צורת כפתור. | PRIM | `Button` (עם `size="small"` כשהארטבורד דורש) | **H** |
| CM-7 | כפתורים ידניים בדשבורד: `DashboardHeader.tsx:69-170`, `DataCard.tsx:134-151`, `HistoryOverlay.tsx:405-684`, `TopStatsBar.tsx:83-98`, `DashboardSidebar.tsx:268-283`, `OverviewTab.tsx:193-208` | אף אחד מהם בלי hover. פוקוס בברירת המחדל של הדפדפן. Export ו-Refresh זה לצד זה ברדיוסים שונים. | AFF | `Button`/`IconButton` עם `size="dense"`, או `.dash-btn` | M–H |
| CM-8 | כפתור icon: 8 וריאנטים (`.stz-iconbtn` 28, `iconBtn` 30/24, `StepBtn` 28, `MiniBtn` 24, close 34, `.wh-x` 36, `.wh-nav` 32, `.shx-icon-btn` 36) | | PRIM | `IconButton` small/medium | M |
| CM-9 | אישורי מחיקה ידניים: `CrudTable:214`, `StationsTable:216`, `StationTypesTable:277` ("בטוח שברצונך למחוק?" בלי שם), `users:659`, `files:896`; לעומת `ConfirmDialog` ב-3 מקומות | ניסוח שונה, צד שונה לכפתור ההרסני | PRIM | `ConfirmDialog` תמיד, עם שם הפריט ושורת "לא ניתן לבטל" | M |
| CM-10 | `ConfirmDialog.tsx:54-59` | `autoFocus` על אישור גם כש-`destructive`: Enter מוחק | A-KEY | פוקוס על "ביטול" כש-`destructive` | M |
| CM-11 | תגיות ופילים: `DataTable:141-148`, `history:513-516, 635-637`, `StatusPill`, `item-types:9`, `packages:348, 356`, `testing-routes:279`, `StationTypesTable:195, 204, 210`, `StationsTable:145`, `reference-items:1158`; צ'יפ פילטר: `DashboardHeader:73-88` מול `ShipmentTable:58-67` | כעשרה סגנונות פיל לאותו תפקיד | PRIM, ROLE | `Tag` אחד (tone, size); `Chip onDelete` לפילטרים | M |
| CM-12 | Skeleton ×3 (`DataTable:97`, `ItemTable:266`, `SummaryStrip:105`); שני steppers (`ItemDialog:170`, `history:540`); שתי רצועות KPI | העתקים | PRIM | לאחד ב-`components/ui` | L–M |
| CM-13 | מסגרת דיאלוג: יש X ב-`ItemLabelsDialog`, `TextEditorModal`, `OnlyOffice`, `PopUp`, `EditItemDialog`; אין ב-`ItemDialog`, `BarcodeDialog`, `StationHistoryDialog`; הסגירה במיקומים שונים (inline-start מול inline-end); רקע footer `#fafafc` מול parchment | | ROLE | `DialogTitle` עם slot סגירה אחד, סדר פעולות אחד (D3) | M |
| CM-14 | `DashboardSidebar.tsx:519-622` (NativeSelect, TextField, switch), `dashboard/Segmented.tsx` | העתקים בלי טבעת פוקוס ובלי `aria-pressed`. מצב "נבחר" משתמש בכחול של הפוקוס. המתג מתהפך הפוך מ-`ui/Switch`. | PRIM | primitives עם `dense` | M |
| CM-15 | `stationKit.tsx:315-452` מול `PackageWizardShell.tsx` | שני עיצובי אשף על אותו מסך עמדה (rail, סגירה, מצב שלב, כפתורים, מידות) | ROLE | ליישר את `StationShell` לשלד של הארטבורד החדש | M |
| CM-16 | `OnlyOfficeEditorModal.tsx:314-316` | תגית debug ירוקה `[v7]` גלויה למשתמשים | — | להסיר | M |
| CM-17 | `PackageOpenWizard.tsx:374` | תוצאת שקילה מציגה תמיד ✓, גם כש"משקל לא תקין" | AFF | `CircleAlert` או X בכשל | M |
| CM-18 | `ShipmentTable.tsx:275-279` | שורות של משלוחים שנשלחו מקבלות pointer ו-hover, אבל לחיצה לא עושה כלום | AFF | `rowClickable(row)` | L–M |
| CM-19 | `startIcon={<X sx={{ ml: 1 }} />}`: `ItemDialog:227`, `ItemFilesPanel:303`, `BarcodeDialog:63`, `ItemLabelsDialog:119`, `ShipmentBarcodesDialog:114` | 8px עודפים בקצה החיצוני של הכפתור | SP | להסיר | L |

### 3.6 מצבים (ריק, טעינה, שגיאה)

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| ST-1 | `ItemTable.tsx:67-70, 98-101` → `:277`; `ShipmentTable.tsx:115-117` → `:462`; `testing/page.tsx:909-911, 1058-1061`; `packages/page.tsx:111-120`; `packages/[id]/page.tsx:32-55` ("המארז לא נמצא" על כל כשל); `reference-items:119-140`; `testing-routes:61-65`; `StationsTable:40-45` | שגיאת טעינה מוצגת כ"אין תוצאות" | ST, HON | מצב שגיאה עם "נסה שוב", כמו `users:485-491`. (זה מוסיף state לשגיאה ב-catch, בלי לשנות את הקריאות עצמן.) | **H** |
| ST-2 | `OverviewTab.tsx:54-55, 157-163`, `StatusTab.tsx:56` ("0 פעילים"); `OverviewTab.tsx:223-227` ("אין משלוחים פתוחים. יום שקט.") | ערכים מזויפים בזמן טעינה או שגיאה | HON | skeleton, ובשגיאה "—" | **H** |
| ST-3 | `testing/page.tsx:1595` | `bgcolor:"error.light"` לא מתורגם, ולכן שגיאת סריקה מוצגת כטקסט רגיל בלי צבע ובלי אייקון | ST | `<Alert severity="error">` | **H** |
| ST-4 | `testing/page.tsx:1609, 1614-1619` | `disabled={scanLoading}` מוריד את הפוקוס מהשדה, ולכן אחרי שגיאה הסריקה הבאה לא נכנסת. auto-submit של 300ms יורה גם בהקלדה ידנית. | ST, A-KEY | `readOnly` בזמן טעינה, ואחרי שגיאה בחירת הכול ופוקוס מחדש; submit ב-Enter | **H** |
| ST-5 | `files/page.tsx:811-822` → `Progress.tsx:27` | `color="primary"` הופך לרקע CSS לא תקין, **ולכן פס ההתקדמות של ההעלאה לא נצבע** | ST | מיפוי צבעים סמנטיים ב-`LinearProgress` | **H** |
| ST-6 | `ItemTable.tsx:277`; `CrudTable:175-182` | אותה הודעה ל"אין פריטים", "הסינון מוציא הכול" ו"רק פריטים שהושלמו תואמים", בלי פעולה | ST | מצב ריק לפי הקשר: "נקה סינון", "הצג שהושלמו", "קליטת מארז" | **H** |
| ST-7 | `testing/page.tsx:1050` → `1284` | כל רענון של התור (אחרי submit או release) מציג 4 skeletons: הבהוב ואובדן מיקום הגלילה במסך של כל היום | ST | skeleton רק כש-`items.length === 0`; אחרת אינדיקציה שקטה | M–H |
| ST-8 | `ItemDialog:87-93, 113-118, 124` | שגיאה משאירה "טוען…" לנצח. ערכים חסרים מוצגים כ-`מקט: null`. | ST | מצב שגיאה, `?? "—"` | M–H |
| ST-9 | `ItemTable.tsx:263-269` | skeleton של 8 פסים בלי מסגרת הטבלה, ולכן קפיצה כשהנתונים מגיעים. לא משתמש ב-`loading` של `DataTable`. | ST | `<DataTable loading>` | M |
| ST-10 | ספינר או "טוען…" במקום skeleton: `ItemFilesPanel:386`, `StationHistoryDialog:147`, `TextEditorModal:163`, `history:482`, `CommandPalette:611`, `StationTypesTable:178`, `packages:332`, `testing-routes:234`, `reference-items:525`, `files:516`, `TimesTab.tsx:416-432`, `ShipmentHistoryPopup:182`, `packages/page.tsx:218` | | ST | skeleton בצורת התוכן | M |
| ST-11 | `testing-routes:73, 295-297` | בזמן טעינה מוצג "אין שלבים. הוסף עמדה למסלול." | HON | skeleton בזמן `loadingRoute` | M |
| ST-12 | טקסט באנגלית למשתמש: `StationHistoryDialog:107` ("Failed to load history"), `CrudTable:97/108`, `StationTypesTable:101, 112, 124, 130`, `StationsTable:118, 123`, `testing-routes:157, 165` ("Failed to save"), `ShipmentHistoryPopup:126, 134, 218` ("Unknown", "No history found"), `ShipmentUpdatePopup:147` | | ST | עברית שאומרת מה קרה ומה עושים | M |
| ST-13 | `alert()` מקורי: `testing/page.tsx:379, 470`, `ShipmentSendPopup:145`, `ShipmentUpdatePopup:147` | חוסם, לא מעוצב, בשפת הדפדפן | PRIM | `Snackbar`/`Alert` | M |
| ST-14 | ולידציה בטוסט: `CrudTable:79-81`, `StationTypesTable:78-93`, `packages:206-208`, `users:222-223`; `EditItemDialog:199` (שמירה מושבתת בלי הסבר) | הטוסט לא מצביע על השדה | ST | `TextField error helperText` (כמו ב-work-hours), וסימון שדות חובה | M |
| ST-15 | `ShipmentInsertPopup.tsx:655, 664, 678` | "חתימה (חובה)" באדום עוד לפני כל אינטראקציה. ב-Send החתימה נדרשת ולא מסומנת. | ST | "חתימה *" ניטרלי עד ניסיון שליחה | L–M |
| ST-16 | `ShipmentTable.tsx:308-313` | 0 דגימות מוצג כ-"0%" | HON | "—" | L–M |
| ST-17 | `no-auth/page.tsx:15-18` | דף stub לא מעוצב ובלי צעד הבא | ST | מצב ריק מעוצב עם "חזור לדף הבית" | M |
| ST-18 | `PackageQueueCard.tsx:44` | טיימר בשניות, בעוד שהארטבורד ו-doc-comment הרכיב אומרים "12 דק׳" | ROLE | דקות | L |

### 3.7 תנועה

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| MO-1 | כל המערכת | `prefers-reduced-motion` קיים רק בפלטת הפקודות. shimmer אינסופי ב-3 מקומות, פס רענון בדשבורד, מגירה. | M-RED | בלוק גלובלי אחד ב-`ui.css`: skeleton סטטי, בלי תזוזה; לשמור opacity וצבע | M |
| MO-2 | `AppShell.tsx:164, 201` (`inset-inline-start`, `margin-inline-start` 0.2s), `navBar.tsx:164` (`width`), `AppShell.tsx:62-68` | מאפייני layout מונפשים, ולכן טבלה של 1100px נבנית מחדש בכל פריים. ההעדפה "מכווץ" נטענת ב-effect אחרי הציור הראשון, ולכן הסרגל מונפש לסגירה **בכל טעינה**. | M-PROP | לקרוא את ההעדפה לפני הציור (cookie), ובלי מעבר בפריים הראשון; ≤200ms ease-out | M |
| MO-3 | `command-palette.css:108, 114-117` | Ctrl+K: פעולה ממקלדת שחוזרת הרבה, עם כניסה של 180ms | M-FREQ | בלי אנימציה | L |
| MO-4 | press: `.sh-btn` 0.95, `.sh-iconbtn` 0.92, `.shx-btn` 0.97, `.dash-press` 0.97 (בלי transition, קופץ), `history:825` 0.96, `.wh-x` 0.96, `.wh-tile` 0.98, ארטבורדים 0.97/0.96 | שמונה ערכים | M-PRESS | `:active { transform: scale(.97) }` עם `var(--t-press)` ו-ease-out, במחלקה אחת | L–M |
| MO-5 | `ItemFilesPanel:374`, `PopUpTestDialog` ×2, `files/page.tsx:635` | `transition: all` | M-PROP | לפרט מאפיינים | L |
| MO-6 | `LinearProgress` (`width .3s`), `DashboardSidebar.tsx:438` (`inset-inline-end`), `files:487` (`outline`) | מאפייני layout | M-PROP | `transform: scaleX()` / `translateX` | L |
| MO-7 | `dashboard.css:164-170` | פס הרענון רץ גם כשהוא מוסתר. ב-RTL הבלוק "קופץ" באמצע ונע ימינה. | M-RED, R-LOG | להנפיש רק כש-`refreshing`, keyframes מראה ל-RTL | L–M |
| MO-8 | `TestingDock.tsx:74-75, 156-159` | הפאנל נפתח בכל מעבר עכבר בלי השהיית כוונה, `ease`, בלי reduced-motion | M-EASE | ~150ms השהיה או pin בלחיצה; `cubic-bezier(.23,1,.32,1)` | L–M |
| MO-9 | hover בלי `(hover:hover)`: `shifthouse.css`, `command-palette.css:47, 156`, `dashboard.css:126, 145`, `history:826-827` | hover "נתקע" במסכי מגע בעמדות | M-RED | לעטוף | L |
| MO-10 | `Dialog`, `Menu`, `Select`, `Tooltip`, `Snackbar` | בלי כניסה ויציאה בכלל. לפי emil זה מקובל לתדירות גבוהה, אבל דיאלוג וטוסט נפתחים "בחבטה". | M-EASE | דיאלוג: opacity ו-scale 0.97→1 ב-180ms, יציאה ב-120ms; popover עם `transform-origin` מנקודת המוצא (`--radix-*-transform-origin`); טולטיפ: skip-delay | L |
| MO-11 | `Fade in={true}` (`testing/page.tsx:1202`), `:active` מתים (`stationKit`), `Grow` מ-0.85 | | M-EASE | להסיר; 0.95 | L |

### 3.8 RTL

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| RT-1 | `stationKit.tsx:433-435, 444-446`, `PopUpTestDialog.tsx:292`; מקור הבעיה: `icons.tsx:87, 90` | `ArrowBack` (lucide ArrowLeft) ו-`ArrowForward` (ArrowRight) לא מתהפכים: "חזור" מצביע קדימה ו"המשך" אחורה, בכל ריצת אשף | R-ICON | במתאם: לאייקוני כיוון `transform: scaleX(-1)` תחת `:dir(rtl)`, או החלפה | **H** |
| RT-2 | `DashboardSidebar.tsx:538-541` מול `:557-565` | המקום שמור ב-inline-end, החץ ב-inline-start, ולכן חץ ה-select יושב על האותיות הראשונות בכל פילטר בדשבורד | R-LOG | `insetInlineEnd: 9` | **H** |
| RT-3 | `packages/[id]/page.tsx:83` | `ChevronLeft` ב"חזרה למארזים". הארטבורד (`Packages.dc.html:209`) מצייר חץ ימינה. | R-ICON | `ChevronRight` | M |
| RT-4 | `work-hours/page.tsx:344-345` | "חודש הבא" (ChevronLeft) מימין ו"חודש קודם" (ChevronRight) משמאל, ולכן החיצים פונים פנימה (`> <`) | R-ICON | להחליף את סדר ה-DOM | M |
| RT-5 | `history:409`, `ShipmentBarcodesDialog.tsx:99` (**מדבקה מודפסת**), `ShipmentHistoryPopup.tsx:196`, `ShipmentCompletionChart.tsx:86` | "3 / 5" מוצג כ-"5 / 3" | R-BIDI | `<bdi dir="ltr">` או "3 מתוך 5" | M |
| RT-6 | `StationHistoryDialog:137-309` (14 תאים עם `textAlign:"right"` ו-`direction:"rtl"`), `:138` `row-reverse` | מיותר ופיזי. האייקון אחרי הכותרת, הפוך מכל דיאלוג אחר. | R-LOG | למחוק ולהוריש כיוון | M |
| RT-7 | שדות ברקוד, מספר סידורי ו-SKU בלי `dir="ltr"`: `referenceScan.tsx:84-86`, `testing/page.tsx:1603-1635`, `PackageIntakeDialog:434`, `PackageOpenWizard:368`, `packages:457, 460`, `reference-items:662-668`; שם משתמש וסיסמה זמנית: `users:520-573` | קודים מתערבבים בזמן ההקלדה | R-BIDI | `dir="ltr"` עם יישור לימין (כמו `PackageIdText`) | L–M |
| RT-8 | `DashboardShell.tsx:355-360` | `scrollLeft` ב-RTL: הטאב הפעיל לא נגלל לתצוגה מתחת ל-1100px | R-LOG | חישוב לפי `getBoundingClientRect` | L–M |
| RT-9 | `textAlign:"right"`/`"left"` ×95 (`DataTable:64, 84, 114` `alignMap`; 17 כותרות במארזים; `dashboard.css:96`; `DenseTable:106`); `left: 12/24` בכפתורי סגירה (`TextEditorModal:152`, `OnlyOffice:321`, `PopUp:132`); `stationKit.tsx:291` (`left:50%` עם `ml` לוגי, ולכן ספינר מוזז 9px); `PackageLabelsDialog:99` (padding פיזי מהארטבורד) | פיזי | R-LOG | `start`/`end`, `insetInlineEnd`, `paddingInline` | L |
| RT-10 | פורמט תאריכים: `ShipmentTable:293` (he-IL, נקודות), `ShipmentHistoryPopup:224` (en-GB, לוכסנים), צ'יפים ב-ISO גולמי, `ItemDialog:207` (עם שניות) מול `history:117` (בלי) | ארבעה פורמטים | ROLE | `formatDate` אחד | L |

### 3.9 נגישות

| ID | מיקום | מה לא תקין | עיקרון | תיקון | השפעה |
|---|---|---|---|---|---|
| A11-1 | `DataTable.tsx:103-108` (טבלת הבית), `StationTypesTable:185-189`, `reference-items:1096-1108, 732-758`, `files:557-567`, `users:453-466`, `DenseTable.tsx:147-151`, 17 בקרות במארזים (למשל `PackageCloseWizard:176, 201`, `PackageDecisionDialog:51`, `packages/page.tsx:223`) | `div`/`tr` עם `onClick` בלי role, tabIndex ומקלדת. **פתיחת פריט, בחירת סוג עמדה, עריכת פריט ייחוס, פתיחת תיקייה וסיום אשף סגירה בלתי אפשריים במקלדת.** | A-KEY | `<button>` או קישור בתא הראשון / `tabIndex=0` עם Enter ו-Space וסגנון focus-visible לשורה; `role="checkbox"` לבדיקות | **H** |
| A11-2 | `packageUi.ts:115` (`outline:"none"`, 20 שימושים), `settings/packages:103, 391`, `work-hours/fields:135`, `HolidayDialog:113`, `PackageOpenWizard:356, 398, 451`, `PackageCloseWizard:209`, `PackageDecisionDialog:65`, `shifthouse.css:47-54` (פוקוס 1px), `command-palette.css:51-56` (טבעת ב-15% alpha, פחות מ-3:1) | אין פוקוס נראה. בשדות סריקה הגבול משתנה לפי הערך ולא לפי הפוקוס. | A-FOC | `:focus-visible` גלובלי (2px `--color-primary-focus`, offset 2); `.pkg-field:focus` כמו `.sh-input:focus` | **H** |
| A11-3 | `DenseTable.tsx:97-110`, `TableSortLabel` (`Table.tsx`) | כותרות מיון רק בעכבר, בלי `aria-sort` | A-KEY | `<th aria-sort>` עם `<button>` | **H** |
| A11-4 | שדות בלי תווית: `ItemsToolbar:76-96` (חיפוש ופילטרים, placeholder בלבד), `EditItemDialog:266-272`, `FieldLabel:20-30` (בלי `htmlFor`, ×13 בפופאפי משלוח), `SearchableCombobox:137-147`, `DashboardSidebar:509-614`, 22 קלטים גולמיים במארזים, `reference-items`, `testing-routes`, `users` | אין תווית פרוגרמטית | A-NAME | `id` אוטומטי ב-`TextField`/`FieldLabel` (`useId`) עם `htmlFor` / `aria-label` | **H** |
| A11-5 | כפתורי icon בלי שם: `ItemFilesPanel:456-487`, `ItemLabelsDialog:66`, `TextEditorModal:152`, `OnlyOffice:319`, `PopUp:128`, קישורי ניווט מכווצים (`navBar:87, 305`), `reference-items:627`, `files:460, 465, 604, 687`, `ShipmentInsertPopup:277, 303`, `ShipmentBarcodesDialog:55`, `ShipmentHistoryPopup:237`, 11 במארזים ובבדיקות | Radix Tooltip מוסיף רק `aria-describedby`, ורק כשהוא פתוח | A-NAME | `aria-label` לכל אחד. `IconButton` יכול לגזור אותו מ-`title`. | **H** |
| A11-6 | `navBar:160-180` (`<aside>` בלי `<nav aria-label>`), אין `aria-current` (`navBar`, `SettingsSubNav`, `DashboardSidebar`), `CommandPalette` (בלי `role="combobox"` / `aria-activedescendant`), דיאלוגים בלי `DialogTitle` (`PopUpTestDialog`, `reference-items:599`, `work-hours/fields:114`), בלי `h1` (בדיקות, דשבורד) | landmarks ומצב חיים חסרים | A-NAME | להוסיף | M |
| A11-7 | `TestingDock.tsx:74-75, 119, 156-158` | בקרות בפאנל שמופיע ב-hover נשארות בסדר ה-Tab כשהן בלתי נראות. במגע זה לא אמין. הרמז אומר "רחף כאן". | A-KEY | חשיפה ב-`:focus-within`, toggle בלחיצה, `aria-expanded` | M–H |
| A11-8 | זמן שני מוסתר ב-`title` מקורי: `stationColumns.tsx:131-135`, `SlowItemsTab.tsx:136-158`, `CustomersTab.tsx:112-116`, `ItemTypesTab.tsx:101-105` | הזמן הנוסף (ברוטו/נטו) נגיש רק בעכבר, וזה נוגד את כלל "כל משך מוצג פעמיים" | A-NAME, HON | `ui/Tooltip` על אלמנט שמקבל פוקוס, או שורה משנית muted | M |
| A11-9 | אזורי לחיצה: `PackageQueueCard:54` (~18px), `navBar:405` (30×30), `.cp-esc` (~20px), טאבי קבצים בהיסטוריה (~28px), פחי אשפה 30×30 במארזים, כפתורי טקסט עם `padding: 0` בדשבורד (~14px) | עמדות מגע | A-TGT | ≥32px | M |
| A11-10 | מצב שמוצג בצבע בלבד: מיני-רצועות פריט (`testing/page.tsx:272-274`, `PackageQueueCard:51`), נקודה כחולה של 6px עם שתי משמעויות (`work-hours:324` מול `:363`), `dashboard/Segmented.tsx` (בלי `aria-pressed`) | | CON | מקרא / ספירה בטקסט / `aria-pressed` | L–M |
| A11-11 | `AppShell.tsx:141-146` ו-`DashboardShell.tsx:217-240` | מגירות בלי Escape ובלי ניהול פוקוס | A-KEY | Radix Dialog, או handler ולכידת פוקוס | L–M |
| A11-12 | `DashboardSidebar.tsx:144` | `div title="מסננים"` שנראה כפתור, בלי handler | A-KEY | `<button>` שמרחיב את הסרגל | L |
| A11-13 | `Switch` (`ui.css:374-399`), המתג בדשבורד | בלי focus-visible. מסילה כבויה 1.32–1.51:1. | A-FOC, CON | `:focus-visible`, מסילה כהה יותר | L–M |

---

## 4. ממצאים מחוץ לשכבה הוויזואלית (דיווח בלבד, לא לתקן בענף הזה בלי אישור)

| # | מיקום | מה קורה | למה זה מחוץ להיקף |
|---|---|---|---|
| X1 | `PackageOpenWizard.tsx:509` | `onClose` של דיאלוג המדבקות קורא ל-`finish()`. "ביטול", × וקליק על הרקע **מגישים את כל פתיחת המארז**. | לוגיקת זרימה |
| X2 | `settings/packages/page.tsx:142-149, 379-385` | החלפת סוג מארז משאירה את התכולה של הסוג הקודם על המסך, ו-`save()` עלול לכתוב אותה (PUT) לסוג החדש | לוגיקת שמירה |
| X3 | `ShipmentInsertPopup.tsx:254-256`, `ShipmentUpdatePopup.tsx:177-179`, `ShipmentSendPopup.tsx:178-180` | `finally { onClose() }`: על שגיאת שרת הדיאלוג נסגר, והטופס והחתימה נמחקים. הודעת השרת לא מוצגת. | זרימת שמירה (אפשר כחלק מ-ST, באישור) |
| X4 | `files/page.tsx:183-205, 753` | דיאלוג ההעלאה נסגר לבד 1.5 שניות אחרי הקובץ האחרון, כולל כשיש שגיאות, ואז מוצג "הקבצים הועלו בהצלחה" | זרימת העלאה (באישור) |
| X5 | `src/app/login/route.ts:85-88, 99-105` | כשל Keycloak מציג JSON גולמי בדפדפן | route, אסור לגעת לפי הפרומפט |
| X6 | `testing/page.tsx:1404-1408` + מודלים ידניים | Esc בדיאלוג פנימי סוגר את האשף ומשחרר את הקופסה (מאבד תמונות ומשקלים) | ייפתר מעצמו במעבר ל-`ui/Dialog` (CM-4), שהוא בהיקף |
| X7 | `TestingDock.tsx` | הסריקה (הפעולה התדירה ביותר בעמדה) נמצאת מאחורי hover. אפשר להוסיף מאזין keyboard-wedge ברמת המסמך. | התנהגות קלט חדשה. כך גם בארטבורד. |
| X8 | `DashboardSidebar.tsx:144` ועוד | בקרות שנראות לחיצות ולא עושות כלום | חלקית בהיקף (A11-12) |

---

## 5. התנגשויות עם הארטבורדים והחלטות עיצוב פתוחות

לפי הכלל הקיים, התאמה לעיצוב גוברת. לכן אלה מדווחים ולא משונים:

1. **eyebrow עם `uppercase` ו-letter-spacing על עברית.** מופיע בארטבורדי המארזים (`PackageWizardShell:84`, `PackageLabelsDialog:74`, `PackageEditDialog:312`, `settings/packages:383`). לעברית אין אותיות גדולות, והריווח פוגע בקריאוּת. ההמלצה: להסיר את ה-uppercase ולהשאיר את הטקסט.
2. **שני מפרטי תגית סותרים.** `Settings.dc.html:73, 190` אומר 11px, ריפוד 3/10. ארטבורד המארזים אומר 10.5px, ריפוד 2/8. ההמלצה: מפרט `Tag` אחד.
3. **`SettingsSubNav`.** הארטבורד מגדיר טאבים בצורת pill (הפעיל לבן), 17/600 ובלי אייקונים. במימוש יש טקסט כחול עם קו תחתון (שלא מוצג, ראו 2.9) ואייקונים. ההערה ב-`:13` אומרת שהבחירה מכוונת.
4. **רדיוס שדה 8 מול 10.** חוזה ה-combobox הצפוף (8px, 14.5px) עומד מול `fieldInput` של הארטבורד (10px, 14px), ושניהם באותה שורה.
5. **`PhotoUploader` ו-`PassFail` משומשים באשף פתיחת המארז.** הארטבורד מגדיר זוגות של 220px וצ'יפים של 44px.
6. **משלוחים.** 8 אריחי KPI מול 4 בארטבורד; `minWidth` 1360 מול 1180.
7. **סדר כפתורים בדיאלוג (D3).** הארטבורדים: הפעולה הראשית בסוף. `ui.css`: בהתחלה.
8. **פאנל הסריקה מופיע ב-hover** (גם בארטבורד). ראו X7.
9. **Inter למספרי מזהה** (בארטבורד). Inter לא ארוז. ההמלצה: `var(--font-mono)` או Rubik עם `tabular-nums`.
10. **הדשבורד: הערות שצבועות תמיד** (CO-7). מדריך הבנייה (§9) לא בריפו, ולכן לא בדקתי אם זה מחויב.
11. **`#7a7a7a` בכל הארטבורדים.** הכהיית הטוקן (D1) תשנה מעט את המראה ביחס לארטבורד.
12. **רצועת סטטוס צבעונית בכרטיס פריט בעמדה (HI-5).** לבדוק מול `Testing Screen Packages.dc.html` לפני הסרה.

---

## 6. מה עובד טוב (לשמור)

- **שפה חזותית קוהרנטית:**
  - כחול פעולה אחד, משטחים שטוחים.
  - משפחת אייקונים אחת (lucide, קו 1.75).
  - Rubik ארוז מקומית.
  - אין MUI, אין גרדיאנטים במסכים החיים (מלבד PopUpTestDialog), ואין `transition: all` ברוב הקוד.
- **מאפיינים לוגיים כמעט בכל מקום** (`insetInline*`, `marginInline*`, `borderInline*`). `sx.ts` ממפה את `ml/mr/pl/pr` למאפיינים לוגיים.
- **הקפדה על bidi:**
  - `PackageIdText` (קבוצות ספרות, `isolate`, tabular).
  - `<Bdi>` בשעות עבודה.
  - `LoadBar`/`ProgressCell` מתמלאים מצד הקריאה.
  - הגרפים הם "איים" LTR עם טולטיפים RTL.
  - `ChevronRight` נכון ב-BackLink של ההיסטוריה.
- **תנועה מאופקת:** רוב המעברים 120–200ms על מאפיינים מוגדרים. כל הגרפים החיים לא מונפשים, ועם נימוק מתועד (`chartConfig.tsx:11-12`). פלטת הפקודות מנפישה רק transform ויש לה מסלול reduced-motion.
- **מספרים כנים בדשבורד:** "—" במקום 0, ▲/▼ יחד עם צבע, skeleton רק בטעינה ראשונה, ורענון שלא מרוקן את הגוף.
- **`tabular-nums`** ב-124 מקומות.
- **דוגמאות לחקות:**
  - `users`: מצבי loading, error ו-retry, ומצב ריק שמבחין בין "סונן" ל"אין".
  - `work-hours`: ולידציה ברמת השדה.
  - `TextEditorModal`: בדיקת שינויים לפני סגירה.
  - `EditItemDialog`: אזהרה לפני שינוי סוג, ו-409 כהחלטה ולא כשגיאה.
  - `ItemFilesPanel`: מצב ריק מלמד.
- **CommandPalette:**
  - קיצורים לפי מקש פיזי, כך שעובד גם בפריסה עברית.
  - kbd מוצג ב-LTR.
  - `listbox`/`option`, מגן מתשובות ישנות, הדגשת התאמה.
- **`packages.css`** הוא התבנית הנכונה למה שסטייל inline לא יכול: container query, כותרת sticky עם box-shadow, ופריסה למסכים נמוכים.
- **`settingsNav.ts`** כמקור אחד לניווט ההגדרות, ו-`CrudTable` שמאחד חמישה דפים.

---

## 7. תוכנית מתועדפת (צעדים קטנים שאפשר לסקור כל אחד בנפרד)

**בכל צעד:** `npx tsc --noEmit` ו-`npm run lint`, סיכום של מה השתנה ולמה, הצעה להודעת commit, ועצירה לאישור. בלי שינויי לוגיקה, fetch, API, routes או Prisma, ובלי חבילות חדשות. בצעדים עם שינוי חזותי משמעותי מומלץ גם מבט בדפדפן.

### A0 — תיקונים מהירים (מומלץ ראשון, D8)
עשרה תיקונים מבודדים בהשפעה גבוהה, שלא תלויים בהחלטות:

| תיקון | ממצא |
|---|---|
| `--shx-font: var(--font-text)` | TY-1 |
| כיבוד `sx.fontSize` באייקונים, ב-`icons.tsx` | 2.9, C1 |
| מיפוי `error.light`, `error.contrastText` ו-`action.hover` ב-`sx.ts` | ST-3, 2.9 |
| צבעים סמנטיים ב-`LinearProgress` | ST-5 |
| היפוך אייקוני כיוון ב-RTL | RT-1 |
| `ChevronRight` ב"חזרה למארזים" | RT-3 |
| סדר כפתורי החודש בשעות עבודה | RT-4 |
| חץ ה-select בדשבורד | RT-2 |
| הסרת `[v7]` | CM-16 |
| `bdi` ל-"a / b" | RT-5 |

הסיכון נמוך. הכי בולט חזותית: האייקונים במסך הבדיקות יקטנו לגודל שתוכנן להם.

### שלב A — בסיס (טוקנים כמקור אמת אחד)
- **A1 — תפקידי צבע וניגודיות** (D1). להוסיף לטוקנים את התפקידים החסרים (CO-3), לתקן את muted, הענבר והירוק, להוסיף גבול שדה ≥3:1, ולהוסיף צבעי סרגל צדי. `--shx-*` ו-`theme.ts` יפנו לטוקנים. `alpha()` יתמוך ב-`var()` דרך `color-mix()`. קבצים: `tokens.css`, `globals.css`, `shifthouse.css`, `theme.ts`.
- **A2 — סולם טיפוגרפיה, ריווח, רדיוס ותנועה** (D2). טוקני תפקיד, עם השמות הישנים כ-alias:
  - טקסט: micro / fine / small / dense / body-sm / body / lead / title / page / kpi.
  - `--space-md: 16`.
  - `--r-card`.
  - תנועה: `--ease-out: cubic-bezier(.23,1,.32,1)`, `--ease-in-out`, `--dur-fast: 120ms`, `--dur-base: 180ms`, `--dur-slow: 240ms`.

  בלי שינוי במסכים בצעד הזה. אפשרי גם `DESIGN.md` שמתעד את המערכת (impeccable ממליץ).
- **A3 — בסיס גלובלי ב-`ui.css`:**
  - `:focus-visible` אחיד לכל רכיב אינטראקטיבי.
  - בלוק `prefers-reduced-motion`.
  - gating ל-hover.
  - `::selection` ו-scrollbar מהטוקנים.
  - keyframe אחד ל-shimmer.
- **A4 — נכונות שכבת `sx`:**
  - אזהרת dev על מפתחות שנבלעים (מקוננים ורספונסיביים), כדי שלא יתווספו חדשים.
  - נתיבי צבע חסרים ב-`COLOR_TOKENS`.
  - המרת כל ~20 הרספונסיביים וכל ~70 המקוננים ל-CSS (חלק ייעשו בצעדי המסכים). SP-1 (גרידים קורסים) כאן או ב-A0.
- **A5 — פלטות מקומיות לטוקנים.** `packageUi.ts`, `stationKit.tsx`, `testing/page.tsx` (`STATUS_TOKENS`), `dashboard.css` (`--dash-*`), `command-palette.css` (`--cp-*`), `work-hours/ui.tsx`, `reference-items`, `settings/packages`, היסטוריה, `navBar`. מכני; אין שינוי חזותי מעבר לתיקוני A1.
- **A6 — hex גולמי במסכים ל-`var(--color-*)`**, בארבעה צעדים: A6a פריטים ומעטפת, A6b בדיקות ומארזים, A6c משלוחים ודשבורד, A6d הגדרות וקבצים. לא כולל `reports/*` (פלטת הדפסה מתועדת) ו-`auth-error` (HTML עצמאי).

### שלב B — רכיבים משותפים
- **B1 — `Button` ו-`IconButton`:** מחלקות לכל ה-colors, `size="dense"`, `loading`, גודל 15px (D2), `aria-label` מ-`title`, הסרת `bgcolor` שדורס מצבים (CM-3).
- **B2 — שדות:** `TextField`/`Select`/`SearchInput`/`Switch`/`Checkbox`. גבהים וגדלים אחידים, `id` ו-`htmlFor` אוטומטיים (A11-4), focus-visible למתג. (`Autocomplete.tsx` רק באישור, D6.)
- **B3 — `Dialog` ו-`ConfirmDialog`:** כותרת אחידה, slot סגירה, סדר פעולות (D3), פוקוס על "ביטול" כשהפעולה הרסנית, כניסה ויציאה קצרות (MO-10).
- **B4 — טבלאות:** סגנון אחד (`sh-table`; `DataTable` עובר אליו), שורה מקלדתית (A11-1), כותרת מיון עם `<button>` ו-`aria-sort` (A11-3), tint לשורה נבחרת במקום פס צדי, כותרת sticky בבית.
- **B5 — `Tag`/`Chip`/`StatusPill`:** רכיב תגית אחד ומפת סטטוס→גוון אחת (CO-6, CM-11), צ'יפ מקלדתי עם כפתור מחיקה בעל שם.
- **B6 — משוב:** `Alert` (בלי פס צד, `role` לפי חומרה, תווית סגירה בעברית), `Snackbar` (`role="status"`, תנועה), `Skeleton` (טוקנים, RTL, reduced-motion), `LinearProgress` (`scaleX`, aria).
- **B7 — מעטפת וניווט:** מחלקות `.sh-nav-item` (CM-1), התאמת prefix ו-meta לנתיב (HI-1), `aria-current` ו-`<nav>`, הסרגל בלי הנפשת layout ובלי הנפשה בטעינה (MO-2), מצבים ל-`SettingsSubNav`.
- **B8 — `Tabs`/`Tooltip`/`Menu`:** focus-visible וניווט חיצים, Provider משותף לטולטיפים (skip-delay), `Menu` עם ניווט מקלדת (שקילת Radix DropdownMenu, שכבר מותקן).
- **B9 — פירוק `shifthouse.css`:** העברת `ItemsToolbar`, `SettingsToolbar`, `ShipmentTable`, `EditItemDialog`, `StationsTable`, `StationTypesTable`, `testing-routes`, `work-hours` ו-history ל-primitives, ומחיקת הקובץ (CM-2, CM-6).

### שלב C — מסכים (לפי תנועה, הגבוה קודם)
כל צעד כולל את המצבים (שגיאה מול ריק, skeletons), RTL ונגישות של אותו מסך:
- **C1 — פריטים (הבית):** HI-2, HI-7, HI-9, SP-2, SP-7, ST-1, ST-6, ST-8, ST-9, `EditItemDialog` על `Dialog` (CM-4).
- **C2 — עמדת בדיקות:** CM-3, ST-4, ST-7, HI-5 (באישור, §5.12), SP-6, SP-8, A11-7, `PopUpTestDialog` (HI-6), `StationHistoryDialog` (RT-6, CO-4), ו-`StationShell` מיושר לשלד המארזים (CM-15).
- **C3 — מארזים ודיאלוגי מארז:** מחלקות `.pkg-*` עם מצבי הארטבורד (CM-5), 8 המודלים על `Dialog` (CM-4, X6), `.pkg-field:focus` (A11-2), שורות כקישורים וכפתורים (A11-1), CM-17, SP-10, RT-7.
- **C4 — משלוחים:** גריד הפופאפים (SP-1, אם לא נעשה ב-A0/A4), כפתורים, צ'יפים, ST-1, ST-12, ST-13, ST-15, ST-16, CM-18.
- **C5 — דשבורד:** ST-2 (מספרים כנים), A11-3, A11-8, CM-7, CM-14, CO-7, CO-8, TY-6, MO-7, RT-8.
- **C6 — היסטוריית פריט:** HI-4, TY-4, רדיוסים, ST-10.
- **C7 — הגדרות:** page shell (SP-3), `PageHeader` (TY-4), גריד העמדות (SP-1), אישורי מחיקה (CM-9), A11-1, ST-11, ST-14, SP-9, SP-12.
- **C8 — קבצים ודפי התחברות:** CO-5, ST-5 (אם לא נעשה ב-A0), `no-auth` (ST-17).

### שלב D — תנועה ומיקרו-אינטראקציות (אחרון)
- **D1:** press אחיד (0.97, `--t-press`, ease-out), gating ל-hover, ניקוי `transition: all` ומאפייני layout (MO-4, MO-5, MO-6, MO-9).
- **D2:** כניסה ויציאה לשכבות צפות. דיאלוג: 180ms פנימה, 120ms החוצה. popover, select ו-menu: מ-`transform-origin` של Radix, 150ms. טולטיפ: skip-delay. Snackbar. הסרת אנימציית Ctrl+K (MO-3, MO-10, MO-11).
- **D3:** הפאנל בדוק עם השהיית כוונה (MO-8), פס הרענון בדשבורד (MO-7), אימות reduced-motion בכל המסכים (MO-1).

### צעד אופציונלי E
- מחיקת 22 קבצי הדשבורד המתים (D7).
- כתיבת `DESIGN.md` מתוך הטוקנים הסופיים, כדי שמסכים עתידיים לא ימציאו פלטות מחדש.

---

## 8. סטטוס יישום (עודכן 2026-10-11)

כל ההחלטות ב-§1.3 אושרו כפי שהומלצו, וכל הצעדים בוצעו בענף `design/ui-polish-audit`, כל צעד ב-commit נפרד.

**בדיקות לפני כל commit:** `npx eslint` על הקבצים שהשתנו. `npx tsc --noEmit` נקי בתוך `src`. שתי שגיאות נשארות בתוך `.next/` (טיפוסים ישנים לנתיב שנמחק), ואינן קשורות לשינויים. בסיום רצו גם `npx eslint src` (נקי), `npm test` (65/65) ו-`next build` בתוך Docker.

### מה בוצע

| צעד | commit | עיקר השינוי |
|---|---|---|
| A0 | `bb9c1b1` | עשרה תיקונים מהירים |
| X1+X2 | `62bc9ea` | ענף `fix/package-labels-and-contents`, מוזג לענף הזה |
| A1–A6 | `e9062ad` … `129951d` | טוקנים במקור אחד, ניגודיות AA, סולמות, בסיס גלובלי, תיקוני `sx`, ~700 hex לטוקנים |
| B1–B8 | `7764ad6` … `0730267` | רכיבי הבסיס |
| B9 | `c5e9743` | מחיקת `shifthouse.css` |
| C1 | `40c974a` | פריטים |
| C2 | `6ad3dfd`, `2c0fbec` | עמדת בדיקה, וסורק ברקוד ברמת הדף |
| C3 | `84e5f19` | מארזים |
| C4 | `e84b7a4` | משלוחים |
| C5 | `22d8410` | דשבורד |
| C7/C8 | `84bb673` | הגדרות, קבצים, no-auth |
| D1–D2 | `fdb5c8b`, `d1a558b` | תנועה |
| E | `4a8e756` | מחיקת 22 קבצי דשבורד מתים |
| תיקונים משותפים | `2886d6a`, `d7d1779`, `a223c14`+`6a43ec7`, `b9f12cf`, `10f07c9`, `31980e6`, `7f4d5cc`+`f93b6b2` | בקשות שעלו מצעדי המסכים |

### בדיקה בדפדפן

צילומי מסך מהסביבה `pkgtest` (משתמש `pkgtest`) לפני ואחרי, בלי שגיאות קונסול ובלי 5xx. נבדקו: פריטים, מארזים, עמוד מארז, משלוחים, שלושה טאבים בדשבורד, קבצים, שבעה דפי הגדרות, no-auth, עמדת בדיקה (ריקה ועם תור), היסטוריית פריט, דיאלוג פריט ופוקוס מקלדת על שורה.

**לא נבדקו בדפדפן** (נבדקו בקוד בלבד):
- זרימות אינטראקטיביות: אשפי פתיחה וסגירה, שליחת פופאפי משלוח, העלאת קבצים, סורק ברקוד גלובלי, Esc מדורג בדיאלוגים
- רוחב נייד

### רגרסיות שנמצאו ותוקנו בדרך
- A6 הפך את `backgroundColor="#fafafa"` של קנבס החתימה ל-`var(...)`. קנבס לא קורא CSS, ולכן החתימה לא נראתה. תוקן ב-C4: הקנבס שקוף והרקע מגיע מה-CSS. קובץ החתימה נשמר עכשיו עם רקע שקוף.
- `ui/Dialog` קרא ל-`onClose` פעמיים בלחיצה על הרקע (באג קיים). תוקן ב-`b9f12cf`.
- KPI "ההמתנה הארוכה ביותר" נחתך מעל 99 שעות ("964:2") (באג קיים). תוקן.

### שינויי התנהגות קטנים לסקירה
- **StationShell:** בלי × בכותרת (יוצאים דרך "יציאה" או Esc). "חזור" הפך ל-"הקודם". גובה 720.
- **מסלולי בדיקה:** שמירה מושבתת כשטעינת המסלול נכשלה. קודם נשמר מסלול ריק שאיש לא ראה.
- **הגדרות מארזים:** Enter בשם יוצר סוג חדש.
- **דיאלוגי מארז:** נועלים גלילת רקע. סגירה בלחיצה ברקע (press) ולא ב-click.
- **שורות בפאנל המארז:** קישורים אמיתיים (אפשר לפתוח בטאב חדש).
- **"N פריטים שהושלמו מוסתרים · הצג":** מפעיל את מסנן הסטטוס הקיים (הושלם).
- **תאריכים בטבלת הפריטים:** בפורמט האחיד (אזור זמן ירושלים).
- **פסי עומס והתקדמות בדשבורד:** מתמלאים מימין, כמו שההערות בקוד תמיד טענו (קודם התמלאו משמאל).

### התנגשויות עם הארטבורדים שהוכרעו לטובת המערכת (לאישורך)

| נושא | הארטבורד | מה מומש |
|---|---|---|
| מראה disabled במארזים | גוון hairline | `.sh-btn:disabled` אחד לכל האפליקציה |
| גבול שדות טקסט במארזים | `#e0e0e0` | `--color-field-border` (3:1) |
| משקל כותרת דיאלוג מארז | 700 | 600 |
| חיפוש בהגדרות | 42px, רדיוס 10 | `SearchInput` (44px pill) |
| שורת סוג עמדה נבחרת | פס צד 3px | גוון כחול |

נשארו לפי הארטבורד: כותרת רשימת המארזים 34px, וגדלים 11.5/12.5/13.5 שהארטבורד מצמיד.

### נשאר פתוח
- **X5** (JSON גולמי בכשל התחברות): מחוץ להיקף, route.
- **שגיאות טעינה בעמדת הבדיקה:** של סוגי העמדות ושל רשימת העמדות עדיין שקטות (ST-1 טופל לתור בלבד).
- **"סה״כ · ברוטו" בפריטים איטיים:** מציג רק זמן קיר. הוספת השעון השני היא שינוי נתונים, ולכן החלטה שלך.
- **K7:** חילוץ עורך הפריטים המשותף לשלושת פופאפי המשלוח (רק החתימה חולצה).
- **הצעות לשכבה המשותפת:** טוקני צבע קטגוריה (תפקידים, סוגי קבצים), `DialogTitle subtitle`, גרסת דיו ל-`DASH_COLORS`.
- **קבצים נוספים שאף נתיב לא מגיע אליהם** (לא נמחקו, לא אושר):
  - `common/PeriodCombobox.tsx`
  - `ItemLabelsDialog.tsx`
  - `lib/dashboard-filters.ts`
  - `lib/date-periods.ts`
  - `lib/itemQrParser.ts`
  - `hooks/useRuntimeConfig.ts`
  - `lib/auth/decode-jwt.ts`
- **התקנות ואתחול:** `/impeccable init` (PRODUCT.md) והתקנת `emil-design-eng`.
