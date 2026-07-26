# משימה: תיקון קשיח למיקום ה‑Autocomplete/SearchableCombobox

## הבעיה
רשימת ה‑autocomplete נפתחת במיקום שגוי — קופצת לראש העמוד/מנותקת מהשדה במקום להיצמד אליו. זה קורה בכל השדות שמבוססים על `SearchableCombobox` (שהוא wrapper דק מעל `Autocomplete`), למשל בטבלת ניהול הפריטים, בפילטרים של הדשבורד, ובדיאלוגים.

## שורש הבעיה (root cause)
בקובץ `src/components/ui/Autocomplete.tsx`, לוגיקת המיקום של הפופאפ (הפורטל ל‑`document.body`) שבורה בשני מקומות:

1. **חישוב מיקום כלפי מעלה (flip):** כשאין מקום מתחת לשדה, התפריט "מתהפך" כלפי מעלה ומחשב `top = fieldTop − GAP − h` כאשר `h` הוא הגובה **המקסימלי** (320px), ולא הגובה האמיתי של התוכן. רשימה של 2 שורות (~90px) מקבלת `top` שמתאים לרשימה בגובה 320px → מרחפת ~230px מעל השדה, בראש העמוד.
2. **`position: absolute` + `window.scrollY`:** ב‑`AppShell.tsx` הגלילה מתרחשת ב‑`Box` פנימי (`height: calc(100vh - TOPBAR); overflowY: auto`), **לא בחלון**. לכן `window.scrollY` תמיד 0, וחשבון הקואורדינטות של העמוד סוטה בשקט.
3. **תנאי ה‑flip אגרסיבי מדי:** הוא משווה את המקום הפנוי מול ה‑cap של 320px במקום מול גובה התפריט האמיתי, אז הוא מתהפך גם כשיש מספיק מקום מתחת.

## הפתרון
החלף את **מודל המיקום בלבד** ב‑`src/components/ui/Autocomplete.tsx` ל:

- **`position: fixed`** עם קואורדינטות viewport גולמיות מ‑`getBoundingClientRect()` — **בלי** להוסיף `scrollX/scrollY`. זה חסין לגלילה הפנימית של ה‑AppShell ולכל ancestor עם offset/overflow.
- כשהתפריט נפתח כלפי מעלה — לעגן אותו לפי **`bottom`** (`bottom: window.innerHeight − fieldTop + GAP`), כך שהוא גדל כלפי מעלה וצמוד לשדה ללא תלות במספר הפריטים.
- **flip רק כשאין באמת מקום מתחת:** סף קבוע (`MIN_SPACE = 160px`), לא ביחס ל‑cap.
- להשאיר את הפורטל ל‑`document.body`, את מאזיני ה‑`scroll` (capture phase) וה‑`resize`, ואת `maxHeight` + `overflowY: auto`.

## חשוב
- **אל תשנה את ה‑public API** של `Autocomplete` (props, `renderInput`, `renderOption`, reasons, וכו'). כל הצרכנים (`SearchableCombobox`, `WorkerPicker`, פילטרים של הדשבורד, שדות בדיאלוגים) חייבים להמשיך לעבוד ללא שינוי.
- שנה **רק** את בלוק המיקום: את ה‑state `pos`, את ה‑`useLayoutEffect` שמודד, ואת ה‑`style` של ה‑`<ul>` בפורטל.
- אל תיגע ב‑CSS ‑ `.sh-select-content` / `.sh-select-item` נשארים כמו שהם (ה‑inline styles גוברים על ה‑class).

## שינויים מדויקים

### 1. state של `pos` — הוסף תמיכה בעיגון לפי top או bottom
```ts
const MENU_MAX_H = 320;
const MIN_SPACE = 160; // מתחת לכמות מקום זו מתחת לשדה — מעדיפים לפתוח כלפי מעלה
const listRef = useRef<HTMLUListElement>(null);
const [pos, setPos] = useState<{
  left: number; width: number; dir: "ltr" | "rtl";
  placement: "bottom" | "top"; top?: number; bottom?: number; maxH: number;
} | null>(null);
```

### 2. ה‑`useLayoutEffect` שמודד — קואורדינטות viewport, בלי scroll math
```ts
useLayoutEffect(() => {
  if (!open || !anchorRef.current) { setPos(null); return; }
  const el = anchorRef.current;
  const GAP = 4, EDGE = 8;
  const update = () => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom;
    const spaceAbove = r.top;
    const dir = getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
    // flip כלפי מעלה רק כשאין באמת מקום מתחת ויש יותר מקום למעלה
    const flip = spaceBelow < MIN_SPACE && spaceAbove > spaceBelow;
    if (flip) {
      // עיגון לפי bottom => גדל כלפי מעלה וצמוד לשדה ללא תלות בכמות הפריטים
      setPos({
        placement: "top",
        bottom: vh - r.top + GAP,
        left: r.left, width: r.width, dir,
        maxH: Math.max(120, Math.min(MENU_MAX_H, spaceAbove - GAP - EDGE)),
      });
    } else {
      setPos({
        placement: "bottom",
        top: r.bottom + GAP,
        left: r.left, width: r.width, dir,
        maxH: Math.max(120, Math.min(MENU_MAX_H, spaceBelow - GAP - EDGE)),
      });
    }
  };
  update();
  window.addEventListener("scroll", update, true); // capture: לתפוס גם גלילה של scroller פנימי
  window.addEventListener("resize", update);
  return () => {
    window.removeEventListener("scroll", update, true);
    window.removeEventListener("resize", update);
  };
}, [open, filtered.length]);
```

### 3. ה‑`style` של ה‑`<ul>` בפורטל — fixed, ועיגון top/bottom לפי placement
```tsx
style={{
  position: "fixed",
  ...(pos.placement === "top" ? { bottom: pos.bottom } : { top: pos.top }),
  left: pos.left,
  width: pos.width,
  maxHeight: pos.maxH,
  overflowY: "auto",
  listStyle: "none",
  margin: 0,
  zIndex: 1450,
  boxShadow: pos.placement === "top"
    ? "rgba(0,0,0,0.14) 0 -10px 34px 0"
    : "rgba(0,0,0,0.14) 0 12px 34px 0",
  transformOrigin: pos.placement === "top" ? "bottom center" : "top center",
}}
```

## דרך מהירה יותר
קיים קובץ מתוקן מלא ומוכן (drop‑in, אותו API בדיוק) ב‑`claude-code-handoff/fixes/Autocomplete.tsx`. אפשר פשוט להעתיק אותו על `src/components/ui/Autocomplete.tsx`.

## בדיקות קבלה (QA)
1. שדה autocomplete באמצע/תחתית העמוד — הרשימה נפתחת **צמודה מתחת לשדה**, לא בראש העמוד.
2. שדה בתחתית ה‑viewport ללא מקום מתחת — הרשימה נפתחת **כלפי מעלה, צמודה לשדה** (גם עם 1–2 פריטים בלבד, בלי ריחוף).
3. גלילה של תוכן העמוד (ה‑Box הפנימי של AppShell) בזמן שהרשימה פתוחה — הרשימה נשארת צמודה לשדה.
4. autocomplete בתוך דיאלוג (`overflow: hidden`) — הרשימה לא נחתכת ומופיעה מעל הדיאלוג.
5. RTL — ה‑`left`/`width` נכונים, הרשימה מיושרת עם השדה.
6. Resize של החלון בזמן שהרשימה פתוחה — המיקום מתעדכן.

## מחוץ ל‑scope (לא חלק מבאג המיקום)
בצילום המסך הופיע ערך `????` באחת האפשרויות — זו בעיית **קידוד/דאטה** בערך עצמו (לא UTF‑8 תקין ב‑DB/API), לא באג של התפריט. לא לטפל בזה במסגרת המשימה הזו.
