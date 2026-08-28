# RUNBOOK — שכבת המטריקות של הדשבורד

> שלד. מתמלא שלב־אחר־שלב יחד עם ההגירה לארכיטקטורת ה־ledger (ראו תוכנית ההגירה v2).
> סטטוס: **שלב 0 בוצע** — תיקוני נכונות והרשאות בלבד; מודל הנתונים החדש טרם נבנה.

## מה קיים אחרי שלב 0

- **הרשאות:** כל `/api/dashboard/*` דורש role של `manager` — גם ב־middleware
  (`src/lib/routes.ts`) וגם בכל handler (`withAuth`, defense-in-depth).
- **שומרי סטטוס:** שלושת מסלולי המחקר ב־`/api/testing/results` נושאים guard
  אופטימי (`AND current_status = <expected>`) — double-submit מתנגש ב־0 שורות
  במקום לדרוס מצב.
- **`research_history.item_id` הוא bigint** (מיגרציה `20260824090000`) — מזהי
  פריטים ארוכים כבר לא מפילים INSERT עם 22003.
- **`src/lib/station-counters.ts`** — מסך ההגדרות קורא ממנו ולא מ־metrics-service.
- **Scheduler בפרודקשן:** `prod-deploy/app-server/scheduler/*.bat` נרשמים אך ורק
  דרך `scripts/8-register-tasks.ps1` (רץ כ־SYSTEM, קורא `CRON_SECRET` מ־`.env`
  של ה־deployment — לא מ־setx).
- **`CRON_SECRET`:** `2-check-env.ps1` דוחה את ערך התבנית — הוא ציבורי (בריפו).
- **Compose:** `TZ=Asia/Jerusalem` על האפליקציה; תקרות logging על כל השירותים.

## מה עוד לא קיים (יגיע בשלבים הבאים)

- טבלאות ה־ledger (`item_state_event`, `item_state_interval`, `route_run`).
- לוח שנת עבודה גרסתי (`work_calendar_version`, `work_span`).
- `job_run` + `GET /api/health/jobs`.
- החלפת ה־endpoints של הדשבורד בשאילתות ledger.

## "המספרים נראים לא נכון" (יתמלא בשלב הקריאה)

_עדיין אין שכבת ledger — הדשבורד קורא מטבלאות ה־snapshot הישנות, שידוע שהן
שגויות (ראו תוכנית ההגירה, §1). אין טעם לדבג מספרים היסטוריים לפני שלב 5._
