# Shifthouse — חבילת התאמת מסך "דוחות וניהול פריטים"

התאמת מסך ניהול הפריטים והפופאפ שלו למראה Shifthouse שאושר. הכל שטוח, RTL, כחול פעולה יחיד, ללא MUI elevation.

## מאיפה מתחילים
1. פתח את **`Items (reference).html`** בדפדפן — זה איך שהמסך צריך להיראות (טבלה, סרגל, פופאפ).
2. תן ל-Claude Code את **`PROMPT.md`** + כל תיקיית `components/` ו-`styles/`.

## תוכן
- `PROMPT.md` — הוראות מדויקות ל-Claude Code (4 הבקשות + דוגמת החלפה).
- `styles/shifthouse.css` — טוקנים + מחלקות hover/focus/scrollbar. **ייבא פעם אחת ב-`app/layout.tsx`.**
- `components/ItemsToolbar.tsx` — כותרת + חיפוש + פילטרים + כפתור "הוסף פריט" (טמפלייט מוכן).
- `components/DataTable.tsx` — טבלה גנרית עם ה-`<th>` הנכון + hover + `StatusPill` + `ProgressCell`.
- `components/AddItemDialog.tsx` — הפופאפ "הוספת פריט" מעוצב מחדש.
- `Items (reference).html` — מקור האמת החזותי.

## תלות
- `lucide-react` לאייקונים (כבר חלק ממעבר Shifthouse מ-`@mui/icons-material`).
- אין תלות ב-MUI באף אחד מהקבצים האלה.

## כלל הזהב
כחול אחד `#0066cc` · שטוח (הצל היחיד רק תחת תצלום) · ללא gradient · ללא משקל 500 · נקודת סטטוס כחול/אפור בלבד.
