# Shifthouse — חבילת Handoff להחלפת MUI

התיקייה הזו מכילה כל מה שצריך כדי להחליף את MUI בספריית קומפוננטות פנימית התואמת את עיצוב Shifthouse.

## קבצים
- **`CLAUDE-CODE-PROMPT.md`** — המפרט המלא ל-Claude Code. זו הנקודת התחלה. כולל: החלטות ארכיטקטורה נעולות (Radix / TanStack / recharts / Tailwind / RTL), מיפוי MUI→קומפוננטה, שלבי ביצוע והגדרת "סיום".
- **`tokens.css`** — קובץ הטוקנים המוכן. שים ב-`src/styles/tokens.css` ויְבָא פעם אחת ב-`layout.tsx`/`globals.css`. הבסיס לכל הקומפוננטות.
- **`Component Library (reference).html`** — ה-reference הוויזואלי, קובץ יחיד שנפתח בכל דפדפן ללא אינטרנט. **זהו מקור האמת החזותי** — כל קומפוננטה שנבנה חייבת להיראות בדיוק כמו כאן.
- **`Component Library.dc.html`** — קובץ המקור של ה-reference (לעריכה עתידית).

## איך להשתמש
1. פתח את `Component Library (reference).html` בדפדפן — זה איך שהאתר צריך להיראות.
2. תן ל-Claude Code את `CLAUDE-CODE-PROMPT.md` + `tokens.css` + הקובץ הזה כהקשר.
3. Claude Code בונה את `src/components/ui/`, מחליף שלב-שלב, ומאמת ש-`grep -r "@mui" src/` ריק ו-`build` עובר.

## כלל הזהב
כחול פעולה יחיד `#0066cc` · שטוח לגמרי (הצל היחיד רק מתחת לתצלום) · ללא gradient · ללא משקל 500 · ללא emoji · RTL עם logical properties.
