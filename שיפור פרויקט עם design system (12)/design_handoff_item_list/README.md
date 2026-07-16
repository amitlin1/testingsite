# Handoff: עיצוב מחדש להצגת הפריטים במסך הבדיקה — "רשימת פסים" (סדר תור + שלבים)

> קובץ ה‑HTML בחבילה (`Item Presentation Options.dc.html`) הוא **רפרנס עיצובי** — אב‑טיפוס אינטראקטיבי. הגרסה הקובעת היא **אופציה 3a** (בראש הקנבס, מסומנת "נבחר"). המשימה: **להחליף את תצוגת הכרטיסים** במסך הבדיקה בפורמט רשימת הפסים הזה, בקובץ `src/app/testing/page.tsx` (ורכיב `ItemCard`). שינוי ויזואלי/פריסה בלבד — בלי לגעת ב‑data fetching, סטטוסים, טיימרים, פתיחת דיאלוגים, סריקה, סינון או ה‑API.

---

## פרומפט מוכן להדבקה ב‑Claude Code

```
במסך הבדיקה (src/app/testing/page.tsx) החלף את תצוגת הכרטיסים בגריד ברשימת פסים
(row strips) לפי מערכת העיצוב Shifthouse. הכרטיסים תופסים יותר מדי מקום; פסים
נותנים סריקה מהירה, ידידות למגע ופחות גלילה בפס הייצור. אל תשנה לוגיקה, API,
סטטוסים, טיימרים או פתיחת דיאלוגים — פריסה/עיצוב בלבד.

מבנה כל פס (גובה ~70px, יעד מגע גדול), מימין לשמאל (RTL):
1) פס צבע סטטוס אנכי בקצה (רוחב 5px, פינות מעוגלות).
2) עיגול מספר‑תור (38px): המיקום בתור אחרי המיון. רקע כהה #15171a רגיל, ענבר
   #d97706 לפריט בעדיפות, אפור #c7c7cf למה שהושלם. טקסט לבן 16px/800.
3) בלוק מזהה: "#<item_id>" 18px/800 + status pill (נקודה צבעונית + תיאור);
   שורה שנייה "<model> · מק״ט <makat>" 13px משני.
4) מחוון שלבים ברוחב 150px: "שלב X / N" + N נקודות‑פס (המושלמות בצבע הסטטוס,
   השאר #e6e6ea).
5) טיימר בצבע הסטטוס (tabular-nums, min-width 82px, ממורכז).
6) כפתור פעולה תמיד גלוי (44px, רוחב ~120px): "התחל בדיקה"/"המשך בדיקה" כחול
   #0066cc עם אייקון play, או "הושלם" ghost ירוק disabled.

מיין: קודם ממתינים לפי זמן יורד, אז בבדיקה, אז הושלמו. הממתין הכי הרבה מקבל סרט
"ממתין הכי הרבה" (ענבר) ומסגרת ענבר דקה + הילה רכה. הוסף שורת כותרות עמודות דקה
מעל הרשימה (תור · מזהה/דגם · שלב · זמן). שמור סרגל תחנה, בורר עמדה/עובד, סריקה,
סינון, היסטוריה ותגית "נסרק" כמו היום.

ראה רפרנס: אופציה 3a ב‑Item Presentation Options.dc.html.
```

---

## מה משתנה בדיוק (ומה לא)

**לא נוגעים:** `useElapsedTime`, ה‑state וה‑`useEffect`, `handleStartTest`, `handleAddTestResult`, `handleRefreshItems`, `handleSubmitTestResult`, `TestingDock`, סריקה, היסטוריה, `getStartTestDialog` מה‑REGISTRY, `filteredItems`, `highlightedItemId`, `connected_items`, ושדות `ItemRow`. גם המיון/סרט העדיפות ורצועת הסיכום (אם כבר יושמו מה‑handoff הקודם) נשארים.

**משתנה — רק אופן ההצגה של כל פריט:**

### 1. מיכל הרשימה
במקום `Box` עם `display:grid; gridTemplateColumns:"repeat(auto-fill, minmax(310px,1fr))"`, השתמש ב‑`Stack` אנכי (`display:flex; flexDirection:"column"; gap:"10px"`). מעליו שורת כותרות עמודות דקה (12px/700, `#9a9aa0`) עם אותן רוחב‑עמודות של הפס.

### 2. `ItemCard` → פס אופקי (אותה חתימה, אותו onClick)
החלף את גוף הכרטיס ב‑`Box` אופקי:
```
display:flex; alignItems:center; gap:"15px";
background:#fff; borderRadius:"14px"; padding:"14px 16px";
border: priority ? "1.5px solid #d97706" : "1px solid #e0e0e0";
boxShadow: priority ? "0 0 0 3px rgba(217,118,6,0.10)" : "none";  // ללא Grow
position:"relative";
```
תוכן משמאל לימין ב‑DOM אך תחת `dir="rtl"`:
- **פס צבע:** `Box` `width:5, alignSelf:"stretch", borderRadius:9999, background: statusColor`.
- **עיגול תור:** `width:38,height:38,borderRadius:9999`, רקע לפי הכלל למעלה, טקסט לבן 16px/800 tabular-nums. המספר = אינדקס הפריט ברשימה הממוינת + 1.
- **מזהה+סטטוס:** `flex:1, minWidth:0`. שורה 1: `#{item_id}` 18px/800 + pill סטטוס (נקודה 6px בצבע + `item_status_desc` 12px/700 באותו צבע). שורה 2: `${model} · מק״ט ${makat}` 13px `#7a7a7a`, `ellipsis`.
- **מחוון שלבים:** `width:150`. "שלב X / N" 11.5px/700 `#5a5a5f`; מתחתיו `flex; gap:4` של N פסים (`flex:1,height:5,borderRadius:9999`), הראשונים `step` בצבע הסטטוס והשאר `#e6e6ea`. אם אין לפריט ריבוי שלבים אמיתי — גזור N מהתבנית של סוג התחנה או השאר N=1.
- **טיימר:** `elapsedTime` בצבע הסטטוס, 14.5px/700 tabular-nums, `minWidth:82, textAlign:center`.
- **כפתור:** `height:44, width:120, borderRadius:11`. ממתין/בבדיקה → כחול מלא #0066cc + אייקון play + "התחל בדיקה"/"המשך בדיקה"; הושלם → `border:1px solid rgba(31,138,91,0.3); background:rgba(31,138,91,0.07); color:#1f8a5b`, disabled, "הושלם". שמור את לוגיקת ה‑onClick הקיימת.
- **סרט עדיפות:** כשזה הממתין הכי הרבה — Chip ענבר "ממתין הכי הרבה" ב‑`position:absolute; top:-10; insetInlineStart:58` (מעל אזור העיגול). תגית "נסרק"/highlight הקיימת נשארת (אפשר כמסגרת כחולה במקום הענבר כשרלוונטי).

### 3. Empty state
ללא שינוי מהותי — אותו אייקון בעיגול + "אין פריטים תואמים בעמדה זו." בפריסת הרשימה.

---

## Design tokens (Shifthouse)
- **Action Blue** `#0066cc` (hover `#0058b3`), focus `#0071e3`.
- סטטוס: ממתין ענבר `#d97706`, בבדיקה כחול `#0066cc`, הושלם ירוק `#1f8a5b`. עיגול תור כהה `#15171a`; נקודות שלב ריקות `#e6e6ea`. **החלף `#ff9800`/`#2196f3`/`#4caf50` הישנים.**
- טקסט `#1d1d1f` / משני `#7a7a7a` / עמום `#9a9aa0` / חצי‑כהה `#5a5a5f`. קלף `#fff`, hairline `#e0e0e0`, מפריד `#f0f0f0`.
- פינות: פס 14px, עיגול/pill `9999px`, כפתור 11px. ללא צללים על קלפים; ללא אנימציית Grow.
- טיפוגרפיה: `#id` 18px/800 (−0.4px), מספר‑תור 16px/800, טיימר 14.5px/700, label 11–12px; מספרים tabular-nums.
- אייקונים: Lucide / `@/components/ui/icons` הקיימים (Science, Search, History, QrCode, AccessTime, PlayArrow…), stroke ~1.75, ללא מילוי. ללא אימוג'י, ללא סימני קריאה. שעות `00:57:08`.

## Files
- `Item Presentation Options.dc.html` — הרפרנס. **אופציה 3a** (בראש, "נבחר") היא המחייבת; 2a–2d ו‑1a–1d הן חלופות שנדחו, שמורות להשוואה בלבד.
