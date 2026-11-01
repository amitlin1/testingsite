# בדיקת דשבורד שלב־אחר־שלב

שותלת נתונים **דרך ה־API האמיתי של המערכת**, באותו סדר שבו המסכים שותלים אותם, ואחרי
כל שלב משווה **כל מספר בדשבורד** למודל בלתי תלוי. המודל נבנה רק מיומן הפעולות של הבדיקה
(עם חותמות זמן מצד הלקוח) ומשורת `item_routes` שנקראת אחרי כל פעולה. הוא לעולם לא קורא את
טבלאות ה־ledger, ולכן כל אי־התאמה היא ממצא על הדשבורד ולא על הבדיקה.

ממצאי ההרצה הראשונה: [docs/DASHBOARD_VERIFICATION.md](../../docs/DASHBOARD_VERIFICATION.md).

## השלבים

| שלב | מה קורה (דרך ה־API) | מה נבדק |
|---|---|---|
| 1 | לקוחות, סוגי עמדה (פתיחה/סגירה ברמת מארז), עמדות, סוגי פריט, סוג מארז ותבנית, שעות עבודה + חריגה להיום עם הפסקה קצרה | דשבורד ריק בלי שגיאות; לוח השעות: 5 דק' סביב הפסקה של 3 דק' = 120 שניות עבודה |
| 2 | שני משלוחים נכנסים שמצהירים על מארזים; המשלוח מייצר מארזים ממתינים לקליטה | אין ספירה של מארז שלא נקלט |
| 3 | קליטה (סריקת מדבקת מארז) של 3 מארזים | תורים חיים, המתנה בעמדת הפתיחה מול מסך העמדה עצמה |
| 4 | ממתינים מעבר להפסקה; פתיחת מארז (התחלה קבוצתית, סריאליים, אשף פתיחה) | שני השעונים (ברוטו/נטו), מארז אחד על ספסל הפתיחה, סטטוס 6 |
| 5 | פריטים בבדיקה ויזואלית; אחד נשלח למחקר | בבדיקה לפי עמדה, בריכת המחקר |
| 6 | מחקר: התחלה, הערה, חזרה למסלול | זמני מחקר, עבודה חוזרת |
| 7 | שחרור ידני, ואז ה־cron של בדיקות תקועות | ניסיונות חוזרים ונטישות |
| 8 | כל הפריטים לסגירה (6 → 2), אשף סגירה | מסלולים שנסגרו, זמני מסלול |
| 9 | שני המארזים האחרים; אחד נשאר באמצע | לוח עמדות חי, פריטים איטיים |
| 10 | שליחת המשלוח (חתימה) | `open_shipments` מסתיר, `all` מציג, זמן מקבלה עד שליחה |
| 11 | מסננים: לקוח, משלוח, סוג פריט, עמדה | כל מסנן מול המודל המסונן; מסנן שאי אפשר לכבד מדווח בכותרת |
| 12 | מחיקת מארז (`cascade`) | ה־ledger שוכח הכול, והמספרים יורדים בהתאם |

אחרי כל שלב רצים גם `metrics_selfcheck()` ובדיקה שה־interval הפתוח של כל פריט תואם את
`item_routes`.

## איך מריצים

הבדיקה משווה מספרים **גלובליים**, ולכן צריך DB טרי (מיגרציות בלבד) ושרת פיתוח שמחובר אליו.

```bash
# 1. DB טרי. ‏timezone=UTC כמו בפרודקשן (docker-compose.db.yml)
createdb dashcheck && psql -d dashcheck -c "ALTER DATABASE dashcheck SET timezone='UTC'"
DATABASE_URL=postgresql://…/dashcheck npx prisma migrate deploy
# טבלאות התצוגה item_status / test_station_status / holiday_types / photo_types
# מגיעות מ-settings-seed ולא מהמיגרציות. בלעדיהן תורי העמדות ריקים:
grep -E "^INSERT INTO public\.(item_status|test_station_status|holiday_types|photo_types) " \
  prod-deploy/db-server/settings-seed/settings-seed.sql | psql -d dashcheck

# 2. האפליקציה, על אותו DB. שלב 10 שומר חתימה ב-MinIO.
#    אם אין MinIO: node scripts/dashboard-stepwise/fake-s3.mjs (מאזין ל-9000, בזיכרון בלבד)
IS_DEV=1 TZ=Asia/Jerusalem DATABASE_URL=… AUTH_SECRET=dev NEXTAUTH_SECRET=dev CRON_SECRET=dev \
  MINIO_ENDPOINT=http://localhost:9000 MINIO_ROOT_USER=dev MINIO_ROOT_PASSWORD=devdevdev npx next dev -p 3000

# 3. הבדיקה (שלב 4 ממתין עד שההפסקה שהוגדרה בשלב 1 תעבור, כ-7 דקות)
DATABASE_URL=… AUTH_SECRET=dev CRON_SECRET=dev node scripts/dashboard-stepwise/stage.mjs all
#    או שלב בודד: … stage.mjs 3        בדיקה בלבד, בלי פעולות: … stage.mjs 99
```

קוד יציאה 0 רק כשכל הבדיקות בכל השלבים עברו. הבדיקה מסרבת לרוץ על DB ששמו נראה כמו
פרודקשן, על `API_BASE` שאינו localhost, ועל DB שכבר יש בו פריטים.

## כלים נוספים

- `crosscheck.mjs`: הדשבורד מול טבלאות התפעול בלבד, על כל נתון שיש ב־DB. לדוגמה אחרי
  `scripts/seed-packages-demo.mjs`: ספירות חיות לפי מצב, סיימו היום, עמודות מסך המשלוחים,
  ולוח העמדות מול `/api/testing/items` של כל עמדה. מדפיס גם זמני תגובה.
- `ui.mjs [outDir] [all]`: דפדפן אמיתי עם אותו session. צילום מסך לכל אחת מ-9 הלשוניות,
  ערכי כרטיסי המדדים מול ה־API, ושגיאות console/HTTP. צריך playwright
  (`PLAYWRIGHT_PATH` אם הוא לא ב־node_modules).
