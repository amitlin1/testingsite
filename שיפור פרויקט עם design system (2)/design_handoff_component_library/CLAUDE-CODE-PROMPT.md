# משימה: החלפת MUI בספריית קומפוננטות Shifthouse (במכה אחת)

מטרה: להסיר את התלות ב-MUI מכל האפליקציה (`testingSite`) ולהחליף אותה בספריית קומפוננטות פנימית הבנויה על **טוקני Shifthouse**, בדיוק לפי ה-reference הוויזואלי שאושר (`Component Library.dc.html`). התוצאה הוויזואלית חייבת להיות זהה ל-reference: שטוחה (ללא elevation/צללים של MUI), כחול פעולה יחיד `#0066cc`, פינות וטיפוגרפיה מדויקות, RTL.

הפרויקט: Next.js 16 / React 19, RTL (עברית), Tailwind 4 כבר מותקן.

---

## החלטות ארכיטקטורה (נעולות)

1. **רכיבים התנהגותיים → Radix UI** (`@radix-ui/react-*`). לא לבנות Dialog/Select/Combobox/Tooltip/Popover מאפס — רק לסגנן מעל.
2. **טבלאות → `@tanstack/react-table`** (headless) לכל הטבלאות הרגילות. להשאיר `@mui/x-data-grid` רק אם מסך ספציפי באמת דורש עריכה/מיון וירטואלי בקנה מידה גדול — אחרת להסיר. וירטואליזציה דרך `react-virtuoso` הקיים.
3. **גרפים → recharts** (כבר מותקן ובשימוש חלקי). לאחד הכל עליו; להסיר `@mui/x-charts`.
4. **אופן ההחלפה → big-bang בקומיטים מדורגים** (טוקנים → אייקונים → dialogs → dashboard → טבלאות → shell). `npm run build` חייב לעבור בסוף כל שלב.
5. **מנוע סגנון → Tailwind 4** עם הטוקנים ב-`@theme`. להסיר emotion/styled-components/jss ששירתו את MUI בלבד.
6. **RTL → `dir="rtl"` + logical properties**. להסיר `jss-rtl`/`stylis-plugin-rtl`.
7. **הגדרת "סיום" → `grep -r "@mui" src/` מחזיר ריק ו-`npm run build` עובר.**

---

## שלב 0 — תשתית טוקנים

צור `src/styles/tokens.css` (ויובא ב-`globals.css` / `layout.tsx`) עם כל טוקני Shifthouse כ-CSS variables. השתמש **אך ורק** בערכים הבאים — אל תמציא צבעים:

```css
:root {
  --color-primary:#0066cc; --color-primary-focus:#0071e3; --color-primary-on-dark:#2997ff; --color-on-primary:#fff;
  --color-destructive:#bf3535; --color-destructive-hover:#a82d2d;
  --color-canvas:#fff; --color-canvas-parchment:#f5f5f7; --color-surface-pearl:#fafafc;
  --color-surface-tile-1:#272729; --color-surface-black:#000; --color-surface-chip-translucent:rgba(210,210,215,.64);
  --color-ink:#1d1d1f; --color-body:#1d1d1f; --color-on-dark:#fff; --color-body-muted:#ccc;
  --color-ink-muted-80:#333; --color-ink-muted-48:#7a7a7a;
  --color-divider-soft:#f0f0f0; --color-hairline:#e0e0e0; --color-hairline-rgba:rgba(0,0,0,.08);
  --color-status-on:#0066cc; --color-status-late:#d97706; --color-status-absent:#7a7a7a; --color-status-approved:#1f8a5b;
  --font-display:'SF Pro Display',system-ui,-apple-system,'Inter',sans-serif;
  --font-text:'SF Pro Text',system-ui,-apple-system,'Inter',sans-serif;
  --font-mono:'SF Mono',ui-monospace,Menlo,Consolas,monospace;
  --fw-light:300; --fw-regular:400; --fw-semibold:600; --fw-bold:700;   /* אין 500 */
  --r-xs:5px; --r-sm:8px; --r-md:11px; --r-lg:18px; --r-pill:9999px;
  --shadow-product:rgba(0,0,0,.22) 3px 5px 30px 0;   /* הצל היחיד, רק מתחת לתצלום */
}
```

חבר את הטוקנים ל-Tailwind 4 דרך `@theme` כדי שיהיו זמינים כמחלקות (`bg-primary`, `rounded-pill` וכו').

---

## שלב 1 — ספריית הקומפוננטות

צור `src/components/ui/` עם קומפוננטה לכל פריט. כל אחת מקבלת `className`/`sx`-חלופה נקייה ומשתמשת בטוקנים בלבד. **בלי elevation, בלי box-shadow (למעט `--shadow-product` מתחת לתצלומים בלבד).** לרכיבים התנהגותיים (Dropdown, Combobox, Dialog, Tooltip, Popover) השתמש ב-**Radix UI** (`@radix-ui/react-*`) לנגישות + התנהגות, וסגנן מעל לפי הטוקנים.

קומפוננטות לבנייה (המקור החזותי לכל אחת נמצא ב-`Component Library.dc.html`):

| קומפוננטה | מחליף (MUI) | הערות סגנון |
|---|---|---|
| `Button` (variant: primary/secondary/dark/destructive/disabled) | `Button` | primary: pill, `#0066cc`, padding 11×22, min-h 38; secondary: מסגרת 1px כחול; press: `scale(.95)`. **אין elevation.** |
| `IconButton` | `IconButton` | 40×40 מרובע `r-sm`, או 44×44 עגול עם `chip-translucent` מעל תצלום |
| `Input` / `TextField` | `TextField` | h40, border hairline, `r-sm`; focus: border+outline `--color-primary-focus`; error: border `--color-destructive` + טקסט שגיאה |
| `SearchInput` | `TextField`+adornment | h44, pill, אייקון חיפוש ב-inset-inline-start |
| `Textarea` | `TextField multiline` | `r-sm`, line-height 1.47 |
| `Select` | `Select`/`MenuItem` | Radix Select; trigger כמו Input; פריט נבחר עם ✓ כחול |
| `Combobox` | `Autocomplete` | Radix; תגים `r-xs` parchment עם ✗ |
| `Segmented` | `ToggleButton` | זוג כפתורים במסגרת אחת; פעיל = tint עדין (ירוק/אדום) — כמו PassFail |
| `Switch` | `Switch` | 44×26 pill, ידית 20px, on=primary |
| `Checkbox` | `Checkbox` | 20px `r-xs`, on=primary עם ✓ לבן |
| `Radio` | `Radio` | 20px עיגול, נקודה 10px כחולה |
| `StatusPill` | `Chip` | micro 10px uppercase, נקודה 6px לפי מצב (on/late/absent/approved) |
| `Chip` / `Badge` | `Chip`/`Badge` | parchment `r-xs`; badge אדום 18px |
| `Card` | `Paper`/`Card` | לבן, border hairline, `r-lg`, padding 24, **shadow:none** |
| `Dialog` | `Dialog`+`DialogTitle`/`Content`/`Actions` | Radix Dialog; שטוח, `r-lg`; פוטר על parchment עם border-top; overlay blur קל |
| `Tabs` | — | קו תחתון 2px ink לפעיל, muted ללא |
| `Alert` | `Alert` | border-inline-start 3px (כחול/ירוק/אדום), אייקון Lucide |
| `Progress` (linear+circular) | `LinearProgress`/`CircularProgress` | פס 6px pill; ספינר border-top primary |
| `Skeleton` | `Skeleton` | shimmer parchment |
| `Table` | `Table`/`DataGrid` | כותרת parchment uppercase muted; שורות מופרדות ב-`--color-divider-soft`. ל-DataGrid כבד: עטוף `@tanstack/react-table` |

---

## שלב 2 — אייקונים

החלף `@mui/icons-material` ב-`lucide-react`. מיפוי שמות ישיר (`Check`→`Check`, `Close`→`X`, `Search`→`Search`, `KeyboardArrowDown`→`ChevronDown`, `Delete`→`Trash2`, `QrCodeScanner`→`QrCode`, `Science`→`FlaskConical`, `LocalShipping`→`Truck`, `Dashboard`→`LayoutDashboard` וכו'). `strokeWidth={1.75}`, גדלים 16/20/24 בלבד. **ללא אייקונים מלאים** — outline בלבד.

## שלב 3 — גרפים

`@mui/x-charts` → `recharts` (כבר מותקן). עטוף כל גרף ב-wrapper מסוגנן; קו/עמודה בצבע `--color-primary`, גריד/ציר ב-hairline, tooltip לבן `r-sm` border hairline.

## שלב 4 — RTL

הסר את התלות ב-`@mui/stylis-plugin-rtl`/`jss-rtl`/`emotion` שנבעה מ-MUI. השתמש ב-`dir="rtl"` + logical properties (`ps/pe/ms/me`, `inset-inline-*`).

## שלב 5 — סדר החלפה ואימות

1. תשתית טוקנים + ספריית `ui/`.
2. אייקונים (מכני, כלל-מערכתי).
3. Popups/Dialogs (`insertPopup`, `PopUpTestDialog`, `Shipment*Popup`, `ItemDialog`…).
4. Dashboard cards + filters + charts.
5. Tables / DataGrid.
6. Shell/Nav (`AppShell`, `navBar`, `TestsSidebar`).
7. הסר מ-`package.json`: `@mui/material`, `@mui/icons-material`, `@mui/material-nextjs`, `@mui/styled-engine-sc`, `@mui/styles`, `@mui/x-charts`, `@mui/x-data-grid`, `@emotion/*`, `@fontsource/roboto`, `jss`, `jss-rtl`, `stylis-plugin-rtl`. הסר `providers.tsx` (ThemeProvider/CssBaseline) ו-`ItemDialog` theme.
8. אחרי כל שלב: `npm run build` חייב לעבור. `grep -r "@mui" src/` חייב לחזור ריק בסוף.

## כללי ברזל (Shifthouse)
- אין accent שני. אין צל על card/button/text. אין gradient. אין משקל 500. אין emoji/סימני קריאה. אין פינות מעוגלות על tiles מלאים. line-height גוף ≥ 1.47. `#2997ff` רק על רקע כהה; `#0066cc` רק על בהיר.
