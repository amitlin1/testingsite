# RUNBOOK — שכבת המטריקות של הדשבורד

הרקע: [dashboard-architecture.md](dashboard-architecture.md) · ההגדרות המלאות: [dashboard-migration-plan-v2.md](dashboard-migration-plan-v2.md).

## מאיפה כל מספר מגיע

- **כתיבה:** כל מעבר מצב של פריט נרשם ב־`item_state_event` דרך `metrics_record()` באותה טרנזקציה של העדכון
  התפעולי (`src/app/lib/metrics/ledger/record.ts`), ומקופל ל־`item_state_interval` (טווח זמן לכל מצב) ול־`route_run`.
- **קריאה:** כל מספר בדשבורד הוא שאילתה ישירה על ה־ledger — `src/app/lib/metrics/read/queries.ts` (Q1–Q8).
  אין cache ואין טבלאות snapshot. התקרה: 13 חודשים אחורה; כשהיא חותכת, השרת מדווח בכותרות `X-Metrics-Period-*`
  והמסך מציג פס ענבר.
- **שני שעונים:** כל משך מוצג פעמיים — ברוטו (`wall_seconds`, זמן אמיתי) ונטו (`work_seconds`, שעות עבודה בלבד, לפי
  מסך "שעות עבודה" + חגי ישראל). הנטו נגזר מלוח העבודה הגרסתי `work_calendar_version` / `work_span`.
- **מסנן שלא כובד** אינו נבלע: השרת מחזיר אותו ב־`X-Metrics-Ignored-Filters` והמסך מציג גלולה ענברית.

## משימות מתוזמנות

נרשמות רק דרך `prod-deploy/app-server/scripts/8-register-tasks.ps1` (רץ כ־SYSTEM, `CRON_SECRET` מה־`.env`);
הקבצים `prod-deploy/app-server/scheduler/*.bat` קוראים ל־endpoint עם `curl --fail`.

| משימה | מתי | מה |
|---|---|---|
| `release-stale-tests` | כל 5 דקות | משחרר בדיקה שננטשה אחרי הסף של סוג העמדה (`stale_after_minutes`, 0 = לעולם לא) |
| `rebuild-work-calendar` | 01:00 | בונה את לוח שעות העבודה לאופק [−24, +12] חודשים, רק אם המקור השתנה או האופק מתקצר |
| `metrics-selfcheck` | 02:00 | מתקן אופק קצר, מחשב מחדש מקטעים שלוח העבודה שלהם הוחלף, ורושם את תוצאת `metrics_selfcheck()` |

כל הרצה משאירה שורה אחת ב־`job_run` (גם דילוג בגלל חפיפה — HTTP 200). דילוג אינו תקלה.

## בריאות

- **האריח בלשונית "סקירה"** = `GET /api/health/jobs` (מנהל בלבד). אדום כשמשימה לא הצליחה בתוך פעמיים המחזור שלה,
  כשאופק לוח העבודה קצר מ־30 יום או חסר, או כשבדיקת עקביות שהערך התקין שלה 0 אינה 0. הכללים:
  `src/app/lib/jobs/health.ts`.
- **ידנית:** `SELECT * FROM metrics_selfcheck();` ו־`SELECT * FROM job_run ORDER BY started_at DESC LIMIT 20;`
- **גרסת סכמה:** `GET /api/health/schema` (ציבורי). אם האפליקציה חדשה מה־DB, כל נתיב כתיבה עונה 503 — הריצו את
  המיגרציות על שרת ה־DB.

## "המספרים נראים לא נכון"

1. האריח אדום? טפלו בסיבה שהוא מציג קודם.
2. `intervals_stale_calendar` > 0 אחרי שינוי שעות עבודה: נטו של העבר מחושב מחדש בהרצת 02:00 (עד 50,000 מקטעים
   בכל לילה). ברוטו אינו משתנה.
3. גלולה ענברית על הכרטיס: חלק מהמספרים אינו מסונן לפי המסנן שנבחר — זה מכוון, לא באג.
4. "מסלולים שנסגרו" הוא סגירת `route_run`, לא פריטים במצב "הושלם"; אחוז השלמה = נסגרו / נפתחו, לעולם לא מול כמות
   המשלוח.
