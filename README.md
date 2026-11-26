# testingsite — מערכת בדיקות

Next.js 16 (App Router) · React 19 · Prisma 7 / PostgreSQL · MinIO · Keycloak (next-auth v5). ממשק בעברית, RTL.

## מבנה התיקיות

| תיקייה | מה יש בה |
|---|---|
| `src/` | קוד האפליקציה. `src/app` — דפים ונתיבי API; `src/app/lib` — לוגיקת הפיצ'רים; `src/lib` — תשתית (DB, HTTP, auth, אחסון, זמן); `src/components/ui` — ערכת ה-UI. `src/auth.ts` — הגדרות next-auth |
| `prisma/` | הסכמה והמיגרציות |
| `public/` | קבצים סטטיים |
| `db/upgrades/` | חבילות השדרוג של DB הייצור, אחת לכל גרסה לפי תאריך (`YYYY-MM-DD-name`): ה-SQL, ה-`build-upgrade.mjs` שבונה אותו, ו-RUNBOOK כשיש |
| `deploy/` | הפריסה לשרתי הייצור (רשת סגורה): `app-server/`, `db-server/` |
| `infra/` | תשתית הפיתוח והבנייה: `docker/` (קבצי docker-compose), `keycloak/`, `nginx/` |
| `scripts/` | כלים לפי ייעוד: `db/` (סכמה ומיגרציות), `dev/` (seed ואיפוס מקומי), `ops/` (גיבוי, שחזור, תחזוקה), `release/` (בניית חבילת הפריסה), `e2e/` (בדיקות דפדפן) |
| `config/env/` | תבניות משתני סביבה (`*.example`). קבצי ה-env האמיתיים לא נשמרים ב-git |
| `docs/` | `architecture/`, `features/`, `runbooks/`, `design/`, `decisions/` |

`DESIGN.md` נשאר בשורש — כלי העיצוב (impeccable) טוען אותו משם.

## פקודות

```bash
npm run dev              # שרת פיתוח
npm run build            # בנייה לייצור
npm run lint             # ESLint
npm test                 # בדיקות יחידה; עם TEST_DATABASE_URL גם בדיקות האינטגרציה
npm run db:migrate       # מיגרציה בפיתוח
npm run db:check-migration
```

פיתוח בלי Keycloak: `IS_DEV=1` (רק ב-`npm run dev`, אף פעם לא בבנייה לייצור) — ראו `config/env/env.local.example`.

## מסמכים

- פריסה ותפעול: `docs/runbooks/` ו-`deploy/README.md`
- ארכיטקטורה: `docs/architecture/`
- החלטות ושינויים גדולים: `docs/decisions/`
