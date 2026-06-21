<div dir="rtl" align="right">

# מדריך גיבויים — DigitalFactory

מדריך זה מסביר **איך מערכת הגיבויים עובדת**, **איפה הגיבויים נשמרים**, **איך מקימים אותה בשרת**, ו**איך משחזרים אם משהו נשבר**.

---

## 1. איך זה עובד — בקצרה

כל הקבצים של המערכת (חתימות + מנהל הקבצים) נשמרים ב-**MinIO**, וכל המידע נשמר ב-**PostgreSQL**. שתי תיבות גיבוי (containers) רצות לצד בסיס הנתונים ושומרות עותקים אוטומטית אל תיקיות על דיסק ה-Windows של השרת:

| תיבת גיבוי | מה היא עושה | לאן שומרת |
| :--- | :--- | :--- |
| `digitalfactory-minio-backup` | מעתיקה (mirror) את כל הקבצים מ-MinIO | `C:\backups\files` |
| `digitalfactory-postgres-backup` | מגבה את בסיס הנתונים (pg_dump + gzip) | `C:\backups\postgres` |

שתיהן רצות **פעם ביום** (ניתן לשנות). הן משתמשות באותו image ובאותו קובץ סביבה (`.env.db`) כמו בסיס הנתונים, אבל הן **תיבות נפרדות** — כך שתקלה בגיבוי לעולם לא תפגע בבסיס הנתונים החי.

---

## 2. איפה הגיבויים נשמרים

```
C:\backups\
├── files\                         ← עותק מדויק של כל הקבצים שב-MinIO
│   ├── shipments\...                (חתימות משלוחים)
│   └── ...                          (קבצי מנהל הקבצים)
│
└── postgres\
    ├── daily\                      ← גיבוי יומי, נמחק אוטומטית אחרי 7 ימים
    │   └── db-20260528-105109.sql.gz
    └── monthly\                    ← גיבוי חודשי, נשמר לצמיתות (לא נמחק לעולם)
        └── db-2026-05.sql.gz
```

- **יומי (`daily`)** — נוצר בכל יום. קבצים ישנים מ-7 ימים נמחקים אוטומטית.
- **חודשי (`monthly`)** — נוצר עותק אחד לכל חודש (`db-YYYY-MM.sql.gz`) ו**נשמר לתמיד**. אם כבר קיים גיבוי לחודש הנוכחי, הוא לא נדרס — כך שאתחול מחדש או יום שהוחמץ לא יוצרים כפילויות.

---

## 3. שלוש שכבות הגנה

1. **גרסאות ב-MinIO (Versioning)** — בכל פעם שקובץ נמחק או נדרס, הגרסה הקודמת נשמרת. ניתן לשחזר קובץ בודד ישירות מ-MinIO בלי גיבוי מלא.
2. **עותק הקבצים** — `C:\backups\files` מגן מפני אובדן הנתונים המקוריים של MinIO.
3. **גיבוי בסיס הנתונים** — `C:\backups\postgres` מגן מפני קריסה, השחתת נתונים, או מיגרציה שגויה.

> ⚠️ **חשוב מאוד:** כל הגיבויים נשמרים על **אותו הדיסק** של השרת. אם כל השרת/הדיסק נהרס — גם הגיבויים יאבדו. ראו סעיף 7 על גיבוי מחוץ לשרת.

---

## 4. איך מקימים את זה בשרת

1. ודאו ש-**Docker Desktop** מותקן ופועל, ושכונן `C:` משותף ל-Docker (ברירת מחדל ב-WSL2).
2. צרו את התיקיות (Docker יוצר אותן אוטומטית, אך מומלץ ליצור מראש):
   ```powershell
   New-Item -ItemType Directory -Force C:\backups\files, C:\backups\postgres
   ```
3. ערכו את `.env.db` והגדירו את הסיסמאות (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`).
4. הפעילו את כל הסטאק (בסיס נתונים + MinIO + שתי תיבות הגיבוי יחד):
   ```powershell
   docker compose -f docker-compose.db.yml up -d
   ```

### שינוי הגדרות (לא חובה)
ברירות המחדל כבר נכונות. לשינוי — הוסיפו לקובץ `.env` שליד קובץ ה-compose (לא ל-`.env.db`):
```env
BACKUP_INTERVAL_SECONDS=86400      # כל כמה זמן לגבות (86400 = יממה)
BACKUP_DAILY_RETENTION_DAYS=7      # כמה ימים לשמור גיבוי יומי
BACKUP_FILES_PATH=C:/backups/files     # יעד גיבוי הקבצים
BACKUP_PG_PATH=C:/backups/postgres     # יעד גיבוי בסיס הנתונים
```

---

## 5. איך בודקים שהגיבוי עובד

```powershell
# האם הקבצים נכתבים?
Get-ChildItem C:\backups\postgres\daily
Get-ChildItem C:\backups\postgres\monthly
Get-ChildItem C:\backups\files

# מה אומרות תיבות הגיבוי?
docker logs digitalfactory-postgres-backup --tail 5
docker logs digitalfactory-minio-backup --tail 5
```

לגיבוי מיידי (למשל לפני מיגרציה מסוכנת) — אפשר פשוט להפעיל מחדש את תיבת הגיבוי:
```powershell
docker restart digitalfactory-postgres-backup
```

---

## 6. שחזור — מה לעשות אם משהו נשבר

### א. שחזור קובץ בודד שנמחק בטעות
היכנסו לקונסולת MinIO בדפדפן: `http://<כתובת-השרת>:9001`
(משתמש/סיסמה מתוך `.env.db`). הפעילו הצגת גרסאות/קבצים מחוקים, ושחזרו את הגרסה הקודמת. אין צורך בשחזור מלא.

### ב. שחזור מלא של בסיס הנתונים
> ⚠️ פעולה הרסנית — דורסת את בסיס הנתונים הקיים. ודאו שבחרתם את הגיבוי הנכון.

```powershell
# 1) עצרו את האפליקציה כדי שלא ייכתבו נתונים חדשים
docker compose -f docker-compose.prod.yml stop next-app

# 2) מחקו וצרו מחדש את בסיס הנתונים (ריק)
docker exec postgres psql -U appuser -d postgres -c 'DROP DATABASE "InventoryDB" WITH (FORCE); CREATE DATABASE "InventoryDB" OWNER appuser;'

# 3) שחזרו מתוך הגיבוי הרצוי (כאן: הגיבוי החודשי)
docker run --rm -i -v C:/backups/postgres:/b --network db-network -e PGPASSWORD=Strong_Pass_123 postgres:16-alpine sh -c "zcat /b/monthly/db-2026-05.sql.gz | psql -h postgres -U appuser -d InventoryDB"

# 4) הפעילו מחדש את האפליקציה
docker compose -f docker-compose.prod.yml start next-app
```
> לשחזור מגיבוי יומי, החליפו `monthly/db-2026-05.sql.gz` בקובץ הרצוי מתוך `daily\`.

### ג. שחזור כל הקבצים (אם MinIO אבד)
```powershell
docker run --rm -v C:/backups/files:/backup --network db-network --entrypoint sh minio/minio -c "mc alias set dst http://minio:9000 digitalfactory-admin Strong_Pass_123 && mc mb -p dst/digitalfactory-files; mc mirror --overwrite /backup dst/digitalfactory-files"
```

> החליפו `Strong_Pass_123` / `digitalfactory-admin` בערכים האמיתיים מתוך `.env.db`.

---

## 7. גיבוי מחוץ לשרת (מומלץ מאוד)

הגיבוי האוטומטי מגן מפני מחיקה ותקלות, אבל **לא** מפני אובדן השרת עצמו. כדי להיות מוגנים באמת, העתיקו את `C:\backups` למיקום חיצוני (כונן חיצוני / NAS / שרת אחר / ענן) באופן קבוע.

דוגמה למשימה מתוזמנת ב-Windows (Task Scheduler) שמעתיקה כל לילה לכונן רשת `Z:`:
```powershell
robocopy C:\backups Z:\digitalfactory-backups /MIR /R:2 /W:5
```

---

## סיכום מהיר

| מתי | מה לעשות |
| :--- | :--- |
| הקמה | `docker compose -f docker-compose.db.yml up -d` |
| בדיקה | `Get-ChildItem C:\backups\postgres\daily` |
| נמחק קובץ בודד | קונסולת MinIO → שחזור גרסה |
| בסיס הנתונים נשבר | סעיף 6.ב (drop + create + zcat \| psql) |
| כל הקבצים אבדו | סעיף 6.ג (mc mirror חזרה) |
| הגנה אמיתית | להעתיק את `C:\backups` מחוץ לשרת (סעיף 7) |

</div>
