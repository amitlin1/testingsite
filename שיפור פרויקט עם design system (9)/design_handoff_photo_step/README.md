# Handoff: עיצוב מחדש לשלב "צילום האריזה" (POPUP קליטה וצילום)

> קובץ ה‑HTML בחבילה (`Photo Step Redesign.dc.html`) הוא **רפרנס עיצובי** — אב‑טיפוס אינטראקטיבי שמראה את המראה וההתנהגות הרצויים, לא קוד ייצור להעתקה. המשימה: **לשחזר את העיצוב בקוד האמיתי** בקובץ `src/app/testing/tests-popups/Photo.tsx`, תוך שמירה מלאה על הפונקציונליות הקיימת (העלאת תמונות אמיתית, PassFail, הערות, ניווט השלבים).

---

## פרומפט מוכן להדבקה ב‑Claude Code

```
בקובץ src/app/testing/tests-popups/Photo.tsx עצב מחדש את שלב "צילום האריזה"
(phase === "pkgPhoto") ואת רכיב PhotoUploader. אל תשנה שום לוגיקה, קריאות API,
העלאת קבצים, או זרימת השלבים — שינוי ויזואלי/פריסה בלבד.

1) חלק התמונות עובר למעלה ותופס יותר מקום: במקום שתי עמודות (תמונות | תקינות),
   סדר את השלב במאונך — קודם בלוק התמונות ברוחב מלא, ואחריו כרטיס "בדיקה תקינה?"
   + "הערות".
2) המסגרת הגדולה (הפריים) גבוהה יותר — height ~340px במקום 210.
3) הפילמסטריפ תומך ביותר מ‑3 תמונות אבל נשאר שורה מסודרת עם מרווח שווה: flex-wrap
   עם gap אחיד, כל תמונה flex:1 1 128px, min-width 112px, max-width 220px. עבור 3
   תמונות זו שורה אחת עם רוחב שווה; אם יש יותר — נשבר לשורה נוספת באותו מרווח
   (בלי לדחוס). תמונות הייחוס ביחס 4/3.
4) ה‑POPUP גדול יותר: ב‑PaperProps.sx כשisWide → width "max(920px, 72vw)",
   height "min(900px, 92vh)".
5) עיצוב ידידותי יותר: כותרת שלב גדולה עם שורת תיאור, כפתור "צלם / העלה" גבוה (58px),
   כותרת מקטע "תיעוד בתמונות" עם מונה, ומחוון נקודות התקדמות. כפתורי תקין/לא תקין
   גבוהים (56px) בתוך כרטיס עם המסגרת.

הכל לפי מערכת העיצוב Shifthouse: כחול פעולה יחיד #0066cc (hover #0058b3), הצלחה
#1f8a5b, הרסני #bf3535, טקסט #1d1d1f/#7a7a7a/#9a9aa0, hairline #e0e0e0, RTL,
Heebo/SF Pro, שטוח ללא צללים על קלפים. ראה מפרט ורפרנס ב‑Photo Step Redesign.dc.html.
```

---

## מה משתנה בדיוק (ומה לא)

**לא נוגעים:** `emptyPhotos`, `Photos`/`Shot`/`RefImg` types, `uploadToItem`, `pickParentPhoto`, `removeParentPhoto`, `pickAccPhoto`, `canContinue`, `goNext/goBack/goToStep`, כל שלבי ה‑phase האחרים, וה‑submit. חתימות הרכיבים (`PhotoUploader`, `PassFail`) נשארות זהות כדי שכל אתרי הקריאה יתעדכנו יחד.

**משתנה — פריסה בלבד:**

### 1. גודל ה‑Dialog (`PaperProps.sx`)
בבלוק ה‑`sx` של ה‑Paper, במקום:
```
width: isMobile ? "100vw" : isWide ? "max(760px, 65vw)" : "94vw",
height: isMobile ? "100dvh" : isWide ? "min(900px, 86vh)" : "94vh",
```
→
```
width: isMobile ? "100vw" : isWide ? "max(920px, 72vw)" : "94vw",
height: isMobile ? "100dvh" : isWide ? "min(900px, 92vh)" : "94vh",
```

### 2. שלב `pkgPhoto` ב‑`PhaseBody` — פריסה מאונכת (photos-first)
היום השלב הוא `Box` עם `display:flex; flexWrap:wrap` ובתוכו שתי עמודות: `PhotoUploader` בעמודה אחת, ו‑`בדיקה תקינה?` + `PassFail` + הערות בעמודה השנייה.

**החדש:** `Stack spacing={3}` מאונך:
- **מקטע תמונות (למעלה, רוחב מלא):** כותרת שורה "תיעוד בתמונות" + קו מפריד + מונה `X / N צולמו` (pill כחול); ואז `<PhotoUploader ... />` ברוחב מלא.
- **כרטיס תקינות + הערות (למטה):** `Box` עם `border:1px solid #e0e0e0; borderRadius:"18px"; p:"22px 24px"` המכיל: label "בדיקה תקינה?" (15px/600) → `<PassFail .../>`; ואז label "הערות" → `TextField multiline rows={3}` (או textarea מעוצב).
- ה‑Chip הכתום "לא נמצא פריט ייחוס" נשאר למעלה כשצריך.

### 3. `PhotoUploader` — פריים גדול + פילמסטריפ גמיש
- **פריים ממוקד:** `height: 210` → `height: 340`; שאר הלוגיקה (bigSrc, pill "צולם"/"תמונת ייחוס", כפתור הסרה, spinner) זהה.
- **כפתור צילום:** `height: 50` → `58`, `fontSize 16` → `17`.
- **פילמסטריפ:** היום `display:flex; gap:1; overflowX:auto` עם פריטים ברוחב 64px קבוע. החלף ל:
  `display:flex; flexWrap:"wrap"; gap:"14px"` והפריטים `flex:"1 1 128px"; minWidth:112; maxWidth:220`, יחס תמונה `4/3` (`aspectRatio`), ולא רוחב קבוע. כך 3 תמונות ממלאות שורה אחת ברוחב שווה, ומעל 3 נשבר לשורה נוספת עם אותו מרווח. השאר את מסגרת ה‑active (2.5px כחול), ה‑✓ הירוק על מה שצולם, וה‑badge "ייחוס".
- מונה ה‑`counterText` ("X / Y צולמו") יכול לעבור לכותרת המקטע (סעיף 2) — לשיקולך; אפשר להשאיר גם בתוך הרכיב.

השינויים ב‑`PhotoUploader` תקפים אוטומטית גם ל‑sub‑flow של הפריטים הנלווים (pkg/product) כי הרכיב משותף — זה רצוי.

---

## Design tokens (Shifthouse)
- **Action Blue** `#0066cc` (hover `#0058b3`), focus `#0071e3`.
- טקסט `#1d1d1f`, משני `#7a7a7a`, עמום `#9a9aa0`.
- רקע רייל/כרטיס `#f5f5f7` / `#fff`, hairline `#e0e0e0`, מפריד רך `#f0f0f0`.
- הצלחה `#1f8a5b` (רקע רך `rgba(31,138,91,0.08)`), הרסני `#bf3535` (רקע רך `rgba(191,53,53,0.08)`).
- פינות: פריים 16–18px, כפתור צילום 13–14px, כרטיס תקינות 18px, thumbnail 12–13px, pill `9999px`.
- טיפוגרפיה: כותרת שלב 24–27px/700 letter‑spacing −0.4px; label מקטע 15–16px/600–700; body 14–15px.
- כפתורים: press `transform:scale(0.98)`. אין צללים על קלפים; הצל היחיד על ה‑Dialog: `rgba(0,0,0,0.22) 3px 5px 30px`.
- אייקונים: Lucide / אותם אייקוני `@/components/ui/icons` הקיימים (AddAPhoto, Check, Close, Person…), ללא מילוי.
- ללא אימוג'י, ללא סימני קריאה. מק״ט/מספרים ב‑tabular‑nums.

## Files
- `Photo Step Redesign.dc.html` — אב‑הטיפוס האינטראקטיבי (לחיצה על "צלם / העלה" או על thumbnail מדגימה מצבי "צולם"). זה הרפרנס לפריסה, לפרופורציות ולמצבי האינטראקציה של שלב `pkgPhoto`.
