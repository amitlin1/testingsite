# תוכנית ההגירה הסופית של שכבת המטריקות — גרסה 2
## CIL — Constrained Interval Ledger, ללא שכבת cache (ledger-only)

**מסמך אחד, סמכותי. מחליף את גרסה 1 במלואה.** מחליף את כל 23 טבלאות ה־snapshot (כולל `station_hourly_snapshots`), את ה־materialized view `mv_station_stats`, את `station_live_counters` והטריגר שלה, את `finished_item`, את 4 cron־י ה־snapshot, 7 endpoints מתים, 6 רכיבי React מתים, ואת `MetricsService` כולו (15 מתודות: 1 מחולצת, 14 נמחקות).

תאריך: 2026-08-24 · ריפו: `C:/Users/Admin/Desktop/Amit_projects/testingsite` · PostgreSQL 16.11 (`postgres:16-alpine`) · deployment: air-gapped

**מה השתנה מגרסה 1 (החלטות המשתמש, 2026-08-24):**
1. **שכבת ה־cache כולה ירדה מגרסה 1.** אין `rollup_hour`, אין `rollup_dirty`, אין `rollup_watermark`, אין `metric_definition`, אין drain של 5 דקות, אין MERGE, אין sealing, אין reconciliation מול cache. כל שאילתת דשבורד קוראת מה־ledger ישירות, תחת תקרת ה־UI של 13 חודשים. מדידות על נפחי שנה-3 (§6.1) מראות שכל שאילתות §5 רצות ב־35ms–1.3s — אין מה להאיץ. חלופת rollup **יומי** מתועדת כ־contingency נדחית (§6.5) עם קריטריון אימוץ מדיד.
2. **9 טבלאות חדשות בלבד** (היו 16 ב־spec המקורי, 13 אחרי ה־trim הראשון): `route_run`, `item_state_event`, `item_state_interval`, `metric_state`, `work_calendar_version`, `work_span`, `job_run`, `metrics_schema_version`, ו־`metrics_drift` (פיגום — נמחק במיגרציה B אחרי שער ה־dual-run). `metric_scope_type` ירדה (enum ב־TypeScript + CHECK ב־contingency); `work_span_stage` הפכה ל־TEMP TABLE בתוך טרנזקציית הבנייה; `item_state_interval_history` + Q9 ירדו כליל — ה־spine ה־append-only כבר מאפשר שחזור as-of על ידי replay (§12.5).
3. **שני שעונים, שני KPI מלאים** (§2.8): "זמן המתנה"/"זמן טיפול" = `wall_seconds`; "זמן המתנה בפועל"/"זמן טיפול בפועל" = `work_seconds`. סימטריה מלאה בכל שאילתה.
4. **שלב 0 בביצוע עכשיו** בריפו על ידי ה־session הראשי; היקפו לא השתנה.
5. כל 45 ממצאי ה־re-review המאושרים קופלו פנימה **כתיקון בגוף הטקסט**, לא כהערות שוליים. מיפוי מלא ב־§11.1.

---

## 1. תקציר מנהלים

1. **מוחקים** את כל 23 טבלאות ה־snapshot (כולל `station_hourly_snapshots`), את `mv_station_stats`, את `station_live_counters` + הטריגר + הפונקציה, את `finished_item`, את `create-daily-snapshots` / `create-monthly-snapshots` / `create-hourly-snapshots` / `refresh-views`, 7 endpoints שאף רכיב לא קורא להם, 6 רכיבי React מתים, ו־5 npm scripts שמצביעים על קבצים שלא קיימים. סה"כ 28 קבצים (≈6,450 שורות) + עץ `prod-deploy/db-server/prisma/` (≈1,600 שורות כפולות).
2. **הסיבה למחיקה, לא לתיקון:** כל שורה בכל טבלת snapshot נוצרה על ידי פונקציה שלא מקבלת פרמטר תאריך כלל. היא סופרת `item_routes.current_status` נכון ל־`NOW()` ושומרת תחת `snapshot_date` בעבר. כל ה"היסטוריה" היא N עותקים של ההווה. אין מה לשמר, אין backfill אפשרי, אין חוב תאימות לאחור.
3. **בונים** `item_state_interval` — ledger של interval אחד לכל תפוסת־מצב של כל פריט מנותב, עם `tstzrange`, שני שעונים (`wall_seconds` / `work_seconds`), וכל ממדי הסינון משוטחים על השורה.
4. **האינווריאנט המרכזי** נאכף על ידי `EXCLUDE USING gist (item_id WITH =, valid_range WITH &&)`: פריט נמצא במצב אחד בדיוק בכל רגע. חפיפה או שני intervals פתוחים = abort של הטרנזקציה, לא ממצא בדוח לילי.
5. **ה־ledger הוא fold דטרמיניסטי** של `item_state_event` — spine append-only, immutable, אידמפוטנטי, שנכתב על ידי קוד האפליקציה *בתוך אותה טרנזקציה* של כתיבת `item_routes`. שחזור מלא = `SELECT isi_rebuild_run(route_run_id) FROM route_run`.
6. **אין שכבת אגרגציה.** Point-in-time = `valid_range @> ts` על אוכלוסייה פעילה (`NOT is_terminal`). Flow ו־duration = אגרגציה על intervals סגורים לפי `close_business_date`. ספירת "הושלמו" מצטברת = ספירת סגירות `route_run` (§5.3ב) — לעולם לא דגימת `@>` על intervals סופיים. הכול נמדד: השאילתה הכבדה ביותר על נפח שנה-3 היא ~1.3 שניות במכונה לא מכווננת (§6.1), הרחק מתחת לסף.
7. **כל משך נמדד ומוצג פעמיים** (§2.8): **"זמן המתנה"** (`wall_seconds`, הזמן האמיתי שהלקוח חווה) ו**"זמן המתנה בפועל"** (`work_seconds`, רק שעות העבודה לפי מסך ההגדרות). דוגמת הדגל: פריט שנכנס לתור **חמישי 15:00** ונאסף **ראשון 07:10** מדווח זמן המתנה **64 שעות ו־10 דקות** וזמן המתנה בפועל **45 דקות** (35 דקות חמישי 15:00→15:35 + 10 דקות ראשון 07:00→07:10, לפי לוח ה־seed 07:00–15:35 עם הפסקה 12:00–13:00).
8. **`item_routes` לא משתנה בכלל בגרסה 1.** אף עמודה לא נמחקת. ~40 קטעי SQL תפעוליים נשארים. טריגר ה־drift (§3.8) הוא **פיגום** שמוכיח לאורך שבוע ה־dual-run שכל הכותבים מכוסים — ונמחק במיגרציה B.
9. **ההגירה מפוצלת לשתי מיגרציות בשני releases**: A = additive בלבד (הסכימה + Tier-1 backfill באותו סקריפט apply, לפני ה־image של מסלול הכתיבה — סדר ההפעלה בפרודקשן הוא 2 → 4 → 3), B = destructive — רק אחרי שבוע dual-run ירוק. `metrics_record` גם **מתדרדרת בחן**: transition על פריט בלי run פתוח פותח run אוטומטית במקום להפיל את ההגשה (§4.2).
10. **התוצאה:** ~90 מזהי מטריקה שמופו לפי שם אל שאילתות ledger בלבד (§5.10), כולל 9 מטריקות שה־UI רומז עליהן ושהמערכת הנוכחית לא מסוגלת לייצר; 31 מסלולי פליטת events (היום: 4); 3 משימות מתוזמנות (היום: 4 שכותבות בדיה); ~25–33 ימי עבודה (§12.1).

---

## 2. עקרונות התכנון — האינווריאנטים

### 2.1 מקור אמת יחיד (single source of truth)

`item_state_event` הוא ה־spine. `item_state_interval` הוא fold דטרמיניסטי שלו. **אין עותק שלישי**: אין cache, אין rollup, אין טבלה מסכמת — ולכן אין אף מקום שבו מטריקה יכולה להיות מוגדרת פעמיים ולהתפצל. שאילתת ה־SQL ב־§5 היא ההגדרה היחידה של כל מדד.

היום זה בדיוק ההפך: `shipment_completion_percentage` מוגדר כ־`finished / items_in_routes` ב־endpoint החי וכ־`finished / shipments.amount` ב־cron writer; `item_type_completion_percentage` מוגדר בשלוש דרכים שונות; "בהמתנה" זה `{2}` בדשבורד הלקוחות ו־`{2,4}` בדשבורד התחנות.

### 2.2 ניתן לשחזור מלא (rebuildable)

כל מספר במערכת נגזר מ־`item_state_event`. שחזור של פריט אחד = `SELECT isi_rebuild_run(route_run_id) FROM route_run WHERE item_id = <id>`. שחזור מלא = לולאה על כל ה־runs. **ה־`EXCLUDE` constraint הוא ה־test suite של ה־rebuild**: אם ה־replay ייצר חפיפה או שני intervals פתוחים, הטרנזקציה נופלת ושום דבר לא מתפרסם. גם "נכון ל־X" bitemporal אפשרי בלי טבלת היסטוריה: ה־spine נושא `recorded_at`, ולכן replay שמסונן לפי `recorded_at <= sys_at` משחזר כל דוח שהודפס אי־פעם (§12.5) — בלי טבלה, בלי cron גיזום.

### 2.3 אידמפוטנטיות (idempotent)

לכל event יש `event_key` דטרמיניסטי ייחודי. `ON CONFLICT (event_key) DO NOTHING` הופך כל retry של POST, כל double-click וכל הרצה חופפת של cron ל־no-op ברמת ה־DB. בנוסף, `metrics_record` נועלת advisory lock פר־פריט **כצעד ראשון** (§4.2) — סדר האירועים של פריט הוא סדר הנעילות, ולא מרוץ שעונים.

`event_key` נושא את זהות ה־*transition*, לא רק את הפעולה האנושית: `{reason}:{submit_id}:{item_id}:{seq}`. בלי `{reason}` ו־`{seq}`, call site ‎#9 (`queued`) ו־‎#10 (`done`) באותה טרנזקציה היו מתנגשים וסגירת המסלול הייתה נבלעת בשקט.

### 2.4 נכונות point-in-time

`valid_range @> T` עונה על "כמה פריטים היו בסטטוס X ב־14:00 ביום שלישי שעבר" — שאלה שהמערכת הנוכחית לא מסוגלת לענות עליה, כי `item_routes` הוא שורה שנדרסת. ה־`EXCLUDE` constraint מבטיח שהתשובה חד־משמעית. שאילתות ה־`@>` פועלות תמיד על האוכלוסייה הפעילה (`NOT is_terminal`) — פריטים גמורים הם interval פתוח לנצח, ודגימתם ב־`@>` הייתה סורקת את כל ההיסטוריה; ספירת "הושלמו" נגזרת מסגירות `route_run` (§5.3ב).

### 2.5 טבלה אחת, אפס בחירת־טבלה

היום: 23 טבלאות snapshot ב־7 משפחות, ובחירת הטבלה מיושמת ב־4 מקומות עם ספי־זמן סותרים (90 יום / 35 יום / 365 יום / מחרוזת period), אחד מהם בודק `information_schema` בזמן ריצה.

אחרי: **טבלה אחת**, `item_state_interval`. כל grain (יום, שבוע, חודש, רבעון) הוא `date_trunc` ב־`GROUP BY` על אותן שורות. אין בחירת טבלה, אין probe, אין סף, אין כלל ניתוב — כי אין מקור שני.

### 2.6 הגדרות חיות במקום אחד

- קודי סטטוס: `metric_state` (טבלה) במקום ~40 קטעי SQL עם 1..5 hardcoded.
- פילטרים: builder אחד ב־`src/app/lib/metrics/filters.ts` — לא מוקלד מחדש לכל query.
- לוח שנה: סולם `work_span` מגורסה, לא `calculateWorkDuration` ב־TypeScript שסותר את ה־seed.
- scopes של ההרשאות: enum אחד ב־`src/app/lib/metrics/scope.ts` (אין טבלת `metric_scope_type` — אף שאילתה לא הצטרפה אליה).

### 2.7 אף פעם לא לשמור יחס — ולא משך פתוח

כל אחוז, ממוצע ושיעור מחושבים ב־`SELECT`. הסיבה: `shipment_snapshots.completion_percentage` קפא עם המכנה השגוי ושום קריאה חוזרת לא תיקנה אותו. העיקרון חל גם על ה־contingency הנדחית (§6.5): טבלת `rollup_day`, אם תיבנה אי־פעם, תשמור מונים ומכנים בלבד.

### 2.8 שני שעונים, שני מדדים בשמות מפורשים

**החלטת המשתמש, 2026-08-24.** כל משך במערכת נמדד ומוצג **פעמיים**, בשני שמות נפרדים שלעולם לא מתחלפים זה בזה:

| שם בממשק | עמודה | מה זה |
|---|---|---|
| **זמן המתנה** / **זמן טיפול** | `wall_seconds` | הזמן האמיתי שעבר על השעון. מה שהלקוח חווה |
| **זמן המתנה בפועל** / **זמן טיפול בפועל** | `work_seconds` | רק השעות שהפס באמת עבד בהן, לפי מסך הגדרת השעות |

הכלל: **`wall` הוא מה שקרה ללקוח, `work` הוא מה שהמעבדה שולטת בו.**

**דוגמת הדגל, מחושבת מול לוח ה־seed (ראשון–חמישי 07:00–15:35, הפסקה 12:00–13:00 = 455 דקות נטו):** פריט שנכנס לתור **בחמישי 15:00** ונאסף **בראשון 07:10** מדווח:
- **זמן המתנה = 64 שעות ו־10 דקות** (חמישי 15:00 → ראשון 07:10, שעון קיר).
- **זמן המתנה בפועל = 45 דקות** — 35 דקות עבודה בחמישי (15:00→15:35, אחרי ההפסקה — כולו זמן עבודה) + 10 דקות בראשון (07:00→07:10). שישי ושבת אינם ימי עבודה.

שני המספרים נכונים, שניהם מוצגים, ואף אחד לא מחליף את השני. `offhours_seconds` (ההפרש) עונה על "כמה מהעיכוב היה לוח השנה ולא אנחנו". במעבדה כזאת כ־76% מזמן השעון הוא לא־עבודה, ולכן שני המדדים יתרחקו זה מזה בפקטור ~4. **זה בדיוק הסיגנל** — ולא סתירה שצריך ליישב.

**מה זה מחייב:**
- `work_calendar_version` + `work_span` הן טבלאות **ליבה** בשלב 2, לא תוספת אופציונלית.
- כל interval סגור נושא את ה־`calendar_version` שחישב אותו, כדי ששינוי רטרואקטיבי בלוח יפעיל חישוב מחדש (§7.4) במקום לדווח מספר מיושן בשקט. `wall_seconds` חסין לזה מהגדרתו.
- **סימטריה מלאה בשאילתות:** כל מדד שקיים ל־`wall` קיים ל־`work` ולהיפך — avg, sum, p95 ו־max בשני השעונים, בכל אחת מ־Q3/Q4/Q5/Q8 (§5). אין cache, ולכן אין "חלון קצר עשיר / חלון ארוך דל" — מקור אחד, סט עמודות אחד, בכל חלון.

---

## 3. מודל הנתונים החדש

מיגרציה: `prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql` (מיגרציה A, additive בלבד — שם אחיד בכל המסמך; שלב 0 תופס את `20260824000000_fix_int4_overflow`).
כל statement אידמפוטנטי (`IF NOT EXISTS` / `OR REPLACE`), כי בשרת ה־air-gapped מיישמים מיגרציות ידנית על volume קיים.

### 3.0 Pre-flight

```bash
docker exec -i postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('btree_gist');"
docker exec -i postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version();"
```

מצופה: `btree_gist` קיים (קובץ ה־control נשלח בתוך `postgres:16-alpine`), PostgreSQL 16.11. `CREATE EXTENSION` דורש superuser; `POSTGRES_USER` ב־`prod-deploy/db-server/docker-compose.yml` הוא ה־superuser של initdb.

### 3.1 Extension + אוצר המילים של המצבים

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS metric_state (
  state_key        text     PRIMARY KEY,
  legacy_status_id smallint UNIQUE,
  label_he         text     NOT NULL,
  is_terminal      boolean  NOT NULL DEFAULT false,
  is_waiting       boolean  NOT NULL DEFAULT false,
  is_active_work   boolean  NOT NULL DEFAULT false,
  is_research      boolean  NOT NULL DEFAULT false,
  at_station       boolean  NOT NULL DEFAULT false,
  sort_order       smallint NOT NULL
);
INSERT INTO metric_state
  (state_key, legacy_status_id, label_he, is_terminal, is_waiting, is_active_work, is_research, at_station, sort_order)
VALUES
  ('testing',         1, 'בבדיקה',        false, false, true,  false, true,  10),
  ('queued',          2, 'ממתין',         false, true,  false, false, false, 20),
  ('done',            3, 'הושלם',         true,  false, false, false, false, 30),
  ('queued_research', 4, 'ממתין למחקר',   false, true,  false, true,  false, 40),
  ('in_research',     5, 'במחקר',         false, false, true,  true,  true,  50),
  ('unmapped',     NULL, 'סטטוס לא ידוע', false, false, false, false, false, 99)
ON CONFLICT (state_key) DO UPDATE SET label_he = EXCLUDED.label_he;

CREATE OR REPLACE FUNCTION state_of(p_status int) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS
$$ SELECT COALESCE((SELECT state_key FROM metric_state WHERE legacy_status_id = p_status), 'unmapped') $$;
```

**כללי הגזירה, במקום אחד:**

| מושג | ביטוי |
|---|---|
| queue רחב (מסך תחנות) | `is_waiting` |
| queue צר (מסך לקוחות/משלוחים) | `is_waiting AND NOT is_research` |
| test רחב | `is_active_work` |
| test צר | `is_active_work AND NOT is_research` |
| מחקר בלבד | `is_research` |

**למה `unmapped`:** היום, אם משתמש מוסיף `item_status` עם id 6 דרך מסך ההגדרות, הוא נופל לכל `ELSE` ולא נספר בשום מקום; ואם הוא *מוחק* סטטוס, פריטים נעלמים ממסך העובד בגלל `INNER JOIN item_status` ב־`src/app/api/testing/items/route.ts:78`. כאן זה הופך לפרוסה מסומנת בכל גרף, והתיקון הוא `INSERT` אחד + rebuild — בלי DDL ובלי deploy. `item_status` נשארת בדיוק כפי שהיא — טבלת **תצוגה** שהמשתמש עורך.

**אין `metric_scope_type`.** בגרסה 1 היא הייתה טבלת 9 שורות שאף שאילתה לא הצטרפה אליה, וה־FK היחיד אליה ישב על `rollup_hour` — שירדה. אוצר המילים של ה־scopes (SYSTEM=0 … RESEARCH_POOL=8) חי כ־enum ב־`src/app/lib/metrics/scope.ts` (ה־scope builder של ההרשאות), ואם ה־contingency של §6.5 תיבנה אי־פעם — כ־`CHECK (scope_type BETWEEN 0 AND 8)` על `rollup_day`.

### 3.2 `route_run` — מעבר אחד של פריט אחד במסלול אחד

```sql
CREATE TABLE IF NOT EXISTS route_run (
  route_run_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id        bigint      NOT NULL,
  run_no         int         NOT NULL DEFAULT 1,
  route_number   int         NOT NULL,
  item_type_id   int         NOT NULL,
  planned_steps  int[]       NOT NULL DEFAULT '{}',
  plan_digest    text        NOT NULL DEFAULT '',
  opened_at      timestamptz NOT NULL,
  closed_at      timestamptz,
  close_reason   text,
  customer_id    int         NOT NULL,
  shipment_id    int         NOT NULL,
  parent_item_id bigint,
  unit_id        bigint      NOT NULL,
  is_accessory   boolean     NOT NULL,
  serial_no      text        NOT NULL DEFAULT '',
  is_trusted     boolean     NOT NULL DEFAULT true,
  CONSTRAINT route_run_uq   UNIQUE (item_id, run_no),
  CONSTRAINT route_run_time CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS route_run_one_open ON route_run(item_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS route_run_closed ON route_run(closed_at) WHERE closed_at IS NOT NULL;
```

הסבר העמודות: `run_no` הוא מונה מעברים (ראה `metrics_open_run`); `route_number` הוא **בורר וריאנט מסלול** ולעולם לא מונה — נבדק בכל הריפו, הוא אף פעם לא מוגדל; `planned_steps` הוא snapshot; `unit_id = COALESCE(parent_item_id, item_id)`.

**האינדקסים — שלושה בלבד, כל אחד עם צרכן מוגדר** (§6.2): `route_run_uq` (איתור run לפי פריט), `route_run_one_open` (ה־lookup של `metrics_record` + יחידות run פתוח), `route_run_closed` — **עכשיו load-bearing**: הוא משרת את `finished_cumulative` ואת `kpi_treated_count`, ששניהם נגזרים מסגירות `route_run` (§5.3ב) ולא מדגימת intervals סופיים. `route_run_dims` ו־`route_run_item` של גרסה 1 ירדו — אין להם צרכן ב־Q1–Q8 (Q7 מקבצת את כל המשלוחים הפתוחים ממילא — hash join עם סריקה מלאה של ~75k שורות/שנה הוא המסלול הנכון).

**`planned_steps` הוא snapshot בכוונה.** היום `PUT /api/settings/testing-routes/[id]:13-16` דורס את `route_steps` במקום, ובכך מגדיר מחדש רטרואקטיבית "מהו הצעד האחרון" לכל פריט שבאוויר. עם snapshot זה לא יכול לקרות.

**`unit_id`:** מוצר פיזי אחד. אביזר (accessory) הוא פריט מנותב נפרד לחלוטין עם `item_routes` משלו, אבל פיזית הוא חלק מהיחידה של ההורה. זה מאפשר לדווח שלושה מספרים שונים בכנות — `operations` (`count(DISTINCT submit_id)`), `units` (`count(DISTINCT unit_id)`), `items` (`count(*)`).

> **אזהרה (נאכפת ב־§5):** `unit_id` תקף כמפתח de-duplication **רק כאשר מפתח הקיבוץ קבוע בתוך יחידה** (customer, shipment). הוא **אסור** כאשר המפתח משתנה בתוך יחידה — `item_type_id`, `station_id`, `step_no` — כי אביזרים נושאים `item_type_id` משלהם (`src/app/api/testing/accessory/route.ts:38-48`). קיבוץ לפי `item_type` עם `count(DISTINCT unit_id)` היה מייצר undercount של פי 4.

### 3.3 `item_state_event` — ה־spine

```sql
CREATE TABLE IF NOT EXISTS item_state_event (
  event_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key       text        NOT NULL,
  route_run_id    bigint      NOT NULL REFERENCES route_run(route_run_id),
  item_id         bigint      NOT NULL,
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  seq             smallint    NOT NULL DEFAULT 0,
  kind            text        NOT NULL CHECK (kind IN ('transition','note','correction')),
  to_state        text        REFERENCES metric_state(state_key),
  step_no         int         NOT NULL,
  station_id      int,
  station_type_id int,
  worker_id       int,
  worker_name     text,
  reason          text        NOT NULL,
  submit_id       uuid,
  supersedes      bigint      REFERENCES item_state_event(event_id),
  is_trusted      boolean     NOT NULL DEFAULT true,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ise_key_uq UNIQUE (event_key),
  CONSTRAINT ise_reason_chk CHECK (reason IN (
    'item_created','test_started','result_submitted','sent_to_research','returned_to_route',
    'research_note','released_by_user','released_stale','no_station_for_type',
    'station_reassigned','manual_override','legacy_import','correction')),
  CONSTRAINT ise_transition_has_state CHECK (kind <> 'transition' OR to_state IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ise_run   ON item_state_event(route_run_id, occurred_at, seq, event_id);
CREATE INDEX IF NOT EXISTS ise_item  ON item_state_event(item_id, occurred_at);
CREATE INDEX IF NOT EXISTS ise_super ON item_state_event(supersedes) WHERE supersedes IS NOT NULL;

CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING HINT = 'corrections are INSERTs: see the correction recipe (retraction: kind=correction; replacement: kind=transition, reason=correction, supersedes=<event_id>)';
END $$;
DROP TRIGGER IF EXISTS trg_ise_immutable ON item_state_event;
CREATE TRIGGER trg_ise_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON item_state_event
  FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();
```

הסבר: `occurred_at` הוא זמן ה־valid; `recorded_at` הוא זמן הטרנזקציה (וגם ציר ה־as-of של §12.5); `seq` שובר שוויון בתוך טרנזקציה; `worker_name` הוא snapshot כי משתמש Keycloak עלול להימחק. `'reroute'` **אינו** reason של event — הוא ערך `exit_reason` שנכתב ישירות על intervals על ידי `metrics_open_run` (§3.7), ולכן איננו ב־CHECK.

שינויים מגרסה 1: `ise_recorded` ו־`ise_submit` ירדו (אין להם צרכן ב־Q1–Q8; replay של as-of הוא אירוע נדיר שסריקה מלאה משרתת). `ise_super` נשאר — בדיקת ה"דולג על אירועים שהוחלפו" של `isi_rebuild_run` רצה פר־event.

> **מפתח הסדר הקנוני הוא `(occurred_at, seq, event_id)` — בכל מקום, ושובר השוויון האחרון הוא `event_id`.**
> `clock_timestamp()` **אינו מונוטוני מובטח** — הוא שעון קיר, ו־NTP step או host-resume (התנהגות מוכרת ב־Docker-on-Windows) יכולים להחזיר אותו אחורה; שתי טרנזקציות שונות יכולות גם לנחות על אותה מיקרו־שנייה. לכן `metrics_record` (§4.2) נועלת את הפריט **לפני** קביעת הזמן ומבצעת clamp: `v_at := GREATEST(clock_timestamp(), max(occurred_at)+1µs)` פר־פריט. כך `occurred_at` עולה ממש בתוך כל פריט, `seq` מבחין בין שני events של אותה קריאה (למשל ‎#9/#10 באותה הגשה), ו־`event_id` סוגר כל שארית תיאורטית. ההשוואות ב־`isi_apply_one` וה־`ORDER BY` של `isi_rebuild_run` משתמשים באותו מפתח משולש — אין שני מפתחות סדר במערכת.
> הצורך בשני events נפרדים באותה טרנזקציה הוא אמיתי: `results/route.ts` מבצע **שני** state transitions במסלול הסיום הרגיל (סטטוס 2 ואז 3 באותה שורה). `now()` היה נותן לשניהם אותה חותמת וה־fold היה מוחק את השני — כלומר אף מסלול לא היה מגיע ל־`done`.

### 3.4 טקסונומיית ה־events המלאה

| `reason` | `kind` | `to_state` | נכתב מ־ | קיים היום ב־log? |
|---|---|---|---|---|
| `item_created` | transition | `queued` | `src/app/lib/create-item.ts` | ✗ |
| `test_started` | transition | `testing` / `in_research` | `api/testing/start-test/route.ts`; **וגם סינתטי לאביזרים** מתוך `results/route.ts` (call site ‎#15, §4.5) | ✗ |
| `released_by_user` | transition | `queued` / `queued_research` | `api/testing/release-test/route.ts` | ✗ |
| `released_stale` | transition | `queued` / `queued_research` | `api/cron/release-stale-tests/route.ts` | ✗ |
| `result_submitted` | transition | `queued` / `done` | `results/route.ts` — מסלול רגיל, צעד אחרון, finishRoute | חלקית |
| `sent_to_research` | transition | `queued_research` | `results/route.ts` (sendToResearch) | דו־משמעי |
| `returned_to_route` | transition | `queued` | `results/route.ts` (returnToRoute) | דו־משמעי |
| `research_note` | **note** | — | `results/route.ts` (5→5 שמירת ביניים) | ✗ |
| `no_station_for_type` | transition | `done` | `results/route.ts` — **שלושת** מסלולי ה"אין המשך": אין תחנה מהסוג, מסלול שהתקצר (בלוק ‎:458), ומסלול השגיאה (‎:579) | ✗ |
| `station_reassigned` | **note** | — | `results/route.ts` ‎:206, ‎:235, ‎:353, ‎:545 — עם `seq` מפורש לכל אתר (§4.5) | ✗ |
| `manual_override` | transition | any | endpoint חדש מוגן manager; **פותח run חדש אוטומטית על פריט גמור** (§4.2) | שורות רעל |
| `legacy_import` | transition | any | backfill (§8 שלב 4) | — |
| `correction` | retraction: **correction** · replacement: **transition** | any | SQL ידני לפי המרשם שמתחת לטבלה — לא דרך `metrics_record` | לא קיים |

**מסלול התיקון (correction), במדויק.** `metrics_record` הוא *לא* ה־API לתיקונים — הוא חותם
`clock_timestamp()` משלו ואין לו `supersedes`; תיקון הוא פעולת SQL ידנית, מודעת, של מי שמבין מה
הוא עושה (וה־trigger של append-only מתיר INSERT):

- **החלפה** (הרוב): `INSERT INTO item_state_event (kind='transition', reason='correction',
  occurred_at=<הרגע הנכון>, to_state=..., supersedes=<event_id השגוי>, is_trusted=false, ...)`
  ואז `SELECT isi_rebuild_run(<route_run_id>)`. ה־replay כולל את האירוע החדש (הוא `transition`)
  ומדלג על כל אירוע ש־`supersedes` מצביע עליו — לוגיקת הדילוג כבר קיימת ב־`isi_rebuild_run`.
- **מחיקה טהורה** (נדיר): `kind='correction'` + `supersedes` בלבד, בלי מצב חלופי — האירוע השגוי
  מדולג וזהו.

זו ההגדרה היחידה; §4.3, §7.5 ו־§10.6 מפנים לכאן. בדיקת יחידה ב־§9.2 מכסה את שני המסלולים.

**כיסוי: 31 מסלולי פליטה** — 28 של גרסה 1, ועוד שלושה שהביקורת חשפה: הזוג הסינתטי `test_started`+`result_submitted` לאביזרים (‎#15, §4.5/§4.7) וסגירת ה"מסלול שהתקצר" בבלוק ‎:458 שקופלה ל־‎#11. היום: 4, ושלושה מתוכם דו־משמעיים או כפולים.

### 3.5 לוח שנה של עבודה — `work_calendar_version` + `work_span`

```sql
CREATE TABLE IF NOT EXISTS work_calendar_version (
  calendar_version int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  horizon_from     date NOT NULL,
  horizon_to       date NOT NULL,
  source_digest    text NOT NULL,
  is_current       boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS wcv_one_current ON work_calendar_version(is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS work_span (
  calendar_version   int    NOT NULL REFERENCES work_calendar_version(calendar_version) ON DELETE CASCADE,
  span_id            bigint GENERATED ALWAYS AS IDENTITY,
  work_date          date   NOT NULL,
  span               tstzrange NOT NULL,
  span_seconds       int    NOT NULL,
  cum_seconds_before bigint NOT NULL,
  PRIMARY KEY (calendar_version, span_id),
  CONSTRAINT work_span_no_overlap EXCLUDE USING gist (calendar_version WITH =, span WITH &&),
  CONSTRAINT work_span_sane CHECK (span_seconds > 0 AND NOT isempty(span))
);
CREATE INDEX IF NOT EXISTS work_span_ladder ON work_span (calendar_version, lower(span));
```

`work_span` הוא **חלון עבודה רציף אחד**. הפסקת 12:00–13:00 מפצלת יום לשני spans. הערכים הם **רגעים מוחלטים** (`tstzrange`), כך ש־DST נפתר פעם אחת בזמן היצירה. `work_span_date` של גרסה 1 ירד — הצרכן היחיד היה בדיקת sanity לילית על ~2,200 שורות, שסריקה מלאה משרתת.

> **אין טבלת staging קבועה.** `work_span_stage` היא **TEMP TABLE** שנוצרת בתוך טרנזקציית הבנייה. זה מחייב חוזה מפורש: ב־Prisma עם `Pool` רגיל, כל `$executeRaw` שאינו בתוך `prisma.$transaction` עושה autocommit על connection שרירותי מה־pool — ו־TEMP TABLE שנוצרה על connection אחד בלתי נראית על השני. לכן `POST /api/cron/rebuild-work-calendar` מריץ **בתוך `prisma.$transaction` אחד**: יצירת ה־TEMP (`ON COMMIT DROP`), ה־INSERTs מ־`resolveRange()`, `SELECT work_calendar_build($ver)`, והיפוך `is_current` — הכול על connection אחד (interactive transaction של Prisma מחזיקה client אחד). name-resolution תקין: `pg_temp` נסרק לפני `public` עבור relations גם עם `SET search_path = pg_catalog, public`.

```ts
// src/app/api/cron/rebuild-work-calendar/route.ts — הזרימה כולה בטרנזקציה אחת
await prisma.$transaction(async (tx) => {
  // digest check: גרסה חדשה נוצרת רק כשה-source השתנה או האופק קצר (תיקון churn)
  await tx.$executeRaw`CREATE TEMP TABLE work_span_stage(
    work_date date NOT NULL, start_hhmm text NOT NULL, end_hhmm text NOT NULL) ON COMMIT DROP`;
  // batched INSERTs של (work_date, start_hhmm, end_hhmm) מתוך resolveRange() —
  // נתונים אזרחיים בלבד; ההמרה לאזור זמן נעשית ב-SQL בלבד.
  await tx.$queryRaw`SELECT work_calendar_build(${ver}::int)`;
  await tx.$executeRaw`UPDATE work_calendar_version SET is_current = (calendar_version = ${ver})
                       WHERE is_current OR calendar_version = ${ver}`;
}, { timeout: 240_000 });
```

> **האזור נקבע ב־SQL, לא ב־Node.** ל־`next-app` אין `TZ` בשום compose/Dockerfile/`.env.template` (נבדק), ולכן אזור הזמן של Node בקונטיינר הוא **UTC**. המרה של `'2026-09-17' + '07:00'` ב־TypeScript הייתה מייצרת 07:00Z = 10:00 ישראל — הזחה שקטה של 2–3 שעות בכל `work_seconds` במערכת. ה־endpoint שולח **רק** נתונים אזרחיים, וה־DB בונה:

```sql
CREATE OR REPLACE FUNCTION work_calendar_build(p_version int) RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n int;
BEGIN
  INSERT INTO work_span (calendar_version, work_date, span, span_seconds, cum_seconds_before)
  SELECT p_version, s.work_date, s.span, s.secs,
         COALESCE(SUM(s.secs) OVER (ORDER BY lower(s.span)
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
  FROM (
    SELECT st.work_date,
           tstzrange((st.work_date::text || ' ' || st.start_hhmm)::timestamp AT TIME ZONE 'Asia/Jerusalem',
                     (st.work_date::text || ' ' || st.end_hhmm)::timestamp   AT TIME ZONE 'Asia/Jerusalem', '[)') AS span,
           EXTRACT(EPOCH FROM
             ((st.work_date::text || ' ' || st.end_hhmm)::timestamp   AT TIME ZONE 'Asia/Jerusalem'
            - (st.work_date::text || ' ' || st.start_hhmm)::timestamp AT TIME ZONE 'Asia/Jerusalem'))::int AS secs
    FROM work_span_stage st
  ) s
  ORDER BY lower(s.span);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
```

(אין `DELETE FROM work_span_stage` — `ON COMMIT DROP` מחליף אותו.)

```sql
-- timestamptz AT TIME ZONE הוא STABLE ולא IMMUTABLE, ולכן business_date
-- לעולם לא יכול להיות GENERATED column. הוא נכתב על ידי פונקציית ה-apply.
CREATE OR REPLACE FUNCTION business_date(ts timestamptz) RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS
$$ SELECT (ts AT TIME ZONE 'Asia/Jerusalem')::date $$;

CREATE OR REPLACE FUNCTION current_calendar_version() RETURNS int
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS
$$ SELECT calendar_version FROM work_calendar_version WHERE is_current $$;

-- שתי גישות אינדקס, לא סריקה על ימים.
CREATE OR REPLACE FUNCTION work_seconds_elapsed(p_ts timestamptz, p_ver int)
RETURNS bigint LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((
    SELECT ws.cum_seconds_before
         + LEAST(GREATEST(0, EXTRACT(EPOCH FROM (p_ts - lower(ws.span)))::bigint), ws.span_seconds)
    FROM work_span ws
    WHERE ws.calendar_version = p_ver AND lower(ws.span) <= p_ts
    ORDER BY lower(ws.span) DESC LIMIT 1), 0);
$$;

-- מחזיר NULL (ולא 0) מחוץ לאופק שנוצר, כדי שפער יהיה גלוי.
CREATE OR REPLACE FUNCTION work_seconds_between(a timestamptz, b timestamptz, p_ver int DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN v IS NULL THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM work_calendar_version c
                     WHERE c.calendar_version = v
                       AND business_date(LEAST(a,b))    >= c.horizon_from
                       AND business_date(GREATEST(a,b)) <= c.horizon_to) THEN NULL
    ELSE GREATEST(0, work_seconds_elapsed(GREATEST(a,b), v) - work_seconds_elapsed(LEAST(a,b), v))::numeric
  END
  FROM (SELECT COALESCE(p_ver, current_calendar_version()) AS v) s;
$$;
```

### 3.6 `item_state_interval` — ה־ledger

```sql
CREATE TABLE IF NOT EXISTS item_state_interval (
  interval_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_run_id     bigint      NOT NULL REFERENCES route_run(route_run_id) ON DELETE CASCADE,
  item_id          bigint      NOT NULL,
  state_key        text        NOT NULL REFERENCES metric_state(state_key),
  is_terminal      boolean     NOT NULL DEFAULT false,   -- denormalized מ-metric_state
  step_no          int         NOT NULL,
  attempt_no       int         NOT NULL DEFAULT 1,
  -- סמנטיקת תחנה, נאכפת:
  station_id       int,        -- רק כאשר metric_state.at_station
  station_type_id  int,        -- לתור: הסוג שהפריט ממתין לו; NULL ל-queued_research
  entered_by_worker_id   int,
  entered_by_worker_name text,
  exited_by_worker_id    int,
  exited_by_worker_name  text,
  entry_reason     text        NOT NULL,
  exit_reason      text,
  entry_event_id   bigint      NOT NULL REFERENCES item_state_event(event_id),
  exit_event_id    bigint      REFERENCES item_state_event(event_id),
  valid_range      tstzrange   NOT NULL,
  closed_at        timestamptz,                          -- = upper(valid_range) כשסגור
  start_business_date date     NOT NULL,
  close_business_date date,
  -- ממדים קפואים: אף שאילתת קריאה לא עושה JOIN ל-items/shipments כדי לסנן
  customer_id      int         NOT NULL,
  shipment_id      int         NOT NULL,
  item_type_id     int         NOT NULL,
  unit_id          bigint      NOT NULL,
  is_accessory     boolean     NOT NULL,
  serial_no        text        NOT NULL DEFAULT '',
  -- שני שעונים, ממולאים בסגירה
  wall_seconds     numeric(14,3),
  work_seconds     numeric(14,3),
  offhours_seconds numeric(14,3) GENERATED ALWAYS AS (wall_seconds - work_seconds) STORED,
  calendar_version int,
  is_trusted       boolean     NOT NULL DEFAULT true,
  sys_from         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT isi_shape CHECK (NOT isempty(valid_range) AND lower_inc(valid_range) AND NOT upper_inc(valid_range)),
  CONSTRAINT isi_closed_sync CHECK (closed_at IS NOT DISTINCT FROM upper(valid_range)),
  CONSTRAINT isi_closed_has_wall CHECK (upper_inf(valid_range) OR is_terminal OR wall_seconds IS NOT NULL),
  -- הconstraint. פריט נמצא במצב אחד בדיוק בכל רגע.
  -- DEFERRABLE (עדיין INITIALLY IMMEDIATE): התפעול הרגיל נבדק פר-statement
  -- בדיוק כמו קודם; רק isi_rebuild_run דוחה אותם, כי replay של run שאינו
  -- האחרון חייב ליצור זמנית interval סופי פתוח שה-run הבא כבר תוחם.
  CONSTRAINT isi_no_overlap EXCLUDE USING gist (item_id WITH =, valid_range WITH &&)
    DEFERRABLE INITIALLY IMMEDIATE
);
-- interval פתוח אחד לכל פריט. EXCLUDE constraint ולא unique index חלקי מסיבה
-- אחת בלבד: constraints אפשר לדחות (SET CONSTRAINTS ... DEFERRED) בזמן
-- isi_rebuild_run; אינדקסים לא. הסמנטיקה זהה. (תיקון מהאימות האמפירי, 2026-08-25.)
ALTER TABLE item_state_interval ADD CONSTRAINT isi_one_open_per_item
  EXCLUDE USING btree (item_id WITH =) WHERE (upper_inf(valid_range))
  DEFERRABLE INITIALLY IMMEDIATE;

-- station_id מותר רק במצבים שתחנה מחזיקה בהם, אבל מותר שיהיה חסר
-- (item_routes.test_station_id הוא nullable, ויש מסלולים שמגיעים ל-1/5 בלי תחנה).
ALTER TABLE item_state_interval DROP CONSTRAINT IF EXISTS isi_station_shape;
ALTER TABLE item_state_interval ADD CONSTRAINT isi_station_shape CHECK (
  station_id IS NULL OR state_key IN ('testing','in_research')
);
```

**האינדקסים המשניים — ארבעה, לא שנים־עשר.** ביקורת הפשטות הפריכה את טענת גרסה 1 ("כולם נדרשים, כל אחד משרת שאילתה מוגדרת"): `isi_start_bd` לא שירת אף שאילתה ב־Q1–Q9, ועוד שישה שירתו נפחים שסריקה מכוסה משרתת מהר יותר מעלות התחזוקה שלהם — כל סגירת interval היא UPDATE לא־HOT שכותב לכל מבנה אינדקס, בתוך טרנזקציית ההגשה של העובד. הסט המלא עם הצרכן של כל שורד — §6.2:

```sql
-- point-in-time (@>) ו-overlap (&&). כל צרכני ה-@>/&& מסננים NOT is_terminal (ראה §5),
-- ולכן predicate האינדקס מיושר עם predicate השאילתות — והאינדקס באמת בשימוש.
CREATE INDEX IF NOT EXISTS isi_range_live ON item_state_interval USING gist (valid_range)
  WHERE NOT is_terminal;
-- שרשרת intervals של פריט (Q6 LATERAL, מסך היסטוריית פריט)
CREATE INDEX IF NOT EXISTS isi_item_time ON item_state_interval (item_id, valid_range);
-- מטריקות flow/duration (עוגן סגירה) — Q4/Q6/Q8
CREATE INDEX IF NOT EXISTS isi_closed ON item_state_interval (close_business_date, state_key)
  INCLUDE (wall_seconds, work_seconds, unit_id, exit_reason, attempt_no, station_id, station_type_id)
  WHERE closed_at IS NOT NULL;
-- hot path של ה-fold (ספירת attempt_no) + DELETE של rebuild
CREATE INDEX IF NOT EXISTS isi_run ON item_state_interval(route_run_id, step_no, attempt_no);

ALTER TABLE item_state_interval SET (fillfactor = 90);
```

> **יישור אינדקס–פרדיקט (החלטה).** ה־GiST היחיד על `valid_range` הוא חלקי (`WHERE NOT is_terminal`), ו־PostgreSQL משתמש באינדקס חלקי רק כשה־WHERE של השאילתה מוכיח את ה־predicate שלו. לכן **כל** שאילתת `@>`/`&&` ב־§5 נושאת `NOT i.is_terminal` מפורש — וזה נכון גם סמנטית: intervals של `done` פתוחים לנצח, ודגימתם ב־`@>` סורקת את כל מה שהסתיים אי־פעם (נמדד: timeout של >120 שניות על נפח שנה-3 בלי הפילטר; 486ms איתו — §6.1). ספירת "הושלמו" **לעולם לא** מגיעה מ־`@>`: היא נגזרת מסגירות `route_run` (§5.3ב), עם `route_run_closed` כאינדקס. (ה־EXCLUDE constraint אינו תחליף ל־GiST על הטווח: העץ שלו מאורגן לפי `item_id` המוביל, ו־probe של טווח בלבד מתנוון לסריקה כמעט מלאה.)

> **שני עוגני תאריך, מופרדים בשם.** `start_business_date` ו־`close_business_date` נכתבים שניהם בזמן ה־fold. כל מטריקת "בתקופה" היא סגירה־מעוגנת (`close_business_date`); interval שנפתח חמישי ונסגר ראשון נספר לראשון. (`isi_start_bd` — אינדקס על עוגן הפתיחה — ירד: אף שאילתה לא מסננת לפיו; מטריקות entry-anchored כמו `rework_entries` הן `FILTER` על `entry_reason` בתוך שאילתות close-anchored.)

> **שני עובדים, לא אחד.** `entered_by_*` ו־`exited_by_*` בנפרד; **כל מטריקת throughput/duration מקבצת לפי `exited_by_worker_id`** (המגיש). interval של `queued` נוצר על ידי אירוע ההגשה של הצעד הקודם, וייחוס לפי הנכנס היה מזכה את האדם הלא נכון. במצבי המתנה שתי העמודות NULL — אף אחד לא "מבצע" המתנה.

**אין `item_state_interval_history`, אין Q9, אין cron גיזום.** הטבלה, האינדקסים שלה, ענף הארכוב ב־`isi_rebuild_run`, `prune-history` ו־Q9 ירדו כליל. ה־spine כבר bitemporal מבנייה (`occurred_at` + `recorded_at`, append-only, תיקונים עם `supersedes`), ולכן "הדוח שהודפס ב־1 באוגוסט" ניתן לשחזור בכל רגע על ידי replay מסונן `recorded_at` — מתכון ב־§12.5 וב־`docs/RUNBOOK_METRICS.md`. היכולת מתועדת במקום להיבנות מראש עבור שאלה שאף מסך לא שואל.

### 3.7 ה־fold — `metrics_open_run`, `isi_apply_one`, `isi_rebuild_run`

```sql
CREATE OR REPLACE FUNCTION metrics_open_run(p_item_id bigint, p_at timestamptz)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_run bigint; v_no int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  -- סגירת interval סופי פתוח, אם יש: אחרת isi_one_open_per_item ו-isi_no_overlap
  -- היו הופכים כל מעבר שני של פריט (rework, manual_override) לכשל constraint
  -- בתוך ה-submit של העובד.
  UPDATE item_state_interval
     SET valid_range = tstzrange(lower(valid_range), p_at, '[)'),
         closed_at   = p_at,
         close_business_date = business_date(p_at),
         exit_reason = 'reroute'
   WHERE item_id = p_item_id AND upper_inf(valid_range) AND is_terminal;

  SELECT 1 + COALESCE(max(run_no), 0) INTO v_no FROM route_run WHERE item_id = p_item_id;

  INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest,
                         opened_at, customer_id, shipment_id, parent_item_id, unit_id,
                         is_accessory, serial_no, is_trusted)
  SELECT ir.item_id, v_no, ir.route_number, ir.item_type_id,
         COALESCE(tr.route_steps, '{}'), md5(COALESCE(tr.route_steps, '{}')::text),
         p_at, it.customer_id, it.shipment_id, it.parent_item_id,
         COALESCE(it.parent_item_id, it.item_id), it.parent_item_id IS NOT NULL,
         COALESCE(TRIM(it.serial_no), ''), true
  FROM item_routes ir
  JOIN items it ON it.item_id = ir.item_id
  LEFT JOIN testing_routes tr
         ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
  WHERE ir.item_id = p_item_id
  RETURNING route_run_id INTO v_run;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'metrics_open_run: no item_routes row for item %', p_item_id;
  END IF;
  RETURN v_run;
END $$;
```

(ה־`LEFT JOIN testing_routes` מניח ייחודיות של `(item_type_id, route_number)` — נאכפת ב־`testing_routes_type_number_uq` שנוצרת במיגרציה A, **אחרי דוח כפילויות** שמדפיס `8-apply-metrics-ledger.ps1`: `SELECT item_type_id, route_number, count(*) FROM testing_routes GROUP BY 1,2 HAVING count(*) > 1`. היום אין unique על הזוג בסכימה (`prisma/schema.prisma`, model `testing_routes` — PK על `test_route_id` בלבד), וכפילות אחת על volume הפרודקשן הייתה מפילה את יצירת האינדקס באמצע apply ידני, בלי נוהל תיקון ביד המפעיל.)

```sql
CREATE OR REPLACE FUNCTION isi_apply_one(e item_state_event) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_open item_state_interval; v_ver int;
  v_terminal boolean; v_at_station boolean;
  v_attempt int; v_run route_run; v_sttype int;
  v_prev_at timestamptz; v_prev_seq smallint; v_prev_id bigint;
BEGIN
  IF e.kind <> 'transition' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||e.item_id::text, 0));
  v_ver := current_calendar_version();
  SELECT * INTO v_run FROM route_run WHERE route_run_id = e.route_run_id;

  SELECT * INTO v_open FROM item_state_interval
   WHERE item_id = e.item_id AND upper_inf(valid_range) FOR UPDATE;

  IF FOUND THEN
    SELECT ev.occurred_at, ev.seq, ev.event_id INTO v_prev_at, v_prev_seq, v_prev_id
      FROM item_state_event ev WHERE ev.event_id = v_open.entry_event_id;

    -- מפתח הסדר המשולש — זהה ל-ORDER BY של isi_rebuild_run. שובר השוויון: event_id.
    IF (e.occurred_at, e.seq, e.event_id) < (v_prev_at, v_prev_seq, v_prev_id) THEN
      IF COALESCE(current_setting('app.isi_rebuilding', true), '') = '1' THEN
        RAISE EXCEPTION 'out-of-order event % during rebuild of run %', e.event_id, e.route_run_id;
      END IF;
      -- בזכות הנעילה+clamp של metrics_record זה בלתי אפשרי במסלול חי;
      -- הענף משרת רק backfill/corrections עם זמנים מפורשים.
      PERFORM isi_rebuild_run(v_open.route_run_id);
      RETURN;
    ELSIF (e.occurred_at, e.seq) = (v_prev_at, v_prev_seq) THEN
      IF e.to_state = v_open.state_key THEN RETURN; END IF;
      RAISE EXCEPTION 'zero-length interval for item % (% -> %) at %',
        e.item_id, v_open.state_key, e.to_state, e.occurred_at;
    END IF;

    IF v_open.is_terminal THEN
      UPDATE item_state_interval SET
        valid_range = tstzrange(lower(valid_range), e.occurred_at, '[)'),
        closed_at = e.occurred_at, close_business_date = business_date(e.occurred_at),
        exit_event_id = e.event_id, exit_reason = e.reason
      WHERE interval_id = v_open.interval_id;
    ELSE
      UPDATE item_state_interval SET
        valid_range      = tstzrange(lower(valid_range), e.occurred_at, '[)'),
        closed_at        = e.occurred_at,
        close_business_date = business_date(e.occurred_at),
        exit_event_id    = e.event_id,
        exit_reason      = e.reason,
        exited_by_worker_id   = e.worker_id,
        exited_by_worker_name = e.worker_name,
        wall_seconds     = EXTRACT(EPOCH FROM (e.occurred_at - lower(valid_range))),
        work_seconds     = work_seconds_between(lower(valid_range), e.occurred_at, v_ver),
        calendar_version = v_ver
      WHERE interval_id = v_open.interval_id;
    END IF;
  END IF;

  SELECT is_terminal, at_station INTO v_terminal, v_at_station
    FROM metric_state WHERE state_key = e.to_state;

  IF v_terminal THEN
    UPDATE route_run SET closed_at = e.occurred_at, close_reason = e.reason
     WHERE route_run_id = e.route_run_id AND closed_at IS NULL;
  END IF;

  SELECT 1 + count(*) INTO v_attempt FROM item_state_interval
   WHERE route_run_id = e.route_run_id AND step_no = e.step_no AND state_key = e.to_state;

  v_sttype := CASE
    WHEN v_at_station          THEN e.station_type_id
    WHEN e.to_state = 'queued' THEN NULLIF(v_run.planned_steps[e.step_no], 0)
    ELSE NULL END;

  INSERT INTO item_state_interval (route_run_id,item_id,state_key,is_terminal,step_no,attempt_no,
    station_id,station_type_id,entered_by_worker_id,entered_by_worker_name,
    entry_reason,entry_event_id,valid_range,start_business_date,
    customer_id,shipment_id,item_type_id,unit_id,is_accessory,serial_no,is_trusted)
  VALUES (e.route_run_id,e.item_id,e.to_state,v_terminal,e.step_no,v_attempt,
    CASE WHEN v_at_station THEN e.station_id END, v_sttype,
    CASE WHEN v_at_station THEN e.worker_id END,
    CASE WHEN v_at_station THEN e.worker_name END,
    e.reason,e.event_id,tstzrange(e.occurred_at,NULL,'[)'),business_date(e.occurred_at),
    v_run.customer_id,v_run.shipment_id,v_run.item_type_id,v_run.unit_id,
    v_run.is_accessory,v_run.serial_no, e.is_trusted AND v_run.is_trusted);
END $$;

CREATE OR REPLACE FUNCTION isi_apply_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN PERFORM isi_apply_one(NEW); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_isi_apply ON item_state_event;
CREATE TRIGGER trg_isi_apply AFTER INSERT ON item_state_event
  FOR EACH ROW EXECUTE FUNCTION isi_apply_event();
```

(שינויים מגרסה 1: אין קריאות `rollup_mark_dirty` — אין cache; ההשוואה על המפתח המשולש.)

```sql
CREATE OR REPLACE FUNCTION isi_rebuild_run(p_run bigint)
RETURNS int LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE e item_state_event; n int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi_rebuild:'||p_run::text, 0));
  PERFORM set_config('app.isi_rebuilding', '1', true);

  DELETE FROM item_state_interval WHERE route_run_id = p_run;
  -- rebuild של run שאינו האחרון (תיקון מהאימות האמפירי, 2026-08-25):
  -- interval ה-done שלו נחתם במקור על ידי פתיחת ה-run הבא — אירוע שלא שייך
  -- ל-run הזה. לכן: (א) ה-constraints נדחים ל-commit למשך ה-replay
  -- (SET CONSTRAINTS isi_no_overlap, isi_one_open_per_item DEFERRED);
  -- (ב) closed_at מאופס רק כשה-run הוא האחרון של הפריט (אחרת route_run_one_open
  -- נשבר); (ג) אחרי הלולאה, ה-interval הסופי הפתוח נתחם ב-opened_at של ה-run
  -- הבא עם exit_reason='reroute' — בדיוק מה ש-metrics_open_run עושה במסלול חי.
  -- בנוסף, בזמן rebuild ה-v_open ב-isi_apply_one נבחר לפי route_run_id ולא לפי
  -- item_id — אחרת ה-replay היה סוגר את ה-interval הפתוח של ה-run החי.
  UPDATE route_run SET closed_at = NULL, close_reason = NULL
   WHERE route_run_id = p_run AND v_next IS NULL;

  FOR e IN
    SELECT ev.* FROM item_state_event ev
    WHERE ev.route_run_id = p_run AND ev.kind = 'transition'
      AND NOT EXISTS (SELECT 1 FROM item_state_event c WHERE c.supersedes = ev.event_id)
    ORDER BY ev.occurred_at, ev.seq, ev.event_id
  LOOP PERFORM isi_apply_one(e); n := n + 1; END LOOP;

  PERFORM set_config('app.isi_rebuilding', '0', true);
  RETURN n;
END $$;
```

(שינויים מגרסה 1: הפרמטר `p_archive` וענף ה־`INSERT INTO item_state_interval_history` **נמחקו לגמרי** — הטבלה לא קיימת בגרסה 2, וברירת מחדל של ארכוב הייתה מרימה 42P01 בתוך submit של עובד על ה־out-of-order הראשון. אין `rollup_mark_dirty_range`.)

**זהו כל סיפור ה־disaster recovery.** ה־`EXCLUDE` constraint ו־`isi_one_open_per_item` **מוכיחים** את ה־rebuild: אם ה־replay ייצר חפיפה או פריט עם שני intervals פתוחים, הטרנזקציה נופלת ושום דבר לא מתפרסם.

### 3.8 גלאי ה־drift — פיגום ה־dual-run

```sql
CREATE TABLE IF NOT EXISTS metrics_drift (
  drift_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id       bigint NOT NULL,
  legacy_status smallint,
  ledger_state  text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  occurrences   int NOT NULL DEFAULT 1,
  resolved_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS metrics_drift_open ON metrics_drift(item_id) WHERE resolved_at IS NULL;

-- לא כותב שום מטריקה. רק צועק כשכותב item_routes שכח לקרוא ל-metrics_record.
CREATE OR REPLACE FUNCTION metrics_detect_drift() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_state text; v_status smallint;
BEGIN
  -- קוראים מחדש את השורה כפי שנחתה ב-commit — לא את row-image של ה-UPDATE שתוזמן.
  -- results/route.ts מעדכן את אותה שורת item_routes פעמיים בטרנזקציה אחת
  -- (סטטוס 2 ואז 3 במסלול הסיום). טריגר נדחה מתוזמן פעם לכל אירוע UPDATE, וההפעלה
  -- הראשונה נושאת NEW.current_status=2 בעוד שה-ledger כבר ב-done — השוואה מול NEW
  -- הייתה מייצרת שורת drift מזויפת לכל השלמת מסלול (מאות ביום). השוואה מול השורה
  -- המחויבת גורמת לכל ההפעלות של אותה טרנזקציה להסכים.
  SELECT ir.current_status INTO v_status FROM item_routes ir WHERE ir.item_id = NEW.item_id;
  SELECT i.state_key INTO v_state FROM item_state_interval i
   WHERE i.item_id = NEW.item_id AND upper_inf(i.valid_range);

  IF v_state IS DISTINCT FROM state_of(v_status) THEN
    INSERT INTO metrics_drift(item_id, legacy_status, ledger_state)
    VALUES (NEW.item_id, v_status, v_state)
    ON CONFLICT (item_id) WHERE resolved_at IS NULL
    DO UPDATE SET last_seen_at = now(), occurrences = metrics_drift.occurrences + 1,
                  legacy_status = EXCLUDED.legacy_status, ledger_state = EXCLUDED.ledger_state;
  ELSE
    UPDATE metrics_drift SET resolved_at = now()
     WHERE item_id = NEW.item_id AND resolved_at IS NULL;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_metrics_drift ON item_routes;
CREATE CONSTRAINT TRIGGER trg_metrics_drift
  AFTER INSERT OR UPDATE ON item_routes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION metrics_detect_drift();

-- מיגרציה A משאירה את הטריגר כבוי. הוא מופעל כצעד האחרון של Tier-1 backfill
-- באותו סקריפט apply (§8 שלב 4).
ALTER TABLE item_routes DISABLE TRIGGER trg_metrics_drift;
```

> **למה כבוי עד ה־backfill:** בין apply של מיגרציה A לבין ה־image של שלב 3, האפליקציה הישנה ממשיכה לכתוב `item_routes` בעוד ה־ledger ריק — כל כתיבה הייתה רושמת drift, ופריט שהסתיים בחלון לא מקבל כתיבת `item_routes` נוספת שתסגור את השורה: `drift_open` היה תקוע מעל 0 לנצח, האריח אדום לתמיד, והשער "7 ימים עם drift_open = 0" בלתי ניתן להשגה מבנית.

> **טריגר constraint נדחה, לא `AFTER ROW` רגיל** — מעריך ב־commit, אחרי שכל הכתיבות נחתו; אחרת ~1,600 שורות רעש ביום. **פיגום, לא תשתית קבע** (החלטת המשתמש): הטריגר, הפונקציה והטבלה נמחקים במיגרציה B, אחרי ששער ה־dual-run ("7 ימים עם drift_open = 0") הוכיח כיסוי מלא של 31 מסלולי הפליטה בפרודקשן אמיתי. עלות ההשארה — הפעלה לכל כתיבת `item_routes`, לתמיד; ה־`CREATE` האידמפוטנטי שמור ב־runbook למקרה שיתווסף אי־פעם כותב `item_routes` חדש (החלטה פתוחה §11.3).

### 3.9 טבלאות תפעול

```sql
CREATE TABLE IF NOT EXISTS job_run (
  job_run_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name      text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','ok','failed','skipped_overlap')),
  rows_affected bigint, detail jsonb, error_text text, host text
);
CREATE INDEX IF NOT EXISTS job_run_recent ON job_run(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS metrics_schema_version (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version int NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO metrics_schema_version(id, version) VALUES (1, 1)
ON CONFLICT (id) DO UPDATE SET version = GREATEST(metrics_schema_version.version, 1), applied_at = now();
```

> **תיקון מהזריעה על נתונים אמיתיים (2026-08-25) — `work_seconds_elapsed` מחזירה `numeric`, לא `bigint`.**
> ה־cast `EXTRACT(EPOCH ...)::bigint` **מעגל**, ולכן שני אירועים במרחק מיקרו־שנייה יכלו לנחות על
> היסטים שרחוקים שנייה שלמה: interval בן 0.09 שניות ירש שניית־עבודה פנטום, `work_seconds` עקף את
> `wall_seconds`, והעמודה המחושבת `offhours_seconds` יצאה **שלילית**. זה לא תרחיש אקזוטי — אשף
> הקליטה פולט `test_started`/`result_submitted` במרחק מיקרו־שנייה **בכוונה** (call site #15).
> נתפס אמפירית על ה־dataset הזרוע: 21 intervals, החריגה הגרועה +0.917 שניות. בנוסף נוספה בדיקה
> קבועה `intervals_negative_offhours` ל־`metrics_selfcheck`, כדי שמחלקת הכשל הזאת תישאר גלויה
> ולא תדרוש שמישהו יחפש אותה.

### 3.10 `metrics_selfcheck` — 11 בדיקות

```sql
CREATE OR REPLACE FUNCTION metrics_selfcheck()
RETURNS TABLE(check_name text, value bigint, detail text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT 'open_intervals', count(*)::bigint, NULL::text
    FROM item_state_interval WHERE upper_inf(valid_range)
  UNION ALL SELECT 'drift_open', count(*)::bigint, min(item_id)::text
    FROM metrics_drift WHERE resolved_at IS NULL
  UNION ALL SELECT 'auto_opened_runs', count(*)::bigint, min(item_id)::text
    FROM item_state_event WHERE payload->>'auto_opened_run' = 'true'
  UNION ALL SELECT 'calendar_horizon_days',
       (SELECT (horizon_to - CURRENT_DATE)::bigint FROM work_calendar_version WHERE is_current),
       (SELECT horizon_to::text FROM work_calendar_version WHERE is_current)
  UNION ALL SELECT 'calendar_sanity_net_minutes',
       (SELECT COALESCE(sum(span_seconds), 0)::bigint / 60 FROM work_span
         WHERE calendar_version = current_calendar_version()
           AND work_date = (SELECT max(work_date) FROM work_span
                             WHERE calendar_version = current_calendar_version()
                               AND EXTRACT(DOW FROM work_date) BETWEEN 0 AND 4
                               AND work_date < CURRENT_DATE)),
       'expect 455 on an ordinary Sun-Thu day'
  UNION ALL SELECT 'intervals_missing_work_seconds', count(*)::bigint, 'calendar gap'
    FROM item_state_interval
    WHERE closed_at IS NOT NULL AND NOT is_terminal AND work_seconds IS NULL
  UNION ALL SELECT 'intervals_stale_calendar', count(*)::bigint, NULL
    FROM item_state_interval
    WHERE closed_at IS NOT NULL AND NOT is_terminal
      AND calendar_version <> current_calendar_version()
  UNION ALL SELECT 'runs_open_past_60d', count(*)::bigint, min(item_id)::text FROM route_run
    WHERE closed_at IS NULL AND opened_at < now() - interval '60 days'
  UNION ALL SELECT 'runs_with_zero_intervals', count(*)::bigint, NULL FROM route_run rr
    WHERE NOT EXISTS (SELECT 1 FROM item_state_interval i WHERE i.route_run_id = rr.route_run_id)
  UNION ALL SELECT 'intervals_at_station_without_station_id', count(*)::bigint, NULL
    FROM item_state_interval WHERE state_key IN ('testing','in_research') AND station_id IS NULL
  UNION ALL SELECT 'ledger_bytes', pg_total_relation_size('item_state_interval')::bigint, NULL;
$$;
```

(ירדו עם ה־cache: `dirty_buckets`, `missing_sealed_buckets`, `stale_definition_rows`. נוספה `auto_opened_runs` — סופרת transitions שנאלצו לפתוח run בעצמם (§4.2); ערך שגדל אחרי חלון הפריסה של שלב 3 מעיד על כותב לא מכוסה. `drift_open` רלוונטית עד מיגרציה B, שמחליפה את הפונקציה בגרסה בלי השורה.)

### 3.11 החלטת אבטחה: RLS יורדת מגרסה 1

**ההחלטה: לא מיישמים Row-Level Security בגרסה 1.** נבדק: `prod-deploy/db-server/.env.template:21` מגדיר `POSTGRES_USER=appuser` שהוא ה־superuser של initdb, ו־`prod-deploy/app-server/docker-compose.yml:91` בונה את `DATABASE_URL` מאותו `DB_USER`. **Superuser עוקף RLS ללא תנאי.** בנוסף, מדיניות `FOR SELECT` בלבד הייתה מפילה את ה־`INSERT` של `isi_apply_one` בתוך כל הגשת בדיקה — ומגלים רק אחרי deploy ב־USB.

**מה כן:**
1. `src/lib/routes.ts` — `{ prefix: "/api/dashboard", any: ["manager"] }` ב־`ROLE_PROTECTED` (שלב 0, בביצוע). היום כל 21 ה־endpoints פתוחים לכל session מאומת.
2. `withAuth(handler, { role: "manager" })` על כל handler בנפרד — הגנה בעומק.
3. Scope builder ברמת האפליקציה, `src/app/lib/metrics/scope.ts`, שמזריק פרדיקטים מפורשים על `customer_id` / `exited_by_worker_id` לכל אחת מ־Q1–Q8, עם בדיקה שמאשרת ש־session מסוג `tester` מקבל תשובה מצומצמת.
4. כל הפונקציות `SET search_path = pg_catalog, public`; `metrics_record` מקבלת `REVOKE` **ומיד אחריו GRANT מותנה** — אחרת מעבר עתידי ל־role לא־superuser היה מקבל 42501 בתוך כל הגשה, והחסר היה מתגלה רק אחרי נסיעת USB:

```sql
REVOKE EXECUTE ON FUNCTION metrics_record(text,bigint,text,int,int,int,int,text,text,uuid,text,smallint,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION metrics_record(text,bigint,text,int,int,int,int,text,text,uuid,text,smallint,jsonb) TO app_rw;
  END IF;
END $$;
```

RLS ל־role ייעודי `app_rw` היא החלטה פתוחה (§11.3), וה־checklist שלה כולל עכשיו במפורש: `GRANT EXECUTE` על `metrics_record` + `SELECT/INSERT/UPDATE` על טבלאות המטריקות — לא רק `DATABASE_URL` ומדיניות.

---

## 4. מסלול הכתיבה

### 4.1 למה קוד אפליקציה ולא טריגר על `item_routes`

טריגר שורה רואה diff של עמודות, לא כוונה. `1 -> 2` נפלט משלושה מסלולים שונים סמנטית (הגשה, ביטול, reaper), זהים בייט־בייט ברמת השורה. גרוע מזה: `results/route.ts` כותב את **אותה שורת `item_routes` 2–4 פעמים בטרנזקציה אחת**, ולכן טריגר `FOR EACH ROW` היה ממציא 2–4 transitions לכל הגשה. הכוונה חיה ב־handler; הכיסוי מוכח בשבוע ה־dual-run על ידי גלאי ה־drift (§3.8), שלא צריך לדעת כוונה.

### 4.2 נקודת הכניסה היחידה

> **תיקון מהאימות האמפירי (2026-08-25) — בדיקת replay לפני כל תופעת לוואי.**
> retry של לקוח על POST סיום שמגיע אחרי שה-run נסגר היה עובר דרך ה-auto-open:
> סוגר את interval ה-done עם 'reroute' ופותח run ריק — ורק אז פוגש את
> ה-ON CONFLICT. לכן `metrics_record` בודקת את `event_key` מיד אחרי הנעילה
> הפר-פריטית ומחזירה את ה-event_id הקיים לפני שהיא נוגעת ב-runs. הנעילה עושה
> סריאליזציה לכל כותבי הפריט, כך שבדוק-ואז-הכנס בטוח; ענף ה-ON CONFLICT נשאר
> כרשת ביטחון. מכוסה ברגרסיה R1 (§9.2).

```sql
CREATE OR REPLACE FUNCTION metrics_record(
  p_event_key text, p_item_id bigint, p_to_state text, p_step int,
  p_station int, p_station_type int, p_worker int, p_worker_name text,
  p_reason text, p_submit uuid DEFAULT NULL, p_kind text DEFAULT 'transition',
  p_seq smallint DEFAULT 0, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_run bigint; v_id bigint; v_at timestamptz;
        v_existing item_state_event; v_payload jsonb;
BEGIN
  -- (1) נעילה פר-פריט לפני קביעת הזמן. סדר האירועים של פריט = סדר הנעילות,
  --     ולא מרוץ בין clock_timestamp() של טרנזקציות מקבילות.
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  -- (2) clamp: clock_timestamp() הוא שעון קיר ואינו מונוטוני מובטח (NTP,
  --     host-resume). ה-max() רואה רק שורות מחויבות — הנעילה ב-(1) היא שמבטיחה
  --     שכותב מקביל כבר סיים והתחייב; בלעדיה שני כותבים היו מקבלים אותו clamp.
  v_at := GREATEST(
    clock_timestamp(),
    COALESCE((SELECT max(occurred_at) + interval '1 microsecond'
              FROM item_state_event WHERE item_id = p_item_id), clock_timestamp()));

  v_payload := p_payload;

  SELECT route_run_id INTO v_run FROM route_run
   WHERE item_id = p_item_id AND closed_at IS NULL;

  IF v_run IS NULL AND p_kind = 'transition' THEN
    -- degradation בחן במקום RAISE: פותחים run. metrics_open_run סוגר interval
    -- סופי פתוח אם יש (rework / manual_override על פריט גמור), ופריט ותיק בלי
    -- run (חלון פריסה, שורת legacy) מקבל run במקום להפיל את הגשת העובד ב-500.
    -- פתיחות "מפתיעות" מסומנות ב-payload ונספרות ב-selfcheck.
    v_run := metrics_open_run(p_item_id, v_at);
    IF p_reason NOT IN ('item_created','legacy_import','manual_override') THEN
      v_payload := v_payload || jsonb_build_object('auto_opened_run', true);
    END IF;
  END IF;

  IF v_run IS NULL THEN
    -- notes / corrections נתלים על ה-run האחרון, גם אם נסגר
    SELECT route_run_id INTO v_run FROM route_run
     WHERE item_id = p_item_id ORDER BY run_no DESC LIMIT 1;
    IF v_run IS NULL THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO item_state_event(event_key, route_run_id, item_id, occurred_at, seq, kind, to_state,
      step_no, station_id, station_type_id, worker_id, worker_name, reason, submit_id, payload)
  VALUES (p_event_key, v_run, p_item_id, v_at, p_seq, p_kind, p_to_state,
      p_step, p_station, p_station_type, p_worker, p_worker_name, p_reason, p_submit, v_payload)
  ON CONFLICT (event_key) DO NOTHING
  RETURNING event_id INTO v_id;

  IF v_id IS NULL THEN
    -- כפילות: מוודאים שזו באמת אותה עובדה ולא התנגשות מפתח.
    SELECT * INTO v_existing FROM item_state_event WHERE event_key = p_event_key;
    IF v_existing.to_state IS DISTINCT FROM p_to_state
       OR v_existing.reason IS DISTINCT FROM p_reason
       OR v_existing.item_id IS DISTINCT FROM p_item_id THEN
      RAISE EXCEPTION 'event_key collision: % already means (item %, %, %) but was asked for (item %, %, %)',
        p_event_key, v_existing.item_id, v_existing.reason, v_existing.to_state,
        p_item_id, p_reason, p_to_state;
    END IF;
    RETURN v_existing.event_id;      -- replay אמיתי
  END IF;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION metrics_record(text,bigint,text,int,int,int,int,text,text,uuid,text,smallint,jsonb) FROM PUBLIC;
```

**שלוש החלטות שקופלו כאן מהביקורת:**
1. **נעילה לפני חותמת + clamp** — בלעדיהן, שתי הגשות מקבילות על אותו פריט יכלו להפוך את סדר `occurred_at` ולהפעיל `isi_rebuild_run` מלא בתוך הגשת עובד, או להתנגש על אותה מיקרו־שנייה ולהרים "zero-length". עכשיו out-of-order חי בלתי אפשרי, והענף ב־`isi_apply_one` משרת רק backfill/corrections.
2. **auto-open במקום `RAISE 'no open route_run'`** — הכשל הישן היה תלוי־סדר־פריסה: בין apply של מיגרציה A ל־cutover של שלב 3, כל הגשה על פריט ותיק הייתה מפילה את רצפת הייצור ב־500. עכשיו הסדר בפרודקשן הוא 2 → 4 → 3 (§8), וה־auto-open הוא רשת ביטחון: לפריטים שנוצרו על ידי ה־image הישן בין ה־backfill ל־cutover; ל־`manual_override` על פריט גמור (המקרה ש־`metrics_open_run` נבנה עבורו — שבגרסה 1 היה קוד מת: הרשימה `('item_created','legacy_import','reroute')` לא כללה אותו, ואף call site לא שלח `'reroute'`); ולשורות legacy עקומות שה־reaper נוגע בהן. פתיחה מפתיעה מסומנת `auto_opened_run` ונצפית ב־selfcheck.
3. **כפילות היא לא `NULL` שקט** — התנגשות אמיתית = `RAISE` עם שני הצדדים; replay אמיתי = `event_id` הקיים.

### 4.3 חוזה ה־TypeScript ומדיניות האמון

`src/app/lib/metrics/record.ts`:

```ts
export type MetricsTransition = {
  eventKey: string;
  itemId: bigint;
  toState: "queued" | "testing" | "done" | "queued_research" | "in_research" | "unmapped" | null;
  stepNo: number;
  stationId?: number | null;
  stationTypeId?: number | null;
  workerId?: number | null;
  workerName?: string | null;
  reason: MetricsReason;
  submitId?: string | null;
  kind?: "transition" | "note" | "correction";
  seq?: number;
  payload?: Record<string, unknown>;
};

/** MUST be called with the SAME tx handle as the item_routes write. */
export async function recordTransition(
  tx: Prisma.TransactionClient, t: MetricsTransition
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ event_id: bigint }[]>`
    SELECT metrics_record(
      ${t.eventKey}, ${t.itemId}::bigint, ${t.toState}, ${t.stepNo},
      ${t.stationId ?? null}::int, ${t.stationTypeId ?? null}::int,
      ${t.workerId ?? null}::int, ${t.workerName ?? null},
      ${t.reason}, ${t.submitId ?? null}::uuid, ${t.kind ?? "transition"},
      ${t.seq ?? 0}::smallint, ${JSON.stringify(t.payload ?? {})}::jsonb
    ) AS event_id`;
  const id = rows[0]?.event_id;
  if (id == null) throw new Error(`metrics_record returned NULL for ${t.eventKey}`);
  return id;
}
```

`occurred_at` נקבע תמיד על ידי ה־DB. `QueueStartTime` / `ProcessingStartTime` מגוף הבקשה **לא נקראים לעולם** — זה לבדו מבטל את defects 4.3/4.4/4.7/4.8 הישנים.

**מדיניות האמון (`is_trusted`) — מיושבת סופית.** בגרסה 1 שני סעיפים סתרו זה את זה ("כל legacy_import הוא is_trusted=false" מול SQL של Tier-1 שכתב `true`), והכרעה לפי הכלל הישן הייתה מרוקנת את כל המסכים בבוקר ה־deploy (Q1/Q3 מסננות `is_trusted`) ומפילה את שערי ההתאמה של שלב 4 לנצח. הכלל הסופי:

| מקור | `is_trusted` | הנימוק |
|---|---|---|
| כל call site חי | `true` | הרגע נקבע על ידי ה־DB |
| **Tier-1 seed** (שלב 4) — שורות `route_run` **וגם** אירועי ה־seed, אף שה־reason הוא `legacy_import` | **`true`** | העובדות מגיעות מהשורה התפעולית החיה (`item_routes`), לא משעון של קורא. החרגת משכים מומצאים מושגת **לא** דרך דגל האמון אלא דרך `wall/work_seconds = NULL` על runs סגורים — אף זמן מומצא לא נכנס לאף ממוצע, אבל ספירות המצב נשארות מלאות ושערי ההתאמה של שלב 4 ניתנים להשגה |
| **Tier-2 import** (`legacy_import` מ־`item_route_history`, אם ירוץ) | **`false`** | רגעים ממקור עם שלוש שחיתויות ידועות |
| `correction` | `false` | רגע שסיפק אדם |

### 4.4 מפתחות אידמפוטנטיות

אין מפתח טבעי: `(item_id, route_number, route_step)` **אינו** ייחודי (סיבוב מחקר = שלוש שורות באותו צעד). המפתח בנוי ודטרמיניסטי:

| Transition | `event_key` |
|---|---|
| יצירת פריט | `item_created:{item_id}` |
| התחלת בדיקה | `test_started:{action_uuid}` |
| התחלת בדיקה סינתטית לאביזר (‎#15) | `test_started:{submit_id}:{item_id}:0` |
| שחרור על ידי משתמש | `released_by_user:{action_uuid}` |
| הגשת תוצאה (הורה או אביזר) | `{reason}:{submit_id}:{item_id}:{seq}` |
| סגירת "אין המשך" (‎#11) | `no_station_for_type:{submit_id}:{item_id}:{seq}` |
| reaper | `released_stale:{item_id}:{YYYYMMDDHH24MI}` |
| הערת מחקר | `research_note:{submit_id}:{item_id}` |
| שיוך תחנה מחדש | `station_reassigned:{submit_id}:{item_id}:{seq}` — `seq` מפורש לכל אתר, §4.5 |
| override ידני | `manual_override:{action_uuid}` |
| ייבוא legacy | `legacy:{source}:{pk}` |

> **המפתח נושא את זהות ה־transition, לא רק את הפעולה האנושית.** `submit:{submit_id}:{item_id}` היה זהה עבור ‎#9 (`queued`) ו־‎#10 (`done`) באותה טרנזקציה, ו־`ON CONFLICT DO NOTHING` היה מוחק את סגירת המסלול בשקט. **מאותה סיבה בדיוק, לשני אתרי `station_reassigned` שיורים באותה הגשה חייבים `seq` שונים** — בלי זה השיוך השני (ה־load-balancing) היה מסווג "replay אמיתי" ונבלע, גם כששני השיוכים בחרו תחנות **שונות**. גרסה 1 לא הקצתה `seq` לאתרי ‎#12 ולא כללה שורת מפתח ל־`no_station_for_type` — שניהם מתוקנים כאן.

> **`attempt_no` לעולם לא נכנס למפתח.** הוא מחושב בתוך ה־DB וה־handler לא יודע אותו; ניחוש 1 היה בולע כל התחלה שנייה של צעד אחרי שחרור reaper. הפתרון: `action_uuid` שהדפדפן מייצר ללחיצה; ל־reaper — חותמת דקה.

### 4.5 טבלת ה־call sites — כל כותב, במדויק

מספרי שורות נכונים לריפו של 2026-08-24; העוגן הסמנטי (שם הענף) הוא הקובע.

| # | קובץ:ענף | `to_state` | `reason` | `seq` | הערות |
|---|---|---|---|---|---|
| 1 | `src/app/lib/create-item.ts` (אחרי ה־INSERT ל־`item_routes`) | `queued` | `item_created` | 0 | פותח `route_run` עם snapshot של `route_steps` |
| 2 | `api/testing/start-test/route.ts` | `testing` / `in_research` | `test_started` | 0 | התחנה משורת ה־DB, לא מגוף הבקשה; `action_uuid` מהלקוח |
| 3 | `api/testing/release-test/route.ts` | `queued` / `queued_research` | `released_by_user` | 0 | |
| 4 | `api/cron/release-stale-tests/route.ts` | `queued` / `queued_research` | `released_stale` | 0 | set-based, §4.6 |
| 5 | `results/route.ts` — ענף `returnToRoute` | `queued` | `returned_to_route` | 0 | אותו `step_no`; `attempt_no` עולה אוטומטית |
| 6 | `results/route.ts` — ענף `finishRoute` | `done` | `result_submitted` | 0 | |
| 7 | `results/route.ts` — ענף 5→5 (שמירת ביניים) | — | `research_note` | 0 | `kind='note'` — לא סוגר את ה־interval |
| 8 | `results/route.ts` — ענף `sendToResearch` | `queued_research` | `sent_to_research` | 0 | הצעד לא עולה; ההסטה מסומנת |
| 9 | `results/route.ts` — מסלול רגיל (2→2, step+1) | `queued` | `result_submitted` | 0; **1 כשקדם ‎#15** | |
| 10 | `results/route.ts` — צעד אחרון (בתוך הטרנזקציה) | `done` | `result_submitted` | 1; **2 כשקדם ‎#15** | אותה טרנזקציה כמו ‎#9 |
| 11 | `results/route.ts` — **שלושת** מסלולי "אין המשך", כולם נשאבים לטרנזקציה הראשית: (א) בלוק "המסלול התקצר" (~‎:458 — ה־UPDATE שנקבר עד היום מאחורי 42703 של `finished_item`; משנמחקת `finished_item`, ה־UPDATE הופך חי **וחייב event**, אחרת returnToRoute על מסלול שקוצר ב־settings כותב `done` בלי event וה־ledger תקוע על `queued` לנצח); (ב) "אין תחנות מהסוג" (~‎:506); (ג) מסלול השגיאה (~‎:579) | `done` | `no_station_for_type` | 1; **2 כשקדם ‎#15** | גרסה 1 כיסתה רק את (ב)+(ג) |
| 12 | `results/route.ts` — ארבעת שיוכי התחנה: ‎:206 (`findBestResearchStation` במסלול sendToResearch) **seq=3**; ‎:235 (in-tx, מסלול רגיל) **seq=2**; ‎:353 (מחקר) **seq=2**; ‎:545 (load-balancing, נשאב פנימה) **seq=3** | — | `station_reassigned` | כמפורט | `kind='note'`; audit בלבד — `station_id` של פריט ממתין הוא NULL מהבנייה. אתר ‎:206 נעדר מטבלת גרסה 1 |
| 13 | `src/app/api/items/[id]/status/route.ts` | — | — | — | **מוחקים את ה־endpoint** (יתום, בלי טרנזקציה, מקור שורות הרעל `test_station_id=0`). אם דרוש override — endpoint חדש מוגן manager שפולט `manual_override`; פריט גמור נפתח מחדש דרך ה־auto-open של §4.2 |
| 14 | `results/route.ts` — `test_results` INSERT (בלתי־מותנה, רץ בכל הענפים) | — | — | — | מקבל `state_event_id` מה־event שהוחזר ב־**‎#9/#10/#6/#8/#5** — גרסה 1 השמיטה את ‎#5, ותוצאות מחקר שהוגשו עם returnToRoute (סיום המחקר הנפוץ ביותר) היו נעלמות מ־Q8. במסלול 5→5 נקשר ה־note של ‎#7 |
| 15 | `results/route.ts` — **הזוג הסינתטי לאביזרים**: כשה־`current_status` של הפריט המוגש **לפני** ה־UPDATE הוא 2 (אביזר שנבדק תחת ההורה — או כל הגשה על פריט שלא עבר start-test), נפלט תחילה `test_started` → `testing` (**seq=0**, תחנה מ־`StationID` של הבקשה, אותו `submit_id`), וכל ה־events הבאים באותה טרנזקציה מוזחים ב־+1 | `testing` | `test_started` | 0 | ראה §4.7. אומת בריפו: אשף הקליטה מגיש אביזרים בלולאה בעודם בסטטוס 2 (`Photo.tsx`, `finish()`), ואביזרים לא מופיעים בתור תחנה (`items/route.ts:86`, `parents_only`) כך ש־start-test לעולם לא נקרא עבורם — בלי ‎#15 אין לאביזר interval של `testing`, לעולם |

**כיסוי: 31 מסלולי פליטה.** היום 4, ושלושה מהם דו־משמעיים או כפולים.

### 4.6 כותב set-based — ה־reaper

```sql
WITH released AS (
  UPDATE item_routes
     SET current_status = CASE WHEN current_status = 5 THEN 4 ELSE 2 END,
         processing_start_time = NULL,
         queue_start_time = NOW()
   WHERE current_status IN (1,5)
     AND processing_start_time IS NOT NULL
     AND processing_start_time < $1::timestamp
     AND finished_at IS NULL
  RETURNING item_id, current_status, current_route_step, test_station_id
), recorded AS (
  SELECT metrics_record(
    'released_stale:'||r.item_id||':'||to_char(clock_timestamp(),'YYYYMMDDHH24MI'),
    r.item_id,
    CASE WHEN r.current_status = 4 THEN 'queued_research' ELSE 'queued' END,
    r.current_route_step, NULL, NULL, NULL, NULL, 'released_stale') AS event_id,
    r.test_station_id
  FROM released r
)
UPDATE test_stations ts SET status = 2
 WHERE ts.test_station_id = ANY (
   (SELECT array_agg(test_station_id) FROM recorded
     WHERE test_station_id IS NOT NULL)::int[]);
```

> **ה־UPDATE החיצוני צורך את `recorded` דרך `array_agg` — בכוונה, וזו נכונות ולא סגנון.** CTE מסוג SELECT אינו מובטח לריצה עד הסוף: PostgreSQL ממלא את ה־tuplestore שלו עצלנית, כפי שהשאילתה החיצונית דורשת. עם `WHERE ... IN (SELECT ...)`, תוכנית nested-loop semi-join הייתה עוצרת כל סריקה פנימית בהתאמה הראשונה — ושורות `released` שלא נדרשו **לא היו קוראות ל־`metrics_record` בכלל**: השמטה שקטה, תלוית planner, שעוברת בבדיקות ונשברת בפרודקשן — בדיוק מחלקת הכשל שה־ledger קיים לחסל. אגרגט חייב לצרוך את כל הקלט שלו, ולכן `array_agg` כופה הרצה של כל שורה. (שורת legacy עקומה — סטטוס 1/5 עם run סגור — כבר לא מפילה את ה־batch: ה־auto-open של §4.2 פותח לה run.)

Statement אחד, בתוך `runJob` (§10.1). פיזור `test_stations.status = 2` עובר לאותה טרנזקציה — היום הוא `Promise.all` **מחוץ** ל־UPDATE, כך שהרצות חופפות יכולות להחזיר תחנה ל"פנויה" בזמן שעובד מתחיל בה בדיקה.

### 4.7 אביזרים ו־`parents_only`

לכל אביזר `route_run` משלו (הם פריטים מנותבים נפרדים), כל האירועים מהגשת אשף אחת נושאים אותו `submit_id`, וכל interval נושא `unit_id`. פעולה אנושית אחת מניבה שלושה מספרים כנים: `operations` = `count(DISTINCT submit_id)`, `units` = `count(DISTINCT unit_id)`, `items` = `count(*)`.

**תיקון הטענה של גרסה 1.** גרסה 1 הבטיחה ש"משך אביזר מפסיק להיות NULL" — אבל לא הגדירה אף call site שפולט `test_started` לאביזר, כך שה־fold לא יכול היה לייצר interval של `testing` לאף אביזר, לעולם. גרסה 2 מוסיפה את ‎#15 (הזוג הסינתטי) ואומרת את האמת עד הסוף:

- ה־interval `testing` של אביזר **קיים** עכשיו: נספר ב־`steps_processed`, ותוצאת ה־pass/fail שלו נעגנת ב־Q8 דרך `test_results.state_event_id`.
- **המשך שלו ~0 מבנית** — האביזר נבדק בתוך הסשן של ההורה, ושני אירועי הזוג נפלטים מילישניות זה מזה. משך אמיתי פר־אביזר אינו ניתן למדידה. לכן **כלל §5.0(8)**: משכי `is_active_work` של אביזרים מוחרגים מכל ממוצע/אחוזון/מקסימום — אחרת אפסים סינתטיים היו מושכים כל ממוצע של תחנת קליטה מטה. המשך הכן של היחידה הוא ה־interval של ההורה. משכי **המתנה** של אביזרים נשארים — ההמתנה שלהם אמיתית.

### 4.8 ערובות טרנזקציה והבלוקים שאחרי ה־commit

הכנסת ה־event, ה־fold וכתיבת `item_routes` הם טרנזקציה אחת. ארבע תת־הטרנזקציות שרצות היום **אחרי** ה־commit של הראשית (בלוק ה־`finished_item` ‎:438-462, אין־תחנה ‎:506-509, load-balancing ‎:545-548, מסלול השגיאה ‎:579-582) נשאבות פנימה: שלוש הופכות ל־‎#11, אחת ל־‎#12 (‎:545).

ה־INSERT ל־`finished_item` **מעולם לא הצליח**: הוא נוקב ב־`queue_start_time` בעוד שהעמודה היא `q_start_time` (`prisma/schema.prisma:143`), מרים 42703 ומגלגל אחורה גם את `UPDATE item_routes ... is_finished=true` שלצדו; השגיאה נבלעת ב־`catch (finishError)`. `finished_item` נמחקת — **ולכן ה־UPDATE שהיה "מוגן" בטעות על ידי הכשל חייב כיסוי event משלו** (‎#11(א)).

### 4.9 תנאים מוקדמים — נשלחים באותו PR, אף אחד לא אופציונלי

(שלב 0 — **בביצוע עכשיו** בריפו על ידי ה־session הראשי; ההיקף כבגרסה 1.)

1. `AND current_status = <expected>` בשלושת מסלולי המחקר ב־`results/route.ts`. בלי זה exactly-once הוא משאלה.
2. חילוץ `getStationLiveCounters` אל `src/lib/station-counters.ts` **לפני** שנוגעים ב־`metrics-service.ts` — הצרכן (`api/settings/test-stations/route.ts:26`) בולע שגיאות, ולכן שבירה שם שקטה. החילוץ הוא שהופך את שכתוב ה־Q3 של שלב 5 לשינוי של קובץ אחד.
3. `research_history.item_id` → `bigint` (מיגרציה `20260824000000_fix_int4_overflow`).
4. קבצי `.bat` ב־`prod-deploy/app-server/scheduler/`, מכוונים ל־`http://localhost/api/cron/...` **דרך nginx**, ו־`8-register-tasks.ps1` עם `MultipleInstances=IgnoreNew` תחת חשבון שרואה את `CRON_SECRET`.
5. `2-check-env.ps1` דוחה את ברירת המחדל המשוגרת של `CRON_SECRET`.
6. `logging` caps על כל שירות בשני קבצי ה־compose; `TZ=Asia/Jerusalem` על `next-app`.
7. `"db:airgap-schema"` ב־`package.json` + בדיקת pre-commit; הסרת 5 npm scripts רפאים.
8. מחיקת `prod-deploy/db-server/prisma/`.
9. הסרת fallback `db push --force-reset` מ־`scripts/reset-db.ps1`.
10. `psql -v ON_ERROR_STOP=1` בכל מסלול יישום ידני (`docs/RUNBOOK_DB_SERVER.md`, `scripts/restore.sh`).

(מעבר ה־backup ל־`pg_dump -Fc` **אינו כאן** — הוא בשלב 2, יחד עם שכתוב מסלול ה־restore שבלעדיו הוא מסוכן: §10.3.)

---

## 5. מסלול הקריאה — קטלוג המטריקות

### 5.0 כללים חוצי־מערכת

1. **`is_sent` אף פעם לא ברירת מחדל שקטה — וגם לא NULL שקט.** פרמטר אחד, `scope ∈ {open_shipments, all}`, ברירת מחדל `open_shipments` ל־endpoints **חיים**, וקבוע `all` לכל endpoint **היסטורי**. הפרדיקט הוא תמיד **`s.is_sent IS NOT TRUE`** ולא `s.is_sent = false`: `shipments.is_sent` הוא `Boolean?` nullable (`prisma/schema.prisma:530`), וכותבי SQL גולמיים עוקפים את ברירת המחדל של Prisma — משלוח עם NULL היה נעלם מכל מסך חי, בדיוק מחלקת הפילטר־השקט שהכלל הזה בא לחסל. `showSent` נמחק.
2. **"טופל" (processed) פירושו דבר אחד**: interval פעיל־עבודה שנסגר עם `exit_reason NOT IN ('released_by_user','released_stale')` — בדיקה שהסתיימה בתוצאה מתועדת, בין אם המשיכה, הוסטה למחקר או חזרה ממנו. סיומי מסלול הם `route_run.closed_at` ונקראים `finished_runs`.
3. **"זמן תור ממוצע" מתפצל לשתי מטריקות בשמות שונים**: `standing_queue_age_*` (עכשיו מינוס כניסה, על ממתינים כרגע — מצב) ו־`wait_*` (intervals `queued` שנסגרו — flow). לעולם לא חולקות שם עמודה.
4. **יום עסקי = `(ts AT TIME ZONE 'Asia/Jerusalem')::date`**, נכתב פעם אחת בזמן ה־fold. אף endpoint לא קורא ל־`toISOString().split('T')[0]`. `src/app/lib/date-periods.ts` נמחק.
5. **`calculateWorkDuration` נמחק** ושתי נקודות הקריאה שלו מופנות ל־`work_seconds_between`. הוא מקודד 15:30 (ה־seed אומר 15:35), מתעלם מהפסקת הצהריים, וסופר שישי־שבת כימי עבודה.
6. **`unit_id` הוא מפתח de-duplication חוקי רק כשמפתח הקיבוץ קבוע בתוך יחידה.** מותר: customer, shipment. אסור: item_type, station, step.
7. **אין gap-filling בגרירת ערך קדימה.**
8. **משכי עבודה של אביזרים מוחרגים מסטטיסטיקות משך.** ה־interval `testing` של אביזר הוא זוג סינתטי (§4.7) ומשכו ~0; כל ממוצע/אחוזון/מקסימום של משך `is_active_work` נושא `FILTER (WHERE NOT is_accessory)`. ספירות (`steps_processed`, pass/fail) כוללות אביזרים; משכי המתנה כוללים אביזרים.
9. **כל שאילתת `@>`/`&&` נושאת `NOT i.is_terminal`** (יישור אינדקס־פרדיקט, §3.6). "הושלמו" נספרים מסגירות `route_run` בלבד (§5.3ב).
10. **סימטריית שני השעונים:** כל עמודת משך מופיעה כזוג `_wall_` / `_work_` — ב־Q3, Q4, Q5, Q8 — בלי יוצא מהכלל.

### 5.1 בלוק הפילטרים — נכתב פעם אחת, `src/app/lib/metrics/filters.ts`

כל שאילתה — Q1, Q2, Q4, Q5, Q6, Q7, Q8 — משתמשת **באותו טקסט**. "הגדרה אחת לכל מטריקה" נשברת אם סט הפילטרים מוקלד מחדש לכל query.

```sql
-- $c customer, $sh shipment, $it item_type, $st station, $sty station_type,
-- $w worker, $ser serial, $acc parents_only, $scope 'all'|'open_shipments'
  AND ($c::int   IS NULL OR i.customer_id     = $c)
  AND ($sh::int  IS NULL OR i.shipment_id     = $sh)
  AND ($it::int  IS NULL OR i.item_type_id    = $it)
  AND ($st::int  IS NULL OR i.station_id      = $st)
  AND ($sty::int IS NULL OR i.station_type_id = $sty)
  AND ($w::int   IS NULL OR i.exited_by_worker_id = $w)
  AND ($ser::text IS NULL OR i.serial_no      = $ser)
  AND (NOT $acc::boolean OR i.is_accessory = false)
  AND ($scope::text = 'all'
       OR EXISTS (SELECT 1 FROM shipments s WHERE s.id = i.shipment_id AND s.is_sent IS NOT TRUE))
```

ב־Q2 הבלוק חי **בתוך תנאי ה־`LEFT JOIN`** (לא ב־WHERE) — כדי שימי גריד בלי התאמות ישרדו כאפסים ולא ייעלמו מהסדרה.

### 5.2 Q1 — התפלגות מצבים ברגע נתון (POINT-IN-TIME, אוכלוסייה פעילה)

```sql
SELECT ms.state_key, ms.label_he,
       count(*)                  AS items,
       count(DISTINCT i.unit_id) AS units,
       round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1) AS pct
FROM   item_state_interval i
JOIN   metric_state ms ON ms.state_key = i.state_key
WHERE  i.valid_range @> $1::timestamptz
  AND  NOT i.is_terminal          -- אוכלוסייה פעילה בלבד; מיישר גם את predicate האינדקס
  AND  i.is_trusted
  /* + בלוק הפילטרים של §5.1 */
GROUP BY ms.state_key, ms.label_he, ms.sort_order
ORDER BY ms.sort_order;
```

> **Q1 היא תמיד אוכלוסייה פעילה.** הווריאנט `$12=false` של גרסה 1 (ספירת `done` דרך `@>`) בוטל: `done` הוא interval פתוח לנצח, אחרי 18 חודשים יש ~75,000 גמורים מול ~300 באוויר, הגרף הופך לעיגול אפור של 99.6% "הושלם" — והשאילתה סורקת את כל ההיסטוריה בלי אינדקס (ה־GiST חלקי). `finished_cumulative` הוא מטריקה נפרדת בשם נפרד, מ־`route_run` (§5.3ב).

### 5.3 Q2 — סדרת point-in-time + הסדרה המצטברת

**Q2א — הסדרות הפעילות.** הרשת נבנית מתאריכים אזרחיים; רגע הדגימה: 12:00 שעון ישראל.

```sql
WITH grid AS (
  -- d הוא timestamptz (האוברלואוד של generate_series על date), ולכן חובה ::date
  -- לפני השרשור: d::text היה '2026-03-25 00:00:00+00' והביטוי היה מרים 22007
  -- על כל הרצה. אומת אמפירית על ה-postgres:16-alpine של הפרויקט.
  SELECT (d::date::text || ' 12:00')::timestamp AT TIME ZONE 'Asia/Jerusalem' AS at_ts,
         d::date AS business_day
  FROM generate_series($1::date, $2::date, interval '1 day') d
)
SELECT g.business_day, s.state_key, count(i.interval_id) AS items
FROM grid g
CROSS JOIN (SELECT * FROM metric_state WHERE NOT is_terminal) s
LEFT JOIN item_state_interval i
       ON i.state_key = s.state_key
      AND NOT i.is_terminal            -- מיושר עם isi_range_live
      AND i.valid_range @> g.at_ts
      AND i.is_trusted
      /* + בלוק הפילטרים של §5.1 — בתוך ה-ON, כדי שימי-אפס ישרדו */
GROUP BY g.business_day, s.state_key, s.sort_order
ORDER BY g.business_day, s.sort_order;
```

> הרשת נבנית מ־`generate_series($1::date, $2::date, interval '1 day')` ולא מ־`timestamptz + interval '1 day'` — אומת על 16.11: הצורה הישנה החזירה 5 נקודות במקום 6 עבור 2026-03-25..2026-03-30 (זליגת DST), והצורה המתוקנת כאן (עם `d::date::text`) אומתה אמפירית ומחזירה 6 נקודות עם טיפול DST נכון (10:00Z ואז 09:00Z).

**Q2ב — `finished_cumulative`: סגירות `route_run`, לא דגימת intervals.**

```sql
WITH grid AS (
  SELECT d::date AS business_day
  FROM generate_series($1::date, $2::date, interval '1 day') d
), closures AS (
  SELECT business_date(rr.closed_at) AS bd, count(*) AS n
  FROM route_run rr
  WHERE rr.closed_at IS NOT NULL AND rr.is_trusted
    /* + פילטרים על ממדי route_run: customer_id / shipment_id / item_type_id */
  GROUP BY 1
), base AS (
  SELECT COALESCE(sum(n), 0) AS n0 FROM closures WHERE bd < $1::date
)
SELECT g.business_day,
       (SELECT n0 FROM base)
       + COALESCE(sum(c.n) OVER (ORDER BY g.business_day), 0) AS finished_cumulative
FROM grid g
LEFT JOIN closures c ON c.bd = g.business_day
ORDER BY g.business_day;
```

> **ההגדרה היחידה של "הושלמו".** עוגן הסגירה הוא `route_run.closed_at` (אינדקס חלקי `route_run_closed`; ~75k שורות/שנה — הסריקה זולה). זו צורה entry-anchored אמיתית: סגירה נספרת פעם אחת ביום שבו קרתה, אדיטיבית, ואינה תלויה ברגע דגימה — בניגוד לצורת ה־`@>` של גרסה 1 שגם דגמה רק עד צהריים וגם סרקה את כל העבר בכל נקודת גריד. הסדרה הזו משרתת גם את דיאלוגי ההיסטוריה של משלוח/לקוח/סוג פריט (שלב 6).

### 5.4 Q3 — לוח התחנות החי (מחליף את `station_live_counters` והטריגר שלה)

```sql
SELECT st.test_station_id, TRIM(st.test_station_desc) AS station_name,
       TRIM(sty.test_type_desc)                       AS station_type_name,
       count(*) FILTER (WHERE i.state_key = 'testing')     AS in_test,
       count(*) FILTER (WHERE i.state_key = 'in_research') AS in_research,
       -- התור שייך לסוג, לא לתחנה. מדווח בכנות.
       (SELECT count(*) FROM item_state_interval q
         WHERE q.valid_range @> now() AND NOT q.is_terminal AND q.state_key = 'queued'
           AND q.station_type_id = st.test_station_type_id)          AS shared_type_queue,
       (SELECT avg(EXTRACT(EPOCH FROM (now() - lower(q.valid_range))))/60
          FROM item_state_interval q
         WHERE q.valid_range @> now() AND NOT q.is_terminal AND q.state_key = 'queued'
           AND q.station_type_id = st.test_station_type_id)          AS standing_queue_age_wall_min,
       (SELECT avg(work_seconds_between(lower(q.valid_range), now()))/60
          FROM item_state_interval q
         WHERE q.valid_range @> now() AND NOT q.is_terminal AND q.state_key = 'queued'
           AND q.station_type_id = st.test_station_type_id)          AS standing_queue_age_work_min,
       (SELECT count(*) FROM item_state_interval q
         WHERE q.valid_range @> now() AND NOT q.is_terminal AND q.state_key = 'queued_research') AS research_pool_queue,
       avg(EXTRACT(EPOCH FROM (now() - lower(i.valid_range))))
         FILTER (WHERE NOT i.is_accessory)/60                        AS active_test_age_wall_min,
       avg(work_seconds_between(lower(i.valid_range), now()))
         FILTER (WHERE NOT i.is_accessory)/60                        AS active_test_age_work_min
FROM test_stations st
JOIN test_stations_type sty ON sty.test_station_type_id = st.test_station_type_id
LEFT JOIN item_state_interval i
       ON i.station_id = st.test_station_id
      AND i.valid_range @> now() AND NOT i.is_terminal
GROUP BY st.test_station_id, st.test_station_desc, sty.test_type_desc, st.test_station_type_id;
```

> **צורת ה־probe של Q3 — `@> now()` ולא `upper_inf`, בכוונה.** intervals סופיים (`done`) נשארים
> פתוחים לנצח, ולכן "כל הפתוחים" הוא O(כל הפריטים שהסתיימו אי־פעם) — ‎~330k בשנה 3, לא מאות.
> ‎`valid_range @> now() AND NOT is_terminal` שקול סמנטית ל־`upper_inf` עבור כל מצב לא־סופי,
> ומוגש מ־`isi_range_live` (‎~מאות שורות חיות). **Q7 נשאר על `upper_inf` בכוונה**: ה־JOIN שלו
> עובר דרך `isi_run` (‏lookup פר־`route_run`, לא סריקת הסט הפתוח) והוא **צריך** את שורות ה־`done`
> לספירת ההשלמה — `NOT is_terminal` שם היה מאפס את `items_finished`.

> `standing_queue_age_*` נמדד על אוכלוסיית **הממתינים לפי סוג התחנה** — לא על הבדיקות הרצות (הבאג של ה־spec המקורי: תחנה עם 22 ממתינים בממוצע 47 דקות ושתי בדיקות בנות 6–9 דקות הציגה 7.5). `active_test_age` היא מטריקה **חדשה**, ועכשיו — בהתאם לכלל הסימטריה — בשני שעונים. סריקות ה"חיים" של Q3 רצות דרך `isi_range_live` על ~מאות שורות לא־סופיות (הסט ה"פתוח" המלא, כולל `done`, הוא ~330k בשנה 3 — ולכן ה־probe הוא `@> now() AND NOT is_terminal`, לא `upper_inf`); שתי המוסכמות "בהמתנה" (`{2}` מול `{2,4}`) הן הטלות של דגלי `metric_state` וניתנות סוף־סוף ליישוב. **`src/lib/station-counters.ts` נכתב מחדש על Q3 בשלב 5** — עבודה מפורשת עם בדיקת parity, לא הנחה (בגרסה 1 שלב 8 טען "שכבר הוסב" אבל אף שלב לא ביצע).

### 5.5 Q4 — FLOW ו־DURATION, מקובץ לפי כל ממד

```sql
SELECT i.close_business_date AS d,
       i.station_id, TRIM(st.test_station_desc) AS station_name,
       count(*) FILTER (WHERE i.exit_reason NOT IN ('released_by_user','released_stale')) AS steps_processed,
       count(*) FILTER (WHERE i.exit_reason = 'result_submitted')            AS steps_completed,
       count(*) FILTER (WHERE i.exit_reason = 'sent_to_research')            AS diverted_to_research,
       count(*) FILTER (WHERE i.exit_reason = 'returned_to_route')           AS returned_from_research,
       count(*) FILTER (WHERE i.exit_reason IN ('released_by_user','released_stale')) AS abandonments,
       count(DISTINCT i.unit_id) FILTER (WHERE i.exit_reason NOT IN ('released_by_user','released_stale')) AS units_processed,
       count(DISTINCT ev.submit_id)                                          AS operations,
       count(*) FILTER (WHERE i.entry_reason = 'returned_to_route')          AS rework_steps,
       count(*) FILTER (WHERE i.entry_reason IN ('released_by_user','released_stale')) AS restarts_after_abandonment,
       count(*) FILTER (WHERE i.entry_reason = 'manual_override')            AS manual_entries,
       -- משכים: זוג מלא לכל מדד, אביזרים מוחרגים (כלל §5.0(8))
       count(*) FILTER (WHERE NOT i.is_accessory)                            AS n,
       avg(i.wall_seconds)     FILTER (WHERE NOT i.is_accessory)/60          AS avg_wall_min,
       avg(i.work_seconds)     FILTER (WHERE NOT i.is_accessory)/60          AS avg_work_min,
       avg(i.offhours_seconds) FILTER (WHERE NOT i.is_accessory)/60          AS avg_offhours_min,
       sum(i.wall_seconds)     FILTER (WHERE NOT i.is_accessory)/3600        AS wall_hours,
       sum(i.work_seconds)     FILTER (WHERE NOT i.is_accessory)/3600        AS work_hours,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY i.wall_seconds)
         FILTER (WHERE NOT i.is_accessory)/60                                AS p95_wall_min,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY i.work_seconds)
         FILTER (WHERE NOT i.is_accessory)/60                                AS p95_work_min,
       max(i.wall_seconds) FILTER (WHERE NOT i.is_accessory)/60              AS max_wall_min,
       max(i.work_seconds) FILTER (WHERE NOT i.is_accessory)/60              AS max_work_min
FROM   item_state_interval i
JOIN   metric_state ms ON ms.state_key = i.state_key AND ms.is_active_work
LEFT   JOIN test_stations st ON st.test_station_id = i.station_id
LEFT   JOIN item_state_event ev ON ev.event_id = i.exit_event_id
WHERE  i.close_business_date BETWEEN $1::date AND $2::date
  AND  i.closed_at IS NOT NULL AND i.is_trusted AND NOT i.is_terminal
  /* + בלוק הפילטרים של §5.1 */
GROUP BY 1, 2, 3 ORDER BY 1, 2;
```

מחליפים את `i.station_id` ב־`i.customer_id`, `i.shipment_id`, `i.item_type_id`, `i.exited_by_worker_id`, `i.station_type_id` או `(i.item_type_id, i.step_no)` לממדים אחרים; את `ms.is_active_work` ב־`ms.is_waiting` לזמני המתנה (ואז מסירים את `NOT is_accessory` מהמשכים — המתנת אביזר אמיתית).

> **עוגן הקיבוץ הוא `close_business_date`** — interval שנפתח חמישי ונסגר ראשון הוא קוץ של יום ראשון. **"טופל" ≠ `result_submitted` בלבד** — interval של `in_research` נסגר כמעט תמיד ב־`returned_to_route`; תחנת מחקר עם 30 טיפולים בשבוע (27 חזרות) הייתה מציגה 3. **rework נגזר מ־`entry_reason`, לא מ־`attempt_no`** — ה־reaper מחזיר לתור כל בדיקה של 30+ דקות, ו־`attempt_no` היה נותן 100% rework בתחנות של 45 דקות. **הסימטריה מלאה**: גרסה 1 נתנה p95 רק ל־work ו־max רק ל־wall — עכשיו זוג מלא לכל מדד (הפער היה בדיוק "זמין בשם אחד, נעלם בשני" שהתוכנית באה לחסל).

### 5.6 Q5 — KPI חתוך־חלון, כולל פריטים באוויר

מחליפה את `getKpiStatsFiltered` (שמצרפת היום את `item_route_history` על התחנה **הנוכחית** בלבד — הטיה שגדלה עם אורך המסלול).

```sql
WITH win AS (SELECT tstzrange($1::timestamptz, $2::timestamptz, '[)') AS w),
clipped AS (
  SELECT i.*, ms.is_waiting, ms.is_active_work, ms.is_research,
         GREATEST(lower(i.valid_range), lower(w.w))                     AS lo,
         LEAST(COALESCE(i.closed_at, now()), upper(w.w))                AS hi
  FROM item_state_interval i
  CROSS JOIN win w
  JOIN metric_state ms ON ms.state_key = i.state_key
  WHERE i.valid_range && w.w AND i.is_trusted AND NOT i.is_terminal
  /* + בלוק הפילטרים של §5.1 */
)
SELECT
  -- FILTER מיד אחרי האגרגט; החלוקה ב-60 אחריו. הצורה ההפוכה
  -- (avg(...)/60 FILTER (...)) היא שגיאת syntax — 42601, אומת על PG16.
  avg(EXTRACT(EPOCH FROM (hi-lo)))  FILTER (WHERE is_waiting) / 60     AS avg_wait_wall_min,
  avg(work_seconds_between(lo,hi))  FILTER (WHERE is_waiting) / 60     AS avg_wait_work_min,
  count(*)                          FILTER (WHERE is_waiting)          AS wait_n,
  avg(EXTRACT(EPOCH FROM (hi-lo)))  FILTER (WHERE is_active_work AND NOT is_accessory) / 60 AS avg_busy_wall_min,
  avg(work_seconds_between(lo,hi))  FILTER (WHERE is_active_work AND NOT is_accessory) / 60 AS avg_busy_work_min,
  count(*)                          FILTER (WHERE is_active_work AND NOT is_accessory)      AS busy_n,
  avg(EXTRACT(EPOCH FROM (hi-lo)))  FILTER (WHERE is_research AND is_waiting) / 60          AS avg_research_wait_wall_min,
  avg(work_seconds_between(lo,hi))  FILTER (WHERE is_research AND is_waiting) / 60          AS avg_research_wait_work_min,
  avg(EXTRACT(EPOCH FROM (hi-lo)))  FILTER (WHERE is_research AND is_active_work) / 60      AS avg_research_wall_min,
  avg(work_seconds_between(lo,hi))  FILTER (WHERE is_research AND is_active_work) / 60      AS avg_research_work_min,
  sum(EXTRACT(EPOCH FROM (hi-lo)) - COALESCE(work_seconds_between(lo,hi),0))/60             AS offhours_min,
  count(DISTINCT unit_id)                                                                   AS units_touched
FROM clipped;
```

היום פילטר `workerId` גורם ל־endpoint הזה להחזיר **אפסים עם HTTP 200** (פרדיקט `worker_id` על טבלה בלי העמודה; ה־catch מחזיר `defaultKpis`). כאן `exited_by_worker_id` היא עמודה על ה־interval. מטריקות המחקר קיבלו את זוג ה־wall החסר (סימטריה, §5.0(10)).

### 5.7 Q6 — הצעדים האיטיים ביותר

```sql
WITH cand AS (
  SELECT i.*
  FROM item_state_interval i
  JOIN metric_state ms ON ms.state_key = i.state_key AND ms.is_active_work
  WHERE i.close_business_date BETWEEN $1::date AND $2::date
    AND i.closed_at IS NOT NULL AND i.is_trusted
    AND NOT i.is_accessory          -- כלל §5.0(8): משך אביזר סינתטי
    /* + בלוק הפילטרים של §5.1 */
  ORDER BY i.work_seconds DESC NULLS LAST
  LIMIT 500
)
SELECT c.item_id, c.serial_no, it.makat, it.model, c.step_no, c.attempt_no, c.entry_reason,
       TRIM(st.test_station_desc) AS station_name, c.exited_by_worker_name AS worker_name,
       q.wall_seconds/60 AS queue_wall_min, q.work_seconds/60 AS queue_work_min,
       c.wall_seconds/60 AS test_wall_min,  c.work_seconds/60 AS test_work_min,
       (COALESCE(q.wall_seconds,0) + c.wall_seconds)/60 AS total_wall_min,
       (COALESCE(q.work_seconds,0) + c.work_seconds)/60 AS total_work_min
FROM cand c
JOIN items it ON it.item_id = c.item_id
LEFT JOIN test_stations st ON st.test_station_id = c.station_id
LEFT JOIN LATERAL (
  SELECT p.wall_seconds, p.work_seconds FROM item_state_interval p
  WHERE p.item_id = c.item_id AND p.closed_at = lower(c.valid_range)
) q ON true
ORDER BY total_work_min DESC NULLS LAST
LIMIT LEAST($3, 100);
```

ה־`LATERAL` מדויק כי ה־`EXCLUDE` constraint מבטיח שה־interval הקודם מסתיים בדיוק היכן שזה מתחיל (`isi_item_time` משרת אותו). ה־CTE `cand` מצמצם ל־500 **לפני** ה־LATERAL.

### 5.8 Q7 — התקדמות ישות (משלוח / לקוח / סוג פריט)

```sql
SELECT s.id AS shipment_id, TRIM(s.shipment_code) AS shipment_code,
       TRIM(c.customer_name) AS customer_name, s.shipment_date,
       s.amount AS declared_amount,
       count(DISTINCT rr.route_run_id)                                         AS routed_runs,
       count(DISTINCT rr.unit_id)                                              AS routed_units,
       count(DISTINCT rr.route_run_id) FILTER (WHERE rr.closed_at IS NOT NULL) AS finished_runs,
       count(*) FILTER (WHERE i.state_key = 'queued')          AS in_queue,
       count(*) FILTER (WHERE i.state_key = 'testing')         AS in_test,
       count(*) FILTER (WHERE i.state_key = 'queued_research') AS waiting_research,
       count(*) FILTER (WHERE i.state_key = 'in_research')     AS in_research,
       count(*) FILTER (WHERE i.state_key = 'done')            AS finished,
       -- השלמה נמדדת מול המדגם המנותב, לעולם לא מול shipments.amount
       round(100.0 * count(DISTINCT rr.route_run_id) FILTER (WHERE rr.closed_at IS NOT NULL)
             / NULLIF(count(DISTINCT rr.route_run_id), 0), 1)                  AS completion_pct,
       -- כיסוי הוא מספר נפרד בשם נפרד
       round(100.0 * count(DISTINCT rr.unit_id) / NULLIF(s.amount, 0), 1)      AS coverage_pct,
       -- turnaround של מסלול פריט, בתוך המשלוח (שם מדויק — לא "קליטה-עד-שילוח")
       avg(EXTRACT(EPOCH FROM (rr.closed_at - rr.opened_at)))/60               AS avg_route_turnaround_wall_min,
       avg(work_seconds_between(rr.opened_at, rr.closed_at))/60                AS avg_route_turnaround_work_min,
       -- קליטה-עד-שילוח אמיתי: רגע השילוח חי על shipments (נכתב ב-shipment-history/route.ts:81),
       -- לא על route_run — משלוח יוצא הרבה אחרי שה-run האחרון נסגר. אין צורך ב-event:
       -- שתי העמודות על הטבלה. shipment_date הוא Timestamp(6) נטול-אזור (§7.1) — המרה מפורשת.
       EXTRACT(EPOCH FROM (s.finished_at - (s.shipment_date AT TIME ZONE 'UTC')))/60 AS ship_turnaround_wall_min,
       work_seconds_between((s.shipment_date AT TIME ZONE 'UTC'), s.finished_at)/60  AS ship_turnaround_work_min
FROM shipments s
JOIN customers c ON c.id = s.customer_id
LEFT JOIN route_run rr ON rr.shipment_id = s.id
LEFT JOIN item_state_interval i
       ON i.route_run_id = rr.route_run_id AND upper_inf(i.valid_range)
WHERE ($1::text = 'all' OR s.is_sent IS NOT TRUE)
GROUP BY s.id, s.shipment_code, c.customer_name, s.shipment_date, s.amount, s.finished_at;
```

`shipments.amount` הוא מספר מלאי ו**לעולם לא** מכנה של בדיקות. לגרסה לפי **סוג פריט**: קיבוץ לפי `rr.item_type_id` ו־`item_type_total_items = count(DISTINCT rr.route_run_id)` — **לא** `unit_id` (אביזרים חולקים `unit_id` עם ההורה אך נושאים סוג משלהם; `unit_id` שם היה undercount פי 4). `count(*) FILTER (state_key='done')` כאן כן חוקי — הוא רץ על ה־intervals הפתוחים של runs שכבר צורפו דרך `route_run`, לא דרך probe `@>` גלובלי.

> **תיקון שמות מהביקורת:** גרסה 1 מיפתה את "קליטה-עד-שילוח של משלוח" אל `avg_turnaround_*` — שמודד turnaround של **מסלול פריט** (`opened_at→closed_at`), בעוד רגע השילוח האמיתי (`is_sent`/`finished_at`) נכתב רק ב־`src/app/api/shipment-history/route.ts:81` ולא הופיע בשום עמודה. עכשיו שני המדדים קיימים בשמות נפרדים: `avg_route_turnaround_*` (פריט) ו־`ship_turnaround_*` (משלוח, מחושב בזמן קריאה מ־`shipments`).

### 5.9 Q8 — איכות, rework ו־turnaround של מחקר

```sql
SELECT i.close_business_date AS d, i.station_type_id,
       count(tr.*)                                                 AS results_recorded,
       count(*) FILTER (WHERE tr.passed)                           AS passed,
       count(*) FILTER (WHERE tr.passed = false)                   AS failed,
       round(100.0*count(*) FILTER (WHERE tr.passed = false)/NULLIF(count(tr.*),0),1) AS fail_pct,
       count(*) FILTER (WHERE i.entry_reason = 'returned_to_route') AS rework_steps,
       round(100.0*count(*) FILTER (WHERE i.entry_reason = 'returned_to_route')
             /NULLIF(count(*),0),1)                                 AS rework_pct,
       (SELECT avg(rq.wall_seconds)/60 FROM item_state_interval rq
         WHERE rq.route_run_id = ANY(array_agg(i.route_run_id))
           AND rq.state_key = 'queued_research' AND rq.closed_at IS NOT NULL) AS avg_research_wait_wall_min,
       (SELECT avg(rq.work_seconds)/60 FROM item_state_interval rq
         WHERE rq.route_run_id = ANY(array_agg(i.route_run_id))
           AND rq.state_key = 'queued_research' AND rq.closed_at IS NOT NULL) AS avg_research_wait_work_min,
       (SELECT avg(rw.wall_seconds)/60 FROM item_state_interval rw
         WHERE rw.route_run_id = ANY(array_agg(i.route_run_id))
           AND rw.state_key = 'in_research' AND rw.closed_at IS NOT NULL)     AS avg_research_wall_min,
       (SELECT avg(rw.work_seconds)/60 FROM item_state_interval rw
         WHERE rw.route_run_id = ANY(array_agg(i.route_run_id))
           AND rw.state_key = 'in_research' AND rw.closed_at IS NOT NULL)     AS avg_research_work_min
FROM item_state_interval i
JOIN metric_state ms ON ms.state_key = i.state_key AND ms.is_active_work
LEFT JOIN test_results tr ON tr.state_event_id = i.exit_event_id
WHERE i.close_business_date BETWEEN $1::date AND $2::date
  AND i.closed_at IS NOT NULL AND i.is_trusted
  /* + בלוק הפילטרים של §5.1 */
GROUP BY 1, 2;
```

ה־join `tr.state_event_id = i.exit_event_id` נשען על call site ‎#14 **כולל ‎#5** (§4.5): interval של `in_research` נסגר כמעט תמיד ב־`returned_to_route`, ו־`test_results` של אותה הגשה חייב להצביע על אירוע ‎#5 — אחרת התוצאה הדומיננטית של מחקר נעלמת מהעמודות האלה. מטריקות המחקר קיבלו את זוגות ה־wall (סימטריה). כרטיס ה־KPI "נכשל / החזרות" מציג היום `"-"` קשיח בעוד `test_results.passed` נכתב ואיש לא קורא אותו.

### 5.10 מיפוי מלא: מזהה מטריקה → שאילתה → ביטוי

**מקרא:** Q1 point-in-time · Q2א סדרת PIT · Q2ב סדרה מצטברת (route_run) · Q3 לוח חי · Q4 flow/duration · Q5 KPI חתוך־חלון · Q6 צעדים איטיים · Q7 התקדמות ישות · Q8 איכות. **כל שורה ממופה לשאילתת ledger בלבד — אין מקור שני.**

#### משפחת KPI (`getKpiStatsFiltered`)

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `kpi_avg_queue_seconds` | Q5 | `avg(EXTRACT(EPOCH FROM (hi-lo))) FILTER (WHERE is_waiting)` — כולל עכשיו כל צעד, לא רק את התחנה הנוכחית |
| `kpi_avg_processing_seconds` | Q5 | אותו דבר עם `is_active_work AND NOT is_accessory` |
| `kpi_avg_queue_time_minutes` / `_processing_time_minutes` | Q5 | `/60` |
| **חדש** `kpi_avg_queue_work_minutes` / `_processing_work_minutes` | Q5 | `work_seconds_between(lo,hi)/60` |
| **חדש** `kpi_offhours_minutes` | Q5 | `offhours_min` — "כמה מהעיכוב היה לוח השנה" |
| `kpi_treated_count` | route_run | `count(*) WHERE closed_at BETWEEN $1 AND $2` (אינדקס `route_run_closed`) |
| `kpi_items_currently_in_queue` | Q1 | `count(*) FILTER (ms.is_waiting)` |
| `kpi_items_currently_in_test` | Q1 | `count(*) FILTER (ms.is_active_work)` |
| `kpi_busiest_station_busy_seconds` | Q4 לפי station | `sum(work_seconds)` עם `is_active_work` |
| `kpi_busiest_station_wait_seconds` | Q4 לפי station_type | `sum(work_seconds)` עם `is_waiting` |
| `kpi_busiest_station_workload_score` | — | **נמחק.** מוחלף ב־`work_hours`, `wait_work_hours`, `steps_processed` |
| `kpi_busiest_station_id` / `_name` | Q4 | `ORDER BY work_hours DESC LIMIT 1` |
| `kpi_busiest_station_count` | — | **נמחק** (היה `ROUND(busy_sec + 0.3*wait_sec)` מוצג כ"עיבדה N פריטים") |

#### משפחת עומס תחנות

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `station_items_in_queue` | Q3 | `shared_type_queue` — לפי **סוג** תחנה, בכנות |
| `station_items_in_test` | Q3 | `count(*) FILTER (state_key='testing')` |
| **חדש** `station_items_in_research` | Q3 | `count(*) FILTER (state_key='in_research')` |
| **חדש** `research_pool_queue` | Q3 | ספירה אחת; אין double-count בין תחנות מחקר |
| `station_avg_current_queue_age_minutes` | Q3 | שם חדש: `standing_queue_age_wall_min` / `_work_min` |
| **חדש** `active_test_age_wall_min` / `_work_min` | Q3 | גיל הבדיקות הרצות, שני שעונים |
| `station_total_processed_in_period` | Q4 | `steps_processed` |
| **חדש** `station_units_processed` / `station_operations` | Q4 | `count(DISTINCT unit_id)` / `count(DISTINCT submit_id)` |
| **חדש** `station_abandonments` | Q4 | `exit_reason IN ('released_by_user','released_stale')` |
| **חדש** `station_utilisation_pct` | Q5 לפי station | `sum(work_seconds_between(lo,hi)) FILTER (is_active_work)` חלקי `work_seconds_between($1,$2)` — חישוב בזמן קריאה, אין cache |
| `station_name`, `station_type_name` | Q3/Q4 | `TRIM(...)` |

#### התפלגות סטטוסים

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `status_dist_count` | Q1 | `count(*)` — אוכלוסייה פעילה, באמת point-in-time |
| **חדש** `finished_cumulative` | **Q2ב** | סכימה רצה של סגירות `route_run` — לא `@>` על `done`, לא `entries` מ־cache |
| `status_dist_percentage` | Q1 | window function, ב־SQL |
| `status_name` | Q1 | `metric_state.label_he`; `status-names.ts` נמחק |
| סדרת ההיסטוריה | Q2א+Q2ב | הפילטרים חלים על כל נקודה (בתוך ה־`LEFT JOIN ON`), לא רק על "היום" |

#### מעקב משלוחים

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `shipment_total_items` | Q7 | `declared_amount` (מלאי, לעולם לא מכנה) |
| `shipment_items_in_queue` / `_in_test` / `_waiting_for_research` / `_in_research` / `_finished` | Q7 | חמישה `FILTER` על אותה סריקת intervals פתוחים |
| `shipment_items_in_routes` | Q7 | `routed_runs` |
| `shipment_completion_percentage` | Q7 | `finished_runs / routed_runs` — מכנה אחד, בכל מקום |
| `shipment_items_in_routes_percentage` | Q7 | שם חדש `coverage_pct` = `routed_units / amount` |
| **חדש** `shipment_route_turnaround_wall/work_minutes` | Q7 | `avg_route_turnaround_*` — turnaround מסלול הפריט |
| **חדש** `shipment_ship_turnaround_wall/work_minutes` | Q7 | `ship_turnaround_*` — קליטה־עד־שילוח אמיתי, מ־`shipments` |
| דיאלוג ההיסטוריה | Q2א (פילטר shipment) + Q2ב | מחליף את `shipment_snapshots{,_monthly}` |
| `completion_history_percentage` | Q2ב + Q7 | מחליף את `stats/completion-history` שנופל על `shipmentId` |

#### מעקב סוגי פריט

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `item_type_total_items` | Q7 לפי `item_type_id` | **מוגדר מחדש** ל־`count(DISTINCT rr.route_run_id)` |
| `item_type_items_in_*` | Q7 | חמישה `FILTER` |
| `item_type_completion_percentage` | Q7 | `finished_runs / routed_runs` — אותה נוסחה כמו משלוחים |
| דיאלוג ההיסטוריה | Q2א+Q2ב (פילטר item_type) | מחליף את `item-types/[id]/history` שמחזיר HTTP 500 בכל בקשה |

#### ביצועי לקוחות

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `customer_total_items` | Q7 לפי `customer_id` | `count(DISTINCT rr.unit_id)` |
| `customer_items_in_*` | Q7 | חמישה `FILTER` |
| `customer_success_percentage` | Q7 | שם חדש `completion_pct`; "הצלחה" אמיתית היא `fail_pct` ב־Q8 |
| `customer_items_in_routes_percentage` | Q7 | `coverage_pct`; היה נעול בטעות על 100 |
| `customer_avg_route_turnaround_minutes` | Q7 | `avg_route_turnaround_wall_min` **וגם** `_work_min` |
| דיאלוג ההיסטוריה | Q2א+Q2ב (פילטר customer) | מחליף את `customer_snapshots{,_monthly}` |

#### פריטים איטיים

| מזהה | שאילתה |
|---|---|
| `slow_item_queue_minutes` / `_processing_minutes` / `_total_minutes` | Q6, שני שעונים, ממוין לפי `total_work_min` |
| `slow_item_route_step`, `_worker_id`, `_station_name`, `_item_id`, `_serial_no`, `_makat`, `_model` | Q6 |
| **חדש** `slow_item_attempt_no` + `slow_item_entry_reason` | Q6 — מבדיל retest ממעבר ראשון ומ־restart אחרי נטישה |

#### זמנים ממוצעים

| מזהה | שאילתה | ביטוי |
|---|---|---|
| `avg_times_waiting_minutes` | Q4 עם `is_waiting` | wall **וגם** work |
| `avg_times_processing_minutes` | Q4 עם `is_active_work` | wall **וגם** work |
| `avg_times_record_count` | Q4 | `n` — המכנה האמיתי של הממוצעים (אחרי החרגת אביזרים) |
| `avg_times_is_today` | client | ללא שינוי |

#### מדדי מערכת חיים

| מזהה | שאילתה |
|---|---|
| `live_items_in_queue` / `_in_test` | Q1 עם `is_waiting` / `is_active_work` |
| `live_items_waiting_for_research` / `_in_research` | Q1 `FILTER (state_key = ...)` |
| `live_items_finished` | **route_run**: מצטבר = Q2ב; בתקופה = `count(*) WHERE closed_at` בחלון — שתי מטריקות בשמות נפרדים |
| `live_items_active` | Q1 (כולה אוכלוסייה פעילה) |

#### מטריקות שה־UI רומז עליהן וה־backend מעולם לא ייצר — עכשיו מדרגה ראשונה

| מטריקה | שאילתה |
|---|---|
| שיעור מעבר/כישלון (ה־`"-"` הקשיח ב־`kpis/page.tsx`) | Q8 `fail_pct` |
| שיעור rework / retest | Q8 `rework_pct` |
| turnaround של מחקר (המתנה + עבודה, שני שעונים) | Q8 / Q5 עם `is_research` |
| תפוקת עובד | Q4 מקובץ לפי `exited_by_worker_id` |
| בדיקות נטושות (ה־reaper, בלתי נראה היום) | Q4 `abandonments` + `restarts_after_abandonment` |
| turnaround מסלול + קליטה־עד־שילוח | Q7 `avg_route_turnaround_*` / `ship_turnaround_*` |
| צוואר בקבוק מול תוכנית | Q4 מקובץ לפי `(item_type_id, step_no)` מול `route_run.planned_steps` |
| זיהום מ־override ידני | Q4 `manual_entries` |
| הפער בין שעון עבודה לשעון קיר | כל שאילתת משך, `offhours_seconds` |

#### נמחקים כליל (אין צרכן, או שבורים בהגדרה)

`snap_*` (כל 7 משפחות ה־writers), `mv_*`, `hourly_station_*`, `ts_*`, `trend_*`, `kpi_busiest_station_count`, `kpi_busiest_station_workload_score`, `snapshot_min_date` / `_max_date` / `_years`. וכן Q9 (as-of) — היכולת נשמרת כמתכון replay (§12.5), לא כ־endpoint.

---

## 6. ביצועי מסלול הקריאה — ledger-only

זהו הסעיף שהחליף את "שכבת האגרגציה" של גרסה 1. אין cache. הסעיף מוכיח שאין בו צורך, מגדיר את סט האינדקסים המינימלי עם הצדקה פר־אינדקס, קובע את תקרת ה־UI, ומגדיר קריטריון מדיד שיפעיל — אם אי־פעם — את ה־contingency הנדחית (§6.5).

### 6.1 חשבון נפחים ומדידות

**קצב:** 100–500 פריטים/יום × 3–8 צעדים × ~2 intervals לצעד (תור+בדיקה) ⇒ ~1,000–8,000 intervals/יום; ~2,700/יום בתרחיש הגבוה ⇒ **~1M שורות/שנה בקצה העליון, ~3.3M בשנה 3**. שורת interval היא ~250 בייט ⇒ ledger של ~250MB/שנה כולל אינדקסים.

**מדידות (בסיס ההחלטה):** על ה־`postgres:16-alpine` של הפרויקט עצמו, **לא מכוונן** (256MB `shared_buffers`, 4MB `work_mem` — לפני השדרוג של שלב 2 ל־1GB/32MB), מול ledger סינתטי של 3.33M שורות (3M סגורים + 330k `done` פתוחים + 300 חיים) ועם 3 אינדקסים בלבד:

| שאילתה | חלון | זמן |
|---|---|---|
| Q4 (flow+p95 לפי יום+תחנה) | **13 חודשים מלאים** (תקרת ה־UI) | **455ms** קר / 419ms חם |
| Q4 | 30 יום | 35ms |
| Q1 (probe `@>` עם `NOT is_terminal`) | רגע אחד | 402ms |
| Q2א (סדרת PIT של צהריים) | 90 יום | 486ms |
| Q2א | 395 יום | 1,223ms |
| Q5 (KPI חתוך־חלון) | 30 יום | 520ms |
| Q2 **בלי** `NOT is_terminal` (הבאג שתוקן) | 90 יום | **timeout ‏>120s** |

*‏Q3 (לוח התחנות החי) לא נכלל במדידה הסינתטית; אחרי תיקון ה־probe (‏§5.4 — `@> now() AND NOT is_terminal`) הוא באותה מחלקת עלות כמו ה־probe של Q1 (חסם ~400ms, בפועל הרבה פחות כי הסט החי ~300 שורות). נמדד בפועל ברתמת ה־parity של שלב 5 — שורת חובה בטבלה לפני שער השלב.*

המסקנה כפולה: (א) עם הפילטרים הנכונים, **השאילתה הכבדה ביותר בתקרת ה־UI היא ~1.3 שניות על נפח שנה 3** — ובשנה 1 יש פי ~10 פחות נתונים (~50–150ms); (ב) ההבדל בין "עובד" ל"תקוע" הוא לא cache אלא **פרדיקט אחד** — בדיוק בגלל זה סעיף 5 מקבע את `NOT is_terminal` ואת גזירת `finished_cumulative` מ־`route_run` כחלק מההגדרה, לא כאופטימיזציה.

מה שגרסה 1 קנתה בשכבת ה־cache — האצת ~0.5–1.3s ל־~50ms עבור משפחת שאילתות אחת (חלון ארוך, scope יחיד) — עלה: 5 טבלאות, cron של 5 דקות, MERGE + orphan-DELETE, watermark + sealing, invalidation בתוך ה־hot path של כל הגשה, reconciliation לילי, 4 בדיקות selfcheck, ו־7 מ־38 התיקונים של גרסה 1 שקיימו **רק** את השכבה הזאת (וה־re-review מצא בה עוד 8 כשלים קריטיים — MERGE שנופל על עמודות חסרות, watermark שלא נזרע, DELETE שמפנה ל־CTE של statement אחר). מחלקת כשל שלמה — סטיית cache מול ledger — חדלה מלהתקיים.

### 6.2 תוכנית האינדקסים — הסט המינימלי, מוצדק פר־שורה

**`item_state_interval`** — PK + 2 מבני נכונות + 4 אינדקסים משניים (בגרסה 1: 12):

| מבנה | משרת |
|---|---|
| `isi_no_overlap` (EXCLUDE gist) | **האינווריאנט.** גם probe פר־פריט (העץ מובל ב־`item_id`) |
| `isi_one_open_per_item` (unique, חלקי) | יחידוּת interval פתוח; איתור נקודתי של הפתוח ב־`isi_apply_one`/`metrics_open_run` (lookup לפי `item_id`). **לא** משרת סריקות רוחב: Q3 עובר דרך `isi_range_live` (probe ‎`@> now()`), ‏Q7 דרך `isi_run` (פר־run) |
| `isi_range_live` (GiST חלקי, `NOT is_terminal`) | Q1, Q2א, Q5 — כל צרכני `@>`/`&&`, שכולם מסננים `NOT is_terminal` (§5.0(9)) |
| `isi_item_time` | ה־LATERAL של Q6; מסך היסטוריית פריט |
| `isi_closed` (חלקי, INCLUDE) | Q4, Q6, Q8 — כל שאילתות ה־flow מעוגנות `close_business_date` |
| `isi_run` | ספירת `attempt_no` בתוך כל הגשה (hot path); ה־DELETE של `isi_rebuild_run` |

**ירדו (היו בגרסה 1, אפס צרכנים או צרכן שסריקה משרתת):** `isi_start_bd` (אף שאילתה לא מסננת עוגן־פתיחה), `isi_open_live`, `isi_station`, `isi_sttype`, `isi_worker`, `isi_dims`, `isi_serial`. המחיר שנחסך: כל סגירת interval היא UPDATE לא־HOT — 13 מבנים היו נכתבים פעמיים בכל הגשת עובד; עכשיו 7.

**`route_run`:** `route_run_uq`, `route_run_one_open` (ה־lookup של `metrics_record`), `route_run_closed` (**Q2ב, `kpi_treated_count`, `live_items_finished`**). ירדו: `route_run_dims`, `route_run_item`.

**`item_state_event`:** `ise_key_uq` (אידמפוטנטיות), `ise_run` (ה־`ORDER BY` של rebuild), `ise_item` (ה־clamp של `metrics_record` — probe אחד של `max(occurred_at)`), `ise_super` (חלקי — דילוג superseded ב־rebuild). ירדו: `ise_recorded`, `ise_submit`.

**אחרים:** `work_span_ladder` (+EXCLUDE), `wcv_one_current`, `job_run_recent`, `metrics_drift_open`. ירד: `work_span_date`.

**כלל ההוספה:** אינדקס חוזר רק עם ראיה — `EXPLAIN` שמראה seq scan דומיננטי **וגם** p95 של ה־endpoint מעל הסף של §6.4. הרשימה שירדה שמורה כאן כדי שקל להחזיר פריט ממנה.

### 6.3 תקרת ה־UI: 13 חודשים

כל בורר תאריכים בדשבורד מוגבל ל־13 חודשים אחורה. "מאז ומתמיד" הוא ייצוא מפורש (CSV, ללא הגבלה, ברקע) — לא טעינת דף. זה מה שמקבע את חסם העבודה של כל שאילתה ב־§6.1 ומנתק את זמן התגובה מגידול המערכת: הדשבורד סורק לכל היותר 13 חודשים של intervals, לא את כל ההיסטוריה, לתמיד.

### 6.4 הקריטריון המדיד ל־contingency

ה־rollup הנדחה של §6.5 נבנה **אך ורק** אם: **p95 של ה־endpoint הכבד ביותר מבין שאילתות §5 עולה על 2 שניות, במדידת פרודקשן, לאורך שבוע.** המדידה כבר קיימת בתשתית: כל cron/endpoint כותב שורות log מובנות עם `duration_ms` (§10.2(5)), ו־`job_run.detail` שומר סיכומי ריצה — שאילתת percentile על שבוע היא חד־שורתית. לפי §6.1, הסף הזה רחוק פי ~2 מהמדידה בשנה 3 ופי ~20 משנה 1; אם הוא בכל זאת ייחצה (גידול חריג בקצב, שאילתה חדשה), ה־contingency נבנית בלי שום חוב הגירה — היא נגזרת טהורה של ה־ledger וניתנת למילוי מההיסטוריה בהרצה אחת.

### 6.5 ה־contingency הנדחית — `rollup_day` (סקיצה ברמת נספח; לא נבנית בגרסה 1)

**טבלה אחת, statement לילי אחד, אפס מנגנוני עזר.** grain יומי — לא שעתי: סקר הצרכנים של גרסה 1 הראה שכל צרכני ה־cache קראו bucket אחד ליום או קיבצו לפי `business_date`; grain שעתי היה פי 24 שורות שאיש לא קורא, וכל מכונת ה־dirty/watermark/sealing התקיימה רק כדי לתחזק אותו.

```sql
CREATE TABLE rollup_day (
  business_date  date     NOT NULL,
  scope_type     smallint NOT NULL CHECK (scope_type BETWEEN 0 AND 8),  -- enum ב-scope.ts; אין טבלת lookup
  scope_id       int      NOT NULL,
  state_key      text     NOT NULL REFERENCES metric_state(state_key),
  is_accessory   boolean  NOT NULL,
  -- flow (אדיטיבי): entries, exits, exits_completed, exits_abandoned, exits_to_research,
  --                  exits_returned, rework_entries, restart_entries, manual_entries,
  --                  finished_runs (סגירות route_run)
  -- occupancy:      occ_wall_seconds, occ_work_seconds
  -- dwell (סגירות): closed_count, dwell_wall_sum, dwell_work_sum, dwell_wall_max,
  --                  dwell_work_max, dwell_wall_sumsq, dwell_work_sumsq   -- שני השעונים, סימטרי
  -- מצב:            open_at_noon (דגימת 12:00 — אותו עוגן כמו Q2א)
  calendar_version int,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_date, scope_type, scope_id, state_key, is_accessory)
);
```

**רענון — statement לילי אידמפוטנטי אחד** בתוך `runJob` (מצטרף כמשימה רביעית):

```sql
DELETE FROM rollup_day WHERE business_date >= current_date - 400;
INSERT INTO rollup_day
SELECT * FROM metrics_day_agg(current_date - 400, current_date);  -- פונקציה אחת, מקור אחד
```

חישוב מחדש של 400 הימים הנגררים כל לילה: אין תור dirty, אין watermark, אין sealing, אין invalidation ב־hot path, אין reconciliation (החישוב מחדש **הוא** ה־reconciliation לחלון שלו), אין מעקב גרסת־נוסחה (שינוי נוסחה נטמע בלילה הבא אוטומטית), ולילה שהוחמץ מתרפא בלילה שאחריו. עלות: סריקת ה־Q4-shape של 13 חודשים נמדדה ב־455ms — ההרצה הלילית המלאה היא שניות בודדות. הניתוב: חלון > 90 יום רשאי לקרוא מ־`rollup_day` פרט ליום הנוכחי, שנקרא תמיד מה־ledger. `finished_cumulative` נשאר מ־`route_run` (Q2ב) גם אז — מקור אחד לספירה הזאת, בכל חלון.

---

## 7. טיפול בזמן

### 7.1 מדיניות אחסון

**כלל אחד, נאכף בסכימה: כל רגע הוא `timestamptz`; כל יום עסקי הוא `date` באזור Asia/Jerusalem.**

כל הטבלאות החדשות (`item_state_event`, `item_state_interval`, `route_run`, `work_span`, `job_run`, `metrics_drift`) משתמשות ב־`timestamptz` בלבד. הטבלאות הישנות נשארות כפי שהן בגרסה 1 — **אבל אף שאילתת מטריקה לא קוראת מהן זמן**, פרט ל־`ship_turnaround_*` (Q7) שקוראת את `shipments.shipment_date` (`Timestamp(6)` נטול־אזור) עם המרה מפורשת `AT TIME ZONE 'UTC'` ומתעדת זאת במקום.

היום הסכימה מעורבת: `item_routes.*`, `item_route_history.*`, `research_history.*`, `shipments.shipment_date` וכל טבלאות ה־snapshot הן `Timestamp(6)`, בעוד `test_results.created_at` ו־`shipments.finished_at` הן `Timestamptz(6)` — אותו אירוע בשני טיפוסים.

### 7.2 חלוקה ליום עסקי

```sql
business_date(ts) := (ts AT TIME ZONE 'Asia/Jerusalem')::date
```

נכתב פעם אחת, בזמן ה־fold, לשתי עמודות: `start_business_date` ו־`close_business_date`. **לעולם לא `GENERATED ALWAYS ... STORED`** — `AT TIME ZONE` הוא `STABLE`. ב־TypeScript: `src/lib/workHours/time.ts` (שכבר נכון). `toISOString().split('T')[0]` נאסר; `date-periods.ts` ו־שימושי `setHours` המקומיים נמחקים (הם מתחו כל חלון דשבורד ל־`[start-1, end+1]`).

### 7.3 DST

1. **`work_span` שומר רגעים מוחלטים.** ההמרה נעשית פעם אחת, ב־SQL, בזמן היצירה. 2026-03-27 בן 23 שעות ו־2026-10-25 בן 25 — במפורש.
2. **רשתות דגימה נבנות מתאריכים אזרחיים**: `generate_series($1::date, $2::date, interval '1 day')` ואז המרת כל יום בנפרד (עם `d::date::text` — ראה Q2א). `timestamptz + interval '1 day'` זולג שעה בכל מעבר עונה — אומת: 5 נקודות במקום 6.
3. **`close_business_date` מחושב דרך Asia/Jerusalem** — יום בן 23 או 25 שעות מקבל את כל הסגירות שלו, וזה נכון.

### 7.4 משכים מודעי־שעות־עבודה

**התשתית כבר בנויה, נכונה, טהורה ובדוקה — היא פשוט לא הייתה מחוברת לכלום.**
`weekday_defaults` (seed: ראשון–חמישי 07:00–15:35, הפסקה 12:00–13:00 = **455 דקות נטו**; שישי ושבת סגורים), `workday_overrides`, `department_holidays`, `holiday_types`, `israeliHolidays.ts` (מ־`@hebcal/core`, חשבוני, בטוח ל־air-gap), `resolveDay.ts` (`resolveDay`/`resolveRange`, 8 רמות קדימות, טהור, עם unit tests).

**החיבור:**

```
weekday_defaults + workday_overrides + department_holidays + hebcal
    -> resolveRange(from, to)                    [TypeScript, טהור]
    -> POST /api/cron/rebuild-work-calendar      [טרנזקציה אחת: TEMP stage + build + flip]
    -> work_span (סולם prefix-sum, רגעים מוחלטים)
    -> work_seconds_between(a, b, ver)           [שתי גישות אינדקס]
    -> item_state_interval.work_seconds          [נכתב בזמן הסגירה]
```

**אופק מתגלגל: [-24 חודשים, +12 חודשים].** נוצר מחדש בכל לילה ב־01:00, **וגם** בכל כתיבה למסך שעות העבודה, **וגם** — ריפוי עצמי — מתוך המשימה הלילית `metrics-selfcheck`: אם `calendar_horizon_days < 60`, ה־job מפעיל את הבנייה בתהליך לפני שהוא ממשיך (בגרסה 1 הריפוי ישב ב־drain של ה־cache; ה־drain ירד, הריפוי נשאר). גרסה חדשה נוצרת **רק כשה־`source_digest` השתנה** או כשהאופק קצר — לא בכל לילה (אחרת ~800k שורות סולם בשנה בלי אפשרות גיזום).

**תיקון רטרואקטיבי של לוח שנה** (חג שהוזן באיחור, או תיקון 15:30 → 15:35):

```sql
-- 1) גרסה חדשה נבנית ומסומנת is_current (דרך ה-endpoint)
-- 2) חישוב מחדש לפי חפיפה, לא לפי business_date:
UPDATE item_state_interval i
   SET work_seconds = work_seconds_between(lower(i.valid_range), i.closed_at, $newver),
       calendar_version = $newver
 WHERE i.closed_at IS NOT NULL AND NOT i.is_terminal
   AND i.valid_range && tstzrange(
         ($from::text)::timestamp           AT TIME ZONE 'Asia/Jerusalem',
         (($to::date + 1)::text)::timestamp AT TIME ZONE 'Asia/Jerusalem', '[)');
```

> **סינון לפי חפיפת טווח, לא לפי `business_date`** — פריט שנכנס לתור ב־17.9 והמתין דרך חופשה מרוכזת שהוזנה רטרואקטיבית ל־21–23.9 נושא `start_business_date` מחוץ לחלון, ובלי החפיפה ההמתנה שלו הייתה נשארת מנופחת ב־3×455 דקות לתמיד. (בגרסה 1 ה־UPDATE הזה גם סימן buckets מלוכלכים — אין יותר buckets; `intervals_stale_calendar` ב־selfcheck עוקב אחרי מה שטרם חושב מחדש.)

> **החלטת המשתמש — שני מדדים, שני שמות. ראה §2.8.** כל משך מוצג פעמיים; `offhours_seconds` הוא ההפרש; `calendar_version` על כל interval סגור; חג שמוזן רטרואקטיבית **משנה מספרי עבר** — בלתי נמנע ואינו באג, ולכן קיים נוהל החישוב מחדש שלמעלה במקום דיווח מיושן שקט. `wall_seconds` חסין מהגדרתו.
> הדוגמה הקנונית (מתוקנת בגרסה 2, מחושבת מול ה־seed): נכנס לתור **חמישי 15:00**, נאסף **ראשון 07:10** ⇒ זמן המתנה **64:10 שעות**, זמן המתנה בפועל **45 דקות** (35 בחמישי + 10 בראשון). הגרסה הקודמת של הדוגמה ("10 דקות") הייתה נכונה רק לכניסה ב־15:40, אחרי סוף יום העבודה — קבועי הבדיקות ב־§9.2 יושרו בהתאם.

### 7.5 שעון הכתיבה

| מקור | כלל |
|---|---|
| `occurred_at` | נקבע ב־`metrics_record`: נעילת פריט ⇒ `GREATEST(clock_timestamp(), max(occurred_at)+1µs)` — עולה ממש פר־פריט גם תחת NTP step (§4.2). **לא** "מונוטוני מעצם clock_timestamp" — הטענה הזאת מגרסה 1 הייתה שגויה |
| `recorded_at` | `now()` (חותמת הטרנזקציה) — ציר ה־as-of של §12.5 |
| גוף הבקשה | **לא נקרא לעולם** עבור זמן, למעט `legacy_import` (Tier-2) ו־`correction` — ראה טבלת האמון ב־§4.3 |
| `TZ` על `next-app` | **`Asia/Jerusalem`** בשני קבצי ה־compose (שלב 0) |
| DB session | `timezone=UTC`, ללא שינוי |

---

## 8. תוכנית ההגירה שלב אחר שלב

**עקרון סידור:** המערכת אף פעם לא שבורה. כל שלב הוא PR נפרד. שלבים 0–1 ניתנים לשילוח עצמאי לחלוטין. השלב ההרסני (7) מגיע release שלם אחרי שהתחליף רץ בפרודקשן ואומת.

> **פיצול לשתי מיגרציות בשני releases — וסדר הפעלה מתוקן.**
> שרת ה־DB ושרת האפליקציה הם מכונות נפרדות בלי handshake גרסאות. שני סדרי הפעלה שוברים: DB־קודם עם DROPs (מסך ההגדרות מציג אפסים בשקט, `finished_item` חסרה) ו־app־קודם (ה־image קורא ל־`metrics_record` שלא קיימת — כל הגשת בדיקה נופלת). הפתרון: מיגרציה A (additive), מיגרציה B (destructive, אחרי שבוע ירוק), `metrics_schema_version` + `GET /api/health/schema` + סירוב־לשרת בגרסת DB נמוכה.
> **סדר ההפעלה בפרודקשן בתוך release 2 הוא 2 → 4 → 3**: ה־Tier-1 backfill הוא SQL בלבד (צריך רק את הסכימה החדשה + `item_routes`), ולכן הוא רץ **בתוך `8-apply-metrics-ledger.ps1`**, באותה נסיעת USB של מיגרציה A — לפני שה־image של שלב 3 משרת תעבורה. הוא אידמפוטנטי (`ON CONFLICT DO NOTHING`), ולכן **מורץ שוב** ב־cutover של שלב 3, אחרי עצירת ה־app הישן ולפני `3-start.ps1` — לכיסוי פריטים שנוצרו בחלון. (סדר ה־PRs בקוד נשאר 3 → 4; רק ההפעלה במכונות הפוכה.) גם אם הסדר יופר — `metrics_record` מתדרדרת ל־auto-open (§4.2) במקום להפיל את הרצפה: ההגנה כפולה.

### שלב 0 — תנאים מוקדמים ותיקוני נכונות · **בוצע ואומת 2026-08-24** (build + tsc נקיים, 35/35 טסטים)

ההיקף כבגרסה 1 — ראה §4.9: חילוץ `station-counters.ts`, סגירת `/api/dashboard` ל־manager, `AND current_status = <expected>` במסלולי המחקר, `research_history.item_id bigint` (מיגרציה `20260824000000_fix_int4_overflow`), `.bat` + `8-register-tasks.ps1`, דחיית `CRON_SECRET` המשוגר, `logging` caps + `TZ`, `db:airgap-schema` + pre-commit, מחיקת `prod-deploy/db-server/prisma/`, הסרת `db push --force-reset`, `ON_ERROR_STOP=1`.

**אימות לפני מעבר:** build + `tsc --noEmit` נקיים; מסך Settings ← תחנות מציג אותם מספרים; cron מגיב מהמארח; session של `tester` מקבל 403 מ־`/api/dashboard/...`; פריט עשירי ביום ללקוח תלת־ספרתי נכנס בלי 22003.
**ניתן לשילוח עצמאי: כן.**

---

### שלב 1 — הריסת קוד מת, קבוצה A (אפס הפניות) · **בוצע ואומת 2026-08-24**

**17 קבצים, 2,245 שורות. אף רכיב, אף `.bat`, אף `.ps1` ואף doc לא מפנה אליהן** — הרשימה המלאה בנספח ב. בנוסף: הסרת `TimeSeriesPoint`, `DailyTrendPoint`, `DateRange` מ־`src/types/dashboard.ts`, והסרת `getLiveSystemStats` מ־`metrics-service.ts` (**`refreshMaterializedViews` נשאר עד שלב 7** — `create-daily-snapshots`, שחי עד אז, קורא לו; רשימת גרסה 1 פספסה את זה) (2 מתוך 15 המתודות; 1 חולצה בשלב 0; 12 הנותרות נמחקות עם הקובץ בשלב 7).

> **אזהרה תפעולית:** ייתכן שערך Task Scheduler במכונת הפרודקשן מצביע על `create-hourly-snapshots` או `refresh-views`. **לאשר מול המפעיל לפני המחיקה.**
> **התנגשות שמות:** `src/app/components/StationHistoryDialog.tsx` (מיובא מ־`testing/page.tsx`) הוא קובץ אחר ו**נשאר**; הנמחק (שלב 6) הוא `src/app/components/dashboard/StationHistoryDialog.tsx`.

**אימות:** build + `tsc --noEmit` נקיים; כל 9 דפי `src/app/dashboard/tests/**` נטענים.
**ניתן לשילוח עצמאי: כן.**

---

### שלב 2 — מיגרציה A: הסכימה החדשה (בלי כותבים, בלי מוחקים) · **בוצע ואומת על dev, 2026-08-25** (סמוק מלא על PG16 חי; פרודקשן ממתין לנסיעת USB)

מיגרציה: `prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql` — כל §3.1–§3.10 (9 טבלאות, הפונקציות, הטריגרים — `trg_metrics_drift` נוצר **כבוי**), `ALTER TABLE test_results ADD COLUMN state_event_id bigint`, `CREATE UNIQUE INDEX testing_routes_type_number_uq` (אחרי דוח כפילויות — §3.7), `ALTER TABLE item_routes ADD CONSTRAINT ir_item_fk ... NOT VALID`, ה־REVOKE+GRANT של §3.11.

> **ה־FK נוסף כ־`NOT VALID`** — יש שורות `item_routes` יתומות מוכחות על volume הפרודקשן; `8-apply-metrics-ledger.ps1` מדפיס דוח יתומים, ו־`VALIDATE CONSTRAINT` הוא שלב נפרד באישור מפעיל.

נוצר:
- `prod-deploy/db-server/scripts/8-apply-metrics-ledger.ps1` — `psql -v ON_ERROR_STOP=1`; מדפיס **שלושה דוחות pre-flight**: יתומי `item_routes`, כפילויות `testing_routes(item_type_id, route_number)`, ושורות `finished_at < created_at` (רעל ל־CHECK של `route_run`); מיישם את המיגרציה; מריץ את **Tier-1 backfill (שלב 4)** כצעד האחרון כולל `ENABLE TRIGGER trg_metrics_drift`; כותב בעצמו את שורת ה־**`_prisma_migrations`** (זה שם הטבלה — `_prisma_binaries` שהופיע ברן־בוק של גרסה 1 היה typo)
- `src/app/api/cron/rebuild-work-calendar/route.ts` — טרנזקציה אחת: TEMP stage + build + flip (§3.5)
- `src/app/api/health/schema/route.ts` — **כאן, לא בשלב מאוחר**: אימות שלב 2 קורא לו, וההגנה מפני app-קודם-DB תלויה בו; נשאר public בכוונה (ל־`4-verify.ps1` אין session)
- `prod-deploy/app-server/scheduler/run_rebuild_work_calendar.bat`
- `docs/PRISMA_UNMANAGED_OBJECTS.md` — כולל חובת `migrate dev --create-only` + diff לפני commit
- `scripts/check-migration-safety.js` + pre-commit hook
- `scripts/restore.sh` (שכתוב) + עדכון `docs/RUNBOOK_DB_SERVER.md` — ראה תיקון הגיבוי למטה

שונה:
- `prisma/schema.prisma` — הצהרה על כל הטבלאות החדשות, עם `Unsupported("tstzrange")`
- `src/app/api/settings/work-hours/**` (מסלולי הכתיבה: defaults / overrides / holidays / holiday-types) — אחרי commit מוצלח קוראים לפונקציית ה־rebuild המשותפת של לוח השנה (§7.4 "בכל כתיבה למסך שעות העבודה") — fire-and-forget עם לוג על כישלון; בלעדיו ההבטחה של §7.4/§10.1 לא ממומשת באף שלב
- `prod-deploy/db-server/docker-compose.yml` — `-c work_mem=32MB -c maintenance_work_mem=512MB -c effective_cache_size=3GB -c shared_buffers=1GB -c autovacuum_naptime=30s`; **וה־backup sidecar עובר ל־`pg_dump -Fc -f /backup/daily/$DB-$TS.dump`** — בלי `| gzip`, בלי סיומת `.sql.gz` (‎-Fc כבר דחוס, ועטיפת gzip הייתה מסתירה מהנהלים את הפורמט האמיתי); retention חודשי מוגבל ל־24

> **תיקון גיבוי ↔ שחזור כזוג אטומי.** גרסה 1 החליפה את פורמט הגיבוי ל־`-Fc` אבל השאירה את `restore.sh` על `gunzip | psql` ואת ה־RUNBOOK על `psql < backup.sql` — ארכיון `-Fc` הוא בינארי ש־psql לא מסוגל להריץ, כלומר בליל האסון הראשון אף נוהל שחזור לא היה עובד. בגרסה 2, באותו PR: הסייד־קאר כותב `.dump`; `restore.sh` מזהה סיומת — `.dump` ⇒ `docker exec ... pg_restore --clean --if-exists -j 4`, ‏`.sql.gz` (ישן) ⇒ המסלול הקודם עם `ON_ERROR_STOP`; סעיפי ה־RUNBOOK מיושרים לשמות הקבצים החדשים עם `-j 4`.

> **`check-migration-safety.js` — ה־regex המורחב.** Prisma לא תפלוט `DROP TABLE` על טבלאות שמוצהרות ב־schema — היא תפלוט `DROP INDEX` / `ALTER TABLE ... DROP CONSTRAINT` / `DROP EXPRESSION` על מה שהיא לא יודעת לבטא: האינדקסים החלקיים, ה־GiST, ה־EXCLUDE, ו־`offhours_seconds GENERATED`. ה־hook בודק, מול רשימת שמות שכוללת **גם את שמות האינדקסים וה־constraints עצמם** (`isi_no_overlap`, `isi_one_open_per_item`, `route_run_one_open`, `wcv_one_current`, `work_span_no_overlap`, ...): `DROP TABLE|DROP FUNCTION|DROP TRIGGER|DROP INDEX|DROP CONSTRAINT|ALTER TABLE <metrics> ... DROP|DROP EXPRESSION|DROP EXTENSION`. אחרת מיגרציה שגרתית בעוד שלושה חודשים הייתה מפילה בשקט את ה־constraint שהוא "ה־test suite של ה־rebuild".

**אימות לפני מעבר:**
1. `SELECT * FROM metrics_selfcheck();` — `calendar_horizon_days > 300`, `calendar_sanity_net_minutes = 455`.
2. `SELECT lower(span) AT TIME ZONE 'Asia/Jerusalem' FROM work_span WHERE calendar_version = current_calendar_version() ORDER BY span_id LIMIT 1;` = `07:00`, לא `10:00` — **הבדיקה שתופסת את באג אזור הזמן של Node**.
3. `work_seconds_between` על יום עבודה רגיל = 27,300 שניות.
4. `SELECT version FROM metrics_schema_version` = 1; `GET /api/health/schema` מחזיר אותו ערך (ה־route קיים כבר בשלב הזה).
5. `EXPLAIN` על Q1 מראה `Index Scan using isi_range_live` (עובד — Q1 נושאת `NOT is_terminal`).
6. **אף עמודה של טבלה ישנה לא השתנתה**: `\d item_routes` מציג את אותן עמודות בדיוק; ההבדלים היחידים המצופים הם הטריגר החדש (מסומן DISABLED) וה־FK ה־`NOT VALID` — נוסח מתוקן מגרסה 1, שדרשה "זהה בייט־בייט" ואז נכשלה בהכרח על מה שהיא עצמה הוסיפה.
7. אחרי צעד ה־backfill שבסקריפט: אימותי שלב 4 (למטה).

**ניתן לשילוח עצמאי: כן** — additive בלבד. **נסיעת USB אחת**, מקובצת עם שינויי ה־compose והגיבוי.

---

### שלב 3 — מסלול הכתיבה · **בוצע ואומת 2026-08-25** (57/57 טסטי אינטגרציה מול DB חי)

> **חמישה תיקונים מסבב הביקורת האדוורסרית של שלב 3.** כולם מומשו ומכוסים בטסטים:
>
> 1. **‏(§4.6) ה־reaper חייב שומר יתומים.** `ir_item_fk` נשלח `NOT VALID` כי שורות `item_routes`
>    יתומות קיימות בפרודקשן — ו־`metrics_open_run` עושה `JOIN items`. יתום אחד שנכנס ל־statement
>    היחיד של ה־reaper מרים exception ומגלגל אחורה את **כל** האצווה: השחרור, האירועים של כל שאר
>    הפריטים ושחרור התחנות — ולתמיד, כי אותו יתום תואם שוב בהרצה הבאה. רשת הביטחון של רצפת
>    הייצור לא יכולה להיות בת־ערובה של שורה אחת. נוסף `AND EXISTS (SELECT 1 FROM items …)`.
>    ‏(טסט R3.)
> 2. **‏(§4.2) auto-open גם ל־`kind='note'`.** ה־degradation בחן כיסה רק `transition`, כך ש־
>    `research_note` על פריט legacy בלי run החזיר NULL ו־`recordNote` הפיל את ההגשה ב־500 — בזמן
>    שהמעבר המקביל דווקא הצליח. עכשיו נפתח run גם ל־note, אלא אם הפריט יתום (ואז NULL הוא התשובה
>    הנכונה). ‏(טסט R4.)
> 3. **‏(§4.3) `recordNote` מחזיר `bigint | null`, לא זורק.** transition נושא את האינווריאנט וחייב
>    להיכשל ברעש; note הוא נתון audit נלווה, ואובדן שלו לעולם לא יהפוך שמירה של עובד ל־500.
> 4. **‏(§4.8) סדר נעילות אחיד — `FOR UPDATE` בקריאה הפותחת של `results/route.ts`.** call site #15
>    פולט **לפני** ה־UPDATE הראשון, ולכן היה לוקח את הנעילה הייעוצית לפני נעילת השורה — הפוך מכל
>    שאר מסלולי הכתיבה. הגשת אביזר ו־start-test על אותו פריט יכלו להיכנס ל־deadlock מסוג ABBA.
> 5. **‏(§4.7) לולאת האביזרים חייבת לבדוק את סטטוס ה־HTTP.** `apiFetch` מחזיר 4xx/5xx בלי לזרוק,
>    ולכן אביזר שנכשל דולג בשקט: האשף המשיך להורה, דיווח הצלחה, והשאיר את האביזר בתור לנצח בלי
>    אף אירוע — וגלאי ה־drift שתק, כי שורת ה־`item_routes` שלו מעולם לא נגעה. נוסף גם מעקב
>    per-accessory, כך ש־retry מדלג על מה שכבר נשמר במקום לקדם אותו צעד נוסף.

נוצר:
- `src/app/lib/metrics/record.ts` — `recordTransition`, `MetricsReason`
- `src/app/lib/metrics/action-id.ts` — `action_uuid` / `submit_id` בצד הלקוח
- **שער הגרסה בתוך מסלול הכתיבה**: `results/route.ts` (וכל כותב) מסרב לפעול אם `metrics_schema_version < המינימום של ה־image` — כשל אתחול רועש במקום השבתת רצפה; assertion תואם ב־`4-verify.ps1` (רץ מיד אחרי `3-start`, לפני שמכריזים על ה־deploy כתקין)

שונה (15 נקודות הקריאה של §4.5):
- `src/app/lib/create-item.ts` — ‎#1
- `api/testing/start-test/route.ts` — ‎#2
- `api/testing/release-test/route.ts` — ‎#3
- `api/cron/release-stale-tests/route.ts` — ‎#4, כתיבה set-based עם `array_agg` (§4.6)
- `api/testing/results/route.ts` — ‎#5–#12, ‎#14, ‎#15 (הזוג הסינתטי לאביזרים), **וארבע תת־הטרנזקציות שאחרי ה־commit נשאבות פנימה** (§4.8)
- `src/app/testing/page.tsx`, `tests-popups/Photo.tsx`, `PopUpTestDialog.tsx` — `submit_id`/`action_uuid`; הפסקת שליחת `QueueStartTime`/`ProcessingStartTime`

נמחק: `src/app/api/items/[id]/status/route.ts` (‎#13).

**בהפעלה בפרודקשן:** לפני `3-start.ps1` — עצירת ה־app הישן והרצה חוזרת של צעד ה־Tier-1 שבסקריפט ה־apply (אידמפוטנטי) לכיסוי פריטים מהחלון.

**אימות לפני מעבר:**
1. **סט בדיקות אינטגרציה של כל 31 מסלולי הפליטה** (§9.2ג): שורת event, מצב ledger, אפס חפיפות.
2. `drift_open = 0` אחרי יום מלא ב־staging.
3. הגשה במסלול הסיום הרגיל ⇒ `route_run.closed_at IS NOT NULL` **ו**־`state_key='done'` (תופס את התנגשות ה־`now()`/`event_key`).
4. reaper כפול באותה דקה ⇒ אירוע אחד.
5. אשף עם 3 אביזרים ⇒ 4 `route_run`, **8 events של הזוגות** (test_started+result לכל אביזר וגם להורה בהתאם), `submit_id` אחד, `unit_id` אחד, ולכל אביזר interval `testing` סגור.
6. `manual_override` על פריט גמור ⇒ run חדש נפתח, ה־interval הסופי נסגר עם `exit_reason='reroute'`, אפס שגיאות constraint.
7. הגשת `returnToRoute` על מסלול שקוצר ⇒ event ‎#11(א) נפלט, ledger מגיע `done`, אין drift.

**ניתן לשילוח עצמאי: כן** — ה־ledger מתמלא בצד; `item_routes` נשאר מקור האמת התפעולי; אף מסך לא קורא מה־ledger עדיין. **זהו שבוע ה־dual-run.**

---

### שלב 4 — Backfill (ה־SQL רץ בתוך סקריפט ה־apply של שלב 2; כאן — התוכן והאימות)

**אין היסטוריית דשבורד לשמר** — כל שורת snapshot היא עותק של ההווה.

#### Tier 1 — המצב הנוכחי (אמין, מדויק) — **חובה**

```sql
-- (א) route_run לכל שורות item_routes שיש להן שורת items (יתומים דווחו ב-pre-flight)
INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest,
                       opened_at, closed_at, close_reason,
                       customer_id, shipment_id, parent_item_id, unit_id,
                       is_accessory, serial_no, is_trusted)
SELECT ir.item_id, 1, ir.route_number, ir.item_type_id,
       COALESCE(tr.route_steps,'{}'), md5(COALESCE(tr.route_steps,'{}')::text),
       ir.created_at AT TIME ZONE 'UTC',
       CASE WHEN ir.finished_at IS NOT NULL OR ir.current_status = 3 OR ir.is_finished
            -- GREATEST: שורת legacy עם finished_at < created_at (נכתבה בלי ולידציה)
            -- הייתה מפילה את route_run_time CHECK ואת כל ה-backfill תחת ON_ERROR_STOP.
            THEN GREATEST(COALESCE(ir.finished_at AT TIME ZONE 'UTC', ir.created_at AT TIME ZONE 'UTC'),
                          ir.created_at AT TIME ZONE 'UTC') END,
       CASE WHEN ir.finished_at IS NOT NULL OR ir.current_status = 3 OR ir.is_finished
            THEN 'legacy_import' END,
       it.customer_id, it.shipment_id, it.parent_item_id,
       COALESCE(it.parent_item_id, it.item_id), it.parent_item_id IS NOT NULL,
       COALESCE(TRIM(it.serial_no),''), true
FROM item_routes ir
JOIN items it ON it.item_id = ir.item_id
LEFT JOIN testing_routes tr ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
ON CONFLICT (item_id, run_no) DO NOTHING;

-- (ב) אירוע seed אחד לכל run. הטריגר מייצר את ה-interval. אותו clamp GREATEST על הרגע.
INSERT INTO item_state_event (event_key, route_run_id, item_id, occurred_at, seq, kind, to_state,
                              step_no, station_id, station_type_id, reason, is_trusted)
SELECT 'legacy:seed:'||ir.item_id, r.route_run_id, ir.item_id,
       GREATEST(COALESCE(
         CASE WHEN ir.finished_at IS NOT NULL THEN ir.finished_at END,
         CASE WHEN ir.current_status IN (1,5) THEN ir.processing_start_time END,
         ir.queue_start_time, ir.created_at) AT TIME ZONE 'UTC',
         ir.created_at AT TIME ZONE 'UTC'),
       0, 'transition',
       CASE WHEN ir.finished_at IS NOT NULL OR ir.current_status = 3 OR ir.is_finished
            THEN 'done' ELSE state_of(ir.current_status) END,
       ir.current_route_step,
       CASE WHEN ir.current_status IN (1,5) AND ir.finished_at IS NULL THEN ir.test_station_id END,
       (SELECT test_station_type_id FROM test_stations WHERE test_station_id = ir.test_station_id),
       'legacy_import', true
FROM item_routes ir JOIN route_run r ON r.item_id = ir.item_id AND r.run_no = 1
ON CONFLICT (event_key) DO NOTHING;

-- (ג) הפעלת גלאי ה-drift — רק עכשיו, כשה-ledger מיושר עם item_routes:
ALTER TABLE item_routes ENABLE TRIGGER trg_metrics_drift;
```

> **בלי פילטר `finished_at IS NULL`** — זריעת פריטים באוויר בלבד הייתה מאפסת את כל אחוזי ההשלמה של משלוחים חיים בבוקר ה־deploy. runs גמורים נזרעים כ־`done` עם `wall/work_seconds = NULL` — **ספירות משוחזרות, משכים לא מומצאים** (וזה, לא דגל האמון, מנגנון ההחרגה — ראה טבלת האמון §4.3). **`is_trusted = true` לכל Tier-1** — כולל אירועי ה־seed, אף שה־reason הוא `legacy_import`.

**שורות שאי אפשר לזרוע:** `current_status IN (1,5) AND test_station_id IS NULL` — נדפסות ב־pre-flight; `isi_station_shape` המרוכך מכניס אותן עם `station_id` ריק ו־selfcheck מדווח.

#### Tier 2 — היסטוריית צעדים (`is_trusted = false`) — **ההמלצה: לא להריץ**

כבגרסה 1 (זמני `processing_*` בלבד, `DISABLE TRIGGER` + `INSERT ... ORDER BY` + `ENABLE` + rebuild בבאצ'ים — לעולם לא דרך ה־fold trigger); ההמלצה נשארת לא להריץ: אין היסטוריה ששווה שימור, ו־prefix שגוי יצוטט בישיבה בעוד חצי שנה. (ה־rebuild רץ עכשיו בלי פרמטר ארכוב — הפונקציה החדשה `isi_rebuild_run(p_run)`.)

#### Tier 3 — לא ניתן לייבוא, ונאמר במפורש

ל־`research_history` אין חותמות זמן שמישות (שתי עמודות הזמן מקודדות `undefined` בצד הלקוח). turnaround של מחקר נמדד מיום 1 של ה־ledger והלאה.

**אימות (רץ בתוך הסקריפט ומודפס):**
1. `count(*) FROM item_routes ir JOIN items it USING (item_id)` = `count(*) FROM route_run WHERE run_no = 1` — **ה־JOIN בכוונה**: יתומים מדווחים בנפרד ב־pre-flight ומוחרגים משוויון הספירות (הנוסח של גרסה 1, בלי ה־JOIN, היה בלתי ניתן לסיפוק בנוכחות יתום אחד).
2. `count(*) FROM item_state_interval WHERE upper_inf(valid_range)` = מספר ה־runs.
3. Q1 ברגע `now()` מול ספירות `item_routes` לפי `state_of(current_status)` — התאמה מדויקת.
4. Q3 מול `station_live_counters` (עדיין חיה) — התאמה מדויקת. **האימות החזק ביותר בתוכנית**; לכן `station_live_counters` נמחקת רק בשלב 7.
5. `metrics_selfcheck` — `drift_open = 0`, `intervals_missing_work_seconds = 0`.

**ניתן לשילוח עצמאי: כן** (חלק מנסיעת ה־USB של שלב 2).

---

### שלב 5 — מסלול הקריאה על ה־ledger + השגחה

נוצר:
- `src/app/lib/metrics/filters.ts` — בלוק הפילטרים היחיד (§5.1)
- `src/app/lib/metrics/scope.ts` — scope builder + enum ה־scopes
- `src/app/lib/metrics/queries/` — `pointInTime.ts` (Q1), `pitSeries.ts` (Q2א+Q2ב), `stationBoard.ts` (Q3), `flow.ts` (Q4), `kpiWindow.ts` (Q5), `slowSteps.ts` (Q6), `entityProgress.ts` (Q7), `quality.ts` (Q8) — **אין `source.ts` ואין כלל ניתוב: מקור אחד**
- `src/app/lib/metrics/jobRun.ts` — `recordJobRun`, מעטפת `runJob` (§10.1)
- `src/app/api/cron/metrics-selfcheck/route.ts` — selfcheck + ריפוי אופק הלוח (§7.4)
- `src/app/api/health/jobs/route.ts` — **self-gated**: `withAuth(handler, { role: "manager" })` בתוך ה־handler. ה־middleware לא יגן עליו — `/api/health` נמצא ב־`PUBLIC_ROUTES` וה־prefix גובר על כל ROLE_PROTECTED (נבדק ב־`routes.ts`); `/api/health/schema` לעומתו **נשאר public בכוונה** (ל־`4-verify.ps1` אין session). בדיקות: `GET /api/health/jobs` בלי session ⇒ 401/403; `GET /api/health/schema` בלי session ⇒ 200
- `src/app/components/dashboard/JobHealthTile.tsx`
- `prod-deploy/app-server/scheduler/run_metrics_selfcheck.bat`; עדכון `8-register-tasks.ps1` ל־**3** המשימות

שונה — 8 ה־endpoints החיים מוסבים ל־ledger, אחד־אחד, מאחורי רתמת ה־parity של §9.3:

| endpoint | שאילתה |
|---|---|
| `tests/kpis` | Q5 |
| `tests/by-station` | Q3 + Q4 |
| `tests/status-distribution` | Q1 |
| `tests/shipments` | Q7 |
| `tests/item-types` | Q7 (לפי `item_type_id`, `count(DISTINCT route_run_id)`) |
| `tests/customer-performance` | Q7 (לפי `customer_id`) |
| `tests/slow-items` | Q6 |
| `tests/average-times` | Q4 |

שונה גם:
- **`src/lib/station-counters.ts` — נכתב מחדש על Q3**, מאחורי אותו ממשק TypeScript שמסך ההגדרות צורך, עם בדיקת parity מול `station_live_counters` בשבוע ה־dual-run. (בגרסה 1 העבודה הזאת לא הוקצתה לאף שלב, ושלב 8 "אימת" שהיא כבר קרתה — מסך ההגדרות היה מציג אפסים שקטים אחרי מיגרציה B.)
- `CompletedShipmentsToggle.tsx` — פרמטר `scope` יחיד; `showSent` נמחק
- `dashboard-query-params.ts` — הסרת `showSent`, `itemId`; `dashboard-filters.ts` — הסרת `statusRef`
- `status-names.ts` — נמחק (תוויות מ־`metric_state.label_he`); `date-periods.ts` — נמחק; `calculateWorkDuration` — נמחק, שתי נקודות הקריאה מופנות ל־`work_seconds_between`

**אימות:** רתמת ה־parity (§9.3) ירוקה ל־8 endpoints עם החריגים המתועדים של §9.4; אימותי ה־auth של health; האריח מאדים כשעוצרים משימה >10 דקות.
**ניתן לשילוח עצמאי: כן**, endpoint אחר endpoint.

---

### שלב 6 — כתיבה מחדש של קבוצה C (6 מסכי היסטוריה חיים)

**2,351 שורות; מסכים שמנהל רואה היום.** ה־PR נוחת **עם** התחליף. לפני שמתחילים: 6 הרכיבים מסומנים `M` ב־`git status` — commit או stash קודם.

שונה — כל endpoint מוסב מ־snapshot ל־Q2א/Q2ב/Q7:
- `customers/[id]/history` → Q2 (פילטר customer)
- `shipments/[id]/history` → Q2 (פילטר shipment)
- `stations/[id]/history` → Q2 (פילטר station) + Q4
- `item-types/[id]/history` → Q2 (פילטר item_type) — **מתקן HTTP 500 קבוע**
- `stats/completion-history` → Q2ב + Q7 — **מתקן קריסה על `shipmentId`**
- `tests/status-distribution/history` → Q2 — **מתקן פילטרים שחלים רק על "היום"**

שונה — 6 הרכיבים תחת `components/dashboard/` (כולל `StationHistoryDialog` בגרסת ה־dashboard בלבד): הסרת gap-fill, הצגת שני השעונים, `unmapped` כפרוסה.

נמחק: `snapshot-tables.ts`, `usePeriodFilter.ts`.

**אימות:** 6 הדיאלוגים מציגים נתונים אמיתיים; `item-types/[id]/history` מחזיר 200 לראשונה; `completion-history?shipmentId=N` מחזיר 200.
**ניתן לשילוח עצמאי: כן.**

---

### שלב 7 — מיגרציה B: ההריסה

**רק אחרי שבוע שלם של: `drift_open = 0`, ו־Q3 מתאים ל־`station_live_counters` בכל דגימה.**

מיגרציה: `prisma/migrations/20260901000000_metrics_drop_snapshots/migration.sql`

```sql
DROP MATERIALIZED VIEW IF EXISTS mv_station_stats;
DROP TRIGGER  IF EXISTS trg_update_station_counters ON item_routes;
DROP FUNCTION IF EXISTS update_station_counters();
DROP TABLE IF EXISTS
  station_live_counters, station_hourly_snapshots, finished_item,
  system_snapshots, system_snapshots_daily, system_snapshots_monthly,
  kpi_snapshots, kpi_snapshots_monthly, kpi_snapshots_quarterly,
  customer_snapshots, customer_snapshots_daily, customer_snapshots_monthly, customer_snapshots_quarterly,
  shipment_snapshots, shipment_snapshots_monthly, shipment_snapshots_quarterly,
  station_snapshots, station_snapshots_monthly, station_snapshots_quarterly,
  item_type_snapshots, item_type_snapshots_monthly, item_type_snapshots_quarterly,
  status_distribution_snapshots, status_distribution_snapshots_monthly,
  status_distribution_snapshots_quarterly
CASCADE;

-- פיגום ה-dual-run סיים את תפקידו (החלטת המשתמש: scaffold, לא קבע):
DROP TRIGGER  IF EXISTS trg_metrics_drift ON item_routes;
DROP FUNCTION IF EXISTS metrics_detect_drift();
DROP TABLE IF EXISTS metrics_drift;
CREATE OR REPLACE FUNCTION metrics_selfcheck() ... ;  -- אותה פונקציה בלי שורת drift_open

UPDATE metrics_schema_version SET version = 2, applied_at = now();
```

**חשבון האובייקטים, מנורמל:** 25 טבלאות legacy (23 snapshot — כולל `station_hourly_snapshots`, שגרסה 1 ספרה פעם כחלק מה־23 ופעם כפריט נפרד — ועוד `station_live_counters`, `finished_item`) + MV + טריגר + פונקציה = **28 אובייקטי legacy**; ועוד 3 אובייקטי פיגום (`metrics_drift` + הטריגר + הפונקציה). אין FK לשום טבלת snapshot (אומת) — `CASCADE` ליתר ביטחון.

נמחק (קוד): `create-daily-snapshots`, `create-monthly-snapshots`, `run_daily_snapshot.bat`, `run_monthly_snapshot.bat`, ו־`metrics-service.ts` **כולו** (12 המתודות הנותרות + 5 interfaces יתומים; `getStationLiveCounters` כבר חולץ בשלב 0 ונכתב מחדש בשלב 5). `prisma/schema.prisma` — הסרת 25 המודלים. `0_init/migration.sql` — לא נוגעים (היסטוריה append-only).

**אימות:** `metrics_selfcheck` ירוק (10 בדיקות אחרי הסרת drift); מסך Settings ← תחנות נכון (קורא מ־`station-counters.ts` שנכתב מחדש בשלב 5 — עכשיו זו טענה מגובה בעבודה שהוקצתה); build נקי.
**ניתן לשילוח עצמאי: כן, אבל רק אחרי שלב 6 ואחרי שבוע ירוק. אין rollback — רק restore מגיבוי.**

---

### נספחים מותנים (לא בגרסה 1, עם טריגר אימוץ מדיד)

- **פרטיציה** — טריגר: `ledger_bytes > 5 GB`. `item_state_event` לפי `RANGE(occurred_at)` שנתי עם `DEFAULT`; ייחודיות `event_key` עוברת ל־`event_key_seen(event_key PK, event_id)`. **`item_state_interval` לעולם לא מחולקת** — PG16 לא תומך ב־EXCLUDE על טבלאות מחולקות. מסמך מוכן: `docs/METRICS_PARTITIONING.md`.
- **`rollup_day`** — טריגר: p95 > 2s לאורך שבוע (§6.4); התכנון ב־§6.5.

### טבלת המוות — מתי כל דבר מת

| פריט | שלב |
|---|---|
| 5 npm scripts רפאים, `prod-deploy/db-server/prisma/` | 0 |
| 6 רכיבי React מתים, 7 endpoints מתים, `create-hourly-snapshots`, `refresh-views`, `create-all-snapshots-tables.sql`, `DASHBOARD_README.md` | 1 |
| `PUT /api/items/[id]/status` | 3 |
| `status-names.ts`, `date-periods.ts`, `calculateWorkDuration`, `showSent`, `itemId`, `statusRef` | 5 |
| `snapshot-tables.ts`, `usePeriodFilter.ts` | 6 |
| 25 טבלאות legacy + MV + טריגר + פונקציה; `metrics_drift` (פיגום); `create-daily/monthly-snapshots` + 2 `.bat`; `metrics-service.ts` | 7 |

**סה"כ: 28 קבצים נמחקים (17 בשלב 1, 1 בשלב 3, 3 בשלב 5, 2 בשלב 6, 5 בשלב 7), ≈6,450 שורות, + עץ `prod-deploy/db-server/prisma/` (≈1,600 שורות) בשלב 0.** (המספר "36 קבצים" של גרסה 1 לא התאים לאף סכום — זהו החשבון הנכון, פריט־פריט בנספח ב.)

---

## 9. בדיקות ואימות

### 9.1 Fixture

`prisma/fixtures/metrics-fixture.sql` — DB דטרמיניסטי לחלוטין, ללא `now()`, כל החותמות מקודדות:

- 2 לקוחות, 3 משלוחים (אחד `is_sent = true`, אחד עם `is_sent = NULL` — לאימות `IS NOT TRUE`), 4 סוגי פריט
- 4 תחנות ב־2 סוגים + 1 תחנת מחקר
- `testing_routes`: `(1,1) = {1,2,1}`, `(1,2) = {2,1,2}`, `(2,1) = {1,2,2,1}` — כולל סוג שחוזר במסלול
- 40 פריטים: 12 גמורים, 8 בבדיקה, 10 בתור, 4 ממתינים למחקר, 3 במחקר, 3 אביזרים תחת הורה אחד
- לפחות אחד מכל תרחיש: סיבוב מחקר מלא (3 intervals באותו צעד), שחרור ידני, שחרור reaper + התחלה מחדש, `no_station_for_type` על כל אחד משלושת מסלוליו (כולל "מסלול שקוצר" עם returnToRoute), `manual_override` על פריט גמור (run שני), הגשת אשף עם אביזרים (הזוג הסינתטי), פריט שחוצה סוף שבוע, פריט שחוצה חופשה מרוכזת, פריט שחוצה מעבר שעון (2026-03-27), פריט `unmapped` (סטטוס 7)
- לוח שנה קבוע: ראשון–חמישי 07:00–15:35 עם הפסקה 12:00–13:00

### 9.2 בדיקות יחידה

**א. `metric_state` וגזירת סטים** — לכל אחד מ־6 המצבים, אימות הדגלים; `state_of(7) = 'unmapped'`, `state_of(NULL) = 'unmapped'`.

**ב. לוח שנה** (הקריטיות ביותר, כי שגיאה כאן שקטה). הקבועים חושבו מחדש מול ה־seed ותוקנו מגרסה 1, שקבעה ציפיות שסתרו את הלוח של עצמה והזמינו את המממש "לתקן" את הפונקציה לקבוע שגוי:
- `work_seconds_between('2026-09-17 07:00 IL', '2026-09-17 15:35 IL')` = **27,300** (455 דקות)
- אותו טווח כשההפסקה בפנים = 27,300 (ההפסקה כבר מוחרגת מה־spans)
- **חמישי 15:00 → ראשון 07:10 = 2,700 שניות עבודה (45 דקות: 35+10), ‏231,000 שניות wall (64:10)** — דוגמת הדגל של §2.8
- **חמישי 15:20 → ראשון 07:10 = 1,500 שניות עבודה (900 בחמישי 15:20→15:35 + 600 בראשון), ~229,800 שניות wall** — בגרסה 1 הצפי היה "600" והוא היה שגוי
- חמישי **15:40** → ראשון 07:10 = **600** שניות עבודה — הווריאנט שבו באמת נשארות רק 10 הדקות של ראשון (הכניסה אחרי סוף יום העבודה)
- מעבר שעון 2026-03-27: יום בן 23 שעות, דקות נטו תקינות
- מחוץ לאופק ⇒ `NULL`, לא 0
- `lower(span) AT TIME ZONE 'Asia/Jerusalem'` של יום ראשון = `07:00`

**ג. ה־fold** — לכל אחד מ־31 מסלולי הפליטה: שורת event, מצב ledger, `attempt_no`, `station_id`, `exit_reason`. במיוחד:
- מסלול סיום רגיל: שני events באותה טרנזקציה, `seq` 0/1, `occurred_at` שונים (ה־clamp), `done`, `route_run.closed_at` נקבע
- סיבוב מחקר: `testing`(exit `sent_to_research`) → `queued_research` → `in_research` → `queued`(entry `returned_to_route`, `attempt_no=2`)
- `research_note` לא סוגר interval
- reaper → `released_stale`; התחלה מחדש עם `attempt_no=2`, `entry_reason='released_stale'`
- אביזר: הזוג הסינתטי — interval `testing` סגור, `test_results.state_event_id` מצביע על אירוע היציאה
- `manual_override` על פריט גמור: run שני, interval סופי נסגר `reroute`
- שני `station_reassigned` באותה הגשה: **שני** events (ה־`seq` המפורש), לא בליעה
- `metrics_record` על פריט בלי run פתוח (סימולציית חלון פריסה): auto-open + `payload.auto_opened_run=true`
- **R1 — replay אחרי סגירת run** (הבאג שהאימות האמפירי מצא): קריאה חוזרת זהה ל-`metrics_record`
  של אירוע סופי אחרי שה-run נסגר ⇒ מחזירה את ה-event_id המקורי, אפס runs חדשים, interval
  ה-done נשאר פתוח ובלי `exit_reason`
- **R2 — rebuild של run שאינו האחרון**: פריט עם שני runs ⇒ `isi_rebuild_run(run1)` מצליח,
  interval ה-done של run1 נתחם ב-`opened_at` של run2 עם `exit_reason='reroute'`,
  ‏`closed_at` של run1 לא משתנה, ה-interval החי של run2 לא נפגע; rebuild של run2 (האחרון) תקין
- מרשם התיקון (§3.4): החלפה — INSERT ידני `kind='transition', reason='correction'` עם `occurred_at` מפורש + `supersedes` ואז `isi_rebuild_run` ⇒ ה־ledger משקף את הערך המתוקן והאירוע השגוי מדולג; מחיקה טהורה — `kind='correction'` + `supersedes` ⇒ האירוע השגוי נעלם מה־replay. בשני המקרים ה־EXCLUDE עובר

**ד. אינווריאנטים** (כל אחד חייב להיכשל כמצופה):
- interval חופף ⇒ `23P01`; שני פתוחים ⇒ `23P01` על `isi_one_open_per_item` (שניהם EXCLUDE)
- `UPDATE`/`DELETE` על `item_state_event` ⇒ `deny_mutation`
- `station_id` על `queued` ⇒ `isi_station_shape`
- אותו `event_key` עם `to_state` שונה ⇒ exception התנגשות; אותו key בדיוק ⇒ `event_id` קיים, אפס intervals חדשים

**ה. rebuild** — `isi_rebuild_run` על כל run ב־fixture מייצר intervals זהים (למעט `interval_id`, `sys_from`). זו ההוכחה ש"ה־ledger הוא fold דטרמיניסטי".

**ו. שאילתות המטריקה** — לכל Q1–Q8 + Q2ב, תוצאה מקודדת מול ה־fixture. כולל:
- Q2א על 2026-03-25..2026-03-30 מחזירה **6 נקודות** (DST) — הצורה עם `d::date::text`, שאומתה אמפירית (הישנה זרקה 22007 על כל הרצה)
- Q2ב: הסדרה המצטברת מונוטונית, כוללת סגירות מלפני החלון (ה־base offset), ואינה תלויה בשעת הסגירה ביום
- Q1 לא מחזירה `done`; `finished_cumulative` מגיע רק מ־Q2ב
- Q4 לפי `item_type_id` עם אביזרים ⇒ `count(DISTINCT route_run_id)`; משכי אביזרים מוחרגים מהממוצעים אך נספרים ב־`steps_processed`
- Q4: p95 ו־max קיימים לשני השעונים (סימטריה)
- Q3: `standing_queue_age` על ממתינים, `active_test_age` על רצות — שניהם בשני שעונים
- Q5: כל 12 העמודות, כולל זוגות ה־research המלאים; ה־FILTER תחבירית אחרי האגרגט (הצורה ההפוכה — 42601, אומת)
- Q6 עם כל 7 הפילטרים מצמצם נכון
- Q7: משלוח עם `is_sent = NULL` מופיע ב־scope ברירת המחדל; `ship_turnaround_*` נבדל מ־`avg_route_turnaround_*`
- Q8: תוצאת מחקר שהוגשה ב־returnToRoute מופיעה ב־`results_recorded` (הקישור ל־‎#5)

### 9.3 רתמת parity (שלב 5)

`scripts/metrics-parity.ts` — לכל אחד מ־8 ה־endpoints החיים, מריצה ישן מול חדש עם אותם params על אותו DB ומדפיסה diff לפי שדה. מטריצה: 3 חלונות × 8 שילובי פילטרים × 2 ערכי `scope` = 48 הרצות ל־endpoint. בנוסף: parity של `station-counters.ts` החדש מול `station_live_counters` לאורך שבוע ה־dual-run.

**"ירוק" פירושו:** כל שדה מתאים, **או** מופיע ב־§9.4 עם הסבר כתוב.

### 9.4 הבדלים מכוונים — הרשימה המלאה

הרתמה **תראה** את ההבדלים האלה. הם התיקון, לא רגרסיה. כל אחד דורש אישור מפורש לפני שלב 5 (§11.3).

| מטריקה | ערך ישן | ערך חדש | למה |
|---|---|---|---|
| `kpi_avg_queue_seconds` | נמוך מדי | **גבוה יותר** | הישן שומר רק שורות היסטוריה בתחנה הנוכחית |
| `kpi_avg_*` עם `workerId` | 0 (HTTP 200) | ערך אמיתי | הישן זורק 42703 ומחזיר `defaultKpis` |
| `station_avg_current_queue_age` | — | שם חדש | פוצל ל־`standing_queue_age_*` ו־`active_test_age_*` |
| `station_total_processed` | נמוך בתחנות מחקר | **גבוה יותר** | "טופל" כולל `returned_to_route` ו־`sent_to_research` |
| `station_total_processed` | מנופח בתחנה 0 | **נמוך יותר** | שורות הרעל של `PUT /api/items/[id]/status` נעלמות |
| `customer_items_in_routes_percentage` | תמיד 100 | ערך אמיתי | `LEFT JOIN` שהתנוון ל־`INNER` תוקן |
| `item_type_total_items` | מנופח פי מספר שורות המשלוח | **נמוך יותר** | `SUM(amount)` הוחלף ב־`count(DISTINCT route_run_id)` |
| `shipment_completion_percentage` (snapshot) | קרוב ל־0 | ערך אמיתי | המכנה עבר מ־`amount` ל־`routed_runs` |
| `avg_times_record_count` | גבוה מדי | **נמוך יותר** | עכשיו המכנה האמיתי של הממוצעים |
| כל משכי ההמתנה | מנופחים | **נמוכים יותר** | `queue_start_time` היה `created_at` של הפריט |
| משכי אשף הקליטה | 0 | ערך אמיתי | `ProcessingStartTime: null` תוקן |
| ממוצעי משך בתחנות קליטה | מדולל באפסי אביזרים | **גבוה יותר** | כלל §5.0(8): משכי אביזרים סינתטיים מוחרגים |
| **כל המשכים** | מדד אחד, wall גולמי, בשם מטעה | **זוג:** "זמן המתנה" (wall) + "זמן המתנה בפועל" (work) | החלטת המשתמש, §2.8. הישן שרד בשם wall; החדש תוספת |
| `status_dist_count` | היברידי | point-in-time אמיתי | |
| ספירות סטטוס 4/5 | כפולות בסטים הרחבים | נפרדות | דגלי `metric_state` |

> **מה מנהל יראה בפועל.** המספר הישן לא נעלם — הוא "זמן המתנה", מתוקן. לצדו "זמן המתנה בפועל", קטן בפקטור ~4 (455 דקות/יום, 5 ימים ⇒ ~76% מהשעון הוא לא־עבודה). "64 שעות המתנה" ו"45 דקות המתנה בפועל" הם אותו פריט (§2.8) ושניהם נכונים; הפער (`offhours`) הוא תשובה לשאלה שלא הייתה ניתנת למענה. רתמת ה־parity מדפיסה את שניהם זה לצד זה כדי שאיש לא יגלה בישיבה.

### 9.5 מה זה "בוצע" לכל שלב

| שלב | הגדרת "בוצע" |
|---|---|
| 0 | build נקי, Settings נכון, cron מגיב מהמארח, `tester` מקבל 403 |
| 1 | build + `tsc --noEmit` נקיים, 9 הדפים נטענים |
| 2 | selfcheck ירוק, בדיקת 07:00, `EXPLAIN` = index scan, עמודות הטבלאות הישנות ללא שינוי, health/schema עונה |
| 3 | 31/31 בדיקות פליטה עוברות, `drift_open = 0` אחרי יום staging |
| 4 | Q1 = `item_routes`, Q3 = `station_live_counters`, בדיוק |
| 5 | רתמת parity ירוקה ל־8 endpoints + station-counters; חריגים רק מ־§9.4; auth של health נבדק |
| 6 | 6 דיאלוגים נטענים; `item-types/[id]/history` מחזיר 200 לראשונה |
| 7 | selfcheck ירוק (10 בדיקות), Settings נכון, build נקי |

---

## 10. תפעול ופרודקשן

### 10.1 לוח הזמנים — 3 משימות מתוזמנות

| Job | תדירות | endpoint | נעילה | תפקיד |
|---|---|---|---|---|
| `release-stale-tests` | 5 דקות | קיים | advisory xact | רשת ביטחון; עכשיו פולט events (set-based, §4.6) |
| `rebuild-work-calendar` | יומי 01:00 **+ בכל כתיבה למסך שעות העבודה** | `POST /api/cron/rebuild-work-calendar` | advisory xact | אופק מתגלגל [-24ח, +12ח]; גרסה חדשה רק על שינוי digest |
| `metrics-selfcheck` | יומי 02:00 | `POST /api/cron/metrics-selfcheck` | advisory xact | 11 בדיקות + ריפוי אופק לוח (<60 יום ⇒ בנייה בתהליך) |

**נמחקים:** `create-daily-snapshots`, `create-monthly-snapshots`, `create-hourly-snapshots`, `refresh-views` + 2 קבצי ה־`.bat` שלהם. **לא קיימים בגרסה 2:** `rollup-drain` (אין cache), `prune-history` (אין טבלת היסטוריה). קבצי `.bat` חדשים: `run_release_stale_tests.bat` (שלב 0), `run_rebuild_work_calendar.bat` (שלב 2), `run_metrics_selfcheck.bat` (שלב 5) — שלושה בסך הכול, רשומים ב־`8-register-tasks.ps1` עם `MultipleInstances=IgnoreNew`.

**כל job באותה מעטפת** (`src/app/lib/metrics/jobRun.ts`):

```ts
export async function runJob(name: string, fn: (tx) => Promise<JobResult>) {
  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${'job:' + name}, 0)) AS locked`;
    const runId = await startJobRun(tx, name);
    if (!locked) { await finishJobRun(tx, runId, 'skipped_overlap'); return { status: 'skipped_overlap' }; }
    try { const r = await fn(tx); await finishJobRun(tx, runId, 'ok', r); return r; }
    catch (e) { await finishJobRun(tx, runId, 'failed', null, String(e)); throw e; }
  }, { timeout: 240_000, maxWait: 5_000 });
}
```

הכול בטרנזקציה **אחת** — `pg_try_advisory_xact_lock` משתחרר בסופה, ו־Prisma עם `Pool` רגיל עושה autocommit לכל statement שאינו בתוך `$transaction`, כך שנעילה מחוץ לטרנזקציה היא no-op (אומת אמפירית). דילוג בריא מחזיר **HTTP 200** עם `{status:'skipped_overlap'}` — `curl --fail` ב־`.bat` היה צובע 409 ככשל ב־Task Scheduler, האות היחיד שיש למפעל.

### 10.2 השגחה והתראה

אין Prometheus, אין Grafana, אין ערוץ התראות ב־LAN מנותק. לכן:

1. **`job_run` בתוך Postgres** — משטח audit עמיד, בר־שאילתה, מגובה בחינם עם ה־dump הלילי.
2. **`GET /api/health/jobs`** — ההרצה המוצלחת האחרונה לכל job + `metrics_selfcheck()` המלא. **self-gated ב־handler** (`withAuth`, manager): הוא יושב תחת ה־prefix הציבורי `/api/health`, שגובר על כל ROLE_PROTECTED — הגנת middleware לא תעבוד שם, נקודה שנבדקה ב־`routes.ts`.
3. **אריח בדשבורד** שמאדים כאשר: `now() - last_success > interval×2` לכל job · `drift_open > 0` (עד מיגרציה B) · `auto_opened_runs` גדל אחרי חלון הפריסה · `calendar_horizon_days < 30` · `intervals_missing_work_seconds > 0`.
4. **`GET /api/health/schema`** — public בכוונה; `4-verify.ps1` בודק אותו **מיד אחרי `3-start`, לפני שמכריזים על ה־deploy כתקין** (ניסוח מתוקן — הסקריפט רץ אחרי עליית הקונטיינרים, לא לפניה; ההגנה האמיתית במצב הפוך היא סירוב־לשרת בתוך ה־image).
5. **שורות log מובנות JSON** מכל cron/endpoint (`job`, `run_id`, `duration_ms`, `rows`) — גם הבסיס למדידת ה־p95 של §6.4.
6. **`logging` caps** על כל שירות (שלב 0).

### 10.3 השלכות על גיבוי

| נושא | היום | אחרי |
|---|---|---|
| פורמט | `pg_dump` טקסט + gzip חד־זרמי | **`pg_dump -Fc` → `.dump`** (בלי gzip — ‎-Fc דחוס) |
| שחזור | `gunzip \| psql` (וב־RUNBOOK: `psql < backup.sql`) | **`pg_restore --clean --if-exists -j 4`**; `restore.sh` מזהה סיומת ותומך בשני הדורות |
| שמירה חודשית | לנצח | מוגבל ל־24 |
| גודל | 23 טבלאות snapshot של בדיה | ~250 MB/שנה ledger; אין cache; ~35 MB gzipped ל־USB |
| RTO | שעות | דקות (`-j 4`) |

**פורמט הגיבוי ומסלול השחזור משתנים באותו PR (שלב 2)** — גיבוי שאי אפשר לשחזר בנוהל הכתוב הוא גרוע מהיעדר שינוי.

### 10.4 נוהל ההגירה ב־air-gap

1. **מכונה מחוברת:** המיגרציה תחת `prisma/migrations/<ts>_<name>/migration.sql`, כל statement אידמפוטנטי.
2. `npm run db:airgap-schema` ⇒ יצירת `prod-deploy/db-server/init/02-app-schema.sql` מחדש (pre-commit אוכף).
3. `scripts/build-airgap-bundle.ps1` ⇒ image tars.
4. `scripts/sync-to-usb.ps1 -Destination E:\prod-deploy`.
5. **שרת DB (נסיעה #1, release 2):** `8-apply-metrics-ledger.ps1` — `ON_ERROR_STOP=1`, שלושת דוחות ה־pre-flight, יישום מיגרציה A, **Tier-1 backfill + `ENABLE TRIGGER trg_metrics_drift`**, `VALIDATE CONSTRAINT` באישור, כתיבת שורת `_prisma_migrations`. `02-app-schema.sql` רץ רק על volume חדש.
6. `docker compose up -d` לשינויי ה־compose (tuning, גיבוי `.dump`).
7. **שרת אפליקציה:** עצירת ה־app הישן ⇒ הרצה חוזרת של צעד ה־Tier-1 (אידמפוטנטי, מכסה את החלון) ⇒ `3-start.ps1` עם ה־image של שלב 3 ⇒ `4-verify.ps1` מאמת `GET /api/health/schema >= minimum` מיד אחרי העלייה.
8. **שער:** `SELECT * FROM metrics_selfcheck();` — `drift_open = 0`, `intervals_missing_work_seconds = 0`, `calendar_horizon_days > 300`, `calendar_sanity_net_minutes = 455`.

### 10.5 תוכנית rollback

| שלב | rollback |
|---|---|
| 0, 1 | `git revert`; שינוי הסכימה היחיד הוא `ALTER TYPE bigint` (הרחבה) |
| 2+4 | ה־DDL additive; rollback = החזרת image. אפשר `DROP` על החדשות — דבר לא תלוי בהן |
| 3 | החזרת image. ה־events מפסיקים, ה־ledger קופא, `item_routes` נשאר נכון. אין אובדן תפעולי |
| 5 | החזרת image; ה־endpoints הישנים קיימים עד שלב 7 |
| 6 | החזרת image; טבלאות ה־snapshot קיימות עד שלב 7 |
| 7 | **אין rollback.** רק `pg_restore` מהלילה הקודם. לכן: שבוע ירוק + אישור בכתב |

### 10.6 ערך ה־runbook: "המספרים נראים לא נכון"

`docs/RUNBOOK_METRICS.md`, סעיף 1 — **אין יותר צעד cache; יש מקור אחד:**

```
1. פריט נראה שגוי:
   SELECT isi_rebuild_run(route_run_id) FROM route_run WHERE item_id = <id>;
   -- ה-EXCLUDE constraint מאמת את התוצאה. אם ה-rebuild נופל — האירועים סותרים,
   -- וזה ממצא אמיתי: תקנו לפי מרשם התיקון של §3.4 (החלפה: INSERT kind='transition'
   -- reason='correction' עם occurred_at מפורש + supersedes; מחיקה: kind='correction').

2. עובד לא מצליח להגיש בדיקה:
   SELECT * FROM metrics_drift WHERE resolved_at IS NULL ORDER BY last_seen_at DESC LIMIT 20;
   -- (עד מיגרציה B; אחריה — metrics_selfcheck)

3. "כמה זמן זה לוקח?" איטי מהרגיל:
   בדקו duration_ms בלוגים; אם p95 > 2s לאורך שבוע — זה הטריגר של נספח rollup_day (§6.4).

כל השאר: SELECT * FROM metrics_selfcheck();
שחזור מלא: SELECT isi_rebuild_run(route_run_id) FROM route_run ORDER BY route_run_id;
שחזור as-of (הדוח שהודפס בעבר): המתכון בסעיף 5 של ה-runbook (§12.5 בתוכנית).
```

**מה זה לא מתקן** (מתועד): `test_stations.status` נשאר נעילה חד־תאית על משאב רב־תאי — ה־ledger מודד את חוסר האיזון אך לא מתקן את ה־balancer; סכמת מזהי הפריטים (שרשור מחרוזות) בטוחה ב־float64 עד 11 ספרות ומסומנת לבחינה נפרדת.

---

## 11. סיכונים, ממצאים והחלטות

### 11.1 ממצאי ה־re-review — כולם קופלו כתיקון בגוף הטקסט

45 ממצאים אושרו על ידי הביקורת הספקנית; רובם קובצו כאן לפי הפגם (כמה ממצאים תיארו את אותו פגם מעדשות שונות). **אף אחד לא נשאר כהערת שוליים** — כל שורה מפנה למקום שבו התיקון הוא עכשיו הטקסט עצמו. ממצאי ה־cache (dwell_work_max חסר ב־agg/MERGE, ‏rollup_watermark שלא נזרע, ‏orphan-DELETE שמפנה ל־CTE של statement אחר, ‏חתימת `metrics_hour_agg` מול §6.6, ‏אריתמטיקת ה־catch-up 48/13-חודשים, ‏exit על גבול שעה עגולה, ‏סטיית finished בין הצורות, ‏עוגן הצהריים) **נפתרו בהסרה**: השכבה כולה ירדה (§6), וה־contingency הנדחית תוכננה כך שאף אחד מהם לא יכול לחזור (grain יומי, statement אחד, אפס מנגנוני עזר).

| # | פגם (מאוחד) | תיקון בגרסה 2 |
|---|---|---|
| 1 | שכבת ה־cache: 8 כשלים קריטיים עצמאיים + הצדקת קיום שנמדדה כבטלה | **הוסרה כולה**; §6.1 מדידות, §6.5 contingency נדחית |
| 2 | Q2 grid: `d::text` על timestamptz ⇒ 22007 על כל הרצה; חסר בלוק פילטרים | §5.3 Q2א — `d::date::text`, `d::date`, פילטרים בתוך ה־ON; אומת אמפירית |
| 3 | Q5: `FILTER` אחרי `/60` ⇒ 42601 בשמונה שורות | §5.6 — aggregate-first, אומת |
| 4 | ה־GiST החלקי לא משרת את Q1/Q2 (אין `NOT is_terminal` בשאילתות) | §3.6/§5.0(9) — כל צרכן `@>`/`&&` נושא את הפרדיקט; נמדד 486ms מול timeout |
| 5 | `finished_cumulative` מוגדר דרך intervals סופיים — סתירה פנימית משולשת בגרסה 1 | §5.3ב — סגירות `route_run` בלבד, `route_run_closed` נהיה load-bearing |
| 6 | ה־reaper: CTE של SELECT לא מובטח לריצה מלאה ⇒ בליעת events תלוית planner | §4.6 — `array_agg` כופה צריכה מלאה |
| 7 | סדר release 2: מסלול כתיבה לפני backfill ⇒ כל הגשה על פריט ותיק נופלת | §8 — סדר הפעלה 2→4→3, Tier-1 בתוך סקריפט ה־apply, ריצה חוזרת ב־cutover; **וגם** auto-open ב־`metrics_record` (§4.2) |
| 8 | `manual_override` על פריט גמור ⇒ `RAISE no open route_run`; ענף `'reroute'` היה קוד מת | §4.2 — auto-open מכסה; `'reroute'` הוצא מטקסונומיית ה־events (נשאר exit_reason) |
| 9 | סתירת `is_trusted` של Tier-1 (§4.3 מול ה־SQL) ⇒ דשבורד ריק או שער בלתי עביר | §4.3 — טבלת אמון אחת: Tier-1 trusted, החרגת משכים דרך NULL; Tier-2/correction false |
| 10 | `station-counters.ts` → Q3 לא הוקצה לאף שלב אך "אומת" בשלב 8 | §8 שלב 5 — פריט עבודה מפורש + parity |
| 11 | טרים `item_state_interval_history`: ‏`p_archive DEFAULT true` ⇒ 42P01 בתוך submit; 8 הפניות תלויות | §3.6/§3.7 — הטבלה, הפרמטר, Q9, prune-history וכל ההפניות הוסרו יחד; as-of דרך replay (§12.5) |
| 12 | טרים `metric_scope_type`: ‏FK מ־rollup_hour היה נשבר | נפתר בהסרה — אין rollup_hour; enum ב־scope.ts; CHECK ב־contingency |
| 13 | טרים `work_span_stage` ל־TEMP: ‏connection affinity של ה־Pool | §3.5 — טרנזקציה אחת: TEMP `ON COMMIT DROP` + INSERTs + build + flip |
| 14 | טריגר ה־drift: רץ מיום המיגרציה מול ledger ריק ⇒ drift_open תקוע לנצח | §3.8/§8 — נוצר DISABLED, מופעל בסוף Tier-1 |
| 15 | טריגר ה־drift: הפעלה פר־row-version ⇒ שורת drift מזויפת לכל השלמת מסלול | §3.8 — השוואה מול השורה המחויבת (re-read), לא מול NEW |
| 16 | `pg_dump -Fc` בלי שכתוב restore ⇒ אף נוהל שחזור לא עובד ביום האסון | §8 שלב 2/§10.3 — `.dump` + `pg_restore -j 4` + `restore.sh` דו־דורי + RUNBOOK, באותו PR |
| 17 | `check-migration-safety.js` מחפש DROP TABLE אבל Prisma תפלוט DROP INDEX/CONSTRAINT | §8 שלב 2 — regex מורחב + רשימת שמות הכוללת אינדקסים/constraints + חובת `--create-only` |
| 18 | `/api/health/schema` + שער הגרסה נוצרים בשלב מאוחר מדי | §8 — ה־route בשלב 2, הסירוב־לשרת ב־image של שלב 3, ניסוח §10.2(4) תוקן |
| 19 | `/api/health/jobs` תחת prefix ציבורי — הגנת middleware לא תעבוד | §8 שלב 5/§10.2 — self-gate ב־handler + שתי בדיקות; health/schema נשאר public במוצהר |
| 20 | Tier-1 שביר: יתומים מפרים את שוויון הספירות; `finished_at < created_at` מפיל CHECK | §8 שלב 4 — clamp `GREATEST` (גם ב־(ב)), אימות עם JOIN, דוח pre-flight שלישי |
| 21 | `clock_timestamp()` הוצג כמונוטוני; מפתח סדר 2-חלקים מול 3-חלקים | §3.3/§4.2/§7.5 — נעילה לפני חותמת + clamp; מפתח משולש `(occurred_at, seq, event_id)` בכל מקום |
| 22 | חוסר סימטריית שעונים ב־Q3/Q4/Q5/Q8 | §5 — זוג מלא לכל מדד; כלל §5.0(10) |
| 23 | דוגמת הדגל (45 דק' לא 10) וקבוע הבדיקה (1,500s לא 600s) סתרו את ה־seed | §2.8/§7.4/§9.2ב — חושבו מחדש; נוסף הווריאנט 15:40=600s |
| 24 | `s.is_sent = false` מפיל משלוחי NULL מה־scope | §5.1/§5.8 — `IS NOT TRUE`; fixture כולל NULL |
| 25 | REVOKE בלי GRANT ⇒ מעבר עתידי ל־app_rw שובר כל הגשה | §3.11 — GRANT מותנה ב־DO block + checklist §11.3 |
| 26 | אביזרים: אין שום call site שפולט test_started ⇒ ההבטחה של §4.7 ריקה | §4.5 ‎#15 + §4.7 + כלל §5.0(8) — הזוג הסינתטי + החרגת משכים |
| 27 | ה־UPDATE ל־done ב־:458 נחשף (עם מחיקת finished_item) בלי כיסוי event | §4.5 ‎#11(א) |
| 28 | `station_reassigned`: שני אתרים באותה הגשה בלי seq ⇒ בליעה; אתר :206 חסר; אין מפתח ל־no_station_for_type | §4.4/§4.5 ‎#12 — seq מפורש לכל אתר + שורת מפתח |
| 29 | call site ‎#14 בלי ‎#5 ⇒ תוצאות מחקר נעלמות מ־Q8 | §4.5 ‎#14 + בדיקת §9.2ו |
| 30 | reaper נופל כולו על שורת legacy בלי run פתוח | §4.2 auto-open (במקום EXISTS-guard) |
| 31 | `testing_routes` בלי unique על (type, number) — האינדקס החדש עלול ליפול באמצע apply | §3.7/§8 שלב 2 — דוח כפילויות ב־pre-flight |
| 32 | "קליטה־עד־שילוח" מופה ל־turnaround של מסלול פריט | §5.8/§5.10 — שני מדדים בשמות נפרדים; רגע השילוח מ־`shipments` |
| 33 | 12 אינדקסים על טבלת הליבה, חלקם בלי צרכן; "כולם נדרשים" היה שקר | §3.6/§6.2 — 4 משניים + טבלת הצדקה + כלל הוספה על ראיה |
| 34 | selfcheck/משימות מפנים לאובייקטים שירדו | §3.10 — 11 בדיקות; §10.1 — 3 משימות; drift מוסר במיגרציה B |
| 35 | ספירות סותרות (23/24 טבלאות, 6/7 משפחות, 9/15 מתודות, "36 קבצים", "26 אובייקטים") | §1/§8/נספח ב — נוסחה אחת: 23 snapshot כולל hourly; 7 משפחות; 15=1+2+12; 28 קבצים+עץ; 28 אובייקטי legacy+3 פיגום |
| 36 | שם המיגרציה כפול (20260824 מול 20260825) ו־typo ‏`_prisma_binaries` | §3 כותרת/§8/§10.4 — ‏`20260825000000_metrics_ledger_additive`; ‏`_prisma_migrations` |
| 37 | אימות שלב 2 "בייט־בייט" נכשל בהכרח על מה שהמיגרציה עצמה מוסיפה | §8 שלב 2 אימות 6 — נוסח מתוקן (עמודות זהות; טריגר כבוי + FK NOT VALID מצופים) |

### 11.2 סיכונים שנשארו פתוחים, עם המיטיגציה

| סיכון | מיטיגציה |
|---|---|
| מסכים מציגים מספרים שונים אחרי ההגירה (שינויי ההגדרה של §9.4 אמיתיים) | §9.4 רשימה סגורה + אישור בכתב לפני שלב 5; רתמת parity מדפיסה diff לכל שדה |
| שני מודלים חיים במקביל (`item_routes` נשאר מקור האמת התפעולי) | בחירה מודעת של גרסה 1; ה־drift מוכיח כיסוי עד מיגרציה B; החלפת `item_routes` ב־view היא החלטה עתידית |
| p95 יחצה אי־פעם את הסף | §6.4 קריטריון מדיד + §6.5 contingency מתוכננת מראש, אפס חוב הגירה |
| ערכי Task Scheduler בפרודקשן לא ניתנים לאימות מהריפו | אישור מפעיל לפני שלב 1; `8-register-tasks.ps1` מנרמל |
| 6 רכיבי קבוצה C מסומנים `M` ב־git | commit/stash לפני שלב 6 |
| `test_stations.status` נעילה חד־תאית שגויה | נמדד, לא מתוקן — פרויקט נפרד (§10.6) |
| `Timestamp(6)` נטול־אזור בטבלאות ישנות | אף שאילתת מטריקה לא קוראת מהן זמן, פרט ל־Q7 `shipment_date` בהמרה מפורשת ומתועדת |

### 11.3 החלטות פתוחות (לאישור המשתמש לפני השלב הרלוונטי)

1. **Tier 2 backfill — להריץ?** ההמלצה: לא (מספרים שגויים ידועים יצוטטו בישיבה). אם כן: `is_trusted=false`, toggle, קו epoch.
2. **אישור 14 שינויי ההגדרה של §9.4** — לפני שלב 5, בכתב.
3. **`shipments.amount` כמכנה — מאושר לביטול?** ההשלמה נמדדת מול המדגם המנותב.
4. **הגדרת "בהמתנה" בברירת מחדל בכל מסך** — צר (`{2}`) או רחב (`{2,4}`).
5. **תקרת 13 חודשים ב־UI — מאושרת?** "מאז ומתמיד" = ייצוא.
6. **RLS/`app_rw`** — לא בגרסה 1; ה־checklist המלא (כולל GRANTs — §3.11) שמור להחלטה עתידית.
7. **מי מאשר את שלב 7 (ההרסני)** — בעל החלטה מוגדר; "שבוע ירוק" הוא קריטריון, לא תאריך.
8. **גורל גלאי ה־drift אחרי מיגרציה B** — ההחלטה הנוכחית: נמחק עם B (פיגום). אם יתווסף אי־פעם כותב `item_routes` חדש בעוד `item_routes` הוא עדיין מקור האמת התפעולי — ה־`CREATE` האידמפוטנטי שמור ב־runbook והפעלה מחדש היא זולה. זו ההחלטה הפתוחה היחידה שמקורה בממצא ביקורת שלא אומץ במלואו (הביקורת המליצה להשאיר; החלטת המשתמש גוברת, עם דלת החזרה מתועדת).
9. **`shipments.is_sent` — לקבע `NOT NULL DEFAULT false`?** ה־SQL כבר עמיד (`IS NOT TRUE`); קיבוע הסכימה הוא שיפור עתידי זול (UPDATE אחד + ALTER), לא תנאי.
10. **מיגרציית `Timestamp(6)` → `timestamptz` בטבלאות הישנות** — לא בגרסה 1.

---

## 12. נספח

### 12.1 הערכת מאמץ

הערכות למפתח backend אחד שמכיר את הריפו. "ימים" = ימי עבודה מלאים.

| שלב | תיאור | הערכה | סיכון |
|---|---|---|---|
| 0 | תנאים מוקדמים (בביצוע) | **3–4** | נמוך |
| 1 | הריסת קוד מת קבוצה A | **0.5–1** | נמוך מאוד |
| 2 | מיגרציה A + לוח שנה + סקריפט apply (כולל Tier-1) + גיבוי/שחזור | **4–5** | בינוני — פחות DDL מגרסה 1 (אין §6), נוסף שכתוב restore |
| 3 | מסלול הכתיבה (15 call sites, 31 מסלולי פליטה) | **6–7** | **גבוה** — `results/route.ts` הוא הקובץ המורכב בריפו; הבדיקות הן חצי מהמאמץ |
| 4 | Backfill Tier 1 — אימות ושערים (ה־SQL בשלב 2) | **1–2** | נמוך; האימות מול `station_live_counters` הוא השער החשוב בתוכנית |
| 5 | מסלול הקריאה (8 endpoints, 8 שאילתות) + station-counters + השגחה | **7–9** | **גבוה** — רתמת ה־parity ושיחת §9.4 הן המאמץ |
| 6 | קבוצה C (6 endpoints + 6 רכיבים) | **3–4** | בינוני |
| 7 | מיגרציה B (הרסנית) | **0.5–1** | נמוך טכנית, גבוה ארגונית |

**סה"כ: ~25–33 ימי עבודה** (גרסה 1: ‏33–44; הפער — שלב ה־rollup שירד, ה־DDL שהצטמצם, ורתמת parity בלי מסלול cache), כ־5–7 שבועות למפתח יחיד, בהנחת שבוע ה־dual-run רץ במקביל לשלבים 5–6.

### 12.2 סדר העבודה — רכבת ה־releases

```
release 1  (שבוע 1)      שלב 0 (בביצוע) -> שלב 1
                          שני PRs עצמאיים. משפרים את המערכת גם אם התוכנית תיעצר כאן.

release 2  (שבועות 2-3)  קוד: שלב 2 -> שלב 3 (PRs); שלב 4 = SQL בתוך סקריפט ה-apply
                          הפעלה בפרודקשן: 2 -> 4 -> 3   [נסיעת USB #1: DB + compose + backfill]
                          (Tier-1 מורץ שוב, אידמפוטנטית, ב-cutover של 3)
                          תחילת שבוע ה-dual-run. הדשבורד עדיין קורא מהמערכת הישנה.

--- שער: 7 ימים עם drift_open = 0 ועם Q3 == station_live_counters ---

release 3  (שבועות 4-5)  שלב 5 (endpoint אחר endpoint, מאחורי רתמת ה-parity) -> שלב 6

--- שער: parity ירוק + אישור המשתמש בכתב ל-§9.4 ---

release 4  (שבוע 6)      שלב 7 (מיגרציה B, הרסנית)  [נסיעת USB #2]
```

**הנתיב הקריטי הוא שלב 3.** הוא נוגע בקובץ שכל המעבדה תלויה בו. אם משהו יידחה — לא הוא.

**שני שערים בלתי ניתנים למשא ומתן:** (1) אחרי release 2 — שבעה ימים רצופים של `drift_open = 0` **ו**־Q3 ≡ `station_live_counters` בכל דגימה: הוכחה ש־31 מסלולי הפליטה מכוסים בפרודקשן אמיתי. (2) לפני שלב 7 — אישור בכתב ל־§9.4.

### 12.3 מדד הצלחה

| מדד | היום | אחרי |
|---|---|---|
| מסלולי פליטה שנרשמים ב־log | 4 מתוך 31 | **31 מתוך 31** |
| מטריקות עם חלון תקין וניתן ל־rebuild | 6 מתוך ~90 | **~90 מתוך ~90** |
| הגדרות סותרות של "בהמתנה" | 2 | **1**, עם 2 הטלות מוצהרות |
| הגדרות סותרות של "אחוז השלמה" | 3 | **1** |
| מקומות שבוחרים בהם טבלת מקור | 4, עם 3 ספים סותרים | **0** — מקור אחד, אין ניתוב |
| טבלאות סיכום/snapshot | 23 | **0** |
| משימות מתוזמנות של מטריקות | 4 (כותבות בדיה) | **3** (אף אחת לא כותבת מטריקה) |
| endpoints ללא הרשאה | 21 | **0** |
| מטריקות שה־UI רומז עליהן ולא קיימות | 6 משפחות | **0** |
| נוהל שחזור | לא קיים | `SELECT isi_rebuild_run(...)`, מוכח ע"י constraint |
| נראות תקלות cron | Task Scheduler בלבד | `job_run` + `/api/health/jobs` + אריח |
| מדידה מודעת־שעות־עבודה | 0 | **כל מטריקת משך**, כזוג "זמן X" / "זמן X בפועל" |

### 12.4 נספח ב — רשימת ההריסה המלאה, לפי שלב

**שלב 0:** 5 npm scripts רפאים; עץ `prod-deploy/db-server/prisma/`; fallback `db push --force-reset`.

**שלב 1 (17 קבצים, 2,245 שורות):** `DashboardContent.tsx`, `KpiCards.tsx`, `TimeSeriesChart.tsx`, `DailyTrendsChart.tsx`, `GenericSelectFilter.tsx`, `WorkerFilter.tsx`, `tests/time-series`, `tests/daily-trends`, `tests/kpis/history`, `tests/customers/history`, `tests/stations/history`, `tests/shipments/history`, `snapshots/available-dates`, `cron/create-hourly-snapshots`, `cron/refresh-views`, `create-all-snapshots-tables.sql`, `DASHBOARD_README.md`. וכן: `TimeSeriesPoint`, `DailyTrendPoint`, `DateRange`, `getLiveSystemStats`, `refreshMaterializedViews`.

**שלב 3 (קובץ 1):** `src/app/api/items/[id]/status/route.ts`.

**שלב 5 (3 קבצים + 3 פרמטרים):** `status-names.ts`, `date-periods.ts`, `calculateWorkDuration` (מתוך `datetime.ts`); `showSent`, `itemId`, `statusRef`.

**שלב 6 (2 קבצים):** `snapshot-tables.ts`, `usePeriodFilter.ts`.

**שלב 7 (5 קבצים + 28 אובייקטי DB legacy + 3 פיגום):** `create-daily-snapshots`, `create-monthly-snapshots`, `run_daily_snapshot.bat`, `run_monthly_snapshot.bat`, `metrics-service.ts`; ‏23 טבלאות snapshot (כולל `station_hourly_snapshots`), `station_live_counters`, `finished_item`, `mv_station_stats` + האינדקס, הטריגר `trg_update_station_counters`, הפונקציה `update_station_counters`; ‏`metrics_drift` + `trg_metrics_drift` + `metrics_detect_drift`.

**חשבון `MetricsService` (15 מתודות):** 1 מחולצת (שלב 0: `getStationLiveCounters`) · 2 נמחקות (שלב 1: `getLiveSystemStats`, `refreshMaterializedViews`) · 12 נמחקות עם הקובץ (שלב 7).

### 12.5 נספח ג — שחזור as-of (מחליף את Q9 ואת טבלת ההיסטוריה)

"הדוח שהודפס ב־1 באוגוסט אמר 40 בתור; למה עכשיו 38?" — ה־spine עונה בלי טבלה נוספת: משחזרים את ה־ledger כפי שהיה ידוע ברגע `sys_at` על ידי replay שמתעלם מכל מה שנרשם אחריו.

```sql
BEGIN;
CREATE TEMP TABLE asof_interval (LIKE item_state_interval INCLUDING DEFAULTS) ON COMMIT DROP;
-- replay פר-run של האירועים שהיו ידועים ב-sys_at, בדילוג על תיקונים מאוחרים:
--   SELECT ev.* FROM item_state_event ev
--   WHERE ev.route_run_id = :run AND ev.kind = 'transition'
--     AND ev.recorded_at <= :sys_at
--     AND NOT EXISTS (SELECT 1 FROM item_state_event c
--                     WHERE c.supersedes = ev.event_id AND c.recorded_at <= :sys_at)
--   ORDER BY ev.occurred_at, ev.seq, ev.event_id
-- מזינים גרסת isi_apply_one שכותבת ל-asof_interval (סקריפט מוכן ב-RUNBOOK_METRICS.md);
-- ואז שאילתת ה-@> הרגילה על asof_interval עם :valid_at.
COMMIT;
```

בקצב של המעבדה זו ריצה של שניות. זה **כל** מה ש־Q9, `item_state_interval_history`, שני האינדקסים שלה ו־cron הגיזום החודשי סיפקו — יכולת לשאלה שנשאלת אולי פעם בשנה, שנבנתה מחדש כאן כמתכון של עשר שורות במקום כתשתית חיה.

---

*סוף המסמך. גרסה 2 — ledger-only. נכתב 2026-08-24; מחליף את גרסה 1 במלואה.*
