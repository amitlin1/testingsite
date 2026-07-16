# Handoff: תיקון רוחב + גלילה לשלב "צילום האריזה" (POPUP קליטה וצילום)

> קובץ הרפרנס בחבילה (`Photo Step Redesign v2.dc.html`) הוא **רפרנס עיצובי** — לא קוד להעתקה.
> המשימה: לתקן **שני באגים** בקובץ `src/app/testing/tests-popups/Photo.tsx` — ללא שינוי לוגיקה, API או זרימת שלבים.

---

## מה לא בסדר עכשיו (מול הפרוטוטייפ)

עיצוב השלב עצמו כבר הוטמע נכון (פריסה מאונכת photos‑first, פריים גדול, פילמסטריפ flex‑wrap, רייל צד). נשארו שני באגים אינטגרציה:

### באג 1 — התוכן צר מדי, נשאר רוחב ריק בפופאפ
עטיפת גוף הדיאלוג היא `<Box sx={{ maxWidth: 760, mx: "auto" }}>`. הדיאלוג רחב (`max(920px, 72vw)`), אז בעמודה הראשית של ~1100px נשארים ~340px שוליים ריקים משמאל. **הפריים והתוכן צריכים למלא את רוחב הפופאפ.**

### באג 2 — גלילה שבורה ("חלק מהקו נגלל וחלק לא")
העמודה הראשית ו‑ה‑body הם flex‑column אבל **חסר להם `minHeight: 0`**. ב‑flexbox ה‑`min-height` הדיפולטי הוא `auto` — כלומר ה‑body מסרב להתכווץ מתחת לגובה התוכן שלו, גדל מעבר לגובה ה‑Paper (שהוא `overflow: hidden`) ונחתך, במקום שה‑`overflowY: auto` הפנימי יפעיל גלילה נקייה. התוצאה: הכותרת/פוטר לא ננעלים כמו שצריך והגלילה מרגישה חלקית. הפתרון הסטנדרטי: `minHeight: 0` על כל מיכל flex שאמור להכיל אזור גלילה.

### באג 3 — קו הכותרת של "תיעוד בתמונות" חתוך באמצע
הקו ליד "תיעוד בתמונות" הוא `Box` עם `flex:1` שנדחס בין הכותרת למונה, ולכן נראה כמו קו שנקטע באמצע השורה. הפתרון: קו תחתון אחד רציף (`borderBottom`) מתחת לכל השורה. ראה סעיף 6b.

---

## פרומפט מוכן להדבקה ב‑Claude Code

```
בקובץ src/app/testing/tests-popups/Photo.tsx תקן שני באגים בלבד — רוחב וגלילה.
אל תשנה לוגיקה, קריאות API, העלאת קבצים או זרימת השלבים. שינוי CSS/sx בלבד.

באג הגלילה (minHeight:0 בכל שרשרת ה‑flex):
1) העמודה הראשית (ה‑<Box sx={{ flex: 1, display:"flex", flexDirection:"column",
   minWidth: 0 }}> שעוטף header/chips/body/footer) — הוסף minHeight: 0.
2) ה‑body (ה‑<Box sx={{ flex: 1, ... overflowY: "auto" }}>) — הוסף minHeight: 0.
3) הרייל השמאלי (ה‑<Box sx={{ width: 264, ... }}> ב‑isWide) — הוסף minHeight: 0
   ו‑overflowY: "auto" כדי שגם רייל ארוך יגלל בפני עצמו במקום לחתוך.

באג הרוחב (התוכן ימלא את הפופאפ):
4) עטיפת התוכן <Box sx={{ maxWidth: 760, mx: "auto" }}> → maxWidth: 1000
   (נשאר mx:"auto" כך שבמסכי ענק זה עדיין תחום ומרוכז).
5) הפריים ב‑PhotoUploader: height 340 → 420, כדי שהפריים הרחב לא ייראה שטוח מדי.
6) הפילמסטריפ: פריטים flex:"1 1 128px"; minWidth:112; maxWidth:220 →
   flex:"1 1 150px"; minWidth:130; maxWidth:280 כדי ש‑3 תמונות ימלאו את השורה הרחבה.

הכל לפי מערכת העיצוב Shifthouse. ראה פרופורציות ב‑Photo Step Redesign v2.dc.html.
```

---

## דיף מדויק (העתק‑הדבק)

### 1. עמודה ראשית — `minHeight: 0`
```diff
- <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
+ <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
```

### 2. גוף הדיאלוג (Body) — `minHeight: 0`
```diff
- <Box sx={{ flex: 1, p: isMobile ? "20px 18px" : "28px 32px", overflowY: "auto" }}>
+ <Box sx={{ flex: 1, minHeight: 0, p: isMobile ? "20px 18px" : "28px 32px", overflowY: "auto" }}>
```

### 3. עטיפת התוכן — רוחב מלא יותר
```diff
- <Box sx={{ maxWidth: 760, mx: "auto" }}>
+ <Box sx={{ maxWidth: 1000, mx: "auto" }}>
```

### 4. הרייל השמאלי (isWide) — גלילה עצמאית
```diff
- <Box sx={{ width: 264, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "24px 20px" }}>
+ <Box sx={{ width: 264, flexShrink: 0, bgcolor: PARCHMENT, borderInlineEnd: `1px solid ${HAIR}`, display: "flex", flexDirection: "column", p: "24px 20px", minHeight: 0, overflowY: "auto" }}>
```

### 5. `PhotoUploader` — פריים גבוה יותר
```diff
- <Box sx={{ position: "relative", height: 340, borderRadius: "18px", overflow: "hidden", ...
+ <Box sx={{ position: "relative", height: 420, borderRadius: "18px", overflow: "hidden", ...
```

### 6b. `PhotoSection` — קו כותרת נקי (לא "חתוך באמצע")
הבעיה: הקו של כותרת "תיעוד בתמונות" הוא כרגע פרגמנט `flex:1` שנדחס **בין** הכותרת לבין מונה ה־"X/Y צולמו" — כך הוא נראה כמו קו חתוך באמצע השורה. הפתרון: קו תחתון אחד רציף מתחת לכל השורה (כותרת מימין, מונה משמאל).

```diff
  function PhotoSection({ children }: { children: React.ReactNode }) {
    return (
      <Box>
-       <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.75 }}>
-         <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.2px", color: INK, whiteSpace: "nowrap" }}>תיעוד בתמונות</Typography>
-         <Box sx={{ flex: 1, height: "1px", bgcolor: "#f0f0f0" }} />
-       </Box>
+       <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, pb: "12px", borderBottom: "1px solid #ececec", mb: 2 }}>
+         <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.2px", color: INK, whiteSpace: "nowrap" }}>תיעוד בתמונות</Typography>
+         {/* אם המונה "X/Y צולמו" נמצא כרגע בתוך children/PhotoUploader — העבר אותו לכאן כ־chip משמאל,
+            או השאר את השורה כפי שהיא; העיקר שהקו יהיה borderBottom רציף ולא Box עם flex:1 באמצע. */}
+       </Box>
        {children}
      </Box>
    );
  }
```
> אם המונה מוצג בתוך `PhotoUploader` ולא ב־`PhotoSection`, אין צורך להזיז אותו — פשוט החלף את ה־`Box` עם `flex:1` בקו `borderBottom` רציף מתחת לשורת הכותרת, כמו למעלה.

### 6c. `PhotoUploader` — פילמסטריפ ממלא שורה רחבה
```diff
- sx={{ position: "relative", flex: "1 1 128px", minWidth: 112, maxWidth: 220, aspectRatio: "4 / 3", ...
+ sx={{ position: "relative", flex: "1 1 150px", minWidth: 130, maxWidth: 280, aspectRatio: "4 / 3", ...
```

> הערה: השינויים ב‑`PhotoUploader` תקפים אוטומטית גם לתת‑זרימת הפריטים הנלווים (pkg/product) — רצוי.

---

## למה `minHeight: 0` פותר את זה (הסבר קצר)
מיכל flex‑column עם גובה קבוע (ה‑Paper: `height: min(900px,92vh); overflow:hidden`) מכיל header/footer עם `flexShrink:0` ו‑body עם `flex:1; overflowY:auto`. ברירת המחדל `min-height:auto` על פריט flex לא נותנת ל‑body להתכווץ מתחת לתוכן שלו — אז במקום שה‑body יגלול, כל העמודה גדלה, ה‑Paper חותך אותה, והפוטר "בורח". `minHeight:0` על העמודה ועל ה‑body מאפשר לה‑body להתכווץ לגובה הזמין ולהפעיל את הגלילה הפנימית שלו בלבד — כך header ו‑footer ננעלים ורק אזור התוכן נגלל.

---

## מה לא נוגעים
`emptyPhotos`, טיפוסי `Photos`/`Shot`/`RefImg`, `uploadToItem`, `pickParentPhoto`, `removeParentPhoto`, `pickAccPhoto`, `canContinue`, `goNext/goBack/goToStep`, ה‑submit, וכל שאר ה‑phases. חתימות `PhotoUploader`/`PassFail`/`VerdictCard`/`PhotoSection` נשארות זהות.

## Design tokens (Shifthouse)
- Action Blue `#0066cc` (hover `#0058b3`), focus `#0071e3`. טקסט `#1d1d1f`/`#7a7a7a`/`#9a9aa0`.
- hairline `#e0e0e0`, מפריד רך `#f0f0f0`, רקע רייל `#f5f5f7`. הצלחה `#1f8a5b`, הרסני `#bf3535`.
- פינות: פריים 18px, כרטיס תקינות 18px, thumbnail 13px, pill `9999px`. שטוח ללא צללים על קלפים.
- הצל היחיד — על ה‑Dialog: `rgba(0,0,0,0.22) 3px 5px 30px`.

## Files
- `Photo Step Redesign v2.dc.html` — הרפרנס המעודכן (רוחב מלא + גלילה נכונה). כותרת/פוטר ננעלים, רק אזור התוכן נגלל.
