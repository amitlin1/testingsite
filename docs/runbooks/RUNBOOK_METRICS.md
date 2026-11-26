# RUNBOOK — שכבת המטריקות של הדשבורד

הרקע: [dashboard-architecture.md](../architecture/dashboard-architecture.md) · ההגדרות המלאות: [dashboard-migration-plan-v2.md](../architecture/dashboard-migration-plan-v2.md).

## מאיפה כל מספר מגיע

- **כתיבה:** כל מעבר מצב של פריט נרשם ב־`item_state_event` דרך `metrics_record()` באותה טרנזקציה של העדכון
  התפעולי (`src/app/lib/metrics/ledger/record.ts`), ומקופל ל־`item_state_interval` (טווח זמן לכל מצב) ול־`route_run`.
- **קריאה:** כל מספר בדשבורד הוא שאילתה ישירה על ה־ledger — `src/app/lib/metrics/read/queries.ts` (Q1–Q8).
  אין cache ואין טבלאות snapshot. התקרה: 13 חודשים אחורה; כשהיא חותכת, השרת מדווח בכותרות `X-Metrics-Period-*`
  והמסך מציג פס ענבר.
- **שני שעונים:** כל משך מוצג פעמיים — ברוטו (`wall_seconds`, זמן אמיתי) ונטו (`work_seconds`, שעות עבודה בלבד, לפי
  מסך "שעות עבודה" + חגי ישראל). הנטו נגזר מלוח העבודה הגרסתי `work_calendar_version` / `work_span`.
- **מסנן שלא כובד** אינו נבלע: השרת מחזיר אותו ב־`X-Metrics-Ignored-Filters` והמסך מציג גלולה ענברית.

## משימות רקע

מאז 2026-11-26 **אין משימות Windows מתוזמנות** — כל משימות הרקע רצות בתוך שרת האפליקציה ומתחילות כשהוא עולה
(`src/instrumentation.ts`):

| משימה | מתי | מה |
|---|---|---|
| `release-stale-tests` | כל 5 דקות, טיימר בתוך האפליקציה (`src/app/lib/jobs/stale-tests-timer.ts`) | משחרר בדיקה שננטשה אחרי הסף של סוג העמדה (`stale_after_minutes`, 0 = לעולם לא) |
| `rebuild-work-calendar` | בעליית השרת ומיד אחרי כל שמירה במסך שעות עבודה (`calendar-sync.ts`) | בונה את לוח שעות העבודה ומחשב מחדש את הנטו של העבר |

כל הרצה משאירה שורה אחת ב־`job_run` (גם דילוג בגלל חפיפה). דילוג אינו תקלה.

`deploy/app-server/scripts/8-register-tasks.ps1` רק **מסיר** משימות `testingsite-*` שגרסאות קודמות רשמו (קובצי ה־`.bat` שלהן
נמחקו). נקודות הקצה `/api/cron/release-stale-tests`, `/api/cron/rebuild-work-calendar` ו־`/api/cron/metrics-selfcheck`
נשארו ככלי ידני (עם `x-cron-secret`). הסבר מלא על הנטו ובדיקות לפרודקשן: [dashboard-times.md](../features/dashboard-times.md).

## בריאות

- **האריח בלשונית "סקירה"** = `GET /api/health/jobs` (מנהל בלבד). אדום כשמשימה לא הצליחה בתוך פעמיים המחזור שלה,
  כשאופק לוח העבודה קצר מ־30 יום או חסר, או כשבדיקת עקביות שהערך התקין שלה 0 אינה 0. הכללים:
  `src/app/lib/jobs/health.ts`.
- **ידנית:** `SELECT * FROM metrics_selfcheck();` ו־`SELECT * FROM job_run ORDER BY started_at DESC LIMIT 20;`
- **גרסת סכמה:** `GET /api/health/schema` (ציבורי). אם האפליקציה חדשה מה־DB, כל נתיב כתיבה עונה 503 — הריצו את
  המיגרציות על שרת ה־DB.

## "המספרים נראים לא נכון"

1. האריח אדום? טפלו בסיבה שהוא מציג קודם.
2. `intervals_stale_calendar` > 0 אחרי שינוי שעות עבודה: נטו של העבר מחושב מחדש מיד אחרי השמירה, במנות של 50,000.
   אם זה נשאר — הסיבה ביומן השרת (`work calendar sync failed`). ברוטו אינו משתנה.
3. גלולה ענברית על הכרטיס: חלק מהמספרים אינו מסונן לפי המסנן שנבחר — זה מכוון, לא באג.
4. "מסלולים שנסגרו" הוא סגירת `route_run`, לא פריטים במצב "הושלם"; אחוז השלמה = נסגרו / נפתחו, לעולם לא מול כמות
   המשלוח.
