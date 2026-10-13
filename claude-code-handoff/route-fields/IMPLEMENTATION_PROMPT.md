# שדות בעמדות — פרומפט ביצוע ל-Claude Code

**מטרה:** להוסיף ל-`amitlin1/testingsite` הגדרה של **השדות שהעובד ממלא בכל עמדה**, לכל מסלול בדיקה. היום השדות קבועים בקוד של כל חלון. אחרי השינוי, לכל מסלול (`testing_routes` = `item_type_id` + `route_number`) המנהל מגדיר לכל שלב, ולכל פריט במארז, אילו שדות העובד ממלא. ההגדרה נשמרת כ-JSON, עוברת טיוטה → פרסום → גרסאות, ומוזרקת לחלונות **הקיימים** בלי לשנות את המעטפת שלהם.

סוג השדה ברירת המחדל הוא **שורת בדיקה** (`choice_row`): שורה אחת = `[שם השדה] | [autocomplete עם כ-4 אפשרויות] | [הערה]`. לכל אפשרות יש טון: תקין / אזהרה / כשל / ניטרלי. כשנבחר ערך בטון כשל, מתחת לשאלת התקינות מופיעה הצעה "מוצע: לא תקין — …", **והעובד מחליט**.

**עמדה בלי הגדרה מפורסמת נשארת בדיוק כמו היום.** זה הבסיס להפעלה הדרגתית: אין שום שינוי התנהגות עד הפרסום הראשון.

---

## העיצוב סגור: הארטבורדים הם המקור, אין להמציא טקסט, צבע או מצב

העיצוב סגור ומאושר. 19 ארטבורדים בתיקייה `design/` (מפה מלאה ב-`README.md`). כל אחד הוא קובץ `.dc.html` עובד: פותחים בדפדפן, `support.js` יושב לידם. ב-`screenshots/` יש PNG לכל ארטבורד.

**איך קוראים ארטבורד:** את ה-DOM, **ואת `<script type="text/x-dc">` שבתחתית הקובץ**. שם נמצאים ה-state ההתחלתי, הנוסחאות לטקסטים דינמיים (יחיד/רבים, "נותרו N…"), רשימות השדות לדוגמה וכל מעברי המצב. העתיקו משם.

**כללים:**
1. **אין להמציא טקסט, צבע או מצב שלא מופיע בארטבורד.** כל מחרוזת עברית במסמך הזה מצוטטת מארטבורד או מהקוד הקיים.
2. מה שלא מצויר באף ארטבורד מסומן כאן **(לא אומת)**. לא ממציאים לו טקסט: רושמים אותו ב-PR תחת **"טקסט לאישור"** ומשאירים placeholder ברור בקוד (קבוע אחד בקובץ `labels.ts` עם הערת `// COPY-PENDING`).
3. **מקורות האמת לפי סדר עדיפות:** (א) ההחלטות במסמך הזה; (ב) הארטבורדים; (ג) הקוד הקיים. לחלון העובד בשלב 1 המקור הוא ארטבורדים **12–18** (`Legacy*.dc.html`). ארטבורדים 5–6 הם רפרנס לרכיב השורה בלבד, ו-7 הוא שלב 3 (אופציונלי).
4. **שתי הערות על ה-DOM של הארטבורדים:**
   - פס הצד של האפליקציה ושורת הלשוניות של ההגדרות מצוירים בארטבורדים ידנית ובקיצור. **לא משכפלים אותם.** הם כבר קיימים ב-`AppShell` וב-`src/app/settings/layout.tsx`.
   - בארטבורדים 12–18 יש מסגרת כחולה `outline: 1px solid #cfe3fb` וצל `inset 0 0 0 1px #cfe3fb` סביב מה שחדש (`markOutline`). זו **הערת עיצוב** שמסמנת "מה חדש", **לא** חלק מהממשק. לא מממשים אותה.

**מצב הריפו:** כל ציטוט קוד במסמך נבדק מול `amitlin1/testingsite` בקומיט `94c96d8` (Merge design/ui-polish-audit), שהוא גם `origin/main` (נבדק ב-`git fetch` ב-2026-10-13). מספרי שורות יכולים לזוז ב-±3 אם נכנסו קומיטים מאז; חפשו את הקוד המצוטט, לא רק את המספר.

---

## 0. מילון, מה קיים היום, ושפה חזותית

### 0.1 מילון

| מונח | פירוש | איפה בקוד / הערה |
|---|---|---|
| **מסלול** (route) | שורה ב-`testing_routes`, מזוהה ע"י (`item_type_id`, `route_number`) | `prisma/schema.prisma:361-369`. ייחודיות באינדקס ידני ושמור `testing_routes_type_number_uq` (`prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql:764`). אין למסלול שם בקוד. ההגדרה של השדות **שייכת למסלול**. |
| **שלב** (step) | מקום אחד במערך `route_steps` (מזהי סוגי עמדה) | בזמן ריצה 1-based: `route_steps[current_route_step-1]` ב-JS (`src/app/lib/station-assignment.ts:128-134`), ו-`route_steps[current_route_step]` ב-SQL (`src/app/api/testing/items/route.ts:100`). **אותו סוג עמדה יכול להופיע פעמיים באותו מסלול.** |
| **step uid** | מזהה יציב לשלב (`s_xxxxxxxx`), שזז יחד איתו כשמזיזים או מסירים שלבים. **חדש** | `testing_routes.step_uids`, מערך מקביל ל-`route_steps` (§1). **ההגדרה תמיד לפי uid, אף פעם לא לפי אינדקס.** |
| **עמדה ברמת מארז** | סוג עמדה עם `test_stations_type.package_level = true` (`schema.prisma:350`): פתיחת מארז, סגירת מארז. התור מציג קופסאות, והחלון מציג **את כל המארז בכרטיס אחד** | בחירת האשף: `packageKindOf` (`src/app/testing/page.tsx:62-65`, `:1446`) |
| **עמדה ברמת פריט** | כל שאר העמדות. כל פריט נבדק לבד, בחלון שנבחר ב-`mainPopUp.ts` | |
| **הגדרת שדות** (config) | ה-JSON שמתאר לכל שלב, לכל יעד, אילו שדות העובד ממלא | `fields_draft` / `route_field_versions.config` (§2) |
| **יעד** (target) | למי שייכת קבוצת שדות בתוך שלב | `item` = פריט בעמדה ברמת פריט. בעמדה ברמת מארז: `box` = **הקופסה** ("שדות על המארז עצמו"), `each_item` = **כל פריט במארז** ("שדות משותפים לכל הפריטים"), `{ item_type_id }` = סוג פריט מסוים במארז |
| **שורת בדיקה** (`choice_row`) | סוג השדה ברירת המחדל | ארטבורד 3: "שם · בחירה מ-4 אפשרויות · הערות" |
| **טון** | הסוג של כל אפשרות: `pass` / `warn` / `fail` / `neutral` = "תקין" / "אזהרה" / "כשל" / "ניטרלי" (`StationFieldEditor.dc.html`, "סוג האפשרות") | מוצג **תמיד כנקודה + מילה** |
| **מצב הערות** | `off` / `optional` / `required_on_fail` / `required` = "ללא" / "אופציונלי" / "חובה בכשל" / "חובה" | ארבע התוויות מופיעות ב-`StationFieldEditor.dc.html` (הסקריפט: `{ k: 'required_on_fail', l: 'חובה בכשל' }, { k: 'required', l: 'חובה' }`) |
| **רשימת אפשרויות** | רשימה משותפת עם גרסה (`option_lists`). השדה **מעתיק** את האפשרויות ושומר `list_ref: {id, ver}` | ארטבורד 4 |
| **ערכת שדות** | תבנית של כמה שדות עם גרסה (`field_sets`). התא מעתיק ושומר `from_set: {id, ver}`. עדכון מוצע לאישור | ארטבורדים 8–9 |
| **תא** | צומת של עמדה (עמודה) × פריט/יעד (שורה) במפת השדות | ארטבורד 1 |
| **טיוטה** | `testing_routes.fields_draft`. נשמרת אוטומטית ("נשמר אוטומטית לפני רגע") ואינה משפיעה על העמדות | |
| **פרסום** | "פרסום לעמדות". כותב גרסה חדשה ל-`route_field_versions` ומעלה את `testing_routes.fields_version` | ארטבורד 10 |
| **גרסה מוקפאת** | `item_routes.fields_version`: הגרסה שהפריט או המארז קיבלו בקליטה. החלון נבנה לפיה עד סוף המסלול | `NULL` = חלון קבוע |
| **חלון קבוע** | החלון של היום, בלי שדות. בארטבורד 1: "ללא שדות — העובד יראה את החלון הקבוע" | זה ה-fallback בכל מקרה של ספק |
| **משותף** | שלב ברמת פריט נשמר במסלול של **סוג הפריט**, ולכן משותף לכל מארז שמכיל את הסוג הזה באותו מספר מסלול | "משותף ל: …", "צור מסלול נפרד למארז הזה" |
| **הצעת פסק דין** | שורה מחושבת מתחת לשאלת התקינות: "מוצע: לא תקין — '<שדה>' = <ערך>". **העובד מחליט** | |

### 0.2 מה קיים היום בקוד (עובדות)

- **אין שום הגדרת שדות.** `testing_routes` מכיל רק `test_route_id, item_type_id, test_station_type_id, route_steps Int[], route_number` (`schema.prisma:361-369`). השדות קבועים בקוד של כל חלון. `route_steps` nullable עם ברירת מחדל ריקה (`prisma/migrations/0_init/migration.sql:570`).
- **מסך המסלולים** (`src/app/settings/testing-routes/page.tsx`, 351 שורות, `"use client"`) עורך את `route_steps` "חי", בלי טיוטה. ה-state הוא `steps: number[]` (`:39`). הוספה/הסרה/הזזה הן פעולות על אינדקס (`handleAddStep` `:115`, `handleRemoveStep` `:122`, `handleMoveStep` `:128`), המפתח בשורות הוא `key={index}` (`:295`), והשמירה שולחת `{item_type_id, route_number, route_steps}` ב-POST או ב-PUT (`handleSave` `:140-179`, הגוף ב-`:145-149`).
- **API המסלולים:**
  - `GET /api/settings/testing-routes` מחזיר `[]` גם כשה-DB נכשל (`src/app/api/settings/testing-routes/route.ts:28-32`, הערה "Return empty array instead of error to prevent frontend crashes"). המסך מפרש מערך ריק כ"מסלול חדש" (`page.tsx:93-101`), כך שכשל נראה כמו מסלול ריק — **מסוכן במיוחד כשיש עליו שדות**.
  - `POST` קובע את `test_station_type_id` מהשלב הראשון (`route.ts:54-74`).
  - `PUT /[id]` כותב **רק** `route_steps` (`[id]/route.ts:11-16`) ולא מעדכן את `test_station_type_id`.
  - `DELETE /[id]` ממפה `P2003` ל-409 (`[id]/route.ts:54-58`).
  - `GET /api/testing-routes` עושה `findMany` **בלי `select`** (`src/app/api/testing-routes/route.ts:8-10`) ומשמש את טופס הקליטה (`src/app/components/packages/PackageIntakeDialog.tsx:110`). כל עמודה חדשה ב-`testing_routes` תיסע ללקוח אם לא מתקנים את זה.
  - **קוראים מחוץ ל-`src`:** `scripts/seed-packages-demo.mjs:202-232` (GET + POST), `scripts/seed-dev-dataset.js:541-564` (GET + PUT + POST), `scripts/e2e-packages/lib.mjs:125` (GET). שני סקריפטי הזרע שולחים עוגיית Auth.js עם `roles: ["manager", "mashan", "tester"]` (`seed-packages-demo.mjs:132`, `seed-dev-dataset.js:324`), כך ששער תפקידים `manager`/`tester` לא ישבור אותם. **אף אחד מהם לא שולח `step_uids`** (§3.5).
- **כל קליטה עוברת בנקודה אחת:** `POST /api/items` מחזיר 410 (`src/app/api/items/route.ts:75-80`). קליטה = `createPackage` / `addPackageItem` (`src/app/api/packages/route.ts:117`, `src/app/api/packages/[id]/items/route.ts:52`), ושתיהן כותבות את `items` ואת `item_routes` דרך `insertRoutedRow` (`src/app/lib/packages/create-package.ts:134-186`; INSERT ל-`items` ב-`:159`, ל-`item_routes` ב-`:170-174`).
- **שינוי מסלול של פריט קיים** קורה בשלושה מקומות בלבד: שינוי סוג עם איפוס מארז (`src/app/api/items/[id]/route.ts:328-333` → `resetPackageToOpening`, `src/app/lib/packages/reset.ts:30`, ה-UPDATE ב-`:52-60`), ושינוי סוג בלי איפוס (`items/[id]/route.ts:338-350`, עם `route_number: routeNum`, שלב 1).
- **כתיבת תוצאה:** `POST /api/testing/results` (`src/app/api/testing/results/route.ts`, 966 שורות) נועל את שורת `item_routes` (`:161-166`, `SELECT route_number, current_status … FOR UPDATE`), בודק replay לפי `SubmitID` (`:190-199`), טוען הקשר מארז (`:208`), מברר את סוג העמדה (`:220-223`) וכותב את `details` כ-`JSON.stringify(Details)::jsonb` (`:562-571`, השורה ב-`:569`). `Details` מוקלד `unknown` (`:41`, וגם `src/types/index.ts:143`). ה-`catch` הכללי ממפה שגיאות ב-`:934-965`.
- **מה החלונות כותבים היום ל-`details`:**

  | חלון | `details` | מקור |
  |---|---|---|
  | שיקוף / מראה שחורה | `{station, sku, verdict:{ok, note}}` | `src/app/testing/tests-popups/VerdictStation.tsx:70-74` |
  | פירוק / הרכבה | `{station, sku, hasRU, photo:{ok, note, photos}}` | `PhotoStation.tsx:128-132` |
  | פתיחת מארז — כל פריט | `{sku, hasRU, weight, product:{ok, note, photos}, package_id, opening:true}` | `PackageOpenWizard.tsx:251-256` |
  | פתיחת מארז — הקופסה | `{sku, hasRU, pkg:{…}, itemCount, registeredCount, templateCount, labelsPrinted, packageItemIds, opening:true}` | `PackageOpenWizard.tsx:267-272` |
  | סגירת מארז — כל פריט שהגיע | `{closing:true, packed:true, package_id}` | `PackageCloseWizard.tsx:97` |
  | סגירת מארז — הקופסה | `{sku, hasRU, closing:true, checks, note, packed, decisions}` | `PackageCloseWizard.tsx:108-112` |
  | חלון ברירת מחדל (`PopUpTestDialog`) | **אין `Details` בכלל** | `src/app/components/PopUpTestDialog.tsx:71-82` |

- **בפתיחה ובסגירה כל פריט נשלח בנפרד** ל-`/api/testing/results` עם אותו `SubmitID`, ורק אחריהם הקופסה (`PackageOpenWizard.tsx:241-275`, `PackageCloseWizard.tsx:88-113`). בסגירה, פריט שלא הגיע לעמדה **לא** מקבל שורת תוצאה (`PackageCloseWizard.tsx:92`), וההחלטה עליו נשמרת על הקופסה ב-`decisions`.
- **בחירת החלון:** `REGISTRY` ב-`src/app/testing/tests-popups/mainPopUp.ts:26-31` ממפה מזהים קבועים (2 פירוק, 3 שיקוף, 4 מראה שחורה, 5 הרכבה). כל סוג אחר מקבל `PopUpTestDialog` (`:36-37`). יש TODO (`:11-12`): "switch to a stable key… so an id edit in Settings can't unmap a wizard". אשפי המארז נבחרים לפי `package_level` (`page.tsx:1444-1447`).
- **zod אינו תלות ישירה** ב-`package.json`. הוא כן מותקן טרנזיטיבית (`package-lock.json:12267`, zod 3.25.76, דרך puppeteer-core → chromium-bidi ו-eslint-plugin-react-hooks) — אבל **אסור לייבא** חבילה שאינה תלות ישירה: הגרסה שלה נקבעת ע"י תלות אחרת ויכולה להיעלם בעדכון. הוספה כתלות ישירה מחייבת לעדכן את המטמון של הבנייה ה-offline (`docs/RUNBOOK_OFFLINE_BUILD.md`), וזו הסיבה להימנע ממנה. לכן **ולידטורים ב-TypeScript נקי** (§2.3). סכמות zod בנספח א' — רק אם תאושר תלות.
- **בדיקות:** `npm test` = `node --import tsx --test "src/**/*.test.ts"` (`package.json:10`). `node:test` + `node:assert/strict`. אין Jest/Vitest/Playwright, ואין CI (אין `.github`).

### 0.3 שפה חזותית

- **טוקנים בלבד** מ-`src/styles/tokens.css`. גופן Rubik (מקומי, `src/app/layout.tsx:10`). רכיבי `sh-*` / `@/components/ui`. אייקונים: `lucide-react` ישירות עם `strokeWidth={1.75}`, כמו ב-`src/app/settings/testing-routes/page.tsx:4,254`, `src/app/testing/tests-popups/PackageOpenWizard.tsx:3` ופרימיטיבי ה-ui (`Chips.tsx:84`, `Dialog.tsx:118`, `Select.tsx:121`). (מסך הבדיקות `src/app/testing/page.tsx:33-40` מייבא אייקונים דרך המתאם בשמות MUI `@/components/ui/icons` — בקוד חדש להשתמש ב-lucide ישירות.) RTL: `padding-inline-*`, `inset-inline-*`; `dir="ltr"` + `unicode-bidi: isolate` על מזהים, מק״ט, מספרים ויחידות. `font-variant-numeric: tabular-nums` על כל מספר.
- **ארבעת צבעי הטון** הם החריג היחיד, והם כבר טוקנים של נקודות סטטוס (`tokens.css:21,44,58,60`):

  ```css
  --rf-tone-pass:    var(--color-status-approved); /* #1f8a5b */
  --rf-tone-warn:    var(--color-status-late);     /* #d97706 */
  --rf-tone-fail:    var(--color-destructive);     /* #bf3535 */
  --rf-tone-neutral: var(--color-ink-muted-40);    /* #9a9aa0 */
  ```

  - טון מוצג **תמיד כנקודה + מילה**. טקסט בצבע טון רק ל-fail (`--color-destructive`). טקסט אזהרה ב-`--color-warning-ink`, טקסט הצלחה ב-`--color-success-ink`. `#d97706` ו-`#1f8a5b` מסומנים ב-`tokens.css:58,60` "not for text" / "not for small text" — **לא צובעים בהם טקסט**.
- **ערכים בארטבורדים שאינם טוקן**, ומה משתמשים במקומם:

  | בארטבורד | במימוש |
  |---|---|
  | `#ebebef` (רקע × בצ'יפ) | `color-mix(in srgb, var(--color-ink) 6%, transparent)` |
  | `#dbe9fb` (קו בין תאים בעמודת מארז) | `--color-primary-border` |
  | `#f1d3d3` (גבול התראה ב-14) | `color-mix(in srgb, var(--color-destructive) 25%, transparent)`, כמו `PackageOpenWizard.tsx:336` |
  | `#fbf2f2` (רקע שורה בכשל) | `--color-danger-bg` |
  | `0 10px 34px rgba(17,21,31,.14)` (צל פופאובר) | `--shadow-pop` (`tokens.css:117`), זהה |

- **מטרות מגע:** 44px לפחות לכל דבר לחיץ בחלונות העמדה (טאבלט). חריג: שדה ההערה בחלונות דחוסים, 38px.
- **אין אותיות רישיות ואין letter-spacing בעברית.** משקלים 300/400/600/700 בלבד.

---

## 1. סכימה ומיגרציה

### 1.1 טבלת השינויים

**כלל על:** הכל תוספת (additive). לא מוחקים עמודה, לא משנים מפתח קיים ב-`details`, לא משנים את סדר הכתיבה בטרנזקציה של התוצאות. **שום טבלה לא נוגעת ב-`test_results`** — התוצאה נכנסת ל-`details` הקיים (§2.5).

| שינוי | טבלה | למה כאן ולא במקום אחר |
|---|---|---|
| `step_uids TEXT[]` | `testing_routes` | `route_steps` נערך "חי" ומשמש ב-SQL בהרבה מקומות (`testing/items/route.ts:100`, `testing/results/route.ts:94-97` ו-`499-502`, `station-assignment.ts:112-134`, וגם `metrics_open_run` — הגוף החי הוא ה-`CREATE OR REPLACE` ב-`20260915120000_package_model/migration.sql:135`; ההגדרה המקורית ב-`20260825000000_metrics_ledger_additive/migration.sql:336` הוחלפה). להחליף אותו ב-JSON זה שינוי מסוכן. מערך מקביל, שנכתב **באותו UPDATE** כמו `route_steps`, נותן לכל שלב זהות יציבה בלי לגעת באף קורא קיים. אי אפשר לשים את ה-uids בתוך ה-JSON המפורסם: הוא מוקפא, ו-`route_steps` ממשיך לזוז אחרי הפרסום. |
| `fields_draft JSONB NULL` | `testing_routes` | ההגדרה שייכת למסלול (item_type + route_number), וזו בדיוק השורה. `NULL` = אין טיוטה (זהה לגרסה המפורסמת). |
| `draft_rev INT`, `draft_updated_at`, `draft_updated_by` | `testing_routes` | שמירה אוטומטית ("נשמר אוטומטית לפני רגע", ארטבורד 2) צריכה בקרת מקביליות אופטימית: שני מנהלים על אותו מסלול לא דורסים זה את זה. |
| `fields_version INT NOT NULL DEFAULT 0` | `testing_routes` | מצביע לגרסה המפורסמת האחרונה. 0 = לא פורסם אף פעם. |
| **אין** `fields_published` | — | ההגדרה המפורסמת נשמרת רק ב-`route_field_versions`. פריט בדרך קורא את הגרסה **המוקפאת** שלו, שלרוב איננה האחרונה, ולכן ממילא קוראים מטבלת הגרסאות. עותק נוסף היה רק עוד מקום שיכול להתיישן. |
| טבלה חדשה `route_field_versions` | — | היסטוריה בלתי ניתנת לשינוי: `(test_route_id, version)` ייחודי, `config` קפוא, מי פרסם, מתי, הערת גרסה ("הערת גרסה · תוצג בהיסטוריית הגרסאות", ארטבורד 10), אופן ההחלה ותקציר השינויים. |
| טבלה חדשה `option_lists` | — | רשימות משותפות (ארטבורד 4). השדה **מעתיק** את האפשרויות ושומר `list_ref:{id, ver}`, ולכן מספיקה טבלה אחת עם `version`. |
| טבלה חדשה `field_sets` | — | ערכות שדות ("שמירה כגרסה N", "N תאים משתמשים בגרסה קודמת של הערכה", ארטבורד 8). אותו עיקרון: `from_set:{id, ver}`. |
| `fields_version INT NULL` | **`item_routes`** (לא `items`) | ל-`items` אין `route_number`. `item_routes` הוא 1:1 עם הפריט (`item_id` הוא PK, `schema.prisma:67-86`), מחזיק `item_type_id` ו-`route_number`, וכל שינוי מסלול כותב אליו (§1.5). `NULL` = נקלט לפני הפיצ'ר → חלון קבוע. |

### 1.2 `prisma/schema.prisma` — תוספות

```prisma
model testing_routes {
  test_route_id        Int                @id @default(autoincrement())
  item_type_id         Int
  test_station_type_id Int
  route_steps          Int[]              @default([])
  route_number         Int                @default(1)
  /// Stable id per step, parallel to route_steps (same length, same order).
  /// Written in the SAME update as route_steps; moves with its step on reorder.
  /// Field configs are keyed by these, never by array index.
  step_uids            String[]           @default([])
  /// Unpublished field config (RouteFieldsConfig, src/app/lib/station-fields/schema.ts).
  /// NULL = no pending changes.
  fields_draft         Json?
  /// Bumped on every draft save; PUT .../fields/draft must send the rev it started from.
  draft_rev            Int                @default(0)
  draft_updated_at     DateTime?          @db.Timestamptz(6)
  draft_updated_by     String?            @db.VarChar(255)
  /// Latest published version (route_field_versions.version). 0 = never published.
  fields_version       Int                @default(0)
  item_types           item_types         @relation(fields: [item_type_id], references: [item_type_id], onDelete: NoAction, onUpdate: NoAction, map: "fk_testing_routes_item_type")
  test_stations_type   test_stations_type @relation(fields: [test_station_type_id], references: [test_station_type_id], onDelete: NoAction, onUpdate: NoAction, map: "fk_testing_routes_test_station_type")
  field_versions       route_field_versions[]
}

/// Immutable history of published field configs, one row per (route, version).
/// Results point here through test_results.details.schema {route_id, v, step_uid}.
model route_field_versions {
  id                Int            @id @default(autoincrement())
  test_route_id     Int
  version           Int
  config            Json
  /// Structured "what changed" vs the previous version, for the history view.
  changes           Json?
  note              String?        @db.Text
  /// 'new_only' | 'not_reached' — the choice made in the publish dialog.
  apply_mode        String         @db.VarChar(20)
  /// One publish action can cover several routes (kit + its item routes).
  publish_batch     String         @db.Uuid
  published_at      DateTime       @default(now()) @db.Timestamptz(6)
  published_by      String?        @db.VarChar(255)
  published_by_name String?        @db.Text
  route             testing_routes @relation(fields: [test_route_id], references: [test_route_id], onDelete: NoAction, onUpdate: NoAction, map: "fk_route_field_versions_route")

  @@unique([test_route_id, version], map: "route_field_versions_route_version_uq")
  @@index([publish_batch], map: "idx_route_field_versions_batch")
}

/// Reusable option list (ארטבורד 4). Fields copy the options and keep
/// list_ref {id, ver}; a list edit is offered to linked fields as a draft change.
model option_lists {
  id         Int       @id @default(autoincrement())
  name       String    @db.VarChar(100)
  /// ChoiceOption[] — see schema.ts.
  options    Json
  version    Int       @default(1)
  archived   Boolean   @default(false)
  created_at DateTime  @default(now()) @db.Timestamptz(6)
  updated_at DateTime  @default(now()) @updatedAt @db.Timestamptz(6)
  updated_by String?   @db.VarChar(255)
}

/// Reusable field template (ארטבורד 8). Cells copy the fields and keep
/// from_set {id, ver}; a set update is offered for approval per linked cell.
model field_sets {
  id         Int       @id @default(autoincrement())
  name       String    @db.VarChar(100)
  /// Field[] — see schema.ts.
  fields     Json
  version    Int       @default(1)
  archived   Boolean   @default(false)
  created_at DateTime  @default(now()) @db.Timestamptz(6)
  updated_at DateTime  @default(now()) @updatedAt @db.Timestamptz(6)
  updated_by String?   @db.VarChar(255)
}
```

וב-`item_routes` (`schema.prisma:67-86`) שורה אחת:

```prisma
  /// Field-config version of THIS row's route, frozen at intake
  /// (create-package.ts insertRoutedRow) and re-frozen when the route changes
  /// (retype, package reset). NULL = intake predates station fields → legacy popups.
  /// A kit row freezes the kit route's version; package-level steps of the
  /// items inside it resolve through the KIT row, not their own.
  fields_version        Int?
```

- `published_by` / `updated_by` / `draft_updated_by` = `preferredUsername` מה-session (`src/lib/auth/current-user.ts`). `published_by_name` הוא צילום של שם התצוגה, באותה גישה כמו `20260816103131_add_worker_name_snapshots`. אין טבלת עובדים מקומית.
- **אין `@@unique([item_type_id, route_number])` בסכימה.** הייחודיות קיימת כאינדקס ידני ושמור (`testing_routes_type_number_uq`, ברשימת `GUARDED_NAMES` ב-`scripts/check-migration-safety.js:74`). אסור להוסיף אותו לסכימה ואסור לתת למיגרציה למחוק אותו (§1.4).

### 1.3 המיגרציה

שם: `prisma/migrations/20261013120000_route_station_fields/migration.sql` (התבנית `YYYYMMDDHHMMSS_snake_case` מ-`docs/PRISMA_GUIDE.md`, "Migration naming convention"). הכותרת בעברית במבנה של `20260915120000_package_model/migration.sql:1-21`. **כל פקודה אידמפוטנטית**, כי הליך ה-air-gap מריץ קבצי מיגרציה שוב על DB קיים (`20261006120000_package_contents_drop_manufacturer_sku/migration.sql:17-18`).

```sql
-- ===========================================================================
--  שדות בעמדות — השדות שהעובד ממלא בכל שלב במסלול
-- ===========================================================================
--
--  §1  testing_routes: step_uids (מזהה יציב לכל שלב, מקביל ל-route_steps),
--      fields_draft + draft_rev (טיוטה), fields_version (הגרסה המפורסמת)
--  §2  route_field_versions — היסטוריית פרסומים, בלתי ניתנת לשינוי
--  §3  option_lists, field_sets — רשימות אפשרויות וערכות שדות
--  §4  item_routes.fields_version — הגרסה שהפריט קיבל בקליטה
--
--  תוספות בלבד. פריט עם item_routes.fields_version = NULL ועמדה בלי הגדרה
--  מפורסמת מקבלים את החלון הקבוע של היום.
--  אידמפוטנטי: הליך ה-air-gap מריץ קבצי מיגרציה שוב על DB קיים.
-- ===========================================================================

-- §1 -------------------------------------------------------------------------
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "step_uids"        TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "fields_draft"     JSONB;
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "draft_rev"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "draft_updated_at" TIMESTAMPTZ(6);
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "draft_updated_by" VARCHAR(255);
ALTER TABLE "testing_routes" ADD COLUMN IF NOT EXISTS "fields_version"   INTEGER NOT NULL DEFAULT 0;

-- Backfill: every existing step gets a uid. Only rows that have none yet, so a
-- re-run never re-keys a route whose config already points at its uids.
UPDATE "testing_routes"
   SET "step_uids" = ARRAY(
         SELECT 's_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
           FROM generate_series(1, COALESCE(cardinality("route_steps"), 0)))
 WHERE COALESCE(cardinality("step_uids"), 0) = 0
   AND COALESCE(cardinality("route_steps"), 0) > 0;

-- §2 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "route_field_versions" (
    "id"                SERIAL NOT NULL,
    "test_route_id"     INTEGER NOT NULL,
    "version"           INTEGER NOT NULL,
    "config"            JSONB NOT NULL,
    "changes"           JSONB,
    "note"              TEXT,
    "apply_mode"        VARCHAR(20) NOT NULL,
    "publish_batch"     UUID NOT NULL,
    "published_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "published_by"      VARCHAR(255),
    "published_by_name" TEXT,
    CONSTRAINT "route_field_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "route_field_versions_version_chk" CHECK ("version" >= 1),
    CONSTRAINT "route_field_versions_apply_chk" CHECK ("apply_mode" IN ('new_only', 'not_reached'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "route_field_versions_route_version_uq" ON "route_field_versions"("test_route_id", "version");
CREATE INDEX IF NOT EXISTS "idx_route_field_versions_batch" ON "route_field_versions"("publish_batch");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_route_field_versions_route') THEN
    ALTER TABLE "route_field_versions" ADD CONSTRAINT "fk_route_field_versions_route"
      FOREIGN KEY ("test_route_id") REFERENCES "testing_routes"("test_route_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- §3 -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "option_lists" (
    "id" SERIAL NOT NULL, "name" VARCHAR(100) NOT NULL, "options" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1, "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" VARCHAR(255),
    CONSTRAINT "option_lists_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "field_sets" (
    "id" SERIAL NOT NULL, "name" VARCHAR(100) NOT NULL, "fields" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1, "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(), "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" VARCHAR(255),
    CONSTRAINT "field_sets_pkey" PRIMARY KEY ("id")
);

-- §4 -------------------------------------------------------------------------
ALTER TABLE "item_routes" ADD COLUMN IF NOT EXISTS "fields_version" INTEGER;
```

- **ON DELETE של הגרסאות:** `NO ACTION`, כמו כל ה-FK במודל (`schema.prisma:367-368`). מסלול שפורסם לא נמחק, ו-`DELETE /[id]` כבר מחזיר על זה 409 (`[id]/route.ts:54-58`). אין היום כפתור מחיקה במסך.
- **אין CHECK על אורך `step_uids` מול `route_steps`.** סקריפטי ההסבה לפרודקשן מכניסים שורות ל-`testing_routes` בלי העמודה החדשה (`scripts/prod-package-model/2-upgrade-to-packages.sql:523, 562`; `03-fix-production.sql:179, 218`), ו-CHECK היה מפיל אותם. במקום זה הקוד מתייחס לאי-התאמה באורך כ"מסלול בלי uids": העובד מקבל חלון קבוע, ושמירה הבאה במסך המסלולים משלימה את ה-uids (§3.5).

### 1.4 תהליך המיגרציה — חובה

לפי `docs/PRISMA_UNMANAGED_OBJECTS.md` ("The required workflow"):

1. לערוך את `schema.prisma` לפי §1.2.
2. `npx prisma migrate dev --create-only --name route_station_fields`.
3. **להחליף** את ה-SQL שנוצר ב-SQL של §1.3. ה-diff של Prisma ינסה למחוק אובייקטים שמורים: `testing_routes_type_number_uq` על הטבלה שאנחנו משנים, ו-`ir_item_fk` על `item_routes`. **אסור** להשאיר `DROP` לאף אחד מהם.
4. `npm run db:check-migration` (`scripts/check-migration-safety.js`) — חייב לעבור.
5. `npx prisma migrate dev`, ואחר כך `npm run db:airgap-schema` כדי לבנות מחדש את `prod-deploy/db-server/init/02-app-schema.sql`.
6. `release/db-scripts/UPGRADE_ALL_IN_ONE.sql` נבנה מרשימה קבועה של קבצים (`scripts/build-upgrade-sql.js`). **לא** מוסיפים אליה את המיגרציה הזו; בפרודקשן היא רצה ב-`prisma migrate deploy` רגיל — נתמך חלקית: `prod-deploy/db-server/init/02-app-schema.sql:2945-2947` אומר ש-`prisma migrate deploy` ממכונה מחוברת יריץ רק מיגרציות חדשות; `docs/RUNBOOK_PROD_SERVER.md` לא מזכיר מיגרציות כלל **(לא אומת מול נוהל הפריסה בפועל — לאשר עם צוות הפריסה ולציין ב-PR)**.
7. בשלב 2 (ספריות), להוסיף את הטבלאות החדשות לרשימת `TABLES` ב-`scripts/build-settings-seed.js` (רשימה מפורשת, סביב `:75`), אחרת זרע ההגדרות לשרת ה-DB לא יכלול רשימות, ערכות וגרסאות. **(לא אומת סדר ה-FK הנדרש.)**

### 1.5 איפה הגרסה מוקפאת

| מקרה | קוד היום | מה מוסיפים |
|---|---|---|
| **קליטת מארז וכל פריטיו** | `createPackage` → `insertRoutedRow` (`create-package.ts:256-271` למארז, `:279-294` לכל פריט) → `INSERT INTO item_routes` (`:170-174`) | להוסיף ל-INSERT עמודה `fields_version` עם תת-שאילתה: `(SELECT NULLIF(fields_version, 0) FROM testing_routes WHERE item_type_id = ${itemType} AND route_number = ${routeNumber})`. מסלול שלא פורסם נשמר כ-`NULL` (חלון קבוע). השורה הזו מכסה גם את הקופסה (מסלול המארז) וגם כל פריט (המסלול שלו). |
| **הוספת פריט למארז בפתיחה** | `addPackageItem` → `insertRoutedRow` (`create-package.ts:377-392`) | אותה תת-שאילתה. הפריט שנוסף מקבל את הגרסה המפורסמת **ברגע ההוספה**, שיכולה להיות חדשה משל אחיו. זה תקין: ההגדרה למסלול שלו נקבעת לפי המסלול שלו. |
| **שינוי סוג פריט, בלי איפוס מארז** | `items/[id]/route.ts:338-350` (`item_type_id: nextTypeId`, `route_number: routeNum`, שלב 1) | להוסיף לאותו `update` את `fields_version` של `(nextTypeId, routeNum)` (אותה תת-שאילתה; ב-Prisma: שאילתה קודמת באותה טרנזקציה). |
| **שינוי סוג שמאפס את כל המארז** | `items/[id]/route.ts:328-333` ואז `resetPackageToOpening` (`reset.ts:52-60`, לולאה על המארז וכל פריטיו) | ב-`reset.ts` להוסיף ל-`UPDATE item_routes` את `fields_version = (SELECT NULLIF(tr.fields_version,0) FROM testing_routes tr WHERE tr.item_type_id = ${r.item_type_id} AND tr.route_number = ${r.route_number})`. איפוס = הקליטה בטלה ומתחילים מחדש, ולכן לוקחים את הגרסה הנוכחית. |
| **פרסום עם "גם לפריטים שטרם הגיעו לעמדה ששונתה"** | — | `UPDATE item_routes` ב-endpoint הפרסום (§3.4.3). |

- **אין הקפאה** בחזרה ממחקר (`results/route.ts:282-296`), בשליחה למחקר (`:371-383`) ובהתקדמות שלב (`:427-438`). המסלול לא משתנה, ולכן הגרסה נשארת.
- **פתרון בזמן ריצה:** שלב ברמת פריט נפתר לפי `item_routes.fields_version` של הפריט עצמו מול המסלול שלו. שלב ברמת מארז נפתר לפי `item_routes.fields_version` של **שורת המארז** מול מסלול המארז, גם בשביל שורות הפריטים שבתוכו (§3.3).

---

## 2. צורת ה-JSON (TypeScript + ולידציה)

### 2.1 עקרונות

- **מפתח לפי uid, לא מערך.** `steps` הוא אובייקט שהמפתח בו הוא `step_uid`. כך אי אפשר "בטעות" לקרוא הגדרה לפי אינדקס.
- **כל מזהה נוצר פעם אחת ולא משתנה:** step `s_xxxxxxxx` (בשרת, §3.5); field `f_xxxxxxxx`, option `o_xxxxxxxx`, checklist item `c_xxxxxxxx` (בלקוח, כדי ששמירה אוטומטית לא תחכה לשרת). השרת בודק פורמט וייחודיות.
- **`station_type_id` ו-`station_label` בתוך שלב הם מידע בלבד.** המיפוי בזמן ריצה הוא uid → מיקום ב-`step_uids` → `route_steps[i]`. לכן שינוי מזהה של סוג עמדה (§3.6) לא יכול לנתק הגדרה בשקט.
- **תוויות מועתקות לתוצאה ברגע השמירה** ("שמות האפשרויות נשמרים בתוצאה ברגע השמירה, כך ששינוי שם לא משנה תוצאות שכבר נשמרו.", ארטבורד 8).
- **`layout` שמור לשלב 3** (ארטבורד 7). בשלבים 1–2 השרת שומר אותו כמו שהוא ומתעלם ממנו.
- **מודול אחד, טהור:** `src/app/lib/station-fields/` — `schema.ts`, `validate.ts`, `evaluate.ts`, `diff.ts`, `step-uids.ts`, `resolve.ts` (טהורים: בלי `prisma` ובלי `next`, כי גם החלונות ומסך המנהל מייבאים אותם), ו-`submit.ts` (שרת בלבד). **זה המיקום היחיד** — לא `route-fields/`.

### 2.2 טיפוסים — `src/app/lib/station-fields/schema.ts`

```ts
// ---- primitives -------------------------------------------------------------
export const TONES = ["pass", "warn", "fail", "neutral"] as const;
export type Tone = (typeof TONES)[number];
/** Dot colours — the ONLY non-token colours allowed (decision 10). Always dot + word.
 *  In CSS use the tokens of §0.3; this map is for the pure module / tests only. */
export const TONE_DOT: Record<Tone, string> = { pass: "#1f8a5b", warn: "#d97706", fail: "#bf3535", neutral: "#9a9aa0" };
/** Words as in StationFieldEditor.dc.html ("סוג האפשרות"). */
export const TONE_WORD: Record<Tone, string> = { pass: "תקין", warn: "אזהרה", fail: "כשל", neutral: "ניטרלי" };

export const NOTES_MODES = ["off", "optional", "required_on_fail", "required"] as const;
export type NotesMode = (typeof NOTES_MODES)[number];
/** Admin labels — StationFieldEditor.dc.html script. Listbox order: optional, required_on_fail, required, off. */
export const NOTES_MODE_LABEL: Record<NotesMode, string> = { optional: "אופציונלי", required_on_fail: "חובה בכשל", required: "חובה", off: "ללא" };

/** "אורך מרבי" choices (NotesField.dc.html / StationFieldEditor.dc.html): 500 / 1000 / 2000, default 1000. */
export const NOTE_MAX_CHOICES = [500, 1000, 2000] as const;
export type NoteMax = (typeof NOTE_MAX_CHOICES)[number];
export const NOTE_MAX_DEFAULT: NoteMax = 1000;

export type StepUid = string;   // /^s_[a-z0-9]{8}$/
export type FieldId = string;   // /^f_[a-z0-9]{8}$/
export type OptionId = string;  // /^o_[a-z0-9]{8}$/

export interface ChoiceOption { id: OptionId; label: string; tone: Tone }

// ---- fields -----------------------------------------------------------------
interface FieldBase {
  id: FieldId;
  label: string;                 // "שם השדה"; trimmed, ≤ 80 (empty allowed in a draft → lint error)
  help?: string;                 // "טקסט עזרה לעובד"
  required: boolean;             // "חובה"
  notes: NotesMode;              // "הערות"
  note_max?: NoteMax;            // "אורך מרבי"; absent = 1000
  from_set?: { id: number; ver: number };   // linked to a field set (ארטבורד 8/9)
}

export interface ChoiceRowField extends FieldBase {   // DEFAULT type — "שורת בדיקה"
  type: "choice_row";
  options: ChoiceOption[];       // 0..12 in a draft; keys 1–4 hit the first four
  list_ref?: { id: number; ver: number };   // "רשימה: <name>"; absent = "רשימה: מותאמת לשדה"
}
export interface PassFailField extends FieldBase { type: "pass_fail" }   // "תקין" / "לא תקין"
export interface NumberField extends FieldBase {
  type: "number";
  unit?: string;                 // "יחידה"
  min?: number; max?: number;    // "מינימום" / "מקסימום"
  ref?: number;                  // "ערך ייחוס"
  tol_pct?: number;              // "סטייה מותרת ±%" — only with ref
  out_of_range_fail: boolean;    // 'ערך מחוץ לטווח נחשב "לא תקין"'
}
export interface TextField extends FieldBase { type: "text" }        // "טקסט קצר"
export interface TextareaField extends FieldBase { type: "textarea" } // "טקסט ארוך"
export interface ChecklistField extends FieldBase {
  type: "checklist";             // "רשימת סימון"
  items: { id: string; label: string }[];
}
export interface MultiChoiceField extends FieldBase {
  type: "multi_choice";          // "בחירה מרובה"
  options: ChoiceOption[];
  list_ref?: { id: number; ver: number };
}
export interface PhotoField extends FieldBase {
  type: "photo";                 // "צילום"
  photo_type: string;            // photo_types.code (schema.prisma:184-192)
  min: number;                   // "מינ׳"
}
export interface ScanField extends FieldBase { type: "scan" }        // "סריקה"
export interface SectionField {                                      // "כותרת מקטע"
  id: FieldId; type: "section"; label: string;
}

export type Field =
  | ChoiceRowField | PassFailField | NumberField | TextField | TextareaField
  | ChecklistField | MultiChoiceField | PhotoField | ScanField | SectionField;
export type FieldType = Field["type"];

// ---- groups, steps, route ---------------------------------------------------
/** Who the fields are for. "item" only on per-item steps; the others only on package-level steps. */
export type GroupTarget = "item" | "box" | "each_item" | { item_type_id: number };

export interface FieldGroup { target: GroupTarget; fields: Field[] }

export interface StepConfig {
  uid: StepUid;
  /** Informational snapshot — resolution goes uid → step_uids index → route_steps. */
  station_type_id: number;
  station_label: string;
  /** Copied from test_stations_type.package_level when the step is edited. */
  scope: "package" | "item";
  groups: FieldGroup[];
  /** Phase 3 (ארטבורד 7). Stored, not interpreted before phase 3. Reserved key for open decision #2:
   *  layout.fields_placement: "in_step" | "separate_step". */
  layout?: Record<string, unknown>;
}

export interface RouteFieldsConfig {
  schema: 1;
  steps: Record<StepUid, StepConfig>;
}
```

### 2.3 ולידציה בלי zod — `src/app/lib/station-fields/validate.ts`

שתי פונקציות, באותו קובץ, משותפות ללקוח ולשרת:

- **`parseRouteFieldsConfig(raw)`** — בדיקת **מבנה**. זורקת `ShapeError` על כל דבר שהעורך לא יכול לייצר. כל endpoint שמקבל config קורא לה (400 `SHAPE_*`).
- **`lintRouteFieldsConfig(cfg)`** — בדיקות **תוכן**, ברמות שהארטבורדים מציירים:
  - **שגיאה** — חוסמת פרסום, לא חוסמת שמירת טיוטה. הכותרת הופכת ל"בעיה אחת לתיקון" / "{n} בעיות לתיקון" (ארטבורד 2, `issueLabel`).
  - **אזהרה** — לא חוסמת.

| קוד | רמה | הודעה (מהארטבורד) | מקור |
|---|---|---|---|
| `FIELD_LABEL_EMPTY` | שגיאה | "יש להזין שם לשדה" | `StationFieldEditor.dc.html` |
| `OPTION_LABEL_EMPTY` | שגיאה | "אפשרות ריקה — מלאו או הסירו"; בפס המפה: "{station} · {item}: אפשרות ריקה בשדה '{field}'" | `OptionListEditor.dc.html`, `Main.dc.html` |
| `OPTIONS_TOO_MANY` | אזהרה | "יותר מ-6 אפשרויות — קשה לבחירה מהירה" | `OptionListEditor.dc.html` (סקריפט, שורת האימות) |
| `OPTIONS_TOO_FEW` | אזהרה | "נדרשות לפחות 2 אפשרויות" | `OptionListEditor.dc.html` (סקריפט) |
| `OPTIONS_NO_FAIL` | אזהרה | "אף אפשרות לא נחשבת 'כשל'" | `OptionListEditor.dc.html` (סקריפט) |
| (תקין) | — | "{n} אפשרויות · אחת נחשבת 'כשל'" / "{n} אפשרויות · {k} נחשבות 'כשל'" (ירוק) | `OptionListEditor.dc.html` |
| `OPTIONS_EMPTY` | שגיאה | **(לא אומת — אין טקסט)**. `choice_row`/`multi_choice` עם 0 אפשרויות אי אפשר לפרסם; העובד לא יכול לבחור בו | — |
| `DUPLICATE_LABEL_IN_CELL` | אזהרה (בהחלת ערכה / הדבקה: דילוג) | "שדה '<x>' כבר קיים ב'<y>' — יידלג כדי למנוע כפילות" | `ApplyFieldSetDialog.dc.html` |
| `NUMBER_RANGE` | שגיאה | **(לא אומת — אין טקסט)** למינימום > מקסימום / ערך לא מספרי | — |
| `SHAPE_*` | 400 | שגיאת מבנה טכנית (לא אמורה להגיע מהמסך) | — |

```ts
import { Field, RouteFieldsConfig, StepConfig, TONES, NOTES_MODES, NOTE_MAX_CHOICES, GroupTarget } from "./schema";

export type Issue = {
  level: "error" | "warning";
  code: string;
  step_uid?: string; target?: GroupTarget; field_id?: string; option_id?: string;
  message: string;               // Hebrew, copied from the artboards
};

const ID = { step: /^s_[a-z0-9]{8}$/, field: /^f_[a-z0-9]{8}$/, option: /^o_[a-z0-9]{8}$/, item: /^c_[a-z0-9]{8}$/ };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const isInt = (v: unknown) => Number.isInteger(v);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Structural parse: throws ShapeError on anything the editor could never produce. */
export class ShapeError extends Error { constructor(public path: string, msg: string) { super(`${path}: ${msg}`); } }

export function parseRouteFieldsConfig(raw: unknown): RouteFieldsConfig {
  if (!isObj(raw) || raw.schema !== 1 || !isObj(raw.steps)) throw new ShapeError("$", "expected {schema:1, steps:{}}");
  for (const [uid, step] of Object.entries(raw.steps)) parseStep(uid, step, `$.steps.${uid}`);
  if (JSON.stringify(raw).length > 512_000) throw new ShapeError("$", "config too large");
  return raw as unknown as RouteFieldsConfig;
}

function parseStep(uid: string, s: unknown, p: string): void {
  if (!ID.step.test(uid)) throw new ShapeError(p, "bad step uid");
  if (!isObj(s) || s.uid !== uid) throw new ShapeError(p, "uid mismatch");
  if (!isInt(s.station_type_id) || !isStr(s.station_label, 50)) throw new ShapeError(p, "station");
  if (s.scope !== "package" && s.scope !== "item") throw new ShapeError(p, "scope");
  if (!Array.isArray(s.groups)) throw new ShapeError(p, "groups");
  const seen = new Set<string>();
  s.groups.forEach((g, i) => parseGroup(g, s.scope as "package" | "item", `${p}.groups[${i}]`, seen));
  if (s.layout !== undefined && !isObj(s.layout)) throw new ShapeError(p, "layout");
}

function parseTarget(t: unknown, scope: "package" | "item", p: string): void {
  if (scope === "item" && t !== "item") throw new ShapeError(p, "per-item step accepts target 'item' only");
  if (scope === "package") {
    if (t === "box" || t === "each_item") return;
    if (isObj(t) && isInt(t.item_type_id)) return;
    throw new ShapeError(p, "package step target");
  }
}

function parseGroup(g: unknown, scope: "package" | "item", p: string, seenFieldIds: Set<string>): void {
  if (!isObj(g) || !Array.isArray(g.fields)) throw new ShapeError(p, "group");
  parseTarget(g.target, scope, `${p}.target`);
  if (g.fields.length > 60) throw new ShapeError(p, "too many fields");
  g.fields.forEach((f, i) => parseField(f, `${p}.fields[${i}]`, seenFieldIds));
}

function parseOptions(opts: unknown, p: string): void {
  // 0..12: a draft may be mid-edit; <2 is a lint WARNING (artboard 4), 0 is a publish error.
  if (!Array.isArray(opts) || opts.length > 12) throw new ShapeError(p, "0..12 options");
  const ids = new Set<string>();
  for (const o of opts) {
    if (!isObj(o) || !ID.option.test(String(o.id)) || ids.has(String(o.id))) throw new ShapeError(p, "option id");
    if (!isStr(o.label, 60) || !(TONES as readonly string[]).includes(String(o.tone))) throw new ShapeError(p, "option");
    ids.add(String(o.id));
  }
}

function parseField(f: unknown, p: string, seen: Set<string>): void {
  if (!isObj(f) || !ID.field.test(String(f.id)) || seen.has(String(f.id))) throw new ShapeError(p, "field id (unique per step)");
  seen.add(String(f.id));
  if (!isStr(f.label, 80)) throw new ShapeError(p, "label");
  if (f.type === "section") return;
  if (typeof f.required !== "boolean") throw new ShapeError(p, "required");
  if (!(NOTES_MODES as readonly string[]).includes(String(f.notes))) throw new ShapeError(p, "notes");
  if (f.note_max !== undefined && !(NOTE_MAX_CHOICES as readonly number[]).includes(f.note_max as number)) throw new ShapeError(p, "note_max");
  if (f.help !== undefined && !isStr(f.help, 200)) throw new ShapeError(p, "help");
  switch (f.type) {
    case "choice_row": case "multi_choice": parseOptions(f.options, `${p}.options`); return;
    case "number":
      for (const k of ["min", "max", "ref", "tol_pct"] as const) if (f[k] !== undefined && !isNum(f[k])) throw new ShapeError(p, k);
      if (f.tol_pct !== undefined && f.ref === undefined) throw new ShapeError(p, "tol_pct needs ref");
      if (typeof f.out_of_range_fail !== "boolean") throw new ShapeError(p, "out_of_range_fail");
      return;
    case "checklist":
      if (!Array.isArray(f.items) || f.items.length > 20) throw new ShapeError(p, "items");
      return;
    case "photo":
      if (!isStr(f.photo_type, 50) || !isInt(f.min) || (f.min as number) < 0 || (f.min as number) > 20) throw new ShapeError(p, "photo");
      return;
    case "pass_fail": case "text": case "textarea": case "scan": return;
    default: throw new ShapeError(p, `unknown type ${String(f.type)}`);
  }
}

/** Publish-time checks (errors block publish, warnings don't). Pure; runs in the editor too. */
export function lintRouteFieldsConfig(cfg: RouteFieldsConfig): Issue[] {
  const out: Issue[] = [];
  for (const step of Object.values(cfg.steps)) for (const g of step.groups) for (const f of g.fields) {
    const at = { step_uid: step.uid, target: g.target, field_id: f.id };
    if (!f.label.trim()) out.push({ level: "error", code: "FIELD_LABEL_EMPTY", ...at, message: "יש להזין שם לשדה" });
    if (f.type === "choice_row" || f.type === "multi_choice") {
      for (const o of f.options) if (!o.label.trim())
        out.push({ level: "error", code: "OPTION_LABEL_EMPTY", ...at, option_id: o.id, message: "אפשרות ריקה — מלאו או הסירו" });
      const n = f.options.length, fails = f.options.filter((o) => o.tone === "fail").length;
      if (n === 0) out.push({ level: "error", code: "OPTIONS_EMPTY", ...at, message: COPY_PENDING.optionsEmpty });
      else if (n > 6) out.push({ level: "warning", code: "OPTIONS_TOO_MANY", ...at, message: "יותר מ-6 אפשרויות — קשה לבחירה מהירה" });
      else if (n < 2) out.push({ level: "warning", code: "OPTIONS_TOO_FEW", ...at, message: "נדרשות לפחות 2 אפשרויות" });
      else if (fails === 0) out.push({ level: "warning", code: "OPTIONS_NO_FAIL", ...at, message: "אף אפשרות לא נחשבת 'כשל'" });
    }
    if (f.type === "number" && f.min != null && f.max != null && f.min > f.max)
      out.push({ level: "error", code: "NUMBER_RANGE", ...at, message: COPY_PENDING.numberRange });
  }
  return out;
}
```

(`COPY_PENDING` = קבועים בקובץ `labels.ts` עם `// COPY-PENDING`, ראו "העיצוב סגור" סעיף 2. סדר הבדיקות של `n` הוא בדיוק הסדר בסקריפט של ארטבורד 4.)

**בדיקה מול המסלול החי** — `checkConfigAgainstRoute(cfg, route_steps, step_uids, packageLevelIds)`, בשרת בלבד: כל `step_uid` בהגדרה חייב להופיע ב-`step_uids`, ו-`scope` חייב להתאים ל-`package_level` של `route_steps[i]`. uid שכבר לא קיים במסלול **נמחק מהטיוטה** בשמירה הבאה (§3.5). בגרסה מפורסמת הוא פשוט לא נפתר בזמן ריצה.

### 2.4 דוגמה — "מארז עמדת עבודה · מסלול 1" ומסלול 1 של מחשב

מבוסס על נתוני הארטבורדים. המזהים מומצאים לדוגמה.

```jsonc
// testing_routes(item_type = "מארז עמדת עבודה", route 1).fields_draft
{ "schema": 1, "steps": {
  "s_k1open0": { "uid": "s_k1open0", "station_type_id": 21, "station_label": "פתיחת מארז", "scope": "package",
    "groups": [
      { "target": "box", "fields": [
        { "id": "f_box00001", "type": "choice_row", "label": "שלמות הקופסה", "required": true, "notes": "required_on_fail",
          "options": [ { "id": "o_00000001", "label": "ללא פגמים", "tone": "pass" }, { "id": "o_00000002", "label": "שריטות קלות", "tone": "warn" },
                       { "id": "o_00000003", "label": "שבר/סדק", "tone": "fail" },   { "id": "o_00000004", "label": "לכלוך", "tone": "warn" } ],
          "list_ref": { "id": 3, "ver": 1 } } ] },
      { "target": "each_item", "fields": [ /* "התאמת מק״ט לרשום", "מצב חיצוני" */ ] },
      { "target": { "item_type_id": 14 }, "fields": [ /* מסך: "מעמד", "כבל DisplayPort" */ ] } ] },
  "s_k1close": { "uid": "s_k1close", "station_type_id": 26, "station_label": "סגירת מארז", "scope": "package", "groups": [ /* … */ ] } } }

// testing_routes(item_type = "מחשב", route 1).fields_draft — shared by every kit whose
// package_contents line is (מחשב, route 1)
{ "schema": 1, "steps": {
  "s_pc1elec": { "uid": "s_pc1elec", "station_type_id": 22, "station_label": "חשמל", "scope": "item",
    "groups": [ { "target": "item", "fields": [
      { "id": "f_sec00001", "type": "section", "label": "הפעלה" },
      { "id": "f_led00001", "type": "choice_row", "label": "נורית מתח", "required": true, "notes": "required_on_fail",
        "options": [ { "id": "o_led00001", "label": "תקין", "tone": "pass" }, { "id": "o_led00002", "label": "מהבהבת", "tone": "warn" },
                     { "id": "o_led00003", "label": "לא דולקת", "tone": "fail" }, { "id": "o_led00004", "label": "לא נבדק", "tone": "neutral" } ],
        "list_ref": { "id": 4, "ver": 2 } },
      { "id": "f_gnd00001", "type": "number", "label": "התנגדות הארקה", "required": true, "notes": "optional",
        "unit": "Ω", "max": 0.1, "out_of_range_fail": true, "help": "מדוד בין פין ההארקה לגוף המארז" } ] } ] } } }
```

### 2.5 התוצאה ב-`test_results.details`

**הכלל:**
- **כל מפתח שהחלון כותב היום נשאר בדיוק כמו שהוא** (טבלה ב-§0.2). דוחות, `StationHistoryDialog` ו-`PackageView` לא רואים שינוי.
- **שלושה מפתחות חדשים נוספים לצדם, ורק כשלשלב הייתה הגדרה מפורסמת:** `schema`, `fields`, `verdict`.
- **`verdict` כבר קיים ב-VerdictStation** (`{ok, note}`, `VerdictStation.tsx:73`). מרחיבים אותו באותו אובייקט (`suggested`, `overridden`) ולא מחליפים אותו.
- **העמודות `result`, `passed` ו-`comments` לא משתנות.** הן ממשיכות לבוא מההכרעה של העובד (החלטה 7: העובד מחליט).

```ts
// באותו schema.ts
export interface FieldsSchemaRef {
  route_id: number;              // testing_routes.test_route_id whose version was used
  v: number;                     // route_field_versions.version
  step_uid: StepUid;
  /** What this row answered. "kit_item" = an item row at a package-level step:
   *  route_id is then the KIT route, and fields = each_item + its item_type group. */
  target: "item" | "box" | "kit_item";
}

type Snap = { label: string; note?: string };   // label = field label AT SAVE TIME

export type FieldValue =
  | (Snap & { t: "choice_row"; opt: OptionId | null; opt_label: string | null; tone: Tone | null })
  | (Snap & { t: "multi_choice"; opts: { id: OptionId; label: string; tone: Tone }[] })
  | (Snap & { t: "pass_fail"; ok: "pass" | "fail" | null })
  | (Snap & { t: "number"; value: number | null; unit?: string; in_range: boolean | null })
  | (Snap & { t: "text" | "textarea" | "scan"; value: string })
  | (Snap & { t: "checklist"; items: { id: string; label: string; ok: boolean }[] })
  | (Snap & { t: "photo"; photo_type: string; photos: string[] /* MinIO object keys, as PhotoStation does */ });

export interface FieldsVerdict {
  /** The worker's own decision when the popup has a verdict question
   *  (VerdictStation / PhotoStation / package-open wizard). Absent in PopUpTestDialog
   *  (decision stays in the numeric Result "תוצאת בדיקה") and on close-wizard item rows. */
  ok?: "pass" | "fail";
  note?: string;                 // VerdictStation keeps its existing note here
  /** Computed by evaluateFields() from tones; null when no value drives it. SERVER recomputes. */
  suggested: "pass" | "fail" | null;
  /** ok !== suggested (both set). Recorded, never blocking. */
  overridden?: boolean;
}

export interface FieldsResultBlock {
  schema: FieldsSchemaRef;
  fields: Record<FieldId, FieldValue>;   // section fields are never stored
  verdict: FieldsVerdict;
}
```

### 2.6 חישוב "מוצע" ושערי סיום — `src/app/lib/station-fields/evaluate.ts` (טהור)

```ts
export const GATE_FINISH_ON_REQUIRED = true;   // open decision #1 — client and server read this one constant

export type FailItem = { field_id: FieldId; label: string; valueText: string };

export function evaluateFields(defs: Field[], values: Record<FieldId, FieldValue | undefined>): {
  suggested: "pass" | "fail" | null;
  /** ALL failing fields, in field order. Every artboard joins them with " · ". */
  fails: FailItem[];
  /** = fails[0] ?? null (kept for convenience). */
  firstFail: FailItem | null;
  missingRequired: FieldId[];    // → "נותר שדה חובה אחד" / "נותרו N שדות חובה"
  missingNotes: FieldId[];       // → "חסרה הערה לחריגה" / "יש לפרט את החריגה"
  noteTooLong: FieldId[];
};
```

- **הטקסט של ההצעה** נבנה מכל הכשלים: `prefix + fails.map(f => "'" + f.label + "' = " + f.valueText).join(" · ")` (למשל `LegacyXray.dc.html:529`, `LegacyPackageOpenBox.dc.html:1136`). `valueText` לפי סוג:
  - `choice_row`: התווית של האפשרות. `multi_choice`: תוויות האפשרויות בטון fail, מופרדות ב-", " **(לא אומת — אין ארטבורד)**.
  - `number`: הערך + רווח + יחידה, למשל `0.2 Ω` (`LegacyFallback.dc.html`, `shown = raw.trim() + ' Ω'`).
  - `pass_fail`: "לא תקין".
- **מה נחשב כשל** (`suggested = "fail"` כשמתקיים אחד מאלה):
  - ל-`choice_row` נבחרה אפשרות עם `tone: "fail"`.
  - ב-`multi_choice` נבחרה לפחות אפשרות אחת כזו.
  - ב-`pass_fail` נבחר `ok: "fail"`.
  - ב-`number` יש `out_of_range_fail` והערך מחוץ ל-`[min, max]` או מחוץ ל-`ref ± tol_pct%`.
- **`suggested = "pass"`:** כשכל השדות שיש בהם ערך מולאו, ואין בהם כשל. אחרת `null`. **אין שורת "מוצע: תקין"** בממשק.
- **הערה חובה:** `notes = "required"` תמיד, ו-`"required_on_fail"` כשהערך של השדה הוא כשל.
- **אורך הערה:** נמדד ב-`String.prototype.length` (UTF-16 code units), בדיוק מה שה-`maxlength` של ה-textarea סופר בארטבורד 7א (`NotesField.dc.html:60, 131, 153`). ברירת המחדל 1000.
- **`section`** לא נספר כשדה ולא כחובה.

### 2.7 דוגמאות — מה נכתב בפועל

```jsonc
// שיקוף, עם שדות (VerdictStation) — המפתחות הקיימים + schema/fields, verdict מורחב
{ "station": "xray", "sku": "PC-7040",
  "verdict": { "ok": "fail", "note": "…", "suggested": "fail" },
  "schema": { "route_id": 77, "v": 5, "step_uid": "s_pc1xray", "target": "item" },
  "fields": { "f_led00001": { "t": "choice_row", "label": "נורית מתח", "opt": "o_led00003", "opt_label": "לא דולקת", "tone": "fail", "note": "…" } } }

// פירוק (PhotoStation) — photo נשאר; verdict חדש לצדו
{ "station": "disassembly", "sku": "…", "hasRU": true, "photo": { "ok": "pass", "note": "", "photos": ["…"] },
  "schema": { … , "target": "item" }, "fields": { … }, "verdict": { "ok": "pass", "suggested": "pass" } }

// פתיחת מארז — שורת פריט 02 מסך: route_id = מסלול המארז
{ "sku": "…", "hasRU": true, "weight": { … }, "product": { "ok": "fail", "note": "…", "photos": [] },
  "package_id": "1005150926000300", "opening": true,
  "schema": { "route_id": 91, "v": 5, "step_uid": "s_k1open0", "target": "kit_item" },
  "fields": { /* each_item + group {item_type_id: מסך} */ }, "verdict": { "ok": "fail", "suggested": "fail" } }

// פתיחת מארז — שורת הקופסה
{ "sku": "…", "pkg": { … }, "itemCount": 5, … , "opening": true,
  "schema": { "route_id": 91, "v": 5, "step_uid": "s_k1open0", "target": "box" }, "fields": { /* box */ },
  "verdict": { "ok": "pass", "suggested": "pass" } }

// סגירת מארז — שורת הקופסה; פריט "נארז בכל זאת" לא מקבל שורה משלו
// (PackageCloseWizard.tsx:92), ולכן השדות שלו נשמרים בתוך ההחלטה
{ "closing": true, "checks": [ … ], "note": "…", "packed": [ … ],
  "decisions": [ { "item_id": "…05", "decision": "packed_anyway", "note": "…",
                   "fields": { /* each_item + type group */ }, "suggested": "pass" } ],
  "schema": { "route_id": 91, "v": 5, "step_uid": "s_k1close", "target": "box" }, "fields": { … }, "verdict": { "suggested": … } }

// חלון ברירת מחדל (PopUpTestDialog) — היום בלי Details; עם שדות:
{ "schema": { … , "target": "item" }, "fields": { … }, "verdict": { "suggested": "fail" } }
```

**מי מקבל שדות בסגירה:** רק פריט שהגיע, או פריט שקיבל "נארז בכל זאת": `fieldsVisible = wf && (it.arr || (d && d.decision === 'packed_anyway'))` (`LegacyPackageCloseItems.dc.html:615`). פריט "חסר במארז" לא מקבל שדות.

---

## 3. API

### 3.0 הרשאות

- `/api/testing/*` כבר מוגבל ל-`manager` ו-`tester` ב-middleware (`src/lib/routes.ts:67`). נקודת הקצה של העובד (§3.3) יושבת שם ולכן מוגנת **בלי שינוי ב-`routes.ts`**.
- `/api/settings/testing-routes/*` **לא** מוגבל ב-middleware. רק הדף מוגבל (`routes.ts:78`), כי "the intake and the queues still read routes / stations through /api/settings/*" (`routes.ts:75-77`). לכן:
  - **קריאה** נשארת פתוחה לכל משתמש מחובר.
  - **כל כתיבה חדשה** (טיוטה, פיצול, ערכות, רשימות) עטופה ב-`withAuth(handler, { role: ["manager", "tester"] })` (`src/lib/auth/withAuth.ts:43-61`), באותם תפקידים כמו הדף.
  - **פרסום:** ברירת המחדל במסמך הזה היא אותם תפקידים (`manager`, `tester`). ההמלצה היא **`manager` בלבד** — ראו §10.2. השאירו את רשימת התפקידים של publish בקבוע אחד (`PUBLISH_ROLES`) כדי שההחלטה תהיה שינוי של שורה.
  - את ה-`POST` וה-`PUT` הקיימים של מסלולים עוטפים באותו `withAuth`. הקוראים היחידים מחוץ לדף הם סקריפטי הזרע, ועוגיית הזרע שלהם נושאת `manager` + `tester` (`seed-packages-demo.mjs:132`, `seed-dev-dataset.js:324`; ה-callback `session` מעתיק `token.roles` ל-`session.roles` ב-`auth.ts:460`, ו-`withAuth.ts:54` קורא משם), כך ששום דבר לא נשבר.
- **מי מפרסם:** `ctx.session.user.preferredUsername` ושם התצוגה, לפי `current-user.ts`.

### 3.1 שינויים בקבצים קיימים

**`src/app/api/settings/testing-routes/route.ts`**

| שורות | היום | אחרי |
|---|---|---|
| 16-25 | `select` של 5 עמודות | להוסיף `step_uids`, `fields_version`, `draft_rev`, ו-`has_draft` (מחושב: `fields_draft != null`). **לא** להחזיר את `fields_draft` כאן — יש לו endpoint משלו. |
| 28-32 | `catch` מחזיר `[]` | `return NextResponse.json({ error: "Failed to fetch testing routes" }, { status: 500 })`. גוף השגיאה הוא באנגלית לפי המוסכמה של שאר ה-route (`"Failed to update testing route"` ב-`[id]/route.ts`); **הוא לא מוצג למשתמש**: המסך כבר מטפל ב-`!res.ok` כשגיאה (`page.tsx:88-90` → `setRouteError(true)` ב-`:104`) ומציג את ה-UI הקיים. אין צורך בטקסט עברי חדש. **שני סקריפטים נשברים מהשינוי ויש לתקן אותם באותו PR:** (1) `scripts/e2e-packages/lib.mjs:125` — `api()` (`:61-67`) מפענח גם גוף של 500, ולכן `.json` = `{error:…}` (truthy) ו-`|| []` **לא** נופל ל-`[]`; `routes[0]` יוצא `undefined` והסקריפט זורק "has no usable route" מטעה. (2) `scripts/seed-dev-dataset.js:541-542` (`existingRoutes = gotRoutes.json || []`) ואחריו `existingRoutes.find(...)` ב-`:553` — `TypeError` על אובייקט. בשניהם: לבדוק `.ok` (ב-lib.mjs) / `res.ok`/סטטוס (ב-seed-dev-dataset.js) ולזרוק שגיאה ברורה לפני השימוש. `seed-packages-demo.mjs` משתמש ב-`must()` ונכשל בקול — תקין. |
| 35-43 | גוף `{item_type_id, route_number, route_steps}` | לקבל גם `step_uids?: (string \| null)[]`. השרת מייצר uid לכל שלב (§3.5) ושומר `step_uids` יחד עם `route_steps` ב-`create` (`:76-83`). |
| 85-91 | תשובה | להוסיף `step_uids`. |

**`src/app/api/settings/testing-routes/[id]/route.ts` — `PUT`**

```ts
export const PUT = withAuth(async (req, _ctx, routeCtx) => {
  const { id } = await (routeCtx as { params: Promise<{ id: string }> }).params;
  const body = await req.json();
  const routeSteps: number[] = body.route_steps;                    // required, ints
  if (!Array.isArray(routeSteps)) → 400

  return prisma.$transaction(async (tx) => {
    const cur = await tx.$queryRaw`SELECT route_steps, step_uids, fields_draft, draft_rev, fields_version
                                     FROM testing_routes WHERE test_route_id = ${Number(id)} FOR UPDATE`;
    // 404 if missing (today: P2025 → 404, [id]/route.ts:26-31)
    const incoming: (string | null)[] = body.step_uids ?? inferUidsByOccurrence(cur.route_steps, cur.step_uids, routeSteps); // §3.5
    if (incoming.length !== routeSteps.length) → 400
    const stepUids = assignStepUids(cur.step_uids, incoming, publishedUidsOf(id));   // §3.5 — rejects unknown/duplicate uids
    const removed = cur.step_uids.filter((u) => !stepUids.includes(u));
    const draft = pruneDraft(cur.fields_draft ?? latestPublished, stepUids, routeSteps); // §3.5
    await tx.testing_routes.update({ where: { test_route_id: Number(id) }, data: {
      route_steps: routeSteps,
      step_uids: stepUids,
      test_station_type_id: routeSteps[0] ?? undefined,              // fixes "PUT never updates it"
      ...(draftChanged ? { fields_draft: draft, draft_rev: { increment: 1 }, draft_updated_at: new Date(), draft_updated_by } : {}),
    }});
    return { …same 5 fields, step_uids, removed_with_fields: removed.filter(hadConfig) };
  });
}, { role: ["manager", "tester"] });
```

- `removed_with_fields` מאפשר למסך לדעת שהסרת שלב מחקה הגדרה (היא תופיע ב"מה השתנה" בפרסום).
- גרסאות מפורסמות **לא נוגעים בהן**. uid שהוסר פשוט לא נפתר יותר בזמן ריצה.
- `DELETE` נשאר כמו שהוא. אחרי המיגרציה, מסלול עם גרסאות יחזיר את ה-409 הקיים.

**`src/app/api/testing-routes/route.ts:8-10`** — להוסיף `select: { test_route_id, item_type_id, test_station_type_id, route_steps, route_number }`, כדי שה-JSON הגדול לא יגיע לטופס הקליטה.

**`src/app/api/settings/test-stations-type/[id]/route.ts`** — §3.6.

**`src/app/api/testing/results/route.ts`** — §3.4.

### 3.2 נקודות קצה חדשות — צד המנהל

כולן תחת `withAuth`, חוץ מ-GET.

| Method + path | גוף / פרמטרים | תשובה | שגיאות |
|---|---|---|---|
| `GET /api/settings/testing-routes/[id]/fields` | — | `{ route: {test_route_id, item_type_id, route_number, route_steps, step_uids}, draft: RouteFieldsConfig \| null, draft_rev, draft_updated_at, draft_updated_by, published_version, published: RouteFieldsConfig \| null, issues: Issue[], shared_with: SharedKit[] }` | 404; **500 אמיתי** (לעולם לא אובייקט ריק). המסך מציג "טעינת הגדרות השדות נכשלה" / "המסלול לא מוצג כריק כדי לא לאבד נתונים." (ארטבורד 11) |
| `GET /api/settings/testing-routes/fields-context?packageTypeId=&routeNumber=` | הקשר "מפת שדות" של מארז | מסלול המארז + לכל שורה ב-`package_contents` את מסלול הפריט (`route_number` מהשורה). לכל אחד: `test_route_id`, `step_uids`, `route_steps`, `draft`/`published`, `fields_version`, `shared_with`, ומונה שימוש בערכות. המסך בונה את המטריצה (`mapModel.ts`) מהקריאה הזו בלבד. מסלול פריט בודד (לא מארז): `?itemTypeId=&routeNumber=` מחזיר אותו מבנה עם מסלול אחד | מסלול חסר → `null` במקומו, עם הסיבה; 500 אמיתי |
| `PUT /api/settings/testing-routes/[id]/fields/draft` | `{ config, base_rev }` | `{ draft_rev, draft_updated_at, issues }` | 400 `SHAPE_*`; 409 `DRAFT_CONFLICT` כש-`base_rev !== draft_rev` (מחזיר את הטיוטה העדכנית); 409 `STEP_UNKNOWN` כש-uid לא נמצא ב-`step_uids` |
| `DELETE /api/settings/testing-routes/[id]/fields/draft` | `{ base_rev }` | `{ draft_rev }` | 409 — "ביטול הטיוטה" |
| `POST /api/settings/testing-routes/fields/publish-preview` | `{ route_ids: number[], context_kit_id?: number }` | `PublishImpact` (§3.4.2) | 422 כשיש שגיאות lint, עם `issues` |
| `POST /api/settings/testing-routes/fields/publish` | `{ route_ids, base_revs: Record<id, rev>, apply_mode: "new_only" \| "not_reached", note?: string }` | `{ publish_batch, versions: Record<route_id, v>, bumped_items: number }` | 409 `DRAFT_CONFLICT`; 422 lint; 400 כש-`note` ארוך מ-2000 |
| `GET /api/settings/testing-routes/[id]/fields/versions` | — | `[{ version, published_at, published_by_name, note, apply_mode, publish_batch, changes }]`, מהחדש לישן ("היסטוריית גרסאות") | — |
| `GET /api/settings/testing-routes/[id]/fields/versions/[v]` | — | `{ version, config, … }` | 404 |
| `POST /api/settings/testing-routes/[id]/fork` | `{ package_type_id }` | `{ test_route_id, route_number }` | "צור מסלול נפרד למארז הזה" (ארטבורד 2). §3.2.1 |
| `GET/POST /api/settings/option-lists` | POST: `{ name, options }` | רשימות + `usage: { fields, routes }` | 400 מבנה |
| `PUT /api/settings/option-lists/[id]` | `{ name, options, base_version }` | `{ version, linked: { route_id, step_uid, field_id }[] }` | 409 גרסה. השמירה מעלה `version` ב-1 |
| `POST /api/settings/option-lists/[id]/propagate` | `{ targets?: {route_id, step_uid, field_id}[] }` | `{ updated_drafts: number }` | מעדכן **טיוטות** בלבד: "שינוי ברשימה המשותפת יחול על N שדות … לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו." (ארטבורד 4) |
| `DELETE /api/settings/option-lists/[id]` | — | — | 409 כשבשימוש (אחרת `archived = true`) |
| `GET/POST /api/settings/field-sets` | POST: `{ name, fields }` | ערכות + `usage: { cells, outdated }` | — |
| `PUT /api/settings/field-sets/[id]` | `{ name, fields, base_version }` | `{ version }` | "שמירה כגרסה N" (ארטבורד 8) |
| `GET /api/settings/field-sets/[id]/usage` | — | `[{ route_id, step_uid, target, from_ver, item/kit labels }]` | "בשימוש ב-9 תאים", "N תאים משתמשים בגרסה קודמת של הערכה" |
| `POST /api/settings/field-sets/[id]/propagate` | `{ targets }` | `{ updated_drafts }` | "עדכן את כולם (2)". **טיוטות בלבד**: "עדכון הערכה יוצע לאישור בכל תא מקושר; שום תא לא משתנה בלי פרסום." |
| `DELETE /api/settings/field-sets/[id]` | — | — | 409 כשבשימוש |

- **ספירת שימוש** ("31 שדות", "בשימוש ב-9 תאים") נעשית בזמן הקריאה, על `fields_draft` ועל הגרסה המפורסמת האחרונה של כל מסלול (`jsonb_path_query` על `$.steps.*.groups[*].fields[*] ? (@.list_ref.id == $id)`). בהיקף של עשרות מסלולים אין צורך בטבלת שימוש **(לא אומת מול נפח פרודקשן)**.
- **פעולות מרובות ("העתק", "הדבק", "נקה", "החל ערכת שדות…", "עדכן את כולם") ו"החלת ערכה על תאים" (ארטבורד 9) לא צריכות endpoint משלהן.** הן עריכת טיוטה בלקוח (`draftStore.ts`), שנשמרת ב-`PUT …/fields/draft` של **כל מסלול שנגעו בו**. אם אחת השמירות נכשלה, הלקוח מציג את מצב "שמירה נכשלה" על הכותרת ומנסה שוב (כל PUT אידמפוטנטי עם `base_rev`). "השאר מקושר לערכה" = נשמר `from_set`; בלי הסימון השדות "יועתקו לתאים כעותק עצמאי".

#### 3.2.1 "צור מסלול נפרד" (fork)

בטרנזקציה אחת:

1. נועלים את המסלול המקורי.
2. `route_number` חדש = `max(route_number) + 1` לאותו `item_type_id`.
3. מעתיקים את `route_steps` ו-**אותם `step_uids`**. ה-uids ייחודיים רק בתוך מסלול, ולכן ההעתקה בטוחה וההגדרה עוברת כמו שהיא.
4. `fields_draft` = הטיוטה של המקור, או הגרסה המפורסמת אם אין טיוטה. `fields_version = 0`.
5. מעדכנים `package_contents.route_number` לשורה (`package_type_id`, `item_type_id`) של **המארז הזה בלבד** (`schema.prisma:116-137`).
6. מריצים `checkItemRouteAgainstPackage` (`src/app/lib/packages/route-rules.ts`), כמו ב-`create-package.ts:126-130`.

פריטים שכבר בדרך נשארים על המסלול הישן. פריטים חדשים במארז הזה ייקלטו על המסלול החדש, כי `resolveItemRoute` לוקח את `route_number` משורת התבנית (`create-package.ts:124-125`).

### 3.3 צד העובד — קריאת ההגדרה

`GET /api/testing/station-fields?itemId=<id>` (קובץ חדש `src/app/api/testing/station-fields/route.ts`). החלון קורא לה כשהוא נפתח. מוגנת ב-`routes.ts:67`.

```ts
// in schema.ts
export type StationFieldsResponse =
  | { mode: "legacy" }                                   // no config → today's popup, unchanged
  | { mode: "item";
      schema: FieldsSchemaRef;                           // target "item"
      fields: Field[];
      gate: boolean }                                    // = GATE_FINISH_ON_REQUIRED
  | { mode: "package";                                   // itemId is a KIT row at a package-level step
      schema: Omit<FieldsSchemaRef, "target">;           // kit route / kit version / kit step uid
      box: Field[];
      items: { item_id: string; package_seq: number; item_type_id: number; item_type_desc: string;
               /** Kept separate so the popup can show "לכל פריט" and "שדות {type}" (artboard 16).
                *  Order: each_item first, then {item_type_id}. Empty groups omitted. */
               groups: { target: "each_item" | { item_type_id: number }; fields: Field[] }[] }[];
      gate: boolean };
```

**אלגוריתם** (פונקציה טהורה `resolveStationFields` ב-`resolve.ts` + שתי שאילתות):

1. `SELECT ir.item_type_id, ir.route_number, ir.current_route_step, ir.fields_version, tr.test_route_id, tr.route_steps, tr.step_uids FROM item_routes ir JOIN testing_routes tr ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number WHERE ir.item_id = $1`. הצירוף זהה ל-`testing/items/route.ts:79-81`.
2. אם `fields_version IS NULL`, או ש-`cardinality(step_uids) <> cardinality(route_steps)`: `legacy`.
3. `uid = step_uids[current_route_step - 1]`, `typeId = route_steps[current_route_step - 1]`. מחוץ לטווח: `legacy`.
4. `config = route_field_versions(test_route_id, fields_version).config`. אם `config.steps[uid]` לא קיים, או שכל הקבוצות ריקות: `legacy`.
5. `package_level` של `typeId` (`isPackageLevelStationType`, `src/app/lib/packages/context.ts:38`):
   - **פריט בשלב ברמת פריט:** `mode: "item"` עם הקבוצה `target: "item"`.
   - **שורת מארז** (`loadPackageContext(...).isPackage`, `context.ts:17-35`) **בשלב ברמת מארז:** `mode: "package"`. `items` = כל `items` עם `package_id = itemId`, לפי `package_seq`, ולכל פריט `groups = [each_item, {item_type_id}]` (ריקות מושמטות).
   - כל צירוף אחר (פריט בתוך מארז בשלב ברמת מארז) לא מגיע לכאן, כי החלון נפתח על הקופסה (`page.tsx:1446`). מחזירים `legacy`.
   - **עמדות מחקר:** לפני שלב 3 — אם `ir.current_status IN (4, 5)` (`status-names.ts:5-12`) או שהעמדה הפותחת `test_stations.is_research` (`schema.prisma:339`): `legacy`. עמדות מחקר פותחות את `PopUpTestDialog` (`isResearchStatus`, `src/app/components/PopUpTestDialog.tsx:97`), ו-`current_route_step` מצביע עדיין על השלב שממנו הפריט נשלח — בלי הבדיקה הזו העובד במחקר היה רואה את שדות השלב ההוא, והשרת (§3.4 שלב 1) היה דורש `Details.schema` גם ב-`returnToRoute`/`finishRoute`. השרת מדלג על הפתרון באותם מקרים.

החלון שומר את `schema` שקיבל ושולח אותו חזרה ב-`Details.schema`. השרת **לא סומך** עליו: הוא מאמת אותו מול השורה הנעולה (§3.4).

### 3.4 כתיבת התוצאה — `src/app/api/testing/results/route.ts`

**איפה:** אחרי שורה 223 (`testStationTypeId` ידוע), בתוך הטרנזקציה, אחרי הנעילה (`:161-166`) ובדיקת ה-replay (`:190-199`), ולפני כל `UPDATE`. כך כשל ולידציה לא משאיר שום כתיבה, ו-replay עם אותו `SubmitID` לא מאמת שוב.

```ts
// after line 223
let detailsToWrite: unknown = Details;
const fieldsCfg = await resolveForSubmission(tx, { itemId: itemIdBig, pkgCtx });   // §3.3 resolver, by row kind
if (fieldsCfg) {
  detailsToWrite = await checkFieldsSubmission(tx, fieldsCfg, {
    details: Details,
    gate: GATE_FINISH_ON_REQUIRED && sendToResearch !== true && !isResearchStatus,
  });   // throws FieldsSubmissionError
}
…
// line 569: write the normalised object instead of the raw one
${detailsToWrite != null ? JSON.stringify(detailsToWrite) : null}::jsonb,
```

- **השלב נקבע מהשורה הנעולה**, לא מה-body: להרחיב את ה-SELECT ב-`:161-166` כך שיחזיר גם `item_type_id`, `current_route_step`, `fields_version` (הרחבת SELECT שכבר נועל את השורה — אין שינוי בסדר הנעילות). ה-`CurrentRouteStep` מה-body ממשיך לשמש את ה-guard הקיים (`:437`) כמו היום.

**`checkFieldsSubmission`** (קובץ חדש `src/app/lib/station-fields/submit.ts`):

1. **מאתר את ההגדרה** כמו ב-§3.3, אבל לפי סוג השורה:
   - שורת פריט בשלב ברמת פריט: היעד `item`.
   - שורת קופסה: `box`.
   - שורת פריט בתוך מארז בשלב ברמת מארז: `kit_item`. **שני התנאים יחד:** `pkgCtx.packageId != null` **וגם** סוג העמדה השולחת ברמת מארז — `isPackageLevelStationType(tx, testStationTypeId)` (`src/app/lib/packages/context.ts:38`; `testStationTypeId` נקרא כבר ב-`results/route.ts:220-223`). `packageId` לבדו **אינו** מבחין: לכל פריט במארז יש `package_id` (`context.ts:17-35`), גם בעמדות פריט כמו חשמל/מכניקה/ויזואלית — ושם היעד הוא `item` מול מסלול הפריט עצמו. הגרסה וה-uid של `kit_item` נלקחים משורת `item_routes` של **המארז** (`pkgCtx.packageId`) ומסלול המארז.
   - **עמדות מחקר:** כש-`current_status IN (4, 5)` (או שהעמדה `is_research`) — אין אימות שדות ואין דרישת `schema` (גם ב-`returnToRoute`/`finishRoute`); ה-`Details` נשמר כמו היום. ראו §3.3.
2. **בודק ש-`Details.schema` קיים ותואם** בדיוק (`route_id`, `v`, `step_uid`, `target`). חסר או לא תואם: 409 `FIELDS_SCHEMA_MISMATCH`. קורה כשהמסלול נערך בזמן שהחלון היה פתוח, או כשלקוח ישן שולח בלי שדות. בלקוח: רענון ההגדרה (§4.10). **הדחייה של `schema` חסר** — ראו §10.2 (המלצה: לדחות, כדי שתוצאה לא תישמר בשקט בלי שדות).
3. **לכל שדה בהגדרה** (`section` מדלגים): מאמת את סוג הערך, ש-`opt` קיים ב-`options`, `photo_type` וכו'.
   - **מנרמל:** `label`, `opt_label` ו-`tone` נלקחים **מההגדרה**, לא מהלקוח.
   - **מחשב** `in_range`.
   - **מוחק** מפתחות של שדות שלא קיימים בהגדרה.
4. **הערות:** אורך ≤ `note_max ?? 1000` (UTF-16). נאכף **תמיד**, גם בלי שער. חריגה: 400 `NOTE_TOO_LONG`.
5. **`evaluateFields`** מחשב את `suggested` ומחליף את מה שהלקוח שלח. `overridden = verdict.ok != null && suggested != null && verdict.ok !== suggested`.
6. **השער**, רק אם `gate`. מחזיר 422 `FIELDS_INCOMPLETE` עם `missing` ו-`message`, וההודעה בעברית מ-`LegacyFallback.dc.html`:
   - שדה חובה אחד: "נותר שדה חובה אחד בבדיקות העמדה — יש למלא לפני סיום בדיקה"
   - כמה: "נותרו N שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה"
   - הערה חסרה: "חסרה הערה לחריגה בבדיקות העמדה — יש לפרט לפני סיום בדיקה"
7. **בסגירה,** לכל `decisions[i]` עם `decision === "packed_anyway"` ו-`fields`: אותה ולידציה מול `each_item ++ group(item_type)` של הפריט.
8. **תקרה:** `JSON.stringify(Details).length ≤ 256_000`, אחרת 413.

**מיפוי שגיאות** ב-`catch` (`:934-965`): להוסיף `if (error instanceof FieldsSubmissionError) return NextResponse.json({ error: error.message, code: error.code, missing: error.missing }, { status: error.status })` **לפני** הענף הכללי (בלי זה ההודעה יוצאת כ-500). הודעות `NOTE_TOO_LONG` ו-`FIELDS_SCHEMA_MISMATCH` **(לא אומת — אין טקסט בארטבורד)**: COPY-PENDING.

**שאר ה-INSERT לא משתנה** (`:562-571`): `result`, `passed` ו-`comments` מגיעים מהלקוח כמו היום. `test_results.route_step` נשאר `CurrentRouteStep`.

#### 3.4.1 מחזור חיים של טיוטה

```
(אין)  ──עריכה ראשונה──▶  fields_draft = עותק של המפורסם (או {schema:1, steps:{}})
טיוטה  ──PUT draft────▶  draft_rev++                      "נשמר אוטומטית לפני רגע"
טיוטה  ──DELETE draft─▶  fields_draft = NULL               "ביטול הטיוטה"
טיוטה  ──publish──────▶  route_field_versions(v+1) ; testing_routes.fields_version = v+1 ; fields_draft = NULL
```

**ספירת השינויים בכותרת** ("טיוטה · 6 שינויים") = מספר השורות ב-`diffConfigs(published, draft)`, סכום על כל המסלולים בהקשר.

`diffConfigs(a, b): Change[]` היא פונקציה טהורה ב-`src/app/lib/station-fields/diff.ts`. משמשת לכותרת, לחלון הפרסום ול-`route_field_versions.changes`:

```ts
type Change = { route_id: number; step_uid: string; target: GroupTarget;
  kind: "field_added" | "field_removed" | "field_changed" | "step_removed" | "layout_changed";
  field_id?: string; label: string;
  detail?: { option_added?: string; option_removed?: string; required?: boolean; notes?: NotesMode; type?: FieldType;
             renamed_from?: string; tone_changed?: string; list_linked?: boolean; note_max?: NoteMax; from_set?: string };
  filled_count?: number };   // only field_removed: "מולא ב-38 בדיקות"
```

הטקסטים לחלון "מה השתנה" — §5.11.

#### 3.4.2 `publish-preview` — חישוב ההשפעה

```ts
type PublishImpact = {
  routes: { route_id: number; label: string;          // "מסלול 1 של מחשב" / "מסלול המארז"
            from_version: number; to_version: number; changes: Change[] }[];
  totals: { changes: number; stations: number; routes: number };   // "6 שינויים" "3 עמדות" "3 מסלולים"
  shared_outside: { route_id: number; item_type_desc: string; route_number: number;
                    kits: { package_type_id: number; desc: string }[] }[];
  items_on_routes: number;                             // "9 פריטים נמצאים כעת במסלולים האלה"
  by_version: { route_id: number; version: number | null; count: number }[];
  not_reached: number;                                 // "… · 4 פריטים"
  issues: Issue[];
};
```

**שאילתות** (כל `route` = `(item_type_id, route_number)`):

```sql
-- items in progress on the route, per frozen version
SELECT fields_version, count(*) FROM item_routes
 WHERE item_type_id = $1 AND route_number = $2 AND finished_at IS NULL
 GROUP BY fields_version;

-- other kits that reuse this ITEM route (template level — package_contents.route_number)
SELECT pc.package_type_id, TRIM(t.item_type_desc) AS desc
  FROM package_contents pc JOIN item_types t ON t.item_type_id = pc.package_type_id
 WHERE pc.item_type_id = $1 AND pc.route_number = $2 AND pc.package_type_id <> $contextKit;

-- "מולא ב-N בדיקות" for a removed field
SELECT count(*) FROM test_results
 WHERE details -> 'schema' ->> 'route_id' = $route::text
   AND ( details -> 'fields' ? $fieldId
      -- close wizard "packed_anyway": kit-item fields live in details.decisions[i].fields (on the box row)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(details -> 'decisions', '[]'::jsonb)) d
                  WHERE d -> 'fields' ? $fieldId) );
```

- `not_reached` בתצוגה המקדימה סופר בדיוק את השורות שה-UPDATE ב-§3.4.3 שלב 6 יעלה — **כולל** המסנן `current_status IN (2, 6)`.

- "משותף ל" מחושב לפי **התבנית** (`package_contents`). פריט ספציפי יכול היה להיקלט עם מסלול אחר (`PackageItemInput.routeNumber`, `create-package.ts:49-50`). הספירה של פריטים בדרך היא לפי `item_routes`, ולכן מדויקת.
- הספירה על `test_results` לא נשענת על אינדקס. אם היא איטית בפרודקשן, מוסיפים אינדקס ביטוי על `((details->'schema'->>'route_id'))` במיגרציה נפרדת **(לא אומת — תלוי בנפח)**.

#### 3.4.3 `publish` — בטרנזקציה אחת

פרסום אחד מכסה את **כל המסלולים בהקשר** (מסלול המארז + מסלולי הפריטים שבמפה). כל מסלול מקבל **מספר גרסה משלו**, וכולם נקשרים ב-`publish_batch` אחד. "גרסה N" בכותרת הדיאלוג = הגרסה של המסלול שהמסך פתוח עליו (מסלול המארז). **(לאשר — ראו §10.2.)**

1. `publish_batch = randomUUID()`.
2. לכל `route_id`, לפי סדר עולה (סדר נעילה קבוע): `SELECT … FROM testing_routes WHERE test_route_id = $1 FOR UPDATE`.
   - `draft_rev !== base_revs[id]`: 409.
   - `fields_draft IS NULL`: מדלגים (אין שינוי).
3. `parseRouteFieldsConfig`, `checkConfigAgainstRoute` ו-`lintRouteFieldsConfig`. שגיאה אחת מספיקה ל-422 ולביטול הכל.
4. `v = fields_version + 1`. `INSERT route_field_versions(test_route_id, v, config = draft, changes = diffConfigs(prev, draft), note, apply_mode, publish_batch, published_by, published_by_name)`.
5. `UPDATE testing_routes SET fields_version = v, fields_draft = NULL, draft_rev = draft_rev + 1`.
6. אם `apply_mode = "not_reached"`, מעלים את הגרסה לפריטים שעוד לא הגיעו לשלב שהשתנה:

   ```sql
   -- $min_changed_pos = 1-based position (index in step_uids + 1) of the FIRST changed step uid
   UPDATE item_routes ir SET fields_version = $v
    WHERE ir.item_type_id = $item_type AND ir.route_number = $route_number
      AND ir.finished_at IS NULL
      AND ir.current_status IN (2, 6)          -- on BOTH branches: never bump 1/4/5
      AND ( ir.current_route_step < $min_changed_pos
         OR ir.current_route_step = $min_changed_pos );
   ```

   - סטטוס 2 = "ממתין" ו-6 = "ממתין לפריטי המארז" (`src/app/lib/status-names.ts:5-12`). בשניהם החלון עוד לא נפתח, ולכן בטוח לעבור לגרסה החדשה.
   - בסטטוס 1 ("בבדיקה") ובסטטוסים 4/5 (מחקר) הפריט נשאר על הגרסה שלו — **גם כשהוא בשלב מוקדם יותר**. לכן מסנן הסטטוס חל על שני הענפים: בלעדיו, פריט בסטטוס 1 בשלב מוקדם (חלון פתוח אצל עובד) היה מקבל את הגרסה החדשה, והשליחה שלו (`schema.v` הישן) הייתה נדחית ב-409 `FIELDS_SCHEMA_MISMATCH` (שלב 2 ב-§3.4) באמצע בדיקה.
   - **הפריט מקבל את כל הגרסה החדשה, לא רק את השלב שהשתנה.** לכן התנאי לפי השלב **הראשון** שהשתנה, ושלבים שהפריט כבר עבר לא מושפעים.
   - הנוסח מהארטבורד: "יעברו לגרסה 5 בעמדה הבאה שלהם; תוצאות שכבר נשמרו לא ישתנו".
7. **מארזים:** שינוי בשלב ברמת מארז במסלול המארז מעלה רק שורות מארז (`item_type_id` = סוג המארז). הפריטים שבתוכו נפתרים דרך שורת המארז (§1.5).

#### 3.4.4 היסטוריה ותוצאות ישנות

- **תוצאה שנשמרה מחזיקה צילום של התוויות** (§2.5), ולכן מציגים אותה **בלי** לטעון את ההגדרה.
- **`schema.v`** מאפשר לפתוח את ההגדרה המלאה של אותה גרסה (`GET …/versions/[v]`) לדוח, להשוואה ול"שדה שנמחק".
- **שדה שנמחק נשאר ב-`details` של כל תוצאה ישנה.** זה מה ש"הערכים יישמרו בהיסטוריה" מבטיח.

### 3.5 מיפוי uid כשמזיזים או מסירים שלבים

**בלקוח** (`src/app/settings/testing-routes/…`, לשונית "שלבי המסלול"): ה-state `steps: number[]` (`page.tsx:39`) הופך ל-`steps: { uid: string | null; typeId: number }[]`.

- `handleAddStep` (`:115-119`) מוסיף `{ uid: null, typeId }`.
- `handleRemoveStep` / `handleMoveStep` (`:122-138`) עובדים על אותו מערך, ולכן ה-uid זז עם השלב **בלי שום קוד מיפוי**.
- `handleSave` (`:140-150`) שולח `route_steps = steps.map(s => s.typeId)` ו-`step_uids = steps.map(s => s.uid)`.
- הטעינה (`:94-96`) מצמידה את `route.step_uids[i]` ל-`route.route_steps[i]`. אם האורכים שונים, כל ה-uids נטענים כ-`null`.
- `key={index}` (`:295`) מוחלף ב-`key={step.uid ?? \`new-${i}\`}`. **אסור לחשב uid מאינדקס.**

**בשרת** — `assignStepUids(current: string[], incoming: (string|null)[], publishedUids: Set<string>)` ב-`step-uids.ts`:

1. כל uid שאינו `null` חייב להופיע ב-`current`, אחרת 400 `STEP_UID_UNKNOWN`. כך הלקוח לא יכול להמציא uid ולהצמיד אותו להגדרה של שלב אחר.
2. אסור שאותו uid יופיע פעמיים: 400 `STEP_UID_DUPLICATE`.
3. כל `null` מקבל uid חדש (`'s_' + 8` תווים מ-`randomUUID()`), שאינו קיים ב-`current` **וגם לא באף גרסה מפורסמת של המסלול**. כך uid שהוסר לא "קם לתחייה" עם ההגדרה הישנה.
4. `pruneDraft`:
   - מוחק מהטיוטה `steps[uid]` לכל uid שהוסר (יופיע ב"מה השתנה" כ-`step_removed`).
   - מעדכן `station_type_id` / `station_label` / `scope` בשלבים שנשארו, לפי המיקום החדש.
   - אם `scope` השתנה (לא אמור לקרות: uid קשור לסוג עמדה, ושינוי סוג = הסרה והוספה), השלב מסומן כשגיאת lint ולא נמחק בשקט.

**קורא בלי `step_uids`** (סקריפטי הזרע, §0.2) — `inferUidsByOccurrence(curSteps, curUids, nextSteps)`: מצמידים לכל שלב חדש את ה-uid של השלב הנוכחי עם אותו `(station_type_id, מספר מופע)`; מה שלא הותאם מקבל `null`. כך `PUT` חוזר עם אותם שלבים (למשל הרצה שנייה של `seed-dev-dataset.js:557`) לא מחליף uids ולא מוחק הגדרות. ב-`POST` (מסלול חדש) כל השלבים מקבלים uid חדש.

**דוגמה:** מסלול `[פתיחה s_a, חשמל s_b, ויזואלית s_c, סגירה s_d]`. מזיזים את ויזואלית למעלה ומוחקים את חשמל:
- הלקוח שולח `route_steps=[פתיחה, ויזואלית, סגירה]` ו-`step_uids=[s_a, s_c, s_d]`.
- השרת מוחק את `steps.s_b` מהטיוטה.
- פריט שהקפיא גרסה שבה `s_b` מוגדר ונמצא עכשיו בשלב 2 מקבל `uid = s_c`, ולכן את השדות של ויזואלית. נכון.

**מה זה לא פותר:** עריכת `route_steps` של מסלול שיש עליו פריטים בדרך מזיזה את `current_route_step` שלהם יחסית לעמדות. זו התנהגות קיימת, נכונה גם בלי שדות. ה-uid מבטיח רק שהשדות יגיעו לעמדה **הנכונה** במיקום החדש.

**מסלולים שהוכנסו מסקריפט בלי `step_uids`** (§1.3): `step_uids` ריק. העובד מקבל `legacy` (§3.3 צעד 2), ושמירה במסך משלימה uids. המסך טוען את המסלול עם `uid: null` לכל השלבים.

### 3.6 באג קיים (החלטה פתוחה 5): שינוי מזהה סוג עמדה לא מגיע ל-`route_steps`

**היום** (`src/app/api/settings/test-stations-type/[id]/route.ts:97-115`): כשמשנים את המזהה עצמו, הטרנזקציה יוצרת שורה חדשה, מעבירה את `test_stations.test_station_type_id` (`:104-107`) ואת `testing_routes.test_station_type_id` (`:108-111`), ומוחקת את הישנה. **`route_steps` לא מתעדכן.** טקסט העזרה במסך מבטיח אחרת: "שינוי המזהה יעדכן גם את כל העמדות והמסלולים המשויכים" (`src/app/settings/test-stations/StationTypesTable.tsx:289`).

**התוצאה:** כל מסלול שמכיל את המזהה הישן מצביע לסוג עמדה שלא קיים. התור (`testing/items/route.ts:100`) לא מוצא את הפריטים; `findStationForRouteStep` מחזיר עמדה לסוג שלא קיים; `metrics_open_run` מקפיא `planned_steps` שגוי.

**תיקון** — בתוך אותה טרנזקציה, אחרי `:111`:

```ts
await tx.$executeRaw`
  UPDATE testing_routes
     SET route_steps = array_replace(route_steps, ${oldId}::int, ${newId}::int)
   WHERE ${oldId}::int = ANY(route_steps)
`;
// Phase 1+: drafts carry station_type_id as information only (§2.1); keep them tidy.
// (לא אומת — ה-client לא נוצר בסביבת הבדיקה; לאשר את Prisma.DbNull אחרי `npm ci && npx prisma generate`)
const drafts = await tx.testing_routes.findMany({ where: { fields_draft: { not: Prisma.DbNull } }, select: { test_route_id: true, fields_draft: true } });
for (const d of drafts) { const next = renameStationTypeInConfig(d.fields_draft, oldId, newId); if (next) await tx.testing_routes.update({ where: { test_route_id: d.test_route_id }, data: { fields_draft: next } }); }
```

- **גרסאות מפורסמות לא נוגעים בהן.** הן היסטוריה, וזמן הריצה לא נשען על `station_type_id` שבתוכן. לכן העיצוב לא תלוי בתיקון הזה, אבל התיקון נדרש בכל מקרה בשביל `route_steps`.
- `step_uids` לא משתנה (המיקומים זהים).
- **מחוץ לתיקון** (לציין בתיאור ה-PR, לא לתקן כאן):
  - `mainPopUp.ts` ממפה חלונות לפי מזהים קבועים 2–5 (ה-TODO ב-`:11-12`).
  - `test_results.test_station_type_id` ההיסטורי לא מתעדכן, וזה במכוון.
  - `route_run.planned_steps` שכבר נפתחו שייכים לטבלאות metrics שמורות (`docs/PRISMA_UNMANAGED_OBJECTS.md`). **אין בריפו קובץ SQL שמגדיר את `metrics_refresh_run_plan`** — השם מופיע רק ברשימת השמירה (`scripts/check-migration-safety.js:97`) וב-`docs/PRISMA_UNMANAGED_OBJECTS.md:45`. לכן **שום דבר בריפו לא מרענן `planned_steps`** אחרי שינוי מזהה סוג עמדה: runs פתוחים נשארים עם המזהה הישן. התיקון כאן לא מטפל בזה; **לציין זאת בתיאור ה-PR** (אם הפונקציה קיימת רק ב-DB של פרודקשן — לבדוק שם לפני שמסתמכים עליה).
- **בדיקת רגרסיה:** לשנות מזהה של סוג עמדה שמופיע במסלול פעמיים. אחר כך `route_steps` מכיל את המזהה החדש בשני המקומות, `step_uids` זהה, והתור של העמדה מציג את הפריט.

---

## 4. צד העובד — רכיבים והזרקה לכל חלון קיים

**מקור האמת לשלב 1:** ארטבורדים 12–18 (`Legacy*.dc.html`). ארטבורדים 5 ו-6 (`WorkerPopupPackage.dc.html` / `WorkerPopupItem.dc.html`) הם הרפרנס **לרכיב** השורה, ל-autocomplete, לעיצוב הכשל ול"הכל תקין" — וגם המראה של חלון מאוחד עתידי (שלב 3). ארטבורד 7א (`NotesField.dc.html`) מגדיר את שדה ההערה (§6).

### 4.0 חמשת הכללים של צד העובד

1. **אין הגדרה מפורסמת לשלב → החלון זהה להיום, עד הפיקסל.** אין בלוק, אין מגבלת אורך חדשה על ההערות, אין שינוי בשער הסיום ואין שינוי ברוחב.
2. **המעטפת לא משתנה:** `StationShell` (`stationKit.tsx:310-451`), `PackageWizardShell` (`PackageWizardShell.tsx:26-156`), ה-`Dialog` של `PopUpTestDialog` (`PopUpTestDialog.tsx:100`), הרייל, השלבים, הסדר והפוטר. מה שמשתנה: **בלוק שדות אחד** בתוך השלב שבו העובד כבר בודק, **שורת "מוצע"** מתחת לשאלת ההכרעה, ו**התנאי** של כפתור הסיום/המשך.
3. **הבלוק יושב מיד לפני שאלת ההכרעה של השלב:**
   - "בדיקה תקינה?" (`VerdictStation`, `PhotoStation`)
   - "האריזה תקינה?" ו-"הפריט תקין?" (`PackageOpenWizard`)
   - בסגירה: מקונן מתחת לכל שורת פריט בתוך כרטיס המארז האחד, ובשלב 3 לפני שלוש תיבות הסימון (`PackageCloseWizard`)
   - אחרי "עובד מבצע *" ולפני פאנל הקבצים (`PopUpTestDialog`)
4. **העובד מחליט.** "מוצע: לא תקין — …" הוא המלצה בלבד. `Result`, `Passed` ו-`Comments` ממשיכים לבוא מההכרעה של העובד בדיוק כמו היום.
5. **כל מפתח שנכתב היום ל-`Details` נשאר.** מתווספים רק `schema`, `fields` ו-`verdict` (§2.5).

### 4.1 קבצים

| קובץ | חדש / קיים | תפקיד |
|---|---|---|
| `src/app/testing/fields/useStationFields.ts` | חדש | טוען את ההגדרה של השלב הנוכחי (`GET /api/testing/station-fields?itemId=`), §4.2 |
| `src/app/testing/fields/useFieldsState.ts` | חדש | טיוטת הערכים, הערכה (`evaluateFields`) ובניית `FieldsResultBlock`, §4.3 |
| `src/app/testing/fields/FieldsBlock.tsx` | חדש | הבלוק: כותרת, ספירה, תג "מהגדרות המסלול", סטטוס, הכרטיס והשורות, §4.4 |
| `src/app/testing/fields/FieldRow.tsx` | חדש | שורה אחת: `[שם] \| [בקרה] \| [הערה]`, §4.5 |
| `src/app/testing/fields/ChoiceAutocomplete.tsx` | חדש | בקרת `choice_row`, בנויה על `SearchableCombobox`, §4.6 |
| `src/app/testing/fields/NotesField.tsx` | חדש | הערה שגדלה לפי הצורך (ארטבורד 7א), §6 |
| `src/app/testing/fields/NumberField.tsx` | חדש | שדה `number` עם יחידה ושורת טווח, §4.7 |
| `src/app/testing/fields/SuggestionLine.tsx` | חדש | שורת "מוצע: לא תקין — …", §4.9 |
| `src/app/testing/fields/ToneDot.tsx` | חדש | נקודת טון 6px (משותף גם למסך המנהל) |
| `src/app/testing/fields/fields.css` | חדש | מחלקות `tst-fx-*`, רק טוקנים מ-`tokens.css` |
| `src/app/testing/tests-popups/stationKit.tsx` | קיים | `PassFail` מקבל `size`/`invalid`; `VerdictCard` מקבל `suggestion` ו-`noteMax` |
| `src/components/ui/Autocomplete.tsx` | קיים | prop אופציונלי `listFooter`, §4.6 |
| `VerdictStation.tsx`, `PhotoStation.tsx`, `PackageOpenWizard.tsx`, `PackageCloseWizard.tsx`, `src/app/components/PopUpTestDialog.tsx` | קיים | ההזרקה, §4.11 |
| `src/app/testing/page.tsx` | קיים | `handleSubmitTestResult` מעביר את `code` של השגיאה, §4.12 |
| `tests-popups/mainPopUp.ts`, `PackageWizardShell.tsx`, `Xray.tsx`, `BlackMirror.tsx`, `Disassembly.tsx`, `Assembly.tsx`, `PackageDecisionDialog.tsx` | קיים | **ללא שינוי** |

מסך המנהל (תצוגת העובד החיה, §5.5.3) מייבא את **אותם** רכיבים מ-`src/app/testing/fields/`.

### 4.2 טעינת ההגדרה — `useStationFields`

```ts
// src/app/testing/fields/useStationFields.ts
import type { StationFieldsResponse } from "@/app/lib/station-fields/schema"; // §3.3

export type StationFieldsState =
  | { status: "loading" }
  | { status: "legacy" }                                   // no published config → today's popup
  | { status: "error"; retry: () => void }
  | ({ status: "ready"; reload: () => void } & Exclude<StationFieldsResponse, { mode: "legacy" }>);

export function useStationFields(itemId: string | number, open: boolean): StationFieldsState;
```

- **מתי נטען:** פעם אחת בכל פתיחה (`open` עובר מ-false ל-true) או כשמשתנה `itemId`. ביטול ב-`AbortController` כשהחלון נסגר. דרך `apiFetch` (`@/lib/api/client`), כמו `lookupRU` (`stationKit.tsx:56-65`).
- **איזה מזהה:** בחלונות של פריט — `item.item_id`. בשני אשפי המארז — `item.item_id` של **הקופסה**, כי `page.tsx:1444-1447` פותח את האשף על שורת המארז (`item` ב-props של האשף, `PackageOpenWizard.tsx:70`, `PackageCloseWizard.tsx:40`). לכן התשובה תהיה `mode: "package"`.

| מצב | מה החלון מציג | כפתור סיום / המשך |
|---|---|---|
| `loading` | **החלון של היום.** אם העובד כבר הגיע לשלב שבו יושב הבלוק, במקום הבלוק שלוש שורות `Skeleton` (`@/components/ui`, `Skeleton.tsx:13`) בגובה 44px **(לא אומת — אין מצב טעינה מצויר לחלון העובד בארטבורדים)** | **חסום** עד שמגיעה תשובה, כדי שתוצאה לא תישמר בלי שדות שהיו צריכים להיות בה |
| `legacy` | **החלון של היום, בדיוק.** שום רכיב מ-`fields/` לא מוצג | כמו היום |
| `ready` | הבלוק, שורת "מוצע", והערות בגרסת `NotesField` (§6) | כמו היום, **וגם** שער השדות (§4.3) כש-`gate === true` |
| `error` | במקום הבלוק: `Alert severity="error"` עם "טעינת הגדרות השדות נכשלה" וכפתור "נסה שוב" | **חסום** עד הצלחה או עד תשובת `legacy` |

- **(לא אומת)** — שתי המחרוזות במצב `error` לקוחות ממצב השגיאה של המנהל (ארטבורד 11). לחלון העובד אין ארטבורד שגיאה.
- **למה `error` חוסם:** תקלה רגעית לא תיצור בשקט תוצאה בלי שדות. השרת דוחה ממילא תוצאה בלי `schema` כשקיימת הגדרה (§3.4 צעד 2).
- **איפוס:** כל חלון מאפס היום את המצב שלו ב-`useEffect`: `VerdictStation.tsx:46-49`, `PhotoStation.tsx:51-54`, `PackageOpenWizard.tsx:93-100`, `PackageCloseWizard.tsx:55-59`. באותו `useEffect` מוסיפים `fx.reset()`. ב-`PopUpTestDialog` אין איפוס בפתיחה — הטופס מתאפס רק אחרי הצלחה (`:84-86`), ובאותו מקום מאפסים גם את השדות.

### 4.3 מצב הערכים — `useFieldsState`

הלקוח שומר **טיוטה** לכל שדה, ובונה ממנה `FieldValue` (§2.5) רק לצורך הערכה ושליחה.

```ts
// src/app/testing/fields/useFieldsState.ts
import type { Field, FieldId, FieldValue, FieldsSchemaRef, FieldsResultBlock } from "@/app/lib/station-fields/schema";
import { evaluateFields } from "@/app/lib/station-fields/evaluate";

export type FieldDraft = {
  opt?: string | null;                 // choice_row: OptionId
  opts?: string[];                     // multi_choice
  ok?: "pass" | "fail" | null;         // pass_fail
  num?: string;                        // number — raw text as typed ("," → ".")
  text?: string;                       // text / textarea / scan
  checked?: Record<string, boolean>;   // checklist
  photos?: Shot[];                     // photo (stationKit Shot)
  note?: string;
};
export type Drafts = Record<FieldId, FieldDraft>;

export function toFieldValue(def: Field, d: FieldDraft | undefined): FieldValue | undefined;
export function useFieldsState(defs: Field[]): {
  drafts: Drafts;
  defsCount: number;                   // excludes "section"
  set: (id: FieldId, patch: Partial<FieldDraft>) => void;
  setMany: (patch: Drafts) => void;    // "הכל תקין" (phase 3)
  reset: () => void;
  ev: ReturnType<typeof evaluateFields>;   // includes fails[]
  toBlock: (schema: FieldsSchemaRef, verdict: { ok?: "pass" | "fail"; note?: string }) => FieldsResultBlock;
};
```

**השער:**

```ts
const fieldsOk = !gate || (ev.missingRequired.length === 0 && ev.missingNotes.length === 0);
// noteTooLong is always blocking (server enforces it regardless of gate — §3.4 step 4)
const fieldsBlocking = !fieldsOk || ev.noteTooLong.length > 0;
```

בפועל `noteTooLong` לא אמור לקרות: `NotesField` עוצר את ההקלדה בגבול. הבדיקה נשארת ליתר ביטחון.

**מתי מציגים שגיאות על השורה** (prop של `FieldsBlock`):

| ארטבורד | "יש לפרט את החריגה" על הערה חסרה | "יש לבחור ערך" / "יש להזין ערך" על שדה חובה ריק |
|---|---|---|
| 12, 13, 15, 16, 17, 18 | מיד כשנבחר ערך שמחייב הערה | לא מוצג. הכפתור מושבת והסטטוס בכותרת מסביר |
| 14 (`PopUpTestDialog`) | מיד — כ-placeholder בגבול אדום, בלי שורה מתחת (§4.5) | **אחרי לחיצה** על "שמור וסיים" (`tried`, `LegacyFallback.dc.html` `onSave`): בחירה — "יש לבחור ערך" בתוך התיבה; מספר — "יש להזין ערך · עד …"; `pass_fail` — גבול אדום על שני הכפתורים **בלי טקסט** (`pfErr`, `:459-460`) |

### 4.4 `FieldsBlock`

```ts
type FieldsBlockVariant = "station" | "photo" | "dialog" | "wizard" | "kit-item" | "pack";
interface FieldsBlockProps {
  variant: FieldsBlockVariant;
  title: string;                       // from the table below
  groups: { mini?: string; icon?: "each" | "type"; fields: Field[] }[];
  fx: ReturnType<typeof useFieldsState>;
  showRequiredErrors?: boolean;        // 14: after first save attempt
  idPrefix: string;                    // React.useId() of the host; ids per field: `${idPrefix}-c-${f.id}` / `-n-`
  allOk?: boolean;                     // "הכל תקין" — phase 3 / artboard 5, OFF in phase 1 (§4.10)
  footer?: React.ReactNode;            // 14: SuggestionLine sits inside the block
}
```

**מבנה:**
- `<section aria-labelledby={titleId}>` עם שורת כותרת: הכותרת · "N שדות" (`--color-ink-muted-48`, `tabular-nums`) · התג "מהגדרות המסלול" (11px/600, `--color-primary` על `--color-primary-soft`, `--r-pill`) · רווח (`flex: 1`) · סטטוס `role="status"`.
- מתחתיה כרטיס לבן עם `1px solid var(--color-hairline)` ובו השורות. בין שורות `1px solid` בצבע `--color-divider-soft`.
- **בפריט בתוך מארז (15–16) — תווית קבוצה לכל קבוצה, גם כשיש רק קבוצה אחת** ("לכל פריט"; `LegacyPackageOpenItem.dc.html:770`, `:790-791` — פריט שאינו מסך מציג רק "לכל פריט", עם התווית). בלוק הקופסה (15) ובלוקי פריט בודד (12–14) — בלי תוויות. **תווית קבוצה** 11px/600 `--color-ink-muted-48`, ריפוד `10px 16px 4px`, אייקון lucide 12px — `Layers` לקבוצת "לכל פריט", `Monitor` לקבוצת הסוג (**(לא אומת)** — הארטבורד מצייר `Monitor` כי הסוג בדוגמה הוא מסך; לא נקבע אייקון לשאר הסוגים). כל קבוצה ב-`role="group"` עם `aria-label`.
- **התג "מהגדרות המסלול"** מוצג בכל שבעת הארטבורדים כש-`markNew` פעיל (ברירת המחדל). ההמלצה: **להשאיר אותו בייצור**, כי הוא מסביר לעובד מאיפה השדות (§10.2). את המסגרת הכחולה של `markNew` **לא** מממשים.

**ההבדלים בין החלונות** (כל ערך נמדד מהארטבורד):

| | 12 שיקוף | 13 פירוק | 14 ברירת מחדל | 15 קופסה (פתיחה) | 16 פריט (פתיחה) | 17 סגירה · פריטים | 18 סגירה · אריזה |
|---|---|---|---|---|---|---|---|
| **כותרת** | "בדיקות שיקוף" | "בדיקות פירוק" | "בדיקות העמדה" | "בדיקות הקופסה" | "בדיקות הפריט" | "בדיקות בסגירה" | "בדיקות האריזה" |
| **סגנון הכותרת** | h3 17/700, קו תחתון, mb 12 | h3 17/700, קו תחתון, mb 16 | h3 15/600 + `ClipboardCheck` 18px | h4 14.5/600, בלי קו | כמו 15 | 13/700 בפס `--color-surface-pearl` בראש כרטיס המארז | 12.5/600 |
| **ספירה** | "4 שדות" | "{n} שדות" | "5 שדות" | "{n} שדות" | "{n} שדות" | "· {n} שדות" | "· 2 שדות" |
| **סטטוס בכותרת** | סטטוס א' | סטטוס ב' | סטטוס ג' | סטטוס א' | סטטוס א' | אין; על כפתור הבא (§4.11.4) | אין; על כפתור הבא |
| **עמודות השורה** | `150px 230px 1fr`, gap 14, ריפוד `12px 16px` | `150px 240px 1fr`, gap 14, ריפוד `12px 16px` | `150px 190px minmax(0,1fr)`, gap 12, ריפוד `8px 12px` | `150px 230px 1fr`, gap 14, ריפוד `12px 16px` | כמו 15; שורה בקבוצה עם תווית: `8px 16px` | `170px 220px 1fr`, gap 12, ריפוד `8px 12px` | `150px 210px 1fr`, gap 12, ריפוד `8px 15px` |
| **רדיוס הכרטיס** | 16 | 16 | 11 | 14 | 14 | 10 (מקונן בשורת הפריט) | 12 |
| **הקלדה ברשימה** | כן, "הקלד לסינון או 1–4…" | כן, "הקלד לסינון…" | כן, "הקלד לסינון…" | כן, "הקלד לסינון או 1–4…" | כמו 15 | **לא**; כפתור ורשימה בלבד | לא |
| **רגל הרשימה** | "{N} אפשרויות" / "{k} מתוך {N}" · "1–4 בחירה מהירה" | "{N} אפשרויות" / "{k} מתוך {N}" · "1–4 · Enter בחירה" (`LegacyDisassembly.dc.html:216`) | "{N} אפשרויות" / "{k} מתוך {N}" · "1–4 · Enter בחירה" | כמו 12 | כמו 12 | "4 אפשרויות" · "1–4 בחירה" | כמו 17 |
| **גובה ההערה במנוחה** | 44 | 44 | 44 | 44 | 44 | **38** | **38** |
| **מקום "מוצע"** | מתחת ל-`PassFail` של "בדיקה תקינה?" | אותו מקום | בתוך הבלוק, בתחתיתו | מתחת ל-"האריזה תקינה?" | מתחת ל-"הפריט תקין?" | מתחת לשדות של כל פריט | אחרי שלוש תיבות הסימון |

הנוסחים שונים בין ארטבורדים לאותו אלמנט (רגל הרשימה, סטטוס, הצעה). **שומרים על הנוסח של כל ארטבורד בחלון שלו** ולא מאחדים.

**הכותרות ב-BlackMirror ו-Assembly (לא אומת).** אין להן ארטבורד. ההערה בתחתית ארטבורד 12: "מראה שחורה משתמשת באותו רכיב — השדות ייכנסו שם באותו מקום". ההצעה: `` `בדיקות ${config.contextLabel}` `` ("בדיקות מראה שחורה", "בדיקות הרכבה"). COPY-PENDING.

**נוסחי הסטטוס** (מהסקריפטים):

- **סטטוס א'** (12, 15, 16; `LegacyXray.dc.html` `reqLabel`, `LegacyPackageOpenBox.dc.html:798-802`):

  | מצב | נוסח | צבע |
  |---|---|---|
  | הכל מולא | "כל שדות החובה מולאו" | `--color-success-ink` |
  | חסרה רק הערה | "חסרה הערה לחריגה" | `--color-ink-muted-48` |
  | חסר שדה חובה אחד | "נותר שדה חובה אחד" | muted |
  | חסרים כמה | "נותרו N שדות חובה" | muted |

- **סטטוס ב'** (13): "כל שדות החובה מולאו" (ירוק) · "{done} / {total} שדות חובה" (muted) · "חסרה הערה לחריגה" (`--color-destructive`).
- **סטטוס ג'** (14): "כל שדות החובה מולאו" · "חובה: {done} מתוך {total}". ההתראות אחרי לחיצה (§4.11.6).

### 4.5 `FieldRow`

```ts
interface FieldRowProps {
  def: Exclude<Field, { type: "section" }>;
  draft: FieldDraft | undefined;
  onChange: (patch: Partial<FieldDraft>) => void;
  isFail: boolean;                // tone fail / pass_fail "fail" / number out of range with out_of_range_fail
  noteRequired: boolean;          // notes "required", or "required_on_fail" && isFail
  showRequiredError: boolean;
  variant: FieldsBlockVariant;    // drives metrics from the table in §4.4
  ids: { control: string; note: string };
  first: boolean; last: boolean;
}
```

- **עמודת השם:** `<label htmlFor={ids.control}>` 14.5/600 (14/600 בווריאנטים 14, 17, 18). שדה חובה: `*` ב-`--color-destructive` עם `aria-hidden`; החובה עצמה ב-`aria-required` על הבקרה. ל-`pass_fail` אין input אחד, ולכן השם הוא `<span id>` ש-`role="group"` מפנה אליו ב-`aria-labelledby` (14: `f.isPf`). `help` מוצג מתחת לשם (12px muted) — "מוצג מתחת לשם השדה בחלון העובד" (ארטבורד 3).
- **שורה בכשל:** רקע `--color-danger-bg`; הערך בטריגר `--color-destructive` 600.
- **עמודת ההערה:** `NotesField` (§6). כשההערה חובה מופיעה מעליה התווית "הערה · חובה" (12px/600 אדום), ובעמודות השם והבקרה `padding-top: 20px` כדי שיתיישרו עם התיבה (`ctlPad`, `LegacyXray.dc.html:138,143`). בלי חובה התווית מוסתרת ויזואלית: "הערה ל{label}". **ב-14 (variant "dialog"):** "הערה · חובה" היא legend 11px/600 על גבול התיבה (top −8px, `right: 9px`, רקע = רקע השורה, `legendBg`; `LegacyFallback.dc.html:189`, `:490`), **בלי** padding-top לעמודות; הערת חובה ריקה מוצגת כ-placeholder "יש לפרט את החריגה" בגבול אדום (`:493`), **בלי** שורת שגיאה מתחת.
- **`notes: "off"`:** העמודה השלישית נשארת ריקה, כדי שהעמודות לא יזוזו **(לא אומת — אף ארטבורד לא מצייר שורה בלי הערה)**.
- **`section`:** כותרת 13/700 על `--color-canvas-parchment`, ריפוד `8px 16px`, בכל רוחב השורה (`WorkerPopupItem.dc.html`, "הפעלה", "בטיחות חשמלית"). לא נספר ב"N שדות".

### 4.6 `ChoiceAutocomplete` — בקרת `choice_row`

נבנה על `SearchableCombobox` (`src/app/components/common/SearchableCombobox.tsx:82-261`) במצב `dense`. הוא כבר נותן: טריגר 44px (`.sh-combo--dense`, `ui.css:318`); רשימה בפורטל מעל חלונות ב-`z-index 1450` (`ui/Autocomplete.tsx:374-404`); חיצים, Enter ו-Esc, ו-Esc סוגר רק את הרשימה (`ui/Autocomplete.tsx:346-361`); `renderOptionContent` (`SearchableCombobox.tsx:56`), `startIcon` (`:60`), `inputSx` (`:67`), `noOptionsText` (`:103`).

```ts
interface ChoiceAutocompleteProps {
  id: string;
  label: string;                         // for aria + listbox aria-label
  options: ChoiceOption[];               // { id, label, tone }
  value: string | null;                  // OptionId
  onChange: (id: string | null) => void;
  required: boolean;
  invalid: boolean;                      // "יש לבחור ערך" (14, after tried)
  typeToFilter: boolean;                 // false in 17/18
  placeholderOpen: string;               // "הקלד לסינון או 1–4…" | "הקלד לסינון…"
  footerHint: string;                    // "1–4 בחירה מהירה" | "1–4 · Enter בחירה" | "1–4 בחירה"
  onPicked?: () => void;                 // host moves focus to the next row / to a required note
}
```

| נושא | איך | מקור |
|---|---|---|
| **טריגר סגור** | נקודה 6px בצבע הטון (`startIcon`), תווית הערך, וחץ למטה. בלי ערך: "בחר…" ב-`--color-ink-muted-40`. ב-14, כשחסרה חובה אחרי ניסיון שמירה, במקום "בחר…": "יש לבחור ערך" באדום | 12:145-147; 14 `emptyText` |
| **ערך בכשל** | `inputSx`: `color: var(--color-destructive); font-weight: 600` | 12 `valColor` / `valWeight` |
| **אפשרות ברשימה** | 15px, וי (כבר קיים ב-dense, `sh-combo-check`), נקודת טון 6px, התווית (החלק שתואם להקלדה ב-600), ומשבצת מקש `1`…`4` 20×20 עם `dir="ltr"` ו-`aria-hidden`, על `--color-surface-pearl` בגבול hairline. ב-`renderOptionContent`. `aria-label` של האפשרות כולל את מילת הטון ("לא דולקת · כשל") **(לא אומת — אין בארטבורדים; בחלונות 12–18 מוצגות נקודה + תווית האפשרות בלבד, ו"המילה" שליד הנקודה היא תווית האפשרות. מילת הטון "תקין/אזהרה/כשל/ניטרלי" מוצגת רק במסכי המנהל)** | 12:159-163 |
| **הבלטה** | הנבחר על `--color-primary-tint` בכחול 600. המודגש על `--color-canvas-parchment` | 12 `o.bg` |
| **אין תוצאות** | `noOptionsText="אין אפשרויות"` (ברירת המחדל של ה-primitive, `ui/Autocomplete.tsx:120`). **לא** "אין תוצאה תואמת" של ה-wrapper | 12:166 |
| **רגל הרשימה** | "{N} אפשרויות", או "{k} מתוך {N}" בזמן הקלדה, ומשמאל `footerHint`. **דורש** prop חדש `listFooter?: React.ReactNode` ב-`ui/Autocomplete.tsx`, שיוצג כ-`<li role="presentation">` אחרון בתוך ה-`ul` (`:386-437`) | 12:168-172 |
| **מקשי 1–4** | `inputValue` ו-`onInputChange` נשלטים מבחוץ (`ui/Autocomplete.tsx:65-66`). אם הטקסט אחרי trim הוא ספרה אחת `n` ו-`1 ≤ n ≤ min(4, options.length)`: `onChange(options[n-1].id)`, `onInputChange("")`, `onPicked()`. אחרת — טקסט לסינון | 12 `setQuery` |
| **מקשי 1–4 ב-17/18** | אין input. ה-`onKeyDown` של הטריגר מקבל `1`–`4` כשהרשימה פתוחה | 17:184 |
| **רשימה אחת פתוחה בכל רגע** | ה-primitive פותח ב-focus וסוגר ב-blur (`ui/Autocomplete.tsx:339-345`). מעבר לשורה אחרת סוגר את הקודמת. **אסור** לפתוח רשימה בלי focus | 5, 12 `toggleList` |
| **אחרי בחירה** | `onPicked()`: אם `noteRequired` נעשה true, ה-focus עובר להערה של השורה; אחרת ל-`ChoiceAutocomplete` בשורה הבאה (זה גם סוגר את הרשימה) | ארטבורד 5: "Enter לשורה הבאה" |
| **ניקוי** | `disableClearable`. הארטבורדים מציירים רק חץ, בלי × | 12:145-148 |
| **נגישות** | `aria-required`, `aria-invalid` כש-`invalid`. הטריגר שומר `role="combobox"` (+ `aria-expanded`, `aria-controls`, `aria-activedescendant`) מה-primitive. `aria-label` של הרשימה = שם השדה | 12:154,157 |

**`multi_choice` (לא אומת — אין ארטבורד עובד).** אותו טריגר עם `multiple` של ה-primitive (`ui/Autocomplete.tsx:73`) והצ'יפים שלו. מקשי 1–4 מסמנים/מבטלים, והרשימה נשארת פתוחה.

### 4.7 `NumberField`

ארטבורדים 6 ו-14.
- **ה-input:** 44px, `dir="ltr"`, `inputMode="decimal"`, `tabular-nums`, צמוד למשבצת יחידה (`Ω`). פסיק מומר לנקודה לפני `Number()`.
- **שורת הטווח** (`LegacyFallback.dc.html` / `WorkerPopupItem.dc.html`, `rangeWord`). ב-14 השורה מתחת לשם השדה; ב-6 מתחת ל-input:

  | מצב | נוסח | צבע |
  |---|---|---|
  | ריק | "טווח מותר · עד {max} {unit}" | muted |
  | חובה ריק אחרי ניסיון | "יש להזין ערך · עד …" | אדום |
  | לא מספר | "יש להזין מספר · עד …" | אדום |
  | בטווח | "בטווח · עד …" | `--color-success-ink` |
  | מחוץ לטווח | "מחוץ לטווח · עד …" | אדום |

- **(לא אומת)** — נוסח לשדה עם `min` בלבד, או עם `ref` ו-`tol_pct`. הארטבורדים מציירים רק `max`. ארטבורד 3 (מנהל) נותן את צורות הטווח "עד {max} Ω" / "מעל {min} Ω" / "{min}–{max} Ω" — משתמשים בהן אחרי "בטווח · " / "מחוץ לטווח · ". ל-`ref`/`tol_pct`: COPY-PENDING (ההצעה: לחקות את רצועת המשקל הקיימת, `PackageOpenWizard.tsx:381`).

### 4.8 `pass_fail` ושאר הסוגים

משתמשים שוב ב-`PassFail` (`stationKit.tsx:81-92`), עם שני props חדשים:

```ts
size?: "lg" | "row";   // lg = today (.tst-passfail, 56px); row = 44px, 14px/600 (14:181-182)
invalid?: boolean;     // 1.5px destructive border on both (14 `pfErr`); in 14 NO text — "יש לבחור ערך" under the buttons is artboard 6 only (phase 3)
```

`size="row"` מוסיף `tst-passfail--row` ב-`testing.css` (ליד `:180-203`). לחיצה על הכפתור שכבר נבחר **מבטלת** את הבחירה (14 `setIso`). בלי ה-props החדשים ההתנהגות זהה להיום.

לסוגים האלה אין ארטבורד עובד — כולם **(לא אומת)**, מימוש מינימלי באותה מסגרת שורה:
- `text`: input של 44px.
- `scan`: input עם `dir="ltr"`, כמו `SkuScreen` (`stationKit.tsx:128-136`). לא `ScanField` (קשור ל-lookup, `referenceScan.tsx`).
- `textarea`: `NotesField` בגודל `area`.
- `checklist`: שורות `pkg-choice` כמו "תקינות האריזה" (`PackageCloseWizard.tsx:206-217`).
- `photo`: `PhotoUploader` (`stationKit.tsx:142-296`) עם `uploadItemFiles`, כמו `PhotoStation.tsx:68-77`. צילום שעולה או שנכשל חוסם; `min` מחייב מספר צילומים.

### 4.9 `SuggestionLine`

```tsx
<SuggestionLine fails={ev.fails} prefix="מוצע: לא תקין — " tail?=" · ההחלטה בידי העובד" decided={verdict.ok} size="13" | "12.5" />
```

- **מבנה:** `role="status"`, אייקון לפי הארטבורד — `CircleAlert` 14px ב-12, 15–18 (כבר מיובא ב-`PackageOpenWizard.tsx:3`), `TriangleAlert` 15px ב-13 (`LegacyDisassembly.dc.html:265`), `Lightbulb` 14px ב-14 (`LegacyFallback.dc.html:230`); ל-`SuggestionLine` prop `icon`, והטקסט `prefix + fails.map(f => \`'${f.label}' = ${f.valueText}\`).join(" · ")`.
- **צבע:** `--color-warning-ink`. ב-12, 15 ו-16, כשהעובד כבר בחר "לא תקין", הצבע עובר ל-`--color-primary` (`suggestColor`).
- **ב-13** נוספת הסיומת " · ההחלטה בידי העובד" ב-muted (`LegacyDisassembly.dc.html:269`).
- **ב-14** הנוסח: "מוצע לסמן כלא תקין — " (`LegacyFallback.dc.html` `failText`), 12.5px/600.
- **מתי מוצג:** רק כשיש לפחות כשל אחד. אין שורת "מוצע: תקין", ושום דבר לא מסומן מראש.

### 4.10 "הכל תקין" (ארטבורד 5 — שלב 3)

- **הכפתור:** רפאים, 44px, כחול 14/600, אייקון `CheckCheck`. מוצג בכותרת של קבוצת פריט פתוחה כשיש בה שדות ריקים (`showAllOk = expanded && empties > 0`).
- **הפעולה** (`allOk(g)`, `WorkerPopupPackage.dc.html`): ממלאת **רק שדות ריקים** בקבוצה, באפשרות הראשונה שהטון שלה `pass`, או באינדקס 0 אם אין כזו.
- **בשלב 1** הוא לא נכנס לאף אחד מארטבורדים 12–18, ולכן `FieldsBlock` מקבל `allOk` כבוי. הוא מוכן לחלון המאוחד של שלב 3.

### 4.11 ההזרקה — חלון אחר חלון

בכל חלון אותו דפוס:

```ts
const sf = useStationFields(item.item_id, open);
const fx = useFieldsState(sf.status === "ready" && sf.mode === "item" ? sf.fields : []);
const hasFields = sf.status === "ready" && fx.defsCount > 0;
const fieldsGate = sf.status === "loading" || sf.status === "error" || (hasFields && fieldsBlocking);
```

#### 4.11.1 `VerdictStation` (שיקוף, מראה שחורה) — ארטבורד 12

| מה | איפה (`src/app/testing/tests-popups/VerdictStation.tsx`, 103 שורות) |
|---|---|
| **הבלוק** | בתוך `<Stack spacing={3}>` של שלב ההכרעה (`:93-99`): **אחרי** `<SystemNote>` (`:95`) **ולפני** `<VerdictCard>` (`:96-98`). ב-12 הבלוק הוא `<section>` נפרד בין "נא לשקף עפ״י תכנית …" לכרטיס "בדיקה תקינה?" |
| **כותרת** | "בדיקות שיקוף". ל-BlackMirror ראו §4.4 **(לא אומת)** |
| **"מוצע"** | `VerdictCard` (`stationKit.tsx:107-124`) מקבל prop חדש `suggestion?: React.ReactNode`, שמוצג מיד אחרי `<PassFail …/>` (`:116`) בתוך אותו `Box` (`:114-117`), עם `margin-top: 10px` |
| **ההערות בכרטיס** | `VerdictCard` מקבל `noteMax?: number`. כשמועבר, ה-`TextField` (`:120`) מוחלף ב-`NotesField size="verdict"` עם placeholder "הוסף הערה…" ו-editorTitle "הערה · הערות" (12). בלי `noteMax` נשאר ה-`TextField` של היום |
| **השער** | `canFinish` (`:61`) הופך ל-`skuScan.trim().length > 0 && verdict.ok !== "" && !fieldsGate`. ההודעה ב-`onFinish` (`:65`) לא משתנה: "לא ניתן לסיים — יש להשלים את כל שלבי הבדיקה". ב-12 כפתור הסיום מושבת (`finishOff`) והסטטוס בכותרת הבלוק אומר מה חסר |
| **"המשך" בשלב הסריקה** | לא משתנה (`canNext`, `:87`) |
| **`Details`** | ב-`:70-74` המפתחות `station`, `sku` ו-`verdict: {ok, note}` נשארים. כש-`hasFields` נכנס `...fx.toBlock(sf.schema, { ok: verdict.ok, note: verdict.note })` — ה-`verdict` נבנה מחדש עם אותם `ok` ו-`note` ועם `suggested`, כך שהוא **מורחב** ולא מוחלף |
| **`Result` / `Passed` / `Comments`** | ללא שינוי (`:69`) |
| **שגיאת שמירה** | `catch` ב-`:78` — §4.12 |

`Xray.tsx` ו-`BlackMirror.tsx` לא משתנים; הם מעבירים `config` בלבד (`Xray.tsx:7-14`).

#### 4.11.2 `PhotoStation` (פירוק, הרכבה) — ארטבורד 13

| מה | איפה (`PhotoStation.tsx`) |
|---|---|
| **הבלוק** | בתוך `<Stack spacing={3}>` (`:151-161`): **אחרי** `</PhotoSection>` (`:155-157`) **ולפני** `<VerdictCard>` (`:158-160`). הסדר ב-13: "תיעוד בתמונות" → "בדיקות פירוק" → "בדיקה תקינה?" |
| **כותרת** | "בדיקות פירוק". ל-Assembly ראו §4.4 **(לא אומת)** |
| **"מוצע"** | כמו §4.11.1, עם הסיומת " · ההחלטה בידי העובד" |
| **ההערות בכרטיס** | `noteMax={1000}` כמו §4.11.1. ב-13 ה-textarea "הערות" מקבל `maxlength` וכפתור הגדלה |
| **המסגרת הגדולה** | **לא משנים את 420px** (`stationKit.tsx:227`). ההערה ב-13 "התמונה הגדולה מוצגת בגובה מוקטן (במקור 420px) כדי שהשדות ופסק הדין ייראו" היא קיצור של הסקיצה בלבד; הגוף כבר נגלל (`stationKit.tsx:396`) |
| **השער** | `canFinish` (`:119`): התנאי של היום `&& !fieldsGate` |
| **`Details`** | ב-`:128-132` נשארים `station`, `sku`, `hasRU` ו-`photo: {ok, note, photos}`. כש-`hasFields` נוסף `...fx.toBlock(sf.schema, { ok: photo.ok })` — `schema`, `fields` ו-`verdict: {ok, suggested}` **לצד** `photo` |
| **שגיאת שמירה** | `catch` ב-`:136` — §4.12 |

החלטה פתוחה 2 (§10.1): שדות בשלב נפרד בתחנות הצילום.

#### 4.11.3 `PackageOpenWizard` — ארטבורדים 15 (קופסה) ו-16 (פריט)

**המצב:**
- `boxFx = useFieldsState(sf.ready ? sf.box : [])`.
- לכל פריט הטיוטה נשמרת **בתוך `ItemWork`** (`:44-55`): מוסיפים `fields: Drafts` ומאתחלים `fields: {}` ב-`freshWork` (`:57`). כך "פתח שוב" ו"יציאה מהפריט שומרת את מה שהוזן" (`:331`) שומרים גם את השדות.
- ההגדרה של פריט: `sf.items.find(x => x.item_id === it.item_id)`.
- פריט שנוסף בפתיחה (`addMissing`, `:154-173`) לא מופיע בתשובה שהתקבלה בפתיחת החלון. אחרי `reloadItems()` (`:147-152`) קוראים ל-`sf.reload()`.

**שלב "צילום הקופסה" (15):**

| מה | איפה |
|---|---|
| **הבלוק** | בתוך ה-`div` של השלב (`:395-404`): **אחרי** `<PhotoUploader …/>` (`:397`) **ולפני** ה-`<div>` של "האריזה תקינה?" (`:398-399`). כותרת: "בדיקות הקופסה" |
| **"מוצע"** | מיד אחרי `{choiceBox(...)}` (`:400`), לפני התווית "הערות" (`:401`) |
| **ההערות** | ה-`<textarea>` ב-`:402` הופך ל-`NotesField size="area"` עם placeholder "אופציונלי" ו-editorTitle "הערות · הקופסה" (15 `edTitle`) |
| **השער** | `nextEnabled` לשלב (`:219-222`): `boxPhotos.ok !== "" && !uploading/failed && !boxGate`. התווית "הסר את הצילום שנכשל" (`:221`) נשארת. ב-15 התווית לא משתנה בגלל שדות: "המשך" מושבת והסטטוס בכותרת הבלוק אומר מה חסר |

**שלב הצילום של פריט (16):**

| מה | איפה |
|---|---|
| **הבלוק** | בתוך `itemPhase === "photo"` (`:349-360`): **אחרי** `<PhotoUploader …/>` (`:352-353`) **ולפני** ה-`<div>` של "הפריט תקין?" (`:354-355`). כותרת: "בדיקות הפריט" |
| **הקבוצות** | מ-`groups` של הפריט (§3.3): "לכל פריט" (`Layers`), ואחריה "שדות {item_type_desc}" (`Monitor`), למשל "שדות מסך" (16, `mini: 'שדות ' + cur.type`). גם פריט עם קבוצה אחת בלבד מציג את תווית הקבוצה ("לכל פריט"; `hasMini: !!g.mini`, `LegacyPackageOpenItem.dc.html:770`, `:790-791`). רק בלוק הקופסה בלי תווית |
| **"מוצע"** | אחרי `{choiceBox(...)}` (`:356`) |
| **ההערות** | `:358` הופך ל-`NotesField size="area"` עם editorTitle "הערות · {item_type_desc}" (16 `edTitle`) |
| **השער** | `nextEnabled` לשלב הצילום (`:215`): התנאי של היום `&& !itemGate(cur)`. "סיום פריט" (`:209`) ושלב השקילה לא משתנים |
| **רייל** | לא משתנה. `stateLabel` (`:312`) נשאר "סריקה / צילום / שקילה / הושלם / ממתין". הסטטוס "חריגה" מארטבורד 5 שייך לשלב 3 |

**`finish` (`:229-280`):**
- **פריט** (`:246-258`): ה-`Details` של היום (`:251-256`) ועוד `...toBlock(itemDefs, w.fields, { ...sf.schema, target: "kit_item" }, { ok: w.photos.ok })`. `Result` ו-`Passed` לפי `itemPass(it)` (`:191`) — לא משתנים.
- **קופסה** (`:265-273`): `Details` של היום (`:267-272`) ועוד `...boxFx.toBlock({ ...sf.schema, target: "box" }, { ok: boxPhotos.ok })`.
- **ליתר ביטחון,** כמו הבדיקה הקיימת של הצילומים (`:232-236`): לפני השליחה, אם `itemGate` של פריט כלשהו או `boxGate` נכשל, `setError` עם ההודעה מ-14 ("נותרו N שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה", או נוסח היחיד/ההערה), ולא שולחים.
- **השמירה החלקית של היום נשמרת:** `committedRef` (`:89`, `:242`, `:263`). פריט שכבר נשמר לא נשלח שוב.
- **שגיאות שרת:** 422 `FIELDS_INCOMPLETE` ו-409 `FIELDS_SCHEMA_MISMATCH` כבר מוצגים, כי `d.error` נכנס להודעה (`:259-262`). ב-409 קוראים גם ל-`sf.reload()`; הטיוטות נשמרות לפי `FieldId`.

#### 4.11.4 `PackageCloseWizard` — שלב "פריטים ואריזה" (ארטבורד 17)

בסגירה **כל המארז בכרטיס אחד** (החלטה 3), והשדות מקוננים מתחת לכל שורת פריט.

| מה | איפה (`PackageCloseWizard.tsx`, 245 שורות) |
|---|---|
| **פס הכותרת** | בתוך המכל `:163` (`border … borderRadius: 14`), **לפני** `items.map` (`:164`): פס `--color-surface-pearl`, `min-height: 40px`, ריפוד `8px 16px`, קו תחתון, רדיוס עליון 13. בתוכו "בדיקות בסגירה", "·", "{n} שדות" והתג "מהגדרות המסלול". n סופר רק פריטים שהשדות שלהם מוצגים (17 `fieldCount`) |
| **עטיפת שורה** | ה-`div` של השורה (`:170-194`) נעטף ב-`<div role="group" aria-label={name}>` (17:137). ה-`key` עובר לעטיפה |
| **השדות** | מיד **אחרי** השורה (`:194`), בתוך העטיפה: `div` בריפוד `0 51px 10px 12px` עם קו תחתון, ובו כרטיס פנימי ברדיוס 10 עם שורות `row-compact` (17:156-160) |
| **למי מציגים** | `fieldsVisible = arrived(it) \|\| decisions[it.item_id]?.decision === "packed_anyway"` (17 `fieldsVisible`). "חסר במארז" לא מקבל שדות |
| **פריט שעוד לא הוחלט** | לא הגיע ואין החלטה: שורה muted 12.5px עם `Info` 14px, "השדות יוצגו אחרי ההחלטה", ריפוד `10px 16px`, מוזח 64px מימין (17:226-231) |
| **"מוצע"** | לכל פריט, אחרי הכרטיס הפנימי: 12.5px/600 `--color-warning-ink` (17:217-223). אין שאלת הכרעה לפריט בסגירה, ולכן אין הכחלה |
| **השער** | `nextEnabled` / `nextLabel` (`:83`): `!allResolved` → "נדרשת החלטה לכל פריט", כמו היום. אחרת, אם חסרים שדות או הערות בפריטים המוצגים: `nextEnabled = false` ו-`nextLabel = missLabel(...)` — "חסרה הערה לחריגה" / "נותר שדה חובה אחד" / "נותרו N שדות חובה" (17, `missLabel`) |
| **ההודעה הקיימת** | "אי אפשר לאשר תקינות אריזה לפני שכל פריט סומן כנארז או קיבל החלטה מפורשת." (`:198-200`) לא משתנה |

#### 4.11.5 `PackageCloseWizard` — שלב "תקינות האריזה" (ארטבורד 18) ו-`finish`

| מה | איפה |
|---|---|
| **הבלוק** | בתוך `<div style={{ maxWidth: 620, marginTop: 20 }}>` (`:205`), **לפני** קבוצת התיבות (`:206`). עטיפה `role="group"` עם `aria-labelledby`, `margin-bottom: 26px`. כותרת 12.5/600 "בדיקות האריזה", "·", "{n} שדות", התג. כרטיס ברדיוס 12, שורות `row-compact` (18:245-256) |
| **"מוצע"** | **אחרי** שלוש התיבות (`:206-217`) **ולפני** התווית "הערות אריזה" (`:218`). 12.5px/600 warning-ink, `margin-top: 9px` (18:325-329) |
| **ההערות** | `:219` הופך ל-`NotesField size="area"` עם placeholder "אופציונלי" ו-editorTitle "הערה · הערות אריזה" (17/18 `pk`) |
| **השער** | `:84`: `nextEnabled = checksAll`. מוסיפים: אם `checksAll` וחסרים שדות בקופסה, `nextEnabled = false` ו-`nextLabel = missLabel(...)`. אחרת "סגור מארז" (18) |

**`finish` (`:87-120`):**
- **פריט שהגיע** (`:91-105`): `Details` של היום `{ closing, packed, package_id }` (`:97`) ועוד `...toBlock(defsOf(it), drafts[it.item_id], { ...sf.schema, target: "kit_item" }, {})`. בתוצאה `verdict: { suggested }` בלי `ok` (אין לפריט שאלת הכרעה). `Result: 1` ו-`Passed: true` (`:97`) **לא משתנים**.
- **קופסה** (`:106-113`): `checks`, `note`, `packed` ו-`decisions` נשארים, ונוסף `...boxFx.toBlock({ ...sf.schema, target: "box" }, {})`. `Result` נשאר `anyMissing ? 0 : 1` (`:107`) גם כש-`suggested = "fail"` — העובד מחליט; `suggested` נרשם ב-`verdict` בלבד.
- **פריט "נארז בכל זאת"** לא מקבל שורת תוצאה (`:92`, `if (!arrived(it) …) continue`). השדות שלו נכנסים **לתוך** ההחלטה ב-`:111`: `{ item_id, decision, note, fields, suggested }`.

`PackageDecisionDialog` (`PackageDecisionDialog.tsx`) ו-`PackageWizardShell` לא משתנים: כל ההזרקה נכנסת דרך `children` (props ב-`PackageWizardShell.tsx:30`, `:51-55`; מוצג ב-`:139`), `nextLabel` ו-`nextEnabled` (כפתור ההמשך `disabled={!nextEnabled || busy}` … `{nextLabel}` ב-`:146-148`). גם `StationShell` לא משתנה: `canFinish` (`stationKit.tsx:439`) כבר משבית את כפתור הסיום.

#### 4.11.6 `PopUpTestDialog` (חשמל, מכניקה, ויזואלית וכל עמדה בלי אשף) — ארטבורד 14

| מה | איפה (`src/app/components/PopUpTestDialog.tsx`, 207 שורות) |
|---|---|
| **הבלוק** | בתוך `<Stack spacing={3}>` (`:104`): **אחרי** ה-`Box` של "עובד מבצע *" (`:127-138`) **ולפני** `<ItemFilesPanel …/>` (`:141`). כותרת: "בדיקות העמדה", עם `ClipboardCheck` |
| **"מוצע"** | בתוך הבלוק, בתחתיתו: "מוצע לסמן כלא תקין — …" (14). אין כאן "בדיקה תקינה?"; ההכרעה נשארת "תוצאת בדיקה" המספרית (`:116-124`) |
| **הערות נוספות** | `:143-151` הופך ל-`NotesField size="verdict"` עם placeholder "הוסף הערות כאן…" ו-editorTitle "הערה · הערות נוספות" (14) — **רק כש-`hasFields`** |
| **השער** | **לפי 14:** "שמור וסיים" (`:195-200`) **נשאר לחיץ**. ב-`handleSubmit` (`:58-95`), אחרי בדיקת העובד (`:62-65`) ורק כש-`action === "save"` או `"finishRoute"` ולא במצב מחקר: אם יש חוסר — `setTried(true)`, `setError(alertText)`, `return`. ההתראה ב-`Alert` הקיים (`:110-114`):<br>• "נותר שדה חובה אחד בבדיקות העמדה — יש למלא לפני סיום בדיקה"<br>• "נותרו N שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה"<br>• "חסרה הערה לחריגה בבדיקות העמדה — יש לפרט לפני סיום בדיקה"<br>(14 `alertText`). השורות מציגות "יש לבחור ערך" / "יש להזין ערך · עד …" / גבול אדום |
| **"העבר לחקר"** | **לא חסום** (`:185-192`). ב-14 אין לו `onSave`, והשרת משחרר את השער ב-`sendToResearch` (§3.4). "החזר למסלול" (`:164-170`) לא חסום |
| **"סיים מסלול" במצב מחקר** | `isResearchStatus` (`:97`). השרת משחרר את השער במצב 5, ולכן הלקוח לא חוסם ומציג את הבלוק בלי שער **(לא אומת — 14 לא מצייר את המצב הזה)** |
| **`Details`** | היום לא נשלח בכלל (`:71-82`). כש-`hasFields`: `Details: fx.toBlock({ ...sf.schema, target: "item" }, {})`, כלומר `verdict: { suggested }` בלבד. `Result` עדיין מ"תוצאת בדיקה" |
| **רוחב** | החלטה פתוחה 3: `maxWidth="sm"` (600, `ui/Dialog.tsx:14`) הופך ל-`"md"` (900) **רק** כש-`hasFields`. 14 צויר ב-600 (`LegacyFallback.dc.html:79`), ושם עמודת ההערה 162px (הערה בסקריפט, `:360`). שבירת השורה ב-900 לא מצוירת **(לא אומת)** |
| **איפוס** | אחרי הצלחה (`:84-86`): `fx.reset()` ו-`setTried(false)` |

#### 4.11.7 `mainPopUp.ts` — ללא שינוי

`REGISTRY` (`mainPopUp.ts:26-31`) ו-`getStartTestDialog` (`:36-37`) נשארים. שדות לא משנים איזה חלון נפתח. אין `wizard_key` ואין רישום חדש. ה-TODO (`:11-12`) נשאר.

### 4.12 שגיאות שמירה — `src/app/testing/page.tsx`

`handleSubmitTestResult` (`page.tsx:1108-1150`) זורק היום `new Error(error.error || "Failed to save test result")` (`:1141-1144`), ו-`VerdictStation`/`PhotoStation` בולעים את ההודעה ומציגים "שגיאה בשמירת הבדיקה" (`VerdictStation.tsx:78`, `PhotoStation.tsx:136`). העובד לא היה רואה את ההודעה בעברית של 422.

```ts
// page.tsx:1141-1144
if (!response.ok) {
  const error = await response.json().catch(() => ({}));
  throw Object.assign(new Error(error.error || "Failed to save test result"), { code: error.code as string | undefined });
}
```

- **בחלונות:** `catch (e) { setError(isFieldsError(e) ? e.message : "שגיאה בשמירת הבדיקה"); if (e.code === "FIELDS_SCHEMA_MISMATCH") sf.reload(); }`. `isFieldsError` בודק `code` מתוך `FIELDS_INCOMPLETE`, `FIELDS_SCHEMA_MISMATCH`, `NOTE_TOO_LONG`.
- **`PopUpTestDialog`** כבר מציג `error.message` (`:90`); מספיק לו לקרוא ל-`sf.reload()` ב-409.
- **אשפי המארז** שולחים את הפריטים ישירות, ושם `d.error` כבר נכנס להודעה (`PackageOpenWizard.tsx:259-262`, `PackageCloseWizard.tsx:100-103`).

### 4.13 מקלדת ונגישות — סיכום

| מקש | פעולה | מקור |
|---|---|---|
| `1`–`4` | בוחר את האפשרות ה-n ברשימה הפתוחה, ומעביר פוקוס להערת חובה או לשורה הבאה | 12, 15, 16, 17 |
| הקלדה | מסננת; התאמה מודגשת ב-600; הרגל "{k} מתוך {N}" | 12, 6 |
| `↑` / `↓` / `Enter` | מה-primitive (`ui/Autocomplete.tsx:352-361`) | — |
| `Esc` | סוגר את הרשימה או את העורך, לא את החלון | `ui/Autocomplete.tsx:347-350`; 7א |
| `Tab` | בקרה → הערה → כפתור הגדלה → השורה הבאה | — |

- ה-`useGlobalScanner` של עמוד הבדיקות **כבוי** כשחלון פתוח (`page.tsx:1024`), כך שהספרות 1–4 לא נבלעות בסורק.
- הטון לעולם אינו רק צבע: תמיד נקודה **וגם** מילה.
- שגיאות ("יש לפרט את החריגה", "יש לבחור ערך") מקושרות לשדה ב-`aria-describedby` ומוכרזות פעם אחת (`aria-live="polite"`). שורת ההצעה ומונה החובה הם `role="status"`.
- מודל הפוקוס של החלון לא משתנה. עורך ההערה מחזיר את הפוקוס לשדה כשנסגר.

---

## 5. צד המנהל — מסך אחרי מסך

הסעיף מכסה ארטבורדים **1, 2, 3, 4, 7א (הגדרת אורך ההערה), 8, 9, 10, 11**. ארטבורד 7 (פריסת החלון) הוא **שלב 3** ומוזכר רק כדי לסמן איפה יתחבר.

| # | ארטבורד | קובץ | מה זה בקוד |
|---|---|---|---|
| 1 | מפת שדות — עמדות × פריטי המארז | `design/Main.dc.html` | `view=map` ב-`/settings/testing-routes` |
| 2 | עריכת שדות בעמדה · חשמל · מחשב | `design/StationFieldEditor.dc.html` | `view=map&step=…&target=…` |
| 3 | הוספת שדה · סוגי שדות נוספים | `design/AddFieldTypePicker.dc.html` | פופאובר בתוך העורך + שורת מספר מורחבת |
| 4 | אפשרויות לשדה · רשימות משותפות | `design/OptionListEditor.dc.html` | פופאובר 560×600 בתוך העורך |
| 7א | הערה שגדלה לפי הצורך | `design/NotesField.dc.html` | "אורך מרבי" בשורת השדה (צד העובד: §6) |
| 8 | ערכות שדות · ספרייה | `design/FieldSetLibrary.dc.html` | `view=library` |
| 9 | החלת ערכה על כמה תאים | `design/ApplyFieldSetDialog.dc.html` | דיאלוג `sm` |
| 10 | פרסום גרסה · השפעה | `design/PublishImpactDialog.dc.html` | דיאלוג `sm` |
| 11 | מסלול ללא שדות · מצבי ריק ושגיאה | `design/FieldsOnboarding.dc.html` | מצבי `view=map` |

**ארטבורד 2 נשמר אחרי 7א ומכיל את הגרסה הסופית של שורת השדה.** כשיש סתירה ביניהם (למשל מיקום "אורך מרבי"), **ארטבורד 2 קובע**.

### 5.1 מה קיים היום, ומה משתנה

| מה | איפה בקוד | מה קורה לו |
|---|---|---|
| כותרת "מסלולי בדיקה" + "הגדרת סדר העמדות לפי סוג פריט ומספר מסלול." | `page.tsx:190-193` (`SettingsToolbar`) | הכותרת נשארת. כותרת המשנה מתחלפת ל"הגדרת סדר העמדות והשדות שהעובד ממלא בכל עמדה, לפי סוג פריט או מארז.", ונוספים תג ספירה ופעולות (§5.2) |
| פס שגיאה בטעינת האפשרויות | `page.tsx:195-200` | נשאר |
| כרטיס "בחירת מסלול" (`SearchableCombobox` סוג פריט + `TextField` מספר מסלול) | `page.tsx:203-248` | מוחלף בכרטיס ההקשר עם combobox "מסלול" אחד (§5.2). הבחירה הישנה (סוג + מספר) עוברת לזרימת "מסלול חדש" בלשונית "שלבי המסלול" (§5.13) |
| כרטיס "עריכת שלבים" | `page.tsx:251-344` | עובר כמו שהוא ללשונית "שלבי המסלול". **חובה:** השלבים מקבלים `uid` (§3.5) |
| `key={index}` / הזזה והסרה לפי אינדקס | `page.tsx:295`, `:122-138` | `key` לפי uid; פעולות על `{uid, typeId}[]` |
| שמירה | `page.tsx:140-179` | "שלבי המסלול" ממשיך לשמור שלבים (עם `step_uids`). השדות נשמרים כטיוטה אוטומטית (§5.2) |
| GET מחזיר `[]` בשגיאה | `api/settings/testing-routes/route.ts:28-32` | 500 (§3.1). ארטבורד 11 דורש "טעינת הגדרות השדות נכשלה", ו-`[]` נראה כמו מסלול ריק |
| הרשאות: `/settings/testing-routes` ל-`manager` ול-`tester` | `src/lib/routes.ts:78` | נשאר. מי רשאי **לפרסם** — §10.2 |

### 5.2 מבנה הדף, URL וחלקים קבועים

**URL.** הכל בנתיב אחד, והמצב ב-query כדי שקישור יפתח בדיוק את מה שהמנהל ראה:

```
/settings/testing-routes?type={item_type_id}&route={route_number}&view=map|steps|library
                         [&step={step_uid}&target={box|each_item|item:{item_type_id}|item}]
                         [&field={field_id}]          ← "עבור לשדה" מפוקס על השורה
                         [&lib=sets|lists&id={id}]    ← בתוך view=library
```

- `view=map` בלי `step` = המפה (ארטבורד 1). עם `step` ו-`target` = העורך (ארטבורד 2), באותה לשונית. "חזרה למפה" מנקה את `step` ואת `target`.
- בלי `type`: המסלול האחרון שנפתח (`localStorage`, עטוף ב-try/catch). אם אין — מצב ריק "בחר סוג פריט ומספר מסלול" (הטקסט הקיים ב-`page.tsx:271-272`).

**רוחב.** `.settings-page` מוגבל ל-1180 (`src/app/settings/settings.css:17-18`).
- **המפה והעורך** מבטלים את המגבלה (בארטבורד: 1152 ב-1440): מחלקה `settings-wide` לשורש הדף, וכלל `.settings-page:has(> .settings-wide) { max-width: none; }` — אותו דפוס כמו `:has(> .settings-fill)` ב-`settings.css:27`.
- **"ערכות ורשימות" ו"שלבי המסלול"** נשארים ב-1180.

**כותרת הדף** (`SettingsToolbar`, `src/app/settings/components/SettingsToolbar.tsx`; ה-props הקיימים `countText` ו-`actions`):
- h1 "מסלולי בדיקה", תג ספירה "14 מסלולים" (`countText={\`${n} מסלולים\`}`), וכותרת המשנה מ-§5.1.
- **`actions`, בסדר הזה (מימין לשמאל):**

| מצב | תג סטטוס (`StatusPill` עם `dotColor`) | טקסט 12px מושתק | כפתור 1 | כפתור 2 |
|---|---|---|---|---|
| יש טיוטה ואין שגיאות | "טיוטה · 6 שינויים", נקודה `--color-status-late` | "נשמר אוטומטית לפני רגע" | outlined-inherit "ביטול הטיוטה" | primary "פרסום לעמדות" עם `Send` |
| יש טיוטה ויש שגיאות | אותו תג | אותו טקסט | אותו כפתור | pill אזהרה (`--color-warning-ink` לטקסט ולמסגרת, רקע `--color-warning-bg`, `CircleAlert`): "בעיה אחת לתיקון" / "{n} בעיות לתיקון" |
| אין שדות במסלול (11) | "ללא שדות", נקודה `--color-ink-muted-40` | "אין שינויים לפרסום" (`id` ל-`aria-describedby` של הכפתור) | — | "פרסום לעמדות" disabled (רקע parchment, טקסט muted-48) |
| מפורסם, בלי טיוטה | **(לא אומת — אין טקסט בארטבורד; spec ישן: "מפורסם · גרסה N")**, נקודה `--color-status-approved` | — | — | "פרסום לעמדות" disabled |

- **"טיוטה · N שינויים":** N = מספר השינויים מאז הגרסה המפורסמת, בכל המסלולים שהמפה נוגעת בהם (המארז ומסלולי הפריטים שלו). יחיד/רבים כמו `draftLabel` בארטבורד 2.
- **"בעיה אחת לתיקון":** לחיצה גוללת לפס השגיאה שמעל המפה ומפקסת את "עבור לשדה". popover בעיות (360px ב-spec הישן) לא מצויר **(לא אומת)**.
- **"ביטול הטיוטה":** `DELETE …/fields/draft` לכל מסלול בהקשר, וחזרה לגרסה המפורסמת. `ConfirmDialog` (`src/components/ui/ConfirmDialog.tsx:29`) נדרש; הטקסט שלו לא מצויר **(לא אומת)**.
- **שמירה אוטומטית:** כל עריכה נכנסת לטיוטה ב-debounce של כ-800ms (`PUT …/fields/draft` עם `base_rev`). "נשמר אוטומטית לפני רגע" מתעדכן כזמן יחסי. הטקסטים לכשל בשמירה ולהתנגשות (409 `DRAFT_CONFLICT`) לא מצוירים **(לא אומת)**.

**כרטיס ההקשר** — `<section aria-label="מסלול נבחר">`: `.settings-card`, padding `14px 18px`, שורה אחת עם wrap. **מוסתר בלשונית "ערכות ורשימות"** (ארטבורד 8).

- **"מסלול"** — `SearchableCombobox` ב-`dense` (44px), רוחב 380, `startIcon` `Package` למארז. הערך: "מארז עמדת עבודה · מסלול 1".
  - **האפשרויות:** `GET /api/settings/testing-routes` בלי פילטר מחזיר את כל המסלולים. מצרפים `GET /api/settings/item-types` לשם ול-`is_package` (`src/app/api/settings/item-types/route.ts:21-22`).
  - **קיבוץ "מארזים" / "פריטים"** (spec; בארטבורד מצויר רק השדה הסגור). ל-`Autocomplete` אין `groupBy` (`AutocompleteProps`, `src/components/ui/Autocomplete.tsx:53-89`): מוסיפים `groupBy` + `renderGroup` לפרימיטיב, או ממיינים מארזים קודם ומשתמשים ב-`getOptionSubtitle` (`SearchableCombobox.tsx:57-58`).
  - **שורת משנה** "15/20 תאים מוגדרים" ו-**"+ מסלול חדש"** בתחתית הרשימה **(לא אומת: spec, לא ארטבורד)**. "+ מסלול חדש" פותח את "שלבי המסלול" עם בחירת סוג + מספר (§5.13).
- **תג primary:** "מארז · 4 סוגי פריטים · 5 יחידות". מ-`GET /api/settings/item-types/[id]/contents`: `total_items` (`src/app/api/settings/item-types/[id]/contents/route.ts:95`), ומספר הסוגים = `lines.length` (`:97`; גם `kinds` ב-`GET /api/settings/package-types`, `src/app/api/settings/package-types/route.ts:23,73`). למסלול פריט בודד התג לא מצויר **(לא אומת)**.
- **תג ספירה** (`.settings-count`, `settings.css:64`): "כיסוי 15/20" = תאים מוגדרים / תאים רלוונטיים. ⚠ בארטבורד 11 "כיסוי 3/16" כש-8 תאים מכוסים בפועל (§10.3).
- **ghost "פתח במסך המארזים"** (`ExternalLink`) → `/settings/packages?type={id}`. `src/app/settings/packages/page.tsx` לא קורא query היום (אין `useSearchParams`) — **צריך להוסיף בחירה לפי `?type=`**.
- **כפתור אייקון `?`** (`aria-label="קיצורי מקלדת"`): רשימת הקיצורים מ-§5.16, בניסוחי הארטבורדים.

**לשוניות התצוגה** — `<nav aria-label="תצוגות">`: 44px, gap 24, hairline בתחתית, בסגנון `.sh-subnav-tab` (`src/components/ui/ui.css:575`). הפעילה בכחול/600 עם קו תחתון 2px (`box-shadow: inset 0 -2px 0`).

| לשונית | אייקון | תוספת | `view` |
|---|---|---|---|
| "מפת שדות" | `LayoutGrid` | — | `map` |
| "שלבי המסלול" | `Route` | תג ספירה "5" (12px, parchment, hairline) | `steps` |
| "ערכות ורשימות" | `Library` | — | `library` |

⚠ "שלבי המסלול 5" למארז שמסלולו `[פתיחת מארז, סגירת מארז]` (2 שלבים); 5 הוא מספר העמודות במפה המאוחדת. **מה המספר מייצג — §10.3.**

### 5.3 קבצים לבנות

```
src/app/settings/testing-routes/
  page.tsx                          ← שלד: כותרת + כרטיס הקשר + לשוניות, קורא/כותב query
  route-fields.css                  ← מחלקות rf-* (טוקנים בלבד, §0.3)
  components/
    RouteFieldsHeader.tsx           ← StatusPill + "נשמר אוטומטית…" + ביטול/פרסום/בעיות
    RouteContextCard.tsx            ← combobox "מסלול", תגים, "פתח במסך המארזים", "?"
    RouteViewTabs.tsx
    steps/RouteStepsTab.tsx         ← כרטיס "עריכת שלבים" הקיים (page.tsx:251-344) + uid
    map/FieldsMap.tsx               ← role="grid", עמודות/שורות, מסגרת "כרטיס אחד"
    map/FieldsMapCell.tsx           ← מצבי תא (§5.4.3)
    map/FieldsMapToolbar.tsx        ← צ'יפי סינון + "תצוגה מקדימה כעובד" + "העתק ממסלול אחר…"
    map/FieldsMapBulkBar.tsx        ← פס הבחירה
    map/FieldsMapFooter.tsx         ← סיכום + מקרא + רמז מקלדת
    map/useGridSelection.ts         ← roving tabindex, Shift-טווח, בחירת עמודה
    map/FieldsMapEmptyStates.tsx    ← ארטבורד 11 (onboarding + 3 מצבים)
    editor/StationFieldEditor.tsx   ← ארטבורד 2: breadcrumb + פס עמדות + כרטיס עורך + תצוגה
    editor/StationTimeline.tsx
    editor/FieldRowsTable.tsx       ← כותרת עמודות + שורות + גרירה/Alt+חיצים
    editor/FieldRowEditor.tsx       ← choice_row | pass_fail | number | section | (שאר הסוגים)
    editor/OptionChip.tsx           ← צ'יפ + שינוי שם במקום + ToneMenu
    editor/ToneMenu.tsx             ← "סוג האפשרות" (200px)
    editor/NotesModeSelect.tsx      ← "אופציונלי / חובה בכשל / חובה / ללא"
    editor/NoteMaxSelect.tsx        ← "עד 1000 תווים" (ארטבורד 2)
    editor/NumberFieldSettings.tsx  ← ארטבורד 3, שורה מורחבת
    editor/AddFieldBar.tsx          ← "הוסף שורת בדיקה" + "סוג שדה אחר" + "כותרת מקטע" + "הדבק מאקסל"
    editor/FieldTypePicker.tsx      ← ארטבורד 3, פופאובר 380
    editor/OptionListPopover.tsx    ← ארטבורד 4, פופאובר 560×600
    editor/SharedRouteNotice.tsx    ← "השדות נשמרים במסלול 1 של …"
    editor/WorkerPreviewCard.tsx    ← "תצוגת העובד" · "חי" — מרנדר את רכיבי src/app/testing/fields/
    library/FieldLibrary.tsx        ← ארטבורד 8: שתי חלוניות + מתג ערכות/רשימות
    library/FieldSetList.tsx
    library/FieldSetEditor.tsx      ← משתמש ב-FieldRowsTable
    library/OptionListDetail.tsx
    dialogs/ApplyFieldSetDialog.tsx ← ארטבורד 9
    dialogs/PublishDialog.tsx       ← ארטבורד 10
  lib/
    draftStore.ts                   ← reducer של הטיוטה + debounce autosave + PUT לכל מסלול שנגעו בו
    mapModel.ts                     ← בניית עמודות/שורות/תאים מ-fields-context (§5.4.1)
    pasteTsv.ts                     ← פענוח הדבקה מאקסל (§5.14)
    labels.ts                       ← יחיד/רבים ("שדה אחד"/"N שדות", "תא אחד נבחר"/"N תאים נבחרו"…) + COPY-PENDING
src/components/ui/AnchoredPopover.tsx ← עטיפה דקה ל-@radix-ui/react-popover
```

- **כללי האימות** מיובאים מ-`src/app/lib/station-fields/validate.ts` (§2.3) — אותו קובץ בשרת ובלקוח. **אין** `src/app/lib/route-fields/`.
- **רכיבי העובד** (`ChoiceAutocomplete`, `NotesField`, `ToneDot`, `FieldRow`) מיובאים מ-`src/app/testing/fields/` (§4). `WorkerPreviewCard` מרנדר **אותם רכיבים** בצפיפות דחוסה; התצוגה לא מציירת שורה משלה.
- **`AnchoredPopover` חדש:** `@radix-ui/react-popover` מותקן (`package.json:29`) אבל לא בשימוש ב-`src`. ה-`Popover` הקיים (`src/components/ui/Misc.tsx:169`) הוא portal פשוט בלי ניהול פוקוס ובלי Escape, ולכן לא מתאים.

**רכיבים קיימים לשימוש חוזר** (מיוצאים מ-`src/components/ui/index.ts`):

| צורך | רכיב קיים | הערה |
|---|---|---|
| combobox "מסלול" | `SearchableCombobox` | `dense`, `denseHeight` 44/38/34, `startIcon`, `getOptionSubtitle`, `locked` (`:57-79`) |
| כפתורים | `Button` (contained/outlined/text; inherit/error/success/warning), `IconButton` | `.sh-btn` |
| תגים | `Tag` עם `tone` primary/neutral/success/warning/danger (`Chips.tsx:197-215`) | "כרטיס מארז", "לכל פריט בנפרד", "גרסה 3", "לא בשימוש", "משותף", "חובה", "יידלג" |
| תג סטטוס עם נקודה | `StatusPill` עם `dotColor` (`Chips.tsx:161-195`) | טיוטה / ללא שדות / מפורסם |
| פסים | `Alert` severity info/warning/error, props `icon`, `action` (`Feedback.tsx:8-32`) | הארטבורד משתמש ב-`CircleAlert` לאזהרה; ברירת המחדל של `Alert` היא `AlertTriangle` — מעבירים `icon` |
| דיאלוגים | `Dialog` עם `maxWidth` xs/sm/md/lg (`Dialog.tsx:14`), `DialogTitle` (כולל × "סגירה"), `DialogContent`, `DialogActions`, `ConfirmDialog` | ארטבורדים 9 ו-10 = `sm` |
| מתג / תיבת סימון / רדיו | `Switch`, `Checkbox`, `Radio`, `RadioGroup` (`Toggles.tsx`) | |
| בקר מקטעים | `.ri-chip` (`settings.css:327-343`) עם `aria-pressed` | ⚠ בארטבורד הלחוץ הוא `--color-primary-border` על `--color-primary-soft`; ב-CSS הקיים המסגרת `--color-primary`. ווריאנט `rf-chip` |
| tooltip | `Tooltip` (Radix, `Tooltip.tsx:30`) | תאי "—" ו-`Link2` |
| תפריט ⋯ | `Menu` (`Menu.tsx:25`) | |
| שלד טעינה | `Skeleton` | |
| כרטיסי בחירה | `.pkg-choice` (`src/app/packages/packages.css:292-306`, `aria-checked="true"` → מסגרת כחולה על tint) | רדיו-קארדים ב-9 ו-10 |
| שתי חלוניות | `.stations-grid` (330px + גמיש, `settings.css:132-141`), `.stz-row[data-selected]` (`settings.css:147-188`) | ארטבורד 8 |
| ריק | `.settings-empty`, `.settings-empty__title` (`settings.css:103-117`) | ארטבורד 11 |
| כפתור "הוסף" מקווקו | `.route-add` (`settings.css:223-242`) | "הוסף שורת בדיקה" |
| אינפוט 38px | `.stp-input`, `.stp-input--error` (`settings.css:260-283`) | שם השדה, יחידה, מקס׳ |
| אייקונים | `lucide-react` | **(לא אומת מול `node_modules` — לא מותקן בסביבה שנבדקה):** `Library`, `LayoutGrid`, `ClipboardPaste`, `ListChecks`, `ScanBarcode`, `Heading`, `ListTodo`, `ListPlus`, `ToggleLeft`, `Hash`, `PencilLine`, `Link2`, `History`, `Send`, `CircleAlert`, `GripVertical`, `Maximize2`, `LayoutTemplate`, `CheckCheck`, `Layers`, `Monitor`, `ClipboardCheck`. בדקו אחרי `npm ci` מול `lucide-react@^1.24.0` (`package.json:41`); אייקון חסר → השם החלופי באותה גרסה |

### 5.4 ארטבורד 1 — מפת שדות (`view=map`)

**מטרה:** תמונת כיסוי של עמדות × פריטים, ונקודת המוצא לכל פעולה מרובה.

**סדר:** כותרת → כרטיס הקשר → לשוניות → פס שגיאה (אם יש) → סרגל כלים → פס בחירה (אם נבחרו תאים) → כרטיס המפה.

#### 5.4.1 בניית המודל (`lib/mapModel.ts`)

**עמודות** — במסלול של מארז:
1. השלב **הראשון** במסלול המארז (`package_level`).
2. איחוד השלבים **האמצעיים** של מסלולי הפריטים, לפי סדר הופעה.
3. השלב **האחרון** במסלול המארז.

- **מפתח עמודה:** `(station_type_id, occurrence)`. אותו סוג עמדה יכול להופיע פעמיים באותו מסלול (למשל "יחידת רדיו" = INT→VIS→FUN→ENV→FUN ב-`seed-dev-dataset.js`, **לא נבדק שוב**). כל תא נקשר ל-**step uid** של המסלול שמחזיק אותו, לא לעמודה.
- **מיזוג סדר בין פריטים:** כשמסלולי הפריטים מסדרים עמדות בסדר שונה, מכניסים כל עמדה אחרי העמודה האחרונה שכבר הופיעה לפניה באותו מסלול. **(לא אומת — האלגוריתם לא מוגדר בארטבורד.)**
- **מסלול של פריט בודד (לא מארז):** אין ארטבורד **(לא אומת)**. ההצעה: מפה עם שורה אחת (הפריט) ועמודה לכל שלב.

**שורות** — במסלול מארז:

| שורה | אייקון | תת-שורה | מאיפה |
|---|---|---|---|
| "הקופסה" | אריח 30px רך-כחול, `Package` | "שדות על המארז עצמו" | `target:"box"` בשלבי `package_level` של מסלול המארז |
| "כל פריט במארז" | אריח 30px, `Layers` | "שדות משותפים לכל הפריטים" | `target:"each_item"` |
| "{seq} · {item}" + "×{qty}" (12px מושתק) | badge 26px parchment עם `seq` ("01", "02–03"), tabular | "מסלול {r} · {n} עמדות" | שורה לכל שורת `package_contents` (לפי `sort_order`) |

- בשורת פריט משותף מופיע `Link2` (12px, כחול) עם `title="משותף ל: {kits}"`, למשל "משותף ל: מארז ציוד היקפי": מסלול `(item_type_id, route_number)` של הפריט מופיע בתכולה של יותר ממארז אחד.

**תא:**
- עמודה `package_level` → קבוצת שדות בשלב **של מסלול המארז** (`box` / `each_item` / `{item_type_id}`).
- עמודה של פריט → הקבוצה `item` בשלב המתאים **במסלול של הפריט** (החלטה 4).
- "הקופסה" ו"כל פריט במארז" בעמודות של פריט: "—" (לא רלוונטי).
- פריט שלא עובר בעמודה: "—" עם tooltip `"{item} לא עוברת בעמדת {station} במסלול {r}"`. בארטבורד: "מקלדת לא עוברת בעמדת חשמל במסלול 1". הנטייה "עוברת" קבועה בארטבורד ולא נכונה לכל שם פריט (§10.3).

#### 5.4.2 כרטיס המפה — מידות

- **מסגרת:** `<section aria-label="מפת שדות">`, לבן, hairline, radius 16, `overflow:hidden`; גלילה אופקית עם `min-width:1120px`.
- **Grid:** `240px repeat(N, minmax(176px, 1fr))`. העמודה הראשונה sticky.
- **כותרת עמודה ראשונה:** "פריט / עמדה" (12/600 מושתק, parchment).
- **כותרות עמודה:** `<button aria-label="בחירת כל התאים בעמדה {name}">`, min-height 92, padding 12: עיגול כחול 20px עם המספר (11/700); שם העמדה (13/600); ב-`package_level` `Tag` primary "כרטיס מארז" עם `Package` 12px, ובעמודת פריט "לכל פריט בנפרד" (12px מושתק); שורה אחרונה "מוגדרים {x}/{y}" (12px מושתק). לחיצה בוחרת את כל התאים הרלוונטיים בעמודה.
- **עמודת `package_level` = מסגרת רציפה אחת:** רקע `--color-primary-tint`, מסגרת `--color-primary-border`; radius `11px 11px 0 0` בשורה הראשונה ו-`0 0 11px 11px` באחרונה; margin `6px 6px 0` / `0 6px` / `0 6px 6px`; בין התאים קו `--color-primary-border`; בראש העמודה "כרטיס אחד לכל המארז" (11/600 כחול); התאים בתוכה שקופים.
- **עמודת פריט:** אריחים נפרדים, min-height 62, radius 8, padding `8px 10px`, ריווח 5px.

#### 5.4.3 מצבי תא (מוגדרים ב-`script` של `Main.dc.html`)

| מצב | נראות | טקסט |
|---|---|---|
| מוגדר | לבן, `1px --color-hairline` | "{N} שדות" / "שדה אחד" (14/600). מתחת עד 4 נקודות 6px של הטונים **השונים** בתא, בסדר pass → warn → fail → neutral. תא מקושר לערכה: תג parchment 11/600 "ערכה: {שם}" (ellipsis) |
| ללא שדות | בעמודת פריט: לבן עם `1px --color-divider-soft`. בעמודת מארז: שקוף | "ללא שדות" (13px מושתק) |
| hover או פוקוס על "ללא שדות" | `1.5px dashed --color-border-strong` | `Plus` + "הגדר שדות" (13/600 כחול) |
| לא רלוונטי | parchment, `--color-ink-muted-40`, בלי hover, לא בטאב | "—", `aria-label="לא במסלול"`, tooltip כהה (radius 5, 12px) |
| שגיאה | `--color-warning-bg` + `--color-warning-border` | "{N} שדות" + `CircleAlert` + "שגיאה אחת" (12/600, `--color-warning-ink`). ל-N>1 אין טקסט **(לא אומת)** |
| נבחר | `2px solid --color-primary` על `--color-primary-tint` | בפינה badge 18px כחול עם `Check` לבן (`box-shadow: 0 0 0 2px #fff`). `aria-pressed="true"` |
| שינוי שלא פורסם | נקודה 6px `--color-status-late` בפינה, `title="שינוי שלא פורסם"` | — |
| הערכה עודכנה | 11/600 `--color-warning-ink` | "הערכה עודכנה" — כשגרסת הערכה המקושרת חדשה מזו שהתא מחזיק |
| משותף (11) | `Link2` בתא, tooltip | "הוגדר במסלול 1 של מסך · משותף עם מארז עמדת עבודה" |

- **שם נגיש לתא:** `aria-label="{station} · {row}"`; בארטבורד 11 (מוגדר) `"{station} · {row} · {n} שדות משותפים"`; ריק `"… · ללא שדות"`.

#### 5.4.4 פס שגיאה, סרגל כלים ופס בחירה

**פס שגיאה** (`Alert severity="warning"`, `role="alert"`): `"{station} · {item}: {הודעה}"` — בארטבורד "מכניקה · מסך: אפשרות ריקה בשדה 'ברגי VESA'". `action`: "עבור לשדה" → העורך עם `&field=`. כמה שגיאות: מציגים את הראשונה, והכפתור בכותרת מציג את הספירה (רשימה מלאה **(לא אומת)**). מוצג רק כש-tweak `showIssue` פעיל בארטבורד.

**סרגל כלים** (wrap, `space-between`):

| צד | תוכן | התנהגות |
|---|---|---|
| inline-start | `<div role="group" aria-label="סינון תאים">` עם 4 צ'יפים (32px, pill, 13/600): "הכל · 20" (לחוץ: `--color-primary-soft` / `--color-primary-border` / כחול), "ללא שדות · 5", "שגיאות · 1", "לא פורסמו · 1" | בחירה יחידה. סינון מסתיר שורות בלי תא מתאים; תאים לא מתאימים מוצגים רגיל **(לא אומת — אין מצב מסונן מצויר)** |
| inline-end | ghost "תצוגה מקדימה כעובד" (`Eye`) | **בשלבים 1–2** פותח את החלון הקיים של העמדה (ארטבורדים 12–18) במצב תצוגה עם קונפיג הטיוטה. בארטבורד הקישור מוביל ל-5 (החלון המאוחד, שלב 3) |
| inline-end | ghost "העתק ממסלול אחר…" (`Copy`) | דיאלוג לא מצויר **(לא אומת)** |

**פס בחירה** (`role="toolbar" aria-label="פעולות על התאים שנבחרו"`), כשנבחר תא אחד לפחות: min-height 48, רקע `--color-primary-tint`, מסגרת `--color-primary-border`, radius 11, padding `6px 14px`. בסדר:
1. "תא אחד נבחר" / "{n} תאים נבחרו" (14/600).
2. outlined small "עריכה משותפת" (`PencilLine`) — §5.14.
3. ghost "החל ערכת שדות…" (`Library`) → ארטבורד 9.
4. ghost "הדבק" (`ClipboardPaste`) עם רמז `Ctrl V` (11px, LTR, מסגרת hairline).
5. ghost "העתק".
6. ghost אדום "נקה".
7. בקצה, ghost "בטל בחירה" (`X`).

#### 5.4.5 פוטר המפה

רקע pearl, padding `12px 18px`.
- **סיכום** (13/600): "37 שדות · 5 תאים ללא שדות · שגיאה אחת".
- **מקרא** (12px מושתק, דוגמית 14×10 radius 3): "מוגדר" · "ללא שדות — העובד יראה את החלון הקבוע" (מקווקו) · "לא במסלול" (parchment) · "שגיאה" (warning-bg) · "שינוי שלא פורסם" (נקודה) · "עמדה ברמת מארז · כרטיס אחד" (tint + primary-border).
- **רמז מקלדת:** "חיצים לניווט · Shift לבחירת טווח · Enter לעריכה · Ctrl C / Ctrl V".

#### 5.4.6 נתונים

| קורא | כותב |
|---|---|
| `GET …/fields-context?packageTypeId=&routeNumber=` (§3.2) + תכולת המארז (`/api/settings/item-types/[id]/contents`) | פעולות מרובות (העתק/הדבק/נקה/החל ערכה) = עריכת טיוטה ב-`draftStore`, ושמירה ב-`PUT …/fields/draft` **לכל מסלול שנגעו בו** (§3.2). לא PUT לכל תא |

### 5.5 ארטבורד 2 — עריכת שדות בעמדה (`view=map&step=&target=`)

**מטרה:** להגדיר את השורות שהעובד ממלא בעמדה אחת, לפריט אחד (או ליעד אחד במארז), עם תצוגה חיה לצד העריכה.

**פריסה:**
1. **breadcrumb** (`<nav aria-label="מיקום">`): ghost "חזרה למפה" (`ArrowRight`, במראה של RTL), ואז "מפת שדות › {station} › {item}" — האחרון ink/600 עם `aria-current="page"`.
2. **פס עמדות** (`<section aria-label="עמדות המסלול">`): לבן, radius 16, min-height 64, padding `6px 12px`. בקצוות ghost "העמדה הקודמת" ו-ghost "העמדה הבאה: {name}" (chevrons במראה של RTL). **עצירה:** כפתור min-height 44 עם עיגול 26px — רגילה: מספר על לבן, מסגרת `--color-border-strong`; `package_level`: מלבן radius 7 על tint, מסגרת primary-border, עם `Package`; **נוכחית:** `--color-primary-soft` עם טבעת `0 0 0 2px --color-primary` ו-`aria-current="step"`. מתחת לכל עצירה שם (13/600) ושורה (12px) "{N} שדות" או "שגיאה" (אדום/600). בין עצירות קו hairline.
3. **שתי עמודות** (flex wrap, gap 20): העורך `flex: 999 1 560px`; התצוגה `flex: 1 1 380px`, `position:sticky; top:16px`.

#### 5.5.1 ראש כרטיס העורך

`<section aria-labelledby="sfe-title">`, padding `16px 20px 0`, hairline בתחתית.
- **h2 (20/700):** "שלב 2 מתוך 5 · חשמל". לידה בעמודת פריט `Tag` neutral "לכל פריט בנפרד"; ב-`package_level` `Tag` primary "עמדה ברמת מארז" (הטקסט קיים היום ב-`page.tsx:301`).
- **שורת משנה (13px מושתק):** "מה העובד ממלא בעמדה הזו עבור: {item}".
- **פעולות ב-inline-end:** ghost "העתק מ…" (`Copy`); ghost "העתק לפריטים…" (`Layers`); ⋯ עם `aria-label="פעולות נוספות לתא: שמור כערכה, החל ערכה, נקה את התא"`, `aria-haspopup="menu"`. פריטי התפריט: "שמור כערכה…", "החל ערכה…" (ארטבורד 9 עם תא אחד), "נקה את התא" (ה-aria-label אומת בארטבורד; "שמור כערכה…"/"החל ערכה…" מ-spec). הדיאלוגים של "העתק מ…", "העתק לפריטים…" ו"שמור כערכה…" לא מצוירים **(לא אומת)**.
- **לשוניות משנה (42px):** "שדות · {n}" (פעילה, `ListChecks`) | "פריסת החלון" (`LayoutTemplate`). "פריסת החלון" = ארטבורד 7 = **שלב 3**; עד אז הלשונית **לא מוצגת**. חריג: אם בהחלטה 2 יוחלט "שדות בשלב נפרד", נדרשת הגדרה מינימלית שאין לה טקסט **(לא אומת)**.
- **צ'יפי יעד** (`<div role="group" aria-label="הפריט שעבורו מגדירים שדות">`): "פריט:" ואחריו צ'יפ לכל פריט שעובר בעמדה, למשל "מחשב · 5", "מסך ×2 · 3" (המספר = שדות עם שם). החלפת צ'יפ סוגרת כל פופאובר.
  - **בעמדת `package_level`:** "הקופסה · 3", "כל פריט · 2", "01 מחשב · 2", "02–03 מסך · 2", "04 מקלדת · 1", "05 עכבר · 0" — הפורמט מהצ'יפים בארטבורד 7. מצב העורך הזה לא מצויר **(לא אומת)**.

#### 5.5.2 גוף העורך

padding `16px 20px`, gap 12.

**א. הודעת "משותף"** (`SharedRouteNotice`, `role="note"`, tint/primary-border, radius 11, `Info`):
- "השדות נשמרים במסלול {r} של {item} ומשמשים גם ב: {kits}. שינוי כאן יחול בשניהם." + קישור "צור מסלול נפרד למארז הזה".
- **מתי:** רק בעמודת פריט, כשהמסלול של הפריט מופיע בתכולה של מארז נוסף. אף פעם לא בשלב `package_level`.
- ⚠ "בשניהם" נכון רק לשני מארזים; ליותר **(לא אומת)**.
- **"צור מסלול נפרד"** = `POST …/[id]/fork` (§3.2.1). דיאלוג האישור לא מצויר **(לא אומת)**.

**ב. שורה נעולה עליונה** (parchment, radius 11, min-height 40, `Lock` 15px, 14px מושתק): "סריקת מק״ט יצרן · חלק קבוע · שלב 1 בחלון". הטקסט תלוי בחלון הקיים של העמדה; בארטבורד מצוירות רק VerdictStation ו-PhotoStation. לחלונות אחרים — נגזר מהעוגנים ב-§4.11 **(לא אומת)**. **(הנוסח בארטבורד נכון ל-VerdictStation/PhotoStation בלבד — חשמל עצמו נפתח ב-`PopUpTestDialog`; ראו §10.3.)**

**ג. טבלת השורות** (`FieldRowsTable`, מסגרת hairline radius 11):
- **כותרת עמודות** (`aria-hidden`; parchment, 36px, 12/600 מושתק): grid `28px 140px minmax(0,1fr) 100px 56px 32px`; תוויות: ריק | "שם השדה" | "אפשרויות · בחירה מהירה" | "הערות" | "חובה" | ריק.
- **שורה רגילה** (`.sfe-row`: padding `8px 12px 6px`, קו `--color-divider-soft`, pearl ב-hover):

| עמודה | תוכן |
|---|---|
| גרירה | כפתור 28×38 עם `GripVertical`, `aria-label="גרירה לשינוי סדר: {name}"` (ללא שם: "שורה ללא שם") |
| שם | `.stp-input` 38px, `aria-describedby` לשגיאה. במספר — אריח 24px עם `Hash` (`title="שדה מספר"`), ובתקין/לא תקין `ToggleLeft` (`title="שדה תקין / לא תקין"`); padding-inline-start 36. **שורה חדשה:** placeholder "לדוגמה: מאוורר מעבד", פוקוס עם הילה. **שגיאה:** `.stp-input--error`, מתחת "יש להזין שם לשדה" (12px אדום), `aria-invalid="true"` |
| אפשרויות | לפי סוג השדה (למטה) |
| הערות | `NotesModeSelect` + `NoteMaxSelect` |
| חובה | צ'יפ 32px "חובה", `aria-pressed`, `aria-label="שדה חובה: {name}"`. לחוץ: primary-soft / primary-border / כחול. לא לחוץ: לבן / hairline / muted-70 |
| ⋯ | 32×38, `aria-label="פעולות נוספות: {name}"`. התפריט לא מצויר **(לא אומת)**; ההצעה "שכפל" ו"מחק" (שני טקסטים שקיימים בארטבורד 8) |

- **שורת מקטע** (pearl): grid `28px minmax(0,1fr) 32px`; גרירה, `Heading`, input שקוף ברוחב 220 (14/700) עם label סמוי "כותרת מקטע", הכיתוב "כותרת מקטע · מקבצת את השורות שמתחתיה" (12px מושתק), ו-⋯. "+ כותרת מקטע" מוסיף מקטע בשם "מקטע חדש".

**עמודת האפשרויות לפי סוג השדה:**
- **`choice_row`** — `<div role="group" aria-label="אפשרויות לשדה {name}">`, min-height 38, wrap. צ'יפ לכל אפשרות: 32px, radius 5, parchment, hairline, 13px; נקודת טון 6px; תווית; × 24px עם `aria-label="הסרת האפשרות {label}"`.
  - **לחיצה על הצ'יפ** (`aria-label="עריכת האפשרות {label} · {tone}"`): **שינוי שם במקום** (אינפוט עם `aria-label="שם האפשרות"`, מסגרת `--color-primary-focus` והילה) + **`ToneMenu`** (`role="dialog" aria-label="עריכת אפשרות"`, 200px, radius 12, `--shadow-pop`): כותרת "סוג האפשרות" (12/600) ו-× "סגירה"; `radiogroup` "תקין"/"אזהרה"/"כשל"/"ניטרלי" (32px, נקודה בצבע הטון, הנבחר tint/600); מפריד; "מחק אפשרות" (אדום, `Trash2`).
  - **מתחת לצ'יפים:** קישור 12/600 "רשימה: {name}" עם `ChevronDown`, או "רשימה: מותאמת לשדה" → ארטבורד 4; ghost "+ אפשרות" מוסיף "אפשרות חדשה" בטון ניטרלי ונכנס לשינוי שם.
  - ⚠ **כלל מהארטבורד:** הוספה, הסרה, שינוי שם או טון של אפשרות בשדה שמקושר לרשימה משותפת **מנתקים את השדה מהרשימה** (`c.list = ''`), והקישור מתחלף ל"רשימה: מותאמת לשדה". לשינוי הרשימה עצמה — ארטבורד 4.
- **`number`:** בשורה (min-height 38): "יחידה" עם אינפוט LTR ברוחב 44; "מקס׳" עם אינפוט LTR ברוחב 56; "מספר · מחוץ לטווח = כשל" (12px מושתק). ההגדרות המלאות — ארטבורד 3.
- **`pass_fail`:** שני צ'יפים מסגרת 28px: "תקין" (`--color-success-ink`), "לא תקין" (`--color-destructive`), ואחריהם "תקין / לא תקין".
- **כל סוג, אם השורה חדשה בטיוטה:** נקודה `--color-status-late` + "חדש בטיוטה" (12/600 `--color-warning-ink`).
- **`text` / `textarea` / `checklist` / `multi_choice` / `photo` / `scan`:** בבוחר (ארטבורד 3), אבל ההגדרות בשורה לא מצוירות **(לא אומת)**. `photo`: `photo_type` מ-`GET /api/settings/photo-types` (קיים) ו-`min`. `checklist`: `items[]`. השאר: שם ועזרה בלבד.

**`NotesModeSelect`** — כפתור 38px, `aria-haspopup="listbox"`, `aria-label="הערות: {mode}"`. listbox 196px, radius 8, `--shadow-pop`, 4 אופציות בסדר: "אופציונלי", "חובה בכשל", "חובה", "ללא" (36px, עמודת `Check` 15px, הנבחרת tint/כחול/600). הערת שוליים בתחתית: "חובה בכשל: העובד חייב לפרט כשנבחרה אפשרות מסוג כשל." מיפוי: `optional` | `required_on_fail` | `required` | `off`.

**`NoteMaxSelect`** (גרסת ארטבורד 2): מתחת לבורר ההערות, ghost 24px (12px מושתק) "עד {n} תווים" עם `ChevronDown`, `title="אורך מרבי להערה"`, `aria-label="אורך מרבי להערה: {n} תווים"`. listbox: כותרת "אורך מרבי", "500 תווים", "1000 תווים · ברירת מחדל", "2000 תווים", הערת שוליים "העובד רואה מונה תווים מ-80% מהאורך." **מוסתר** כשמצב ההערות "ללא". נשמר כ-`note_max`. ⚠ 7א מצייר גרסה מוקדמת (select 38px עם תווית "אורך מרבי" ושורת עזרה "ברירת מחדל 1000 תווים · נשמר ב-test_results.details") — **הולכים לפי ארטבורד 2.** שלוש השורות בתחתית 7א ("העובד רואה מונה רק מ-80%…", "בהגעה לאורך המרבי ההקלדה נעצרת והמונה הופך לכתום.", "החלה על השדה הזה בלבד…") הן הערות עיצוב, לא UI.

**רק פופאובר אחד פתוח בכל רגע.** צ'יפ בעריכה, בורר ההערות ובורר האורך סוגרים זה את זה (ב-`script`: `edit`, `notesOpen`, `lenOpen`).

**ד. פס הוספה** (`AddFieldBar`):
- `.route-add` ברוחב מלא, 44px: `Plus` + "הוסף שורת בדיקה", ומתחת "שם · בחירה מתוך 4 אפשרויות · הערות" (12px מושתק).
- **שורה חדשה (מה-script):** `choice_row` עם אפשרויות "תקינות כללית" (מקושרת), `notes: required_on_fail`, לא חובה, פוקוס על השם.
- באותה שורה: outlined small "סוג שדה אחר ▾" → ארטבורד 3; ghost "+ כותרת מקטע"; ghost "הדבק מאקסל" (`ClipboardPaste`) עם `title="הדביקו שורות: שם⇥אפשרות 1⇥אפשרות 2⇥…"` (§5.14).

**ה. שורה נעולה תחתונה:** "פסק דין · 'בדיקה תקינה?' · תמיד אחרון". בשלבי מארז השאלה "האריזה תקינה?" / "הפריט תקין?" **(לא אומת לעורך)**. **(הנוסח בארטבורד נכון ל-VerdictStation/PhotoStation בלבד; ל-`PopUpTestDialog` אין "בדיקה תקינה?" — ראו §10.3.)**

**ו. פוטר הכרטיס** (pearl, 12px מושתק, tabular): "{N} שדות · {M} חובה[ · {K} שורות ללא שם] · גרירה או Alt+חיצים לשינוי סדר". יחיד: "שדה אחד", "חובה אחד", "שורה אחת ללא שם".

#### 5.5.3 תצוגת העובד (`WorkerPreviewCard`)

`<aside aria-labelledby="pv-title">`. **התצוגה נגזרת מהחלון שהעמדה באמת פותחת (`getStartTestDialog`, `mainPopUp.ts:36-37`).** הארטבורד מצייר את עמדת חשמל בסגנון VerdictStation ("שלב 2 מתוך 3", "סיום בדיקת חשמל"), אבל חשמל פותח את `PopUpTestDialog` (14) — ראו §10.3. הנוסח למטה נכון ל-VerdictStation/PhotoStation בלבד.
- **ראש:** "תצוגת העובד" (15/700); `Tag` success "חי" עם נקודה `--color-status-approved`; ghost "פתח בחלון מלא" (`Maximize2`) — פותח את החלון הקיים של העמדה במצב תצוגה (כמו "תצוגה מקדימה כעובד").
- **שורת דמה:** "{item} · {model} · 1005 1509 2600 **{suffix}**" (LTR, סיומת מודגשת). מתחת: "שינוי אפשרות כאן לא נשמר · מתעדכן עם כל עריכה בעורך".
- **מסגרת "בדיקות העמדה":** "{station} · {item} · {N} שדות"; "שלב 2 מתוך 3"; הודעת מערכת "נא לבדוק עפ״י תכנית {sku}"; שורות grid `92px 112px 1fr` בצפיפות הדחוסה של רכיב העובד; כותרות מקטע parchment 12/600.
- **מצב כשל לדוגמה:** `--color-danger-bg`, ערך אדום/600, מסגרת אדומה, "הערה · חובה", placeholder "פרט את החריגה…", "יש לפרט את החריגה".
- **מספר:** "בטווח · עד {max} {unit}" (`--color-success-ink`).
- **הערה בתצוגה:** `NotesField` בצפיפות 32px; בארטבורד 2 ה-textarea `rows` 1–6, `max-height` 122px, ובמצב מקופל 50px. בתוכה "הצג הכל · {n} שורות", "פתח עורך הערה", מונה מ-80% ו"הגעת לאורך המרבי".
- **מיני-פוטר:** "כל שדות החובה מולאו" / "נותר שדה חובה אחד" / "נותרו {n} שדות חובה"; כפתור success small עם תווית הסיום של העמדה ("סיום בדיקת חשמל"), `aria-disabled` כל עוד חסר משהו.
- **ערכים לדוגמה:** state מקומי בלבד, לא נשמרים.

#### 5.5.4 נתונים

| קורא | כותב |
|---|---|
| `GET …/[id]/fields` של המסלול שמחזיק את התא (המארז או הפריט); רשימות האפשרויות | `PUT …/[id]/fields/draft` של **אותו** מסלול, דרך autosave |

עריכה של תא פריט במפת מארז כותבת **למסלול של הפריט** — זו הסיבה להודעת "משותף".

### 5.6 ארטבורד 3 — "סוג שדה אחר" ושורת מספר מורחבת

**פופאובר `FieldTypePicker`:** מעוגן ל"סוג שדה אחר" (`aria-expanded`, `aria-haspopup="dialog"`, `aria-controls="type-picker"`; כשפתוח הכפתור על tint עם הילה). `role="dialog" aria-label="הוספת שדה מסוג אחר"`, 380px, radius 12, `--shadow-pop`. למעלה חיפוש 38px עם פוקוס אוטומטי, placeholder "חיפוש סוג שדה…", מסנן לפי שם או תיאור. קבוצות עם כותרת 11/600 מושתקת; כל פריט 48px: אריח 32px עם אייקון, שם 14/600, תיאור 12px מושתק; הפריט הפעיל (`aria-current`) על parchment עם רמז "Enter".

| קבוצה | שם | אייקון | תיאור | `type` |
|---|---|---|---|---|
| נפוץ | שורת בדיקה + `Tag` primary "ברירת מחדל" | `ListChecks` | "שם · בחירה מ-4 אפשרויות · הערות" | `choice_row` |
| נפוץ | תקין / לא תקין | `ToggleLeft` | "שני כפתורים גדולים" | `pass_fail` |
| מדידה וטקסט | מספר | `Hash` | "ערך עם יחידה, טווח או ערך ייחוס ±%" | `number` |
| מדידה וטקסט | טקסט קצר | `Type` | "שורה אחת חופשית" | `text` |
| מדידה וטקסט | טקסט ארוך | `AlignRight` | "פסקה, עד 3 שורות" | `textarea` |
| בחירה | רשימת סימון | `ListTodo` | "כמה תיבות סימון, כמו בבדיקת הסגירה" | `checklist` |
| בחירה | בחירה מרובה | `ListPlus` | "אפשר לבחור יותר מאפשרות אחת" | `multi_choice` |
| תיעוד | צילום | `Camera` | "סוג צילום ומינימום תמונות" | `photo` |
| תיעוד | סריקה | `ScanBarcode` | "שדה לקורא ברקוד" | `scan` |
| מבנה | כותרת מקטע | `Heading` | "מחלקת את השדות לקבוצות בחלון" | `section` |

- **אין תוצאות:** "אין סוג שדה מתאים" + "נסו מילה אחרת, למשל "מספר" או "צילום"".
- **פוטר** (pearl, 12px): "טיפ: Enter בשם השדה האחרון מוסיף שורת בדיקה חדשה".
- **כשהבוחר פתוח:** התצוגה החיה מקבלת כיסוי לבן 50% (`rgba(255,255,255,.5)`, radius 16).
- **מקלדת:** חצים מזיזים את הפעיל, Enter בוחר (מוסיף שורה מהסוג ופותח אותה מורחבת אם יש לה הגדרות), Escape סוגר ומחזיר פוקוס לכפתור.

**שורת מספר מורחבת** (`NumberFieldSettings`): הרחבה במקום, 180ms, השורה על pearl.
- **כפתור הסיכום** בעמודת האפשרויות: "יחידה Ω · {rangeShort} · מספר", עם `aria-expanded`/`aria-controls`; כשפתוח tint/primary-border. `rangeShort`: "ללא טווח" / "{min}–{max}" / "מקס׳ {max}" / "מינ׳ {min}".
- **Grid של שתי עמודות**, padding `16px 48px 16px 16px`:

| שדה | פקד | פרטים |
|---|---|---|
| "יחידה" | select 38px | "Ω אוהם". אין רשימת יחידות בארטבורד **(לא אומת)** |
| "מינימום" | אינפוט LTR, `inputmode="decimal"`, placeholder "—" | סיומת היחידה |
| "מקסימום" | אינפוט LTR | סיומת היחידה |
| "ערך ייחוס" | אינפוט | placeholder "לא בשימוש" |
| "סטייה מותרת ±%" | אינפוט | disabled בלי ערך ייחוס, עזרה "זמין לאחר הזנת ערך ייחוס"; עם ערך ייחוס "סטייה מותרת מערך הייחוס, באחוזים" (placeholder "5") |
| מתג | `Switch` (44×26) | "ערך מחוץ לטווח נחשב "לא תקין"" → `out_of_range_fail` |
| "טקסט עזרה לעובד" | אינפוט | placeholder "למשל: היכן ואיך למדוד"; עזרה "מוצג מתחת לשם השדה בחלון העובד" → `help` |
| — | ghost "סגור הגדרות" (`ChevronUp`) | — |

- **הודעת התצוגה החיה:** "בטווח · {טווח}" (ירוק); "מחוץ לטווח · {טווח} · יסומן לא תקין", או בלי הסיומת כשהמתג כבוי (אדום); "ללא טווח מוגדר". הטווח: "עד {max} Ω" / "מעל {min} Ω" / "{min}–{max} Ω".

### 5.7 ארטבורד 4 — אפשרויות לשדה (`OptionListPopover`)

- **עיגון:** לקישור "רשימה: …" בשורה. `role="dialog"` עם `aria-labelledby`, 560×600, radius 12, `--shadow-pop`; מאחוריו העורך עמום (scrim 40%).
- **ראש:** "אפשרויות · {field}" (15/700); בקר מקטעים (`role="group" aria-label="מקור האפשרויות"`): "רשימה משותפת" | "רק לשדה הזה"; × "סגירה".

**מצב "רשימה משותפת":**
- **עמודה ב-inline-start (200px, parchment, radius 8):** חיפוש "חיפוש רשימה…"; כותרות "רשימות משותפות" ו"שדות"; שורות 40px: שם (13/600) וספירה; מקושרת לשדה הנוכחי: `Link2` עם `title="מקושר לשדה {field}"`; הנבחרת tint/primary-border/כחול; בלי התאמה "אין רשימות תואמות"; בתחתית ghost "+ רשימה חדשה".
- **עמודה ב-inline-end:** "שם הרשימה" (אינפוט); עזרה "מקושר לשדה הזה · גרסה {v}", או "בלחיצה על "החל על השדה" {field} תקושר לרשימה הזו".

**מצב "רק לשדה הזה":** במעבר האפשרויות מועתקות מהרשימה. כותרת "אפשרויות מקומיות · {station} · {item}"; טקסט "הועתקו מהרשימה "{list}". שינוי כאן חל רק על {field} ולא ישפיע על שדות אחרים."

**רשימת האפשרויות (בשני המצבים):**
- **כותרת:** "אפשרויות · {n}" / "אפשרויות לשדה הזה · {n}", ולידה "מקשים 1–4 לבחירה מהירה בעמדה".
- **שורה** 44px, grid `24px 22px 32px minmax(0,1fr) 44px 32px`: (1) גרירה; (2) **קופסת מקש** 20px (mono 11px) "1"–"4", ומהחמישית "–" על parchment עם `title="אין מקש קיצור לאפשרות זו"`; (3) **כפתור טון** — לחיצה מחליפה תקין ← אזהרה ← כשל ← ניטרלי, `title="לחיצה מחליפה: תקין ← אזהרה ← כשל ← ניטרלי"`, `aria-label="סוג האפשרות: {w}. לחיצה מחליפה ל{next}"`; (4) **תווית** אינפוט 38px, מסגרת אדומה כשריקה; (5) **מילת הטון** (12px מושתק); (6) **×** `aria-label="הסרת האפשרות {label}"`.
- **הוספה:** אינפוט מקווקו, placeholder "הוסף אפשרות (Enter)"; כשיש טקסט מופיע "הוסף". חדשה = ניטרלי.
- **שורת אימות** (`role="status"`, 12/600): הטקסטים של §2.3 (`OPTIONS_TOO_MANY`, `OPTIONS_TOO_FEW`, `OPTIONS_NO_FAIL`, "אפשרות ריקה — מלאו או הסירו", ומצב תקין בירוק).
- **פתק השפעה** (רק במצב משותף, `role="note"`, tint): "שינוי ברשימה המשותפת יחול על {N} שדות[ ב-{R} מסלולים] לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו."
- **פוטר** (pearl): ב-inline-start ghost "שמור כרשימה חדשה…"; "ביטול" (outlined-inherit small); primary small "החל על השדה".

**"החל על השדה":**
- **משותף:** `PUT /api/settings/option-lists/[id]` (גרסה חדשה של הרשימה) + קישור השדה (`list_ref: {id, ver}`) בטיוטה. השדות האחרים המקושרים מתעדכנים **בטיוטות שלהם** דרך `POST …/option-lists/[id]/propagate` ומסומנים במפה "שינוי שלא פורסם".
- **מקומי:** כותב את האפשרויות על השדה ומנתק את הקישור.

### 5.8 ארטבורד 7א — מה רלוונטי למנהל

- "אורך מרבי" בשורת השדה — `NoteMaxSelect` (§5.5.2).
- ההערה בתצוגה החיה — `NotesField` של העובד בצפיפות התצוגה (§5.5.3). כל ההתנהגות — §6.

### 5.9 ארטבורד 8 — ערכות ורשימות (`view=library`)

- **פריסה:** כותרת הדף (בלי כרטיס הקשר) → לשוניות ("ערכות ורשימות" פעילה) → שתי חלוניות `flex: 1 1 330px` + גמישה, gap 20. **הספרייה גלובלית** — לא תלויה במסלול שנבחר.

**חלונית הרשימה** (`<section aria-label="ספריית ערכות ורשימות">`):
- בקר מקטעים (`role="group" aria-label="תוכן הספרייה"`): "ערכות שדות · {n}" | "רשימות אפשרויות · {n}".
- ראש: h2 "ערכות שדות" / "רשימות אפשרויות"; outlined small "+ ערכה חדשה" (יוצר "ערכה חדשה" עם המטא "נוצרה עכשיו · {user}") או "+ רשימה חדשה" (פותח את ארטבורד 4).
- חיפוש pill 40px: "חיפוש ערכה…" / "חיפוש רשימה…".
- שורות `role="list"`, `.stz-row` 56px עם `aria-current`. **ערכה:** שם (14/600) ו"{N} שדות · בשימוש ב-{n} תאים" ("בשימוש בתא אחד"; בלי שימוש רק "{N} שדות"); `Tag` neutral "לא בשימוש"; נקודה כתומה `title="שינויים שלא נשמרו"`. **רשימה:** שם, "{n} אפשרויות · בשימוש ב-{m} שדות", נקודות טון.
- אין תוצאות: "אין תוצאות" + "אין ערכה בשם הזה. אפשר ליצור ערכה חדשה." / "אין רשימה בשם הזה."
- פוטר: "ערכה היא תבנית: החלה על תא מעתיקה את השדות ושומרת קישור, כדי שעדכונים יוצעו לתא." / "רשימה משותפת מקושרת לשדות: שינוי באפשרויות יחול על כל השדות שמשתמשים בה אחרי פרסום."

**עורך ערכה** (`<section aria-label="עריכת ערכה: {name}">`, padding 20):
1. **ראש:** h2 (20/700) עם השם ו-`Pencil` (`aria-label="שינוי שם הערכה"`; מצב עריכת השם לא מצויר **(לא אומת)**); `Tag` primary "גרסה {v}", ובלי שימוש גם "לא בשימוש"; מטא (12px מושתק) "עודכנה לפני יומיים · נועה לוי" / "נוצרה מתוך: חשמל › מחשב · נועה לוי" / "שוכפלה מ: {name}"; כשיש שינויים "שינויים שלא נשמרו · יישמרו כגרסה {v+1}" ו-primary small "שמירה כגרסה {v+1}" (`aria-disabled` כשיש שדה בלי שם); פעולות: ghost "שכפל" (יוצר "{name} · עותק", גרסה 1), ghost אדום "מחק" (אישור לא מצויר **(לא אומת)**), outlined "החל על תאים…" (§5.10).
2. **בלוק שימוש** (pearl, radius 11): "בשימוש ב-{n} תאים" / "לא בשימוש" + "לחיצה על תא פותחת אותו בעורך"; צ'יפים (13px, `Link2`) "מארז עמדת עבודה › בדיקה ויזואלית › מחשב", בהמשך מקוצר "… › מסך"; תא בגרסה ישנה: צ'יפ אזהרה עם "גרסה 2" ו-`aria-label` "{מלא} · גרסה {n}"; לחיצה פותחת את העורך על התא; יותר מחמישה: "+{n} נוספים" → המפה; בלי שימוש: "הערכה עוד לא מוחלת על אף תא. בחרו תאים במפת השדות ולחצו "החל ערכת שדות…", או השתמשו בכפתור "החל על תאים…" למעלה."
3. **פס תאים בגרסה ישנה** (`role="status"`, warning-bg): "{n} תאים משתמשים בגרסה קודמת של הערכה" / "תא אחד משתמש בגרסה קודמת של הערכה"; "השדות בתאים האלה נשארים כמו שהם עד שתאשרו את העדכון ותפרסמו."; outlined small "עדכן את כולם ({n})" → `POST …/field-sets/[id]/propagate` (טיוטות בלבד; עדיין צריך פרסום).
4. **שדות:** "שדות בערכה · {n}" ו"אותה שורה כמו בעורך העמדה: שם · 4 אפשרויות · הערות · חובה"; אותו `FieldRowsTable` עם grid `28px 150px minmax(0,1fr) 104px 56px 32px`; בשדה מקושר לרשימה — כפתור "רשימה: {name}" עם `title="פתיחת הרשימה בלשונית רשימות אפשרויות"`; ערכה ריקה: "אין עדיין שדות בערכה" + "התחילו בשורת בדיקה: שם, 4 אפשרויות לבחירה מהירה והערות."; בתחתית "+ הוסף שורת בדיקה" ו-outlined small "סוג שדה אחר".
5. **פוטר:** "{N} שדות · {M} חובה"; "עדכון הערכה יוצע לאישור בכל תא מקושר; שום תא לא משתנה בלי פרסום." (בשימוש) / "כשהערכה תוחל על תאים, כל עדכון שלה יוצע לאישור בתאים המקושרים." (בלי שימוש).

**שמירה כגרסה** (מה-`script`): `PUT /api/settings/field-sets/[id]`; הגרסה עולה, המטא "עודכנה עכשיו · {user}", התאים המקושרים נשארים בגרסה הקודמת ומסומנים "הערכה עודכנה" במפה.

**פרטי רשימה** (`OptionListDetail`): ראש — h2 עם שם, `Pencil` (`aria-label="שינוי שם הרשימה"`), `Tag` "רשימה משותפת"; "בשימוש ב-{N} שדות · {M} אפשרויות"; "שכפל", "מחק" (אדום), outlined "עריכת האפשרויות" (ארטבורד 4). "אפשרויות · {n}" + "המספר הוא מקש הבחירה המהירה בחלון העובד"; צ'יפים 36px עם קופסת מקש mono, תווית ומילת טון; "{n} אפשרויות · אחת נחשבת 'כשל'". "איך כל אפשרות נספרת בפסק הדין": טבלת 4 טונים (מילה + תוויות או "—"), והערה "בחירה מסוג כשל מציעה "לא תקין" בפסק הדין של העמדה; העובד יכול לשנות זאת עם הערה." "כך העובד יראה את הרשימה": mock סטטי ("בחר…" + אפשרויות עם רמזי מקש). "בערכות שדות" + "לחיצה פותחת את הערכה": צ'יפים "{set} · {n} שדות"; כשאין "אף ערכת שדות לא משתמשת ברשימה הזו. היא מקושרת ישירות לשדות במסלולים." פתק (`role="note"`): "שינוי ברשימה המשותפת יחול על {N} שדות לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו." + "שמות האפשרויות נשמרים בתוצאה ברגע השמירה, כך ששינוי שם לא משנה תוצאות שכבר נשמרו."

**מחיקה של ערכה/רשימה בשימוש:** השרת מחזיר 409 (§3.2); טקסט ההודעה לא מצויר **(לא אומת)**.

### 5.10 ארטבורד 9 — החלת ערכת שדות (`ApplyFieldSetDialog`)

**נפתח מ:** פס הבחירה ("החל ערכת שדות…"); ⋯ של העורך ("החל ערכה…", תא אחד); "החל ערכת שדות…" ב-onboarding; "החל על תאים…" בספרייה (בלי בחירת תאים — **לא מצויר (לא אומת)**; ההצעה: לעבור למפה עם הערכה בחורה מראש).

**דיאלוג:** `Dialog maxWidth="sm"`, `aria-modal`, `aria-describedby` לשורת המשנה.
- **כותרת:** "החלת ערכת שדות · {n} תאים". **שורת משנה** (13px מושתק): "מארז עמדת עבודה · מסלול 1 · עמדת סגירת מארז" (תאים בכמה עמדות — **(לא אומת)**).
- **"ערכת שדות":** חיפוש pill 44px, `type="search"`, "חיפוש ערכה…".
- **בחירה:** `role="radiogroup" aria-label="בחירת ערכה"`, `.pkg-choice` 56px: שם, "{N} שדות · בשימוש ב-{n} תאים", `Tag` "גרסה 3" אם יש. אין התאמה: "אין ערכות תואמות. נסו שם אחר או פתחו את ספריית הערכות."
- **תצוגה מקדימה** (pearl, radius 11): "מה יתווסף לכל תא · {set}" (הוספה) / "מה יהיה בכל תא · {set}" (החלפה), ולצידה "{n} שדות · קריאה בלבד"; שורות: שם, `Tag` "חובה", `Tag` "יידלג" (כפילות), מטא "רשימה: מצב חיצוני · הערות: חובה בכשל", צ'יפי אפשרויות עם נקודות.
- **"יעד":** צ'יפים "{station} · {seq} {item}[ ×{qty}]" ("סגירת מארז · 02–03 מסך ×2"); בעמדת `package_level` פתק "עמדה ברמת מארז: השדות יופיעו לעובד בשורת כל פריט בתוך כרטיס המארז."
- **"אופן ההחלה":** `role="radiogroup"`, grid `repeat(auto-fit, minmax(220px,1fr))`: "הוסף לשדות הקיימים" — "שדות הערכה יתווספו אחרי השדות שכבר בתא" (ברירת מחדל); "החלף את השדות בתא" — "השדות הקיימים יוסרו ושדות הערכה יבואו במקומם", ועם פס אזהרה "שדות שכבר הוגדרו בתאים שנבחרו יוחלפו בשדות הערכה".
- **תיבת סימון** (`role="checkbox"`, מסומנת): "השאר מקושר לערכה — עדכונים יוצעו לאישור". עזרה: מסומנת — "כשהערכה תתעדכן, התאים יסומנו "הערכה עודכנה" ותוכלו לאשר את השינוי בכל תא."; לא מסומנת — "השדות יועתקו לתאים כעותק עצמאי. שינויים בערכה לא ישפיעו עליהם."
- **בדיקת כפילות** (12px מושתק עם אייקון כתום): "שדה '{f}' כבר קיים ב'{target}' — יידלג כדי למנוע כפילות". **הכלל:** במצב הוספה, שדה בערכה שהתווית שלו (אחרי trim) כבר קיימת בתא היעד, **או** בקבוצת "כל פריט במארז" של אותו שלב `package_level`, מדולג.
- **פוטר:** ghost "ספריית הערכות" → `view=library`; "ביטול"; primary "החל על {n} תאים".

**כותב:** עריכת טיוטה בלקוח לכל תא (`{set_id, set_ver, cells[], mode: add|replace, linked}`), ואז `PUT …/fields/draft` לכל מסלול שנגעו בו (§3.2). כל שדה מערכה מקבל `from_set: {id, ver}` כש-`linked`.

### 5.11 ארטבורד 10 — פרסום גרסה (`PublishDialog`)

**נפתח מ:** "פרסום לעמדות". זמין רק כשאין שגיאות ויש טיוטה. נטען מ-`POST …/fields/publish-preview` (`route_ids` = כל המסלולים בהקשר).

**דיאלוג:** `Dialog maxWidth="sm"`. מצויר ב-640 — קרוב ל-`sm` (600) אבל לא שווה ⚠ (§10.3). משתמשים ב-`sm`.
- **כותרת:** "פרסום גרסה {v} · {route}".
- **תגי ספירה:** "{n} שינויים", "{n} עמדות", "{n} מסלולים", ואחריהם "מחליפה את גרסה {v-1} המפורסמת".
- **"מה השתנה"** (`id` ל-`aria-labelledby`), ולידה ghost "כווץ הכל" / "הרחב הכל". רשימה `role="list"`, hairline, radius 11. **קבוצה מתקפלת:** כפתור pearl 34px עם `aria-expanded`/`aria-controls`: כותרת (13/700, "חשמל · מחשב"), שורת משנה "מסלול 1 של מחשב" / "מסלול המארז", `Tag` "משותף" אם רלוונטי, ספירה "שינוי אחד" / "{n} שינויים". **שורת שינוי:** badge עגול 22px עם `title` — "נוסף" (`Plus`, success-bg/success-ink), "שונה" (`Pencil`, primary-soft/כחול), "נמחק" (`Minus`, danger-bg/אדום); אחרי הטקסט סיומת אזהרה אפשרית "· {warn}".

| סוג שינוי (`Change`) | טקסט (מהארטבורד) |
|---|---|
| `field_added` | `נוסף '{label}'` |
| `field_changed` + `option_added` | `'{field}': נוספה אפשרות '{opt}'` |
| `field_changed` + `required: true` | `'{field}' סומן כחובה` |
| `field_removed` | `נמחק '{label}'` + אזהרה `מולא ב-{n} בדיקות, הערכים יישמרו בהיסטוריה` |
| מילוי מערכה (`from_set`) | `{n} תאים מולאו מהערכה '{set}'` |
| `layout_changed` (שלב 3) | `נוסף כפתור 'הכל תקין'` |
| שינוי שם, שינוי טון, מצב הערות, הסרת אפשרות, ביטול חובה, קישור לרשימה, מקטע, אורך הערה, `step_removed` | **(לא אומת — טקסט חסר)** — COPY-PENDING; בינתיים badge "שונה"/"נמחק" + `'{label}'` בלבד |

- **פתק אזהרה** (`role="note"`, warning), רק כש-`shared_outside` לא ריק: "השינויים יחולו גם מחוץ למארז הזה: מסלול 1 של מסך משמש גם ב'מארז ציוד היקפי', ומסלול 1 של מחשב משמש גם ב'מארז מחשב'."
- **פתק מידע** (`aria-live="polite"`, info), לפי הבחירה:
  - **חדשים:** "9 פריטים נמצאים כעת במסלולים האלה. הם ימשיכו לפי גרסה 4 עד סוף המסלול; פריטים שייקלטו מעכשיו יקבלו גרסה 5."
  - **גם ממתינים:** "9 פריטים נמצאים כעת במסלולים האלה. 4 מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה 5 בעמדה הבאה שלהם; 5 האחרים ימשיכו לפי גרסה 4 עד סוף המסלול. פריטים שייקלטו מעכשיו יקבלו גרסה 5."
- **"על מי תחול גרסה {v}"** (radiogroup, קארדים 58px):
  - "רק לפריטים חדשים (מומלץ)" — "פריטים שכבר בדרך ממשיכים לפי גרסה 4 עד סוף המסלול" (ברירת מחדל) → `apply_mode: "new_only"`.
  - "גם לפריטים שטרם הגיעו לעמדה ששונתה · {n} פריטים" — "יעברו לגרסה 5 בעמדה הבאה שלהם; תוצאות שכבר נשמרו לא ישתנו" → `apply_mode: "not_reached"`.
- **"הערת גרסה":** textarea שתי שורות, min-height 60; עזרה "תוצג בהיסטוריית הגרסאות" → `note` (≤ 2000).
- **פוטר:** ghost "היסטוריית גרסאות" (`History`; המסך עצמו לא מצויר **(לא אומת)** — נתונים מ-`GET …/fields/versions`); "ביטול"; primary "פרסם גרסה {v}".
- **אחרי פרסום:** Snackbar — הטקסט לא מצויר **(לא אומת)**.

### 5.12 ארטבורד 11 — מסלול ללא שדות, מצבי ריק ושגיאה

**Onboarding** — כשאין שדות לא בטיוטה ולא בפרסום, בשום תא **שהמסלול הזה מחזיק**.
- **כותרת:** "ללא שדות", "אין שינויים לפרסום", פרסום disabled (§5.2).
- **כרטיס** (`<section aria-labelledby="onb-title">`): לבן, radius 16, padding 40, ממורכז, max 760. `ListChecks` 34px; h2 (20/700) "עדיין לא הוגדרו שדות למסלול הזה"; 15px מושתק "כל עוד אין שדות, כל עמדה מציגה לעובד את החלון הקבוע של היום. שום דבר לא משתנה בעמדות עד שתפרסמו."
  - **`<ol aria-label="שלושה צעדים">`**, grid של 3 (עיגול כחול 26px, כותרת 14/600, שורה 13px מושתקת): 1 "בחרו עמדה ופריט" — "לחיצה על תא במפה"; 2 "הוסיפו שורות בדיקה" — "שם · 4 אפשרויות · הערות"; 3 "פרסמו" — "העובדים יראו את השדות בחלון העמדה".
  - **כפתורים:** primary "התחל בעמדה הראשונה" (העורך על התא הרלוונטי הראשון; במארז `step=<ראשון>&target=box`); outlined "העתק ממסלול אחר…"; ghost "החל ערכת שדות…".
- **פס מידע** (`role="status"`, info, × "סגירה"): "{n} תאים כבר מלאים: {item} משתמש במסלול {r} שלו, שמוגדר גם ב{kit}." + קישור "פתח את {kit}" (למשל "פתח את מארז עמדת עבודה" → המפה של אותו מארז).
- **המפה מוצגת מלאה** מתחת לכרטיס: תאים ריקים "ללא שדות" (בפוקוס: מקווקו + "הגדר שדות"); תאים משותפים כקישור עם `Link2` וה-tooltip מ-§5.4.3. **פוטר:** "8 שדות משותפים · 13 תאים ללא שדות"; מקרא "מוגדר", "ללא שדות — העובד יראה את החלון הקבוע", "לא במסלול", "משותף עם מארז אחר", "עמדה ברמת מארז · כרטיס אחד"; רמז "לחיצה על תא פותחת את עורך השדות".

**שלושה מצבים נוספים** (כותרת הרצועה "מצבים נוספים של מפת השדות" היא הערת עיצוב):

| מצב | מתי | תוכן |
|---|---|---|
| אין שלבים | `route_steps` ריק | `.settings-empty` עם `Route`: "למסלול אין שלבים" / "הוסיפו עמדות כדי להגדיר להן שדות." + outlined "עבור לשלבי המסלול" (→ `view=steps`) |
| מארז בלי תכולה | `package_contents` ריק | `Package`: "לסוג המארז אין תכולה" / "הגדירו פריטים במארז כדי לראות אותם במפה." + outlined "פתח את הגדרות המארזים" (→ `/settings/packages?type=`) |
| כשל טעינה | ה-API החזיר שגיאה | `role="alert"`, danger-bg, radius 11, padding 24: "טעינת הגדרות השדות נכשלה" / "המסלול לא מוצג כריק כדי לא לאבד נתונים." + outlined "נסה שוב"; בזמן ניסיון חוזר "טוען…" ו-disabled. **בזמן כשל הכותרת לא מציגה "ללא שדות" ולא מאפשרת פרסום** |

**טעינה:** `Skeleton` בצורת המפה (כותרת עמודות ו-6 שורות). לא מציגים "ללא שדות" לפני שהנתונים הגיעו — אותו עיקרון כמו `page.tsx:284` ("While the route loads its steps are unknown — never "no steps"").

### 5.13 לשונית "שלבי המסלול" — מה משתנה בעורך הקיים

הכרטיס הקיים (`page.tsx:251-344`) עובר כמו שהוא: `.route-step`, החצים ("הקדם את {name}" / "אחר את {name}"), × ("הסר את {name} מהמסלול"), `Tag` "עמדה ברמת מארז", "הוסף שלב (סוג עמדה)" ו-`.route-add`. **שלושה שינויים:**
1. **`uid` לכל שלב** — §3.5. הסרה מוחקת את ההגדרה מהטיוטה, והיא מופיעה בפרסום (`step_removed`). **לא לחשב uid מאינדקס.**
2. **מסלול חדש:** הבחירה "סוג פריט" + "מספר מסלול" (`page.tsx:209-245`) עוברת לכאן ומופיעה ב"+ מסלול חדש" **(לא אומת — spec)**. התגים "מסלול חדש — ייווצר בשמירה" ו"מסלול קיים נטען" נשארים.
3. **עמודות המפה מתעדכנות** אחרי שמירת שלבים. תא של uid שנמחק נעלם מהמפה ומופיע בפרסום כ"נמחק".

עד שתיקון §3.6 נכנס, מסלול עם `station_type_id` שלא קיים יציג את השם הקיים `ID {n}` (`page.tsx:182`).

### 5.14 פעולות מרובות

**בחירה במפה** (`useGridSelection`):
- **לחיצה על תא:** **פותחת את העורך** — "לחיצה על תא פותחת את עורך השדות" (ארטבורד 11). ב-`Main.dc.html` לחיצה **מסמנת** תא, אבל זה לצורך ההדגמה (§10.3).
- **Ctrl/⌘ + לחיצה או רווח:** מוסיף/מסיר מהבחירה. **Shift + לחיצה או Shift + חיצים:** טווח מלבני (תאי "—" לא נבחרים). **לחיצה על כותרת עמודה:** כל התאים הרלוונטיים בעמודה. **Escape או "בטל בחירה":** מנקה. מותר לערבב עמודות מארז ופריט.

**"עריכה משותפת"** — אין ארטבורד סופי; ב-spec תגים "ב-3/3" **(לא אומת)**. פותח את העורך כשכל התאים שנבחרו הם צ'יפי יעד לחוצים יחד; מוצגות השורות **המשותפות לכל היעדים** (לפי תווית וסוג); עריכה חלה על כולם; שורות שקיימות רק בחלק מסומנות "ב-{k}/{n}".

**"העתק" / Ctrl C:** הקונפיג של התאים נשמר בלוח פנימי (state), ובמקביל נכתב ללוח המערכת כ-TSV (שורה לכל שדה, בפורמט למטה).

**"הדבק" / Ctrl V:** מלוח פנימי של תא אחד — מוחל על כל התאים שנבחרו במצב "הוסף לשדות הקיימים", עם דילוג על כפילויות (כלל ארטבורד 9). מכמה תאים — לפי צורה יחסית (כמו בגיליון). מטקסט בלוח המערכת — מפוענח כ-TSV ומתווסף לכל תא שנבחר. ההודעה אחרי הדבקה לא מצוירת **(לא אומת)**.

**"נקה":** מסיר את כל השדות מהתאים שנבחרו, בטיוטה. "ביטול הטיוטה" מחזיר. אישור לא מצויר **(לא אומת)**.

**"הדבק מאקסל" בעורך** — פורמט TSV (`lib/pasteTsv.ts`):

```
שם השדה<TAB>אפשרות 1<TAB>אפשרות 2<TAB>אפשרות 3<TAB>אפשרות 4
נורית מתח	תקין	מהבהבת	לא דולקת	לא נבדק
הפעלה ו-POST	עולה תקין	עולה עם שגיאה	לא עולה	לא נבדק
```

- UTF-8; שורות לפי `\r?\n`, ריקות מדולגות; trim לכל תא; תאים ריקים בסוף שורה מוסרים.
- **כותרת:** אם התא הראשון בשורה הראשונה הוא "שם השדה" — מדולגת.
- **עמודה אחת:** שורת בדיקה עם אפשרויות ברירת המחדל ("תקינות כללית"), בדיוק כמו "הוסף שורת בדיקה".
- **2 עמודות ומעלה:** `choice_row`; הראשונה שם, השאר אפשרויות לפי הסדר. **רצף זהה בדיוק לרשימה משותפת** (תוויות וסדר) → השדה **מקושר** לרשימה. **אחרת** — טון לכל אפשרות לפי התאמה מדויקת לתווית באחת הרשימות המשותפות (הראשונה מנצחת); בלי התאמה `neutral`.
- ברירות מחדל: הערות `required_on_fail`, לא חובה. מקום: אחרי השורה המפוקסת, או בסוף.
- אחרי ההדבקה רץ האימות (§2.3). שם שכבר קיים בתא — מדולג. פענוח אחד ואז שמירת טיוטה אחת לכל מסלול.

### 5.15 כללי אימות במסך

כל הכללים מ-`src/app/lib/station-fields/validate.ts` (§2.3). איפה מוצג:

| כלל | איפה |
|---|---|
| שם שדה ריק | מתחת לשם — אחרי שהשורה כבר לא "חדשה" (יציאה מהשדה או הוספת שורה אחרת) |
| אפשרות ריקה, יותר מ-6, פחות מ-2, אף כשל, תקין | שורת האימות בארטבורד 4; אפשרות ריקה גם בפס השגיאה במפה |
| שמירת ערכה עם שדה בלי שם | כפתור "שמירה כגרסה" disabled |
| "סטייה מותרת ±%" בלי ערך ייחוס | השדה disabled, עזרה "זמין לאחר הזנת ערך ייחוס" |
| מינימום > מקסימום, ערך לא מספרי, שם שדה כפול באותו תא, 0 אפשרויות | **(לא אומת — אין טקסט)** COPY-PENDING |

- **שגיאות** חוסמות פרסום ומחליפות את כפתור הפרסום ב"בעיה אחת לתיקון". **אזהרות** לא חוסמות.
- **השרת מריץ את אותו `validate`** בשמירת טיוטה (מחזיר `issues`) ובפרסום (422).

### 5.16 מקלדת

| איפה | מקש | פעולה | מקור |
|---|---|---|---|
| מפה | חיצים | תנועה בין תאים (`role="grid"`, roving tabindex). ב-RTL ← זז ל-inline-end | "חיצים לניווט" |
| מפה | Shift + חיצים / Shift + לחיצה | טווח | "Shift לבחירת טווח" |
| מפה | Enter | פתיחת התא בעורך | "Enter לעריכה" |
| מפה | Ctrl C / Ctrl V | העתק / הדבק | "Ctrl C / Ctrl V" |
| מפה | רווח, Escape | סימון / ניקוי בחירה | **(לא אומת — אין רמז)** |
| עורך | Alt + ↑/↓ | הזזת שורה | "גרירה או Alt+חיצים לשינוי סדר" |
| עורך | גרירה בידית | הזזת שורה (HTML5 DnD; אין ספריית DnD ב-`package.json`) | אותו טקסט |
| עורך | Enter בשם השדה האחרון | מוסיף שורת בדיקה | "טיפ: Enter בשם השדה האחרון מוסיף שורת בדיקה חדשה" |
| בוחר סוג | ↑/↓, Enter, Escape | פעיל, בחירה, סגירה | רמז "Enter" |
| עריכת אפשרויות | Enter באינפוט ההוספה | הוספת אפשרות | "הוסף אפשרות (Enter)" (בארטבורד 4 Enter לא מחובר — רק הכפתור "הוסף"; לממש) |
| תצוגת עובד | 1–4 | בחירה מהירה | "מקשים 1–4 לבחירה מהירה בעמדה" |
| כל פופאובר | Escape | סגירה והחזרת פוקוס לעוגן | — |

### 5.17 אילו נקודות קצה המסך קורא

| מי | נקודת קצה (§3) |
|---|---|
| combobox "מסלול" | `GET /api/settings/testing-routes` (קיים, + `step_uids`, `fields_version`, `has_draft`), `GET /api/settings/item-types` (קיים, `is_package`) |
| כרטיס הקשר, שורות המפה | `GET /api/settings/item-types/[id]/contents` (קיים: `lines[]` עם `route_number`, `sort_order`, `quantity`) |
| מפה, onboarding, כותרת | `GET /api/settings/testing-routes/fields-context` — **בשגיאה 5xx, לעולם לא תוצאה ריקה** |
| עורך | `GET …/[id]/fields`, `PUT …/[id]/fields/draft` (עם `base_rev`) |
| "ביטול הטיוטה" | `DELETE …/[id]/fields/draft` |
| שלבים | `PUT /api/settings/testing-routes/[id]` (עם `step_uids`), `POST` למסלול חדש |
| "צור מסלול נפרד למארז הזה" | `POST …/[id]/fork` |
| ארטבורד 10 | `POST …/fields/publish-preview`, `POST …/fields/publish` (`apply_mode`, `note`) |
| "היסטוריית גרסאות" | `GET …/[id]/fields/versions`, `…/versions/[v]` |
| ארטבורדים 4, 8, 9 | `/api/settings/option-lists*`, `/api/settings/field-sets*` |
| שדה צילום | `GET /api/settings/photo-types` (קיים) |

---

## 6. שדה ההערה — `NotesField` (ארטבורד 7א, החלטה 9)

קובץ: `src/app/testing/fields/NotesField.tsx`. משמש בשורות השדות, בהערות פסק הדין של חלון עם שדות, ובתצוגה החיה של המנהל.

```ts
interface NotesFieldProps {
  id: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;                    // default 1000; per field 500 | 1000 | 2000 (def.note_max)
  required?: boolean;              // → "הערה · חובה" label + aria-required
  error?: boolean;                 // → red border + "יש לפרט את החריגה"
  placeholder: string;
  editorTitle: string;             // "הערה · {label}" | "הערה · הערות" | "הערה · הערות נוספות" | "הערה · הערות אריזה" | "הערות · הקופסה" | "הערות · {type}"
  size?: "row" | "row-compact" | "area" | "verdict";
  rowTone?: "fail" | "normal";     // fade gradient ends in --color-danger-bg on fail rows
}
```

**הגדלים:**

| `size` | איפה | מנוחה | מקסימום | מקור |
|---|---|---|---|---|
| `row` | עמודת ההערה בשורת שדה | שורה אחת, **44px**, ריפוד `11px 12px` | 6 שורות = **146px**, ואז גלילה | 12:182 |
| `row-compact` | שורות שדה ב-17/18 (חלונות דחוסים) | **38px**, ריפוד `8px 12px` | 6 שורות = **138px** (בגלל הריפוד הקטן); מקופל: **58px** (ב-`row`: 64px) — `noteMaxH: collapsed ? '58px' : '138px'` (`LegacyPackageCloseItems.dc.html:582`) | 17:193 |
| `area` | "הערות" באשף הפתיחה, "הערות אריזה" | 76px (`.pkg-field--area`, `packages.css:262`), max-width 560 | — | 15 `v-note` |
| `verdict` | "הערות" ב-`VerdictCard`, "הערות נוספות" | 3 שורות, `resize: vertical` | — | 12 `v-note`, 14 |

**ההתנהגות** (מ-7א ומהסקריפטים):
- **גדילה:** גובה שורה 20px; גדל שורה-שורה. `field-sizing: content` עם `min-height` ו-`max-height` מהטבלה. **Fallback** לדפדפן בלי `CSS.supports("field-sizing: content")`: ב-`onChange` `style.height = "auto"` ואז `min(scrollHeight, max)`.
- **כיווץ כשלא בפוקוס** (`row` / `row-compact`, כשאין פוקוס ויש יותר משתי שורות): 2 שורות (`max-height: 64px`; ב-`row-compact` 58px; `overflow: hidden`); fade של 20px בתחתית, מ-transparent לצבע הרקע של השורה; כפתור קישור "הצג הכל · N שורות" (12px/600 כחול), שעושה focus לתיבה ועם זה פותח אותה.
- **כפתור ההגדלה** `Maximize2` 16px במשבצת 28×28: בפינה הלוגית בסוף התיבה (`left: 6px; top: 8px` ב-RTL), והתיבה מקבלת `padding-inline-end: 40px`. `aria-label="פתח עורך הערה"`, `aria-haspopup="dialog"`, `aria-expanded`. מופיע כשיש פוקוס, כשיש יותר משורה אחת, כשזו ההערה האחרונה שהייתה בפוקוס, או כשהעורך פתוח (`expandOn`, 12).
- **העורך:**
  - popover עם `role="dialog"` ו-`aria-label={editorTitle}`. רוחב **520**, `max-width: calc(100% - 32px)`, רדיוס 12, ריפוד 16, gap 12, צל `--shadow-pop`.
  - בתוכו: כותרת 15/700, כפתור × עם `aria-label="סגירה"`, textarea של **8 שורות** (`min-height: 180px`, `resize: vertical`).
  - בתחתית: המונה, "הגעת לאורך המרבי" בגבול, וכפתור pill כחול "סיום" בגובה 32.
  - נפתח מתחת לשורה, ומעליה כשאין מקום ("העורך נפתח מתחת לשורה, ומעליה כשאין מקום", 7א).
  - Esc סוגר את העורך בלבד (`stopPropagation`, כמו `ui/Autocomplete.tsx:347-350`). Esc או "סיום" מחזירים את הפוקוס לשדה.
  - עורך אחד פתוח בכל רגע; פתיחת עורך סוגרת רשימה פתוחה, ולהפך (`openEditor`, 12).
- **אורך:**
  - `maxLength={max}`, נמדד ב-UTF-16 (§2.6). ברירת מחדל 1000; לכל שדה 500/1000/2000 ("אורך מרבי" בשורת המנהל).
  - מונה `dir="ltr"` עם `aria-live="polite"`, "{len} / {max}", מוצג **מ-80%** ("העובד רואה מונה רק מ-80% מהאורך המרבי.", 7א).
  - בגבול הצבע עובר ל-`--color-warning-ink`, ולצד המונה "הגעת לאורך המרבי" ("בהגעה לאורך המרבי ההקלדה נעצרת והמונה הופך לכתום.", 7א).
  - **השרת אוכף גם הוא** (§3.4 צעד 4, `NOTE_TOO_LONG`), גם כשהשער כבוי.
- **כיוון:** `dir="auto"`, `text-align: right`. עברית ואנגלית מעורבות מוצגות נכון.
- **placeholder:** ההערה חובה: "פרט את החריגה…"; בכשל ולא חובה: "פרט את החריגה (אופציונלי)"; אחרת: "הערה (אופציונלי)" (12 `ph`). ב-17/18 רק שני הנוסחים "פרט את החריגה…" / "הערה (אופציונלי)".
- **שגיאה:** גבול `--color-destructive`, מתחת "יש לפרט את החריגה" (12px אדום), `aria-invalid`, `aria-describedby`. (חוץ מ-14 — שם ה-placeholder הוא ההודעה ואין שורה מתחת; ראו §4.5.)
- **הערות פסק הדין הקיימות** ("הערות", "הערות נוספות", "הערות אריזה") עוברות ל-`NotesField` עם מגבלת 1000 **רק כש-`hasFields`**, כדי שהחלון בלי הגדרה יישאר זהה. על `Comments` אין היום אכיפה בשרת, ולא מוסיפים (§10.2).

---

## 7. שלבי ביצוע

### 7.0 סקירה

| שלב | מה | סשנים | תלוי ב- | מה רואים בסוף |
|---|---|---|---|---|
| **0** | הכנה ותיקון באג | 1 | — | שינוי מזהה סוג עמדה לא שובר מסלולים. `GET` של מסלולים לא מסתיר כשל. מודול טהור עם בדיקות. |
| **1** | נתונים + API + הזרקה לחלונות הקיימים, עם הגדרה מסקריפט זרע | 3 (1א, 1ב, 1ג) | 0 | עובד רואה שדות בחלונות 12–18 על "מארז עמדת עבודה". שאר העמדות בלי שינוי. |
| **2** | מנהל: מפה, עורך, פרסום, ואז ספריות, פעולות מרובות, onboarding | 5 (2א–2ה) | 1 | מנהל מגדיר, מפרסם ורואה השפעה, בלי זרע; רשימות, ערכות, החלה על כמה תאים, הדבקה מאקסל, "צור מסלול נפרד". |
| **3** (אופציונלי) | פריסת החלון (ארטבורד 7) וחלון מאוחד (5/6) | 2–3 | 2 | ארטבורד 7 + חלון לפי 5/6 מאחורי preset. |

**כללים לכל סשן:**
- ענף משלו ו-PR משלו. אם על ה-default branch — לפתוח ענף קודם.
- לפני כל commit: `npm run lint`, `npm test`, `npm run db:check-migration` (כשיש מיגרציה). `npm run build` בסוף כל שלב.
- **החלון הקבוע לא משתנה.** אסור לגעת בהתנהגות שלו כשאין הגדרה מפורסמת.
- **אין טקסט שלא מופיע בארטבורד.** טקסט חסר נרשם ב-PR תחת "טקסט לאישור".

### 7.1 שלב 0 — הכנה ותיקון באג (סשן אחד)

1. **תיקון הבאג** (החלטה פתוחה 5, ברירת מחדל: לתקן) — §3.6. `array_replace` על `route_steps` באותה טרנזקציה. אחרי שלב 1 מוסיפים לאותה טרנזקציה גם את `fields_draft`.
2. **`GET /api/settings/testing-routes` מפסיק להחזיר `[]` על כשל** — §3.1. 500; מסלול הכשל במסך כבר קיים (`page.tsx:88-104`).
3. **מודול טהור** `src/app/lib/station-fields/`: `schema.ts`, `validate.ts`, `evaluate.ts`, `step-uids.ts`, `resolve.ts` (§2, §3.3, §3.5). בלי DB, בלי React, בלי zod.
4. **בדיקות יחידה** ב-`src/app/lib/station-fields/__tests__/` (§8.12).

קבצים: `src/app/api/settings/test-stations-type/[id]/route.ts`, `src/app/api/settings/testing-routes/route.ts`, `src/app/lib/station-fields/*` (חדש).

**גמור כש:**
- [ ] `npm test` ירוק וכולל את הבדיקות החדשות. `npm run lint` נקי.
- [ ] שינוי מזהה של סוג עמדה שמופיע פעמיים במסלול מעדכן את שני המקומות ב-`route_steps`, והפריט ממשיך להופיע בתור של העמדה.
- [ ] כשה-DB למטה, מסך המסלולים מציג את פס השגיאה ולא "מסלול חדש — ייווצר בשמירה".

### 7.2 שלב 1 — נתונים, API והזרקה לחלונות הקיימים (3 סשנים)

**מטרה:** הגדרה מפורסמת אחת, שנכתבת מסקריפט זרע, משנה את החלונות **הקיימים** בדיוק כמו בארטבורדים 12–18. כל השאר זהה להיום.

**סשן 1א — סכימה, הקפאה, API**
1. מיגרציה אחת, תוספות בלבד (§1.2–§1.4), ואז `npm run db:check-migration`.
2. הקפאה בקליטה (`create-package.ts`, INSERT ל-`item_routes` ב-`:170-174`) ובשינוי סוג (`items/[id]/route.ts:328-333`, `:338-350`; `reset.ts:52-60`) — §1.5.
3. הרחבת `POST`/`PUT` של מסלולים עם `step_uids`, `assignStepUids`, `inferUidsByOccurrence`, `pruneDraft`, ו-`withAuth` (§3.1, §3.5). `GET /api/testing-routes` עם `select`.
4. נקודות הקצה של הטיוטה והפרסום (§3.2: `GET …/[id]/fields`, `PUT/DELETE …/fields/draft`, `publish-preview`, `publish`, `versions`) — הזרע משתמש בהן.
5. `GET /api/testing/station-fields?itemId=` (§3.3).
6. כתיבת התוצאה: `checkFieldsSubmission` + `FieldsSubmissionError` ב-`results/route.ts` (§3.4). `result`, `passed` ו-`comments` לא משתנים.

**סשן 1ב — רכיבי עובד והזרקה לחלונות של פריט בודד**
7. רכיבים חדשים ב-`src/app/testing/fields/` (§4.1–§4.10) ו-`NotesField` (§6). `listFooter` ב-`ui/Autocomplete.tsx`; `size`/`invalid` ב-`PassFail`; `suggestion`/`noteMax` ב-`VerdictCard`.
8. הזרקה: `VerdictStation` (§4.11.1, ארטבורד 12), `PhotoStation` (§4.11.2, 13), `PopUpTestDialog` (§4.11.6, 14).
9. `page.tsx:1141-1144` מעביר `code` (§4.12).

**סשן 1ג — אשפי המארז וזרע**
10. `PackageOpenWizard` (§4.11.3, 15–16) ו-`PackageCloseWizard` (§4.11.4–§4.11.5, 17–18).
11. **סקריפט זרע חדש** `scripts/seed-station-fields-demo.mjs --confirm`:
    - **הסגנון:** כמו `scripts/seed-packages-demo.mjs` — דרך ה-API של האפליקציה, עוגיית Auth.js מ-`AUTH_SECRET`/`NEXTAUTH_SECRET`, ומסרב לכל כתובת שאינה localhost.
    - **מה הוא כותב** (`PUT …/fields/draft` ואז `POST …/fields/publish`):
      - "מארז עמדת עבודה · מסלול 1", פתיחת מארז וסגירת מארז: הקופסה, כל פריט, מסך, מחשב, מקלדת (ארטבורדים 15–18).
      - **מספר המסלול לא קבוע:** `seed-packages-demo.mjs:207-218` מוצא מסלול פריט עם אותם שלבים או מקצה את המספר הבא, ולכן ב-DB שכבר יש בו מסלול 1 אחר של "מחשב" המארז ישתמש במסלול 2 ומעלה. הזרע החדש **קורא** את `route_number` של כל פריט משורת `package_contents` (`GET /api/settings/item-types/[id]/contents`) ולא מניח 1. מסלול המארז עצמו הוא 1 (`:230-232`).
      - מסלול "מחשב" שבמארז (בדוגמה: מסלול 1), שלב חשמל: 5 השדות מארטבורד 14 ("נורית מתח", "הפעלה ו-POST", "מאוורר ספק הכוח", "התנגדות הארקה", "בדיקת בידוד").
    - **מאיפה הערכים:** שמות השדות והאפשרויות מועתקים **מהסקריפטים של ארטבורדים 12–18 בלבד** (למשל `LegacyXray.dc.html:349-352`, `LegacyFallback.dc.html:354-358`, `LegacyPackageCloseItems.dc.html:494-497`).
    - **סדר הרצה:** אחרי `seed-packages-demo.mjs`. מארזים שנקלטו **אחרי** הזרע מקבלים גרסה 1; מה שנקלט לפניו נשאר בחלון הקבוע (זו גם בדיקה של ההקפאה).

**קבצים בשלב 1:** `prisma/schema.prisma` + מיגרציה; `src/app/lib/station-fields/*`; `src/app/lib/packages/create-package.ts`, `reset.ts`; `src/app/api/items/[id]/route.ts`; `src/app/api/settings/testing-routes/route.ts`, `[id]/route.ts`, `[id]/fields/**`, `fields/**`; `src/app/api/testing-routes/route.ts`; `src/app/api/testing/station-fields/route.ts` (חדש); `src/app/api/testing/results/route.ts`; `src/app/testing/tests-popups/{VerdictStation,PhotoStation,PackageOpenWizard,PackageCloseWizard,stationKit}.tsx`; `src/app/testing/fields/*` (חדש); `src/app/testing/testing.css`; `src/components/ui/Autocomplete.tsx`; `src/app/components/PopUpTestDialog.tsx`; `src/app/testing/page.tsx`; `scripts/seed-station-fields-demo.mjs` (חדש). **`src/lib/routes.ts` לא משתנה** (`/api/testing` כבר מוגן).

**גמור כש:**
- [ ] כל בדיקות הקבלה ב-§8.1–§8.7 עוברות.
- [ ] תסריט ה-QA ב-§9.2 (תרחישים א–ח, יא) עובר על DB נקי עם הזרעים.
- [ ] `npm test`, `npm run lint` ו-`npm run build` ירוקים.
- [ ] `scripts/e2e-packages/02-flow.mjs` ו-`03-wizards-ui.mjs` עדיין עוברים מול מארז **בלי** הגדרה (דורשים Chrome מקומי בנתיב קבוע ב-`lib.mjs`, `scripts/e2e-packages/README.md`).

### 7.3 שלב 2 — מנהל (5 סשנים)

| סשן | תוצרים | ארטבורדים |
|---|---|---|
| **2א** | שלד הדף עם 3 לשוניות ו-query state (§5.2). כרטיס הקשר "מסלול". לשונית "שלבי המסלול" עם uid (§5.13, §3.5). `fields-context` (§3.2). | (לשונית קיימת) |
| **2ב** | "מפת שדות" (§5.4): עמודות × שורות "הקופסה" / "כל פריט במארז" / פריטים, מסגרת "כרטיס אחד לכל המארז", מצבי תא. עורך התא (§5.5) עם שורות, צ'יפים, טון, מצב הערות, "אורך מרבי", מספר (§5.6), `pass_fail`, כותרת מקטע. "רק לשדה הזה" של ארטבורד 4. "תצוגת העובד · חי" עם **אותם רכיבים** של שלב 1. | 1, 2, 3, 4 (מקומי) |
| **2ג** | דיאלוג "פרסום גרסה N" (§5.11) על `publish-preview`/`publish`. "ביטול הטיוטה". מצבי ריק ושגיאה (§5.12, בלי onboarding). | 10, 11 |
| **2ד** | "ערכות ורשימות" (§5.9): רשימות משותפות עם `list_ref` ו-propagate; ספריית ערכות עם "עדכן את כולם (N)". "רשימה משותפת" של ארטבורד 4. הטבלאות ל-`build-settings-seed.js` (§1.4 צעד 7). | 4 (משותף), 8 |
| **2ה** | בחירה מרובה ופס הפעולות (§5.14), דיאלוג "החלת ערכת שדות" (§5.10), "הדבק מאקסל", "צור מסלול נפרד למארז הזה" (`POST …/[id]/fork`), כרטיס ה-onboarding. | 1 (פס), 9, 11 |

**גמור כש:**
- [ ] אפשר לשחזר את ההגדרה של `seed-station-fields-demo.mjs` רק דרך המסך.
- [ ] בדיקות הקבלה ב-§8.8–§8.10 עוברות.
- [ ] פרסום עם "גם לפריטים שטרם הגיעו…" מעביר לגרסה החדשה רק פריטים שעוד לא עברו את השלב ששונה (תרחיש ט ב-§9.2). תרחיש י עובר.

### 7.4 שלב 3 (אופציונלי) — פריסת החלון וחלון מאוחד

- **לשונית המשנה "פריסת החלון"** (ארטבורד 7): תבנית בסיס "המארז בכרטיס אחד" / "פריט אחר פריט", בלוקי שלבים עם מקטעים, מפקח "פריטי המארז". נשמרת ב-`steps[uid].layout` (§2.2).
- **מה נעול** — לפי "נעול · חלק משפת העיצוב" בארטבורד: גודל החלון, כפתורים, שלבי מערכת וסדר הפריטים.
- **החלון המאוחד** לפי ארטבורדים 5/6 (כולל "הכל תקין", §4.10) מופעל **רק** כש-`layout.preset` מבקש אותו. החלונות של שלב 1 נשארים ברירת המחדל.
- **"תצוגה מקדימה כעובד"** במפה מתחילה להוביל לחלון המאוחד.
- **גמור כש:** פריסה מותאמת שמפורסמת משנה רק את מה שמסומן "ניתן להתאמה". "חזור לברירת המחדל" מחזיר לחלון של שלב 1.

---

## 8. בדיקות קבלה

"חלון קבוע" = החלון כפי שהוא בקומיט `94c96d8`.

### 8.1 תאימות לאחור

- [ ] **אין הגדרה מפורסמת → החלון זהה לגמרי.** אותם שלבים, אותו פוטר, `VerdictCard` עם `TextField` של 3 שורות, ו-`PopUpTestDialog` ברוחב `sm` 600 (`PopUpTestDialog.tsx:100`). השוואת צילומי מסך לפני/אחרי של 5 החלונות.
- [ ] **ה-`Details` שנשמר בלי הגדרה זהה להיום:** `VerdictStation.tsx:70-74`; `PhotoStation.tsx:128-132`; בלי `Details` ב-`PopUpTestDialog`; `PackageOpenWizard.tsx:251-256` ו-`:267-272`; `PackageCloseWizard.tsx:97` ו-`:108-112`.
- [ ] **פריט עם `item_routes.fields_version = NULL`** מקבל חלון קבוע, גם אם המסלול שלו פורסם אחר כך.
- [ ] **אי-התאמה מחזירה `legacy` ולא שגיאה:** אורך `step_uids` ≠ `route_steps`, או uid של השלב לא קיים בגרסה המוקפאת.
- [ ] **מפתחות קיימים ב-`details` לא משתנים, לא זזים ולא משנים שם.** החדשים רק נוספים. כל הקוראים ממשיכים לעבוד:

  | קורא | מה הוא קורא | מה בודקים |
  |---|---|---|
  | `src/app/lib/packages/read.ts:156-160` (`decisionsOf`) | `details.decisions[]` של סגירת הקופסה | עמוד המארז ממשיך להציג "נארז בכל זאת" / "חסר במארז". `fields` בתוך החלטה לא שובר |
  | `src/app/lib/packages/read.ts:209-213` | `closing_details` ו-`details->>'sku'` | ה-SKU של הסריקה האחרונה ממשיך להופיע |
  | `src/app/components/reports/testDetails.ts:76-95` (`normalizeTestDetails`) | מערך, `fields` כמערך, או אובייקט שטוח של פרימיטיבים | **אובייקט `fields` לפי מזהה לא נקרא** בענף הזה; הענף השטוח מסנן אובייקטים, כך שאין שבירה אבל גם אין הצגה. בדיקת יחידה: אין חריגה (§10.2) |
  | `src/app/components/reports/TestResultsReportDocument.tsx:64` | `normalizeTestDetails(s.details)` | לא מיובא באף מקום ב-`src` — אין לו מסך היום |
  | `src/app/lib/metrics/queries.ts` (סביב `:1644-1656`) | `tr.passed` בלבד | `passed` נשאר ההכרעה של העובד |

- [ ] **`Result`, `Passed` ו-`Comments` מההכרעה של העובד** גם כש"מוצע" שונה; ההבדל ב-`verdict.overridden`.
- [ ] **שינוי מזהה של סוג עמדה** לא מנתק הגדרה (uid → מיקום → `route_steps`).
- [ ] **`REGISTRY` לא משתנה** (`mainPopUp.ts:26-31`): שדות לא משנים איזה חלון נפתח.
- [ ] **סקריפטי הזרע** (`seed-packages-demo.mjs`, `seed-dev-dataset.js`) רצים פעמיים ברצף בלי שגיאה ובלי להחליף uids של מסלול קיים.

### 8.2 חלון העובד — מיקום הבלוק (ארטבורדים 12–18)

- [ ] **שיקוף/מראה שחורה** (12): שלב "שיקוף הפריט": "נא לשקף עפ״י תכנית {sku}" → "בדיקות שיקוף · N שדות · מהגדרות המסלול" → "בדיקה תקינה?" → "מוצע…" → "הערות". הרייל, הכותרת והפוטר ("יציאה" / "הקודם" / "סיום בדיקת שיקוף") לא משתנים.
- [ ] **פירוק/הרכבה** (13): "תיעוד בתמונות" → "בדיקות פירוק" → "בדיקה תקינה?"; מתחת להצעה "· ההחלטה בידי העובד"; הכפתור "סיום בדיקת פירוק".
- [ ] **ברירת מחדל** (14): "Dell OptiPlex 7040 · עמדה #1" → (אחרי "שמור וסיים" עם חוסר: ההתראה, ב-`Alert` הקיים **בראש הגוף**) → "תוצאת בדיקה" → "עובד מבצע *" → "בדיקות העמדה · N שדות · מהגדרות המסלול" → בתחתית הבלוק "מוצע לסמן כלא תקין — …" → "קבצים מצורפים" → "הערות נוספות". פוטר "ביטול" / "העבר לחקר" / "שמור וסיים". הרוחב לפי החלטה 3.
- [ ] **פתיחה · צילום הקופסה** (15): צילום → "בדיקות הקופסה" → "האריזה תקינה?" → "הערות".
- [ ] **פתיחה · פריט** (16): בתת-שלב "· צילום": "בדיקות הפריט" עם "לכל פריט" ושדות סוג הפריט, ואז "הפריט תקין?". "· סריקה" ו-"· שקילה" לא משתנים.
- [ ] **סגירה · פריטים ואריזה** (17): שורה לכל פריט בכרטיס האחד והשדות מתחתיה; פריט שלא הגיע — "השדות יוצגו אחרי ההחלטה" עד "נארז בכל זאת"; אחרי "חסר במארז" אין שדות; "אי אפשר לאשר תקינות אריזה לפני שכל פריט סומן כנארז או קיבל החלטה מפורשת." נשארת.
- [ ] **סגירה · תקינות האריזה** (18): "בדיקות האריזה" **לפני** 3 התיבות ("כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת הקופסה קריאה"), ואחריהן "הערות אריזה". הכפתור "סגור מארז".
- [ ] **בכל החלונות:** בלוק שדות **אחד** בשלב; שום שלב לא נוסף או זז.

### 8.3 שורת שדה ובחירה

- [ ] **`choice_row`:** תווית (עם "*" בחובה) · autocomplete · הערה. בהתחלה "בחר…".
- [ ] **הרשימה:** לכל אפשרות נקודת טון ורמז מקש; ברגל "{N} אפשרויות" ורמז המקשים של הארטבורד (§4.4).
- [ ] **מקשים 1–4** בוחרים מיד כשהרשימה פתוחה. **הקלדה** מסננת ומציגה "{k} מתוך {N}"; בלי התאמה "אין אפשרויות".
- [ ] **רשימה אחת פתוחה בכל רגע.** Esc סוגר את הרשימה, לא את החלון.
- [ ] **ערך בטון fail:** רקע אדום עדין, ערך אדום/600; ב-`required_on_fail`/`required` — "הערה · חובה", placeholder "פרט את החריגה…", ועד שממלאים מסגרת אדומה עם "יש לפרט את החריגה".
- [ ] **`optional`:** "הערה (אופציונלי)" (או "פרט את החריגה (אופציונלי)" בכשל). **`off`:** אין שדה הערה.
- [ ] **`number`:** LTR עם יחידה; "בטווח · עד X" בירוק / "מחוץ לטווח · עד X"; ריק "יש להזין ערך · עד X"; לא מספר "יש להזין מספר · עד X"; עם `out_of_range_fail` מחוץ לטווח = כשל.
- [ ] **`pass_fail`:** שני כפתורים 44px "תקין" / "לא תקין"; חובה שלא נבחר — מסגרת אדומה על שני הכפתורים (ב-14 בלי טקסט; "יש לבחור ערך" מתחת לכפתורים קיים רק בארטבורד 6).
- [ ] **צבעים:** טון תמיד נקודה + מילה; טקסט לא נצבע ב-`#d97706`/`#1f8a5b`; אין צבע שאינו טוקן.

### 8.4 שדה הערה (7א)

- [ ] במנוחה שורה אחת, 44px (38px בחלונות 17/18).
- [ ] בהקלדה גדל עד 6 שורות (`max-height: 146px`; 138px ב-17/18) ואז נגלל. `field-sizing: content`, ו-fallback של `scrollHeight`.
- [ ] ביציאה, מעל 2 שורות: 2 שורות עם fade ו"הצג הכל · N שורות".
- [ ] `Maximize2` עם "פתח עורך הערה" פותח עורך 520px, 8 שורות, מונה, "סיום"; מתחת לשורה או מעליה; Esc/"סיום" מחזירים פוקוס.
- [ ] ברירת מחדל 1000; 500/1000/2000 לפי השדה; מונה מ-80%; בגבול ההקלדה נעצרת ו"הגעת לאורך המרבי" בענבר.
- [ ] `dir="auto"` על כל שדות ההערה.
- [ ] **השרת אוכף** גם כשהשער כבוי: 1001 תווים בשדה עם 1000 → 400 `NOTE_TOO_LONG`, ושום דבר לא נכתב.

### 8.5 הצעה ושער סיום

- [ ] ערך אחד לפחות בטון fail → מתחת לשאלת התקינות "מוצע: לא תקין — '<שדה>' = <ערך>", **עם כל הכשלים** מחוברים ב-" · ". ב-14: "מוצע לסמן כלא תקין — …".
- [ ] העובד יכול לבחור "תקין" בכל זאת; נשמר `verdict.overridden = true`.
- [ ] בלי כשל אין שורת הצעה, ושום דבר לא מסומן מראש.
- [ ] **השער** (ברירת מחדל מופעל): "המשך"/סיום חסומים כל עוד חסר שדה חובה או הערת חובה; הסטטוס "נותר שדה חובה אחד" / "נותרו N שדות חובה" / "חסרה הערה לחריגה", ו"כל שדות החובה מולאו" כשהכל מלא. **לא חל** על "העבר לחקר".
- [ ] **השרת אוכף את אותו שער:** 422 `FIELDS_INCOMPLETE` עם הטקסט מ-`LegacyFallback.dc.html`.
- [ ] "הכל תקין" **לא** מופיע בחלונות של שלב 1.

### 8.6 שמירה

- [ ] `label`, `opt_label` ו-`tone` שנשמרים לקוחים מההגדרה בשרת. שינוי שם של אפשרות אחר כך לא משנה תוצאה שנשמרה.
- [ ] בפתיחת מארז כל פריט מקבל `schema.target = "kit_item"` ו-`route_id` של מסלול **המארז**; הקופסה `"box"`.
- [ ] בסגירה, "נארז בכל זאת" בלי שורה משלו (`PackageCloseWizard.tsx:92`); הערכים ב-`decisions[i].fields`.
- [ ] `Details.schema` לא תואם (או חסר כשקיימת הגדרה) → 409 `FIELDS_SCHEMA_MISMATCH`, והחלון מרענן את ההגדרה.
- [ ] replay עם אותו `SubmitID` לא כותב פעמיים ולא מאמת שוב.

### 8.7 גרסאות והקפאה

- [ ] קליטה אחרי פרסום כותבת `item_routes.fields_version`: לקופסה — גרסת מסלול המארז; לכל פריט — גרסת המסלול שלו; מסלול שלא פורסם — `NULL`.
- [ ] פרסום עם "רק לפריטים חדשים (מומלץ)" לא משנה פריט באמצע מסלול.
- [ ] "גם לפריטים שטרם הגיעו לעמדה ששונתה · N פריטים" מעביר רק פריטים עם `current_route_step` קטן ממיקום השלב הראשון ששונה (או שווה, בסטטוס 2/6).
- [ ] שלב ברמת מארז נבנה לפי הגרסה של **שורת המארז**, גם לשדות הפריטים בכרטיס.
- [ ] שינוי סוג שמאפס את המארז (`reset.ts`) מקפיא מחדש את הגרסה הנוכחית לכל השורות שהתאפסו.
- [ ] תוצאה ישנה נפתחת ונקראת אחרי עוד פרסומים ואחרי מחיקת שדה.

### 8.8 מסלולים, uid ושיתוף (מנהל)

- [ ] הזזת שלב בחיצים ("הקדם את {name}" / "אחר את {name}") משאירה את השדות על אותה עמדה.
- [ ] הסרת שלב ("הסר את {name} מהמסלול") מוחקת את ההגדרה שלו מהטיוטה ומופיעה ב"מה השתנה".
- [ ] אותו סוג עמדה פעמיים במסלול = שתי הגדרות נפרדות.
- [ ] בתא ברמת פריט: "השדות נשמרים במסלול 1 של {פריט} ומשמשים גם ב: {מארזים}. שינוי כאן יחול בשניהם."; בשורת הפריט במפה `Link2` עם "משותף ל: …".
- [ ] "צור מסלול נפרד למארז הזה" מעדכן את `package_contents.route_number` **רק** בשורה של המארז הזה.
- [ ] מסלול פריט משותף → דיאלוג הפרסום מציג "השינויים יחולו גם מחוץ למארז הזה: …".
- [ ] GET שנכשל → "טעינת הגדרות השדות נכשלה" / "המסלול לא מוצג כריק כדי לא לאבד נתונים." עם "נסה שוב", לא "ללא שדות", ופרסום חסום.

### 8.9 מסך המנהל

- [ ] `/settings/testing-routes?type=…&route=…&view=map` נטען ישירות, ו"חזרה למפה" מנקה `step`/`target` בלי לאבד את המסלול.
- [ ] "מארז עמדת עבודה · מסלול 1": 5 עמודות ו-6 שורות; כל אחת מעמודות 1 ו-5 במסגרת רציפה משלה, עם "כרטיס אחד לכל המארז" בראשה; "מקלדת · חשמל" הוא "—" עם ה-tooltip.
- [ ] כל מצבי התא מ-§5.4.3 מופיעים, כולל "שינוי שלא פורסם" ו"הערכה עודכנה".
- [ ] בחירת 4 תאים → "4 תאים נבחרו"; "בטל בחירה" ו-Escape מנקים.
- [ ] עריכת אפשרות בשדה מקושר מחליפה ל"רשימה: מותאמת לשדה".
- [ ] אפשרות ריקה → "אפשרות ריקה — מלאו או הסירו", הכותרת "בעיה אחת לתיקון", ופרסום חסום.
- [ ] "הדבק מאקסל" עם 3 שורות TSV יוצר 3 שורות; "תקין / מהבהבת / לא דולקת / לא נבדק" מקושר אוטומטית לרשימה "מצב נורית".
- [ ] מסלול בלי שדות → כרטיס ה-onboarding, "אין שינויים לפרסום", פרסום disabled.
- [ ] ארטבורד 10: מעבר בין "רק לפריטים חדשים (מומלץ)" ל"גם לפריטים שטרם הגיעו…" מחליף את פתק המידע, ו-`aria-live` מכריז.
- [ ] בכל המסכים אין צבע מחוץ ל-`tokens.css`; כל טון נקודה + מילה.

### 8.10 ספריות ופעולות מרובות

- [ ] שינוי ברשימה משותפת לא משנה שום שדה מפורסם; מעדכן **טיוטות** בלבד; ההודעה "שינוי ברשימה המשותפת יחול על N שדות ב-M מסלולים לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו."
- [ ] עדכון ערכה מציג "N תאים משתמשים בגרסה קודמת של הערכה" ו"עדכן את כולם (N)"; התאים משתנים רק אחרי פרסום.
- [ ] ארטבורד 9: במצב הוספה עם "קבלת פריט במארז" על 4 תאים, "הפריט ארוז במקומו" מסומן "יידלג".
- [ ] הדבקה מאקסל של `שם⇥אפשרות 1⇥…` יוצרת שורת בדיקה לכל שורה.

### 8.11 RTL ונגישות

- [ ] כל מזהה מארז/פריט בחלונות ובמפה מקובץ ב-4 (`1005 1509 2600 01`), סיומת מודגשת וכחולה, עם `PackageIdText` (ייצוא ברירת מחדל, `src/app/components/packages/PackageIdText.tsx:10`) / `fmtId` (`src/app/components/packages/packageUi.ts:71`) הקיימים, עטוף ב-`direction:ltr; unicode-bidi:isolate`.
- [ ] מק״ט, S/N, מספרים ויחידות ("0.08 Ω") ב-LTR ומבודדים, `tabular-nums`. "1–4" לא מתהפך.
- [ ] חצים מתהפכים ("חזרה למפה", "העמדה הבאה"). הרשימה מיושרת לימין השדה ולא יוצאת מהחלון (portal).
- [ ] autocomplete: `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-activedescendant`; אפשרויות `role="option"` עם מילת הטון ב-`aria-label`; רמזי מקשים `aria-hidden`.
- [ ] אפשר למלא את כל החלון בלי עכבר. מטרות מגע 44px (38px רק להערה בחלון דחוס). במפה `role="grid"` עם ניווט חיצים.

### 8.12 בדיקות אוטומטיות להוסיף

`node:test` + `node:assert/strict`, כמו `src/lib/workHours/__tests__/time.test.ts`. בדיקות אינטגרציה רצות רק כש-`TEST_DATABASE_URL` מצביע ל-DB זמני; בלי המשתנה ה-`describe` מדולג (`src/app/lib/metrics/__tests__/write-path.integration.test.ts:24-26`). עזרים ב-`write-path-helpers.ts` (`call(h().results, "/api/testing/results", …)`, `:545-547`).

| קובץ | שלב | מה נבדק |
|---|---|---|
| `src/app/lib/station-fields/__tests__/validate.test.ts` | 0 | uid לא תקין, יעד `box` בשלב ברמת פריט, `note_max` מחוץ ל-500/1000/2000 נדחים; lint מחזיר "יש להזין שם לשדה", "אפשרות ריקה — מלאו או הסירו", ושלוש אזהרות ארטבורד 4 בסדר הנכון |
| `…/evaluate.test.ts` | 0 | tone fail → `suggested:"fail"` ו-`fails` עם **כל** הכשלים; `required_on_fail` דורש הערה רק בכשל; מספר מחוץ לטווח עם/בלי `out_of_range_fail`; 1001 תווים כש-`note_max` חסר; `section` לא נספר |
| `…/step-uids.test.ts` | 1 | `assignStepUids`: הזזה, הסרה, uid לא מוכר, uid כפול, uid שהוסר לא ממוחזר; `inferUidsByOccurrence` עם סוג עמדה שמופיע פעמיים |
| `…/resolve.test.ts` | 1 | `legacy`/`item`/`package`: `fields_version` NULL, אורכים לא תואמים, uid חסר בגרסה, קבוצות ריקות; `groups` לכל פריט במארז |
| `…/diff.test.ts` | 2 | הוספה, הסרה, אפשרות חדשה, סימון חובה, `step_removed` |
| `src/app/components/reports/__tests__/testDetails.test.ts` | 1 | `normalizeTestDetails` על כל צורות ה-`details` הקיימות ועל צורה עם `schema`/`fields`/`verdict`: אין חריגה, והמפתחות הקיימים (`sku`, `station`) עדיין מוצגים |
| `write-path.integration.test.ts` (הרחבה) | 1–2 | קליטה אחרי פרסום מקפיאה; בלי פרסום `NULL`; `schema` שגוי → 409; חובה חסרה → 422 עם הטקסט מהארטבורד; התווית מההגדרה; `not_reached` מעלה רק את מי שלא הגיע; replay לא כותב; שינוי מזהה סוג עמדה מעדכן `route_steps` |

---

## 9. QA ידני

### 9.1 סביבה ופקודות

הכל מהשורש של הריפו. הפקודות מ-`package.json:5-20` ומכותרות סקריפטי הזרע.

```bash
# 1. משתנים. אפליקציית Next קוראת מ-.env.local; ה-CLI של prisma קורא מ-.env
#    (prisma.config.ts טוען dotenv/config) — ולכן DATABASE_URL מגיע מהסביבה.
cp env.local.example .env.local        # למלא: NEXTAUTH_SECRET (הזרע קורא AUTH_SECRET או NEXTAUTH_SECRET), MinIO
export DATABASE_URL="postgresql://<user>:<pass>@localhost:5432/<db>?schema=public"

# 2. תלויות + סכימה
npm ci
npm run db:deploy          # כל המיגרציות כולל החדשה (בפיתוח: npm run db:migrate)
npm run db:generate
npm run db:check-migration # חייב לעבור לפני commit של מיגרציה

# 3. שרת
npm run dev                # http://localhost:3000

# 4. זרעים (טרמינל שני, השרת רץ)
node scripts/seed-packages-demo.mjs --confirm
node scripts/seed-station-fields-demo.mjs --confirm    # חדש, שלב 1
node scripts/seed-packages-demo.mjs --confirm          # שוב: מארזים שנקלטים אחרי הפרסום

# 5. בדיקות
npm test
npm run lint
npm run build
```

- **`seed-packages-demo.mjs`** דורש DB שעבר את `20260915120000_package_model` (כותרת הקובץ, `:8-11`). יוצר סוגי עמדה "פתיחת מארז", "חשמל", "מכניקה", "בדיקה ויזואלית", "מעבדת מחקר", "סגירת מארז" (`:66-71`); סוגי מארז "מארז מחשב", "מארז עמדת עבודה", "מארז ציוד היקפי" (`:95-97`); ו-~16 מארזים בכל המצבים. **זה הזרע ל-QA.**
- **`seed-dev-dataset.js`** מיועד לדשבורד המטריקות ועדיין משתמש במפתח `parents_only` (`:187`) **(לא אומת שהוא עובד אחרי מודל המארזים; לא נדרש כאן)**.
- **אילו חלונות נפתחים בזרע:** מזהי סוגי העמדה מוקצים אוטומטית. "חשמל", "מכניקה" ו"בדיקה ויזואלית" יפתחו `PopUpTestDialog` (14) **רק אם** לא קיבלו את המזהים 2–5 (`mainPopUp.ts:19-22`, `:26-31`). **ב-DB ריק זה כמעט בטוח קורה:** הזרע יוצר 6 סוגים לפי הסדר (`seed-packages-demo.mjs:66-71`, autoincrement) — פתיחת מארז=1, חשמל=2, מכניקה=3, בדיקה ויזואלית=4, מעבדת מחקר=5, סגירת מארז=6 — ולכן חשמל נפתח כ-Disassembly (פירוק), מכניקה כ-Xray ובדיקה ויזואלית כ-BlackMirror. תרחיש ו ב-§9.2 (ארטבורד 14 בחשמל) דורש שחשמל יקבל מזהה מחוץ ל-2–5: ליצור קודם 4 סוגי עמדה אחרים (למשל "פירוק", "שיקוף", "מראה שחורה", "הרכבה") כדי לתפוס את 2–5, או לשנות את המזהה של חשמל דרך "מזהה (ID)" אחרי תיקון שלב 0. בדיקה: `SELECT test_station_type_id, test_type_desc FROM test_stations_type ORDER BY 1;`. כדי לבדוק 12–13: ליצור ב-`/settings/test-stations` סוגים "שיקוף" ו"פירוק", לשנות להם מזהה ל-3 ו-2 (שדה "מזהה (ID)", `StationTypesTable.tsx:283`) — **לפני** שמכניסים אותם למסלול, או אחרי תיקון שלב 0 — להוסיף למסלול של "מחשב" ולפרסם שדות. (המזהים 2–5 פנויים רק אם יצרתם אותם לפני הזרע — ראו למעלה.)
- **כניסה:** הדפדפן עובר ב-Keycloak (`docker-compose.keycloak.yml`); הזרעים עוקפים עם עוגייה offline. לדפדפן צריך משתמש עם manager + tester: `node scripts/e2e-packages/kc-test-user.mjs create` (`scripts/e2e-packages/README.md`) **(לא אומת מחוץ ל-Windows)**.
- **`DATABASE_URL`** מופיע ב-`env.local.example:29` רק כשורה מוערת (`# DATABASE_URL=postgresql://…`); `src/app/lib/prisma.ts:10` קורא `process.env.DATABASE_URL` ישירות ולא מרכיב אותו מ-`DB_*`. לכן יש להגדיר `DATABASE_URL` במפורש.

### 9.2 תסריט QA

"לפני" = מארז שנקלט לפני `seed-station-fields-demo`, "אחרי" = אחריו.

| # | תרחיש | צעדים | מצופה |
|---|---|---|---|
| **א** | חלון קבוע | מסך בדיקה → "עמדת פתיחה 1" → מארז "לפני" → "התחל פתיחת מארז" | 6 השלבים של היום. ב"צילום הקופסה" אין "בדיקות הקופסה". ה-`details` זהה ל-`PackageOpenWizard.tsx:267-272` |
| **ב** | פתיחה · קופסה | אותה עמדה → מארז "עמדת עבודה" "אחרי" → שלב 2 | "בדיקות הקופסה" לפני "האריזה תקינה?". "שבר/סדק" ב"שלמות הקופסה" → השורה אדומה, "הערה · חובה", ו"מוצע: לא תקין — 'שלמות הקופסה' = שבר/סדק". "המשך" חסום עד שממלאים הערה. "תקין" למרות ההצעה → `verdict.overridden = true` |
| **ג** | פתיחה · פריט 02 מסך | "פריטים במארז" → 02 מסך → סריקה → צילום | "בדיקות הפריט": "לכל פריט" ואחריה "שדות מסך" ("מעמד", "כבל DisplayPort"). מקש 2 בוחר "חסר". "פג" מסנן ל"פגום". ב-DB: `schema.target = "kit_item"`, `route_id` של מסלול המארז |
| **ד** | הערה ארוכה | 7 שורות בהערה → יציאה → "הצג הכל · 7 שורות" → הגדלה | 6 שורות ואז גלילה; אחרי יציאה 2 שורות עם fade; עורך 520px עם מונה. בשדה 500: המונה מופיע ב-400; ב-500 "הגעת לאורך המרבי" וההקלדה נעצרת |
| **ה** | אורך בשרת | `curl` ל-`/api/testing/results` עם הערה של 1001 תווים (עוגייה מהזרע) | 400 `NOTE_TOO_LONG`; אין שורה ב-`test_results`; `item_routes` לא זז |
| **ו** | חשמל · מחשב (14) | (תנאי: לסוג "חשמל" מזהה מחוץ ל-2–5 — ראו §9.1) "עמדת חשמל 1" → מחשב מ"אחרי" → "התחל בדיקה" | "בדיקות העמדה · 5 שדות · מהגדרות המסלול" בין "עובד מבצע *" ל"קבצים מצורפים". "התנגדות הארקה" = 0.2 → "מחוץ לטווח · עד 0.1 Ω" והצעת כשל. "שמור וסיים" מציג את ההתראה ולא שומר עד שהחובה מלאה. "העבר לחקר" לא חסום |
| **ז** | סגירה (17–18) | "עמדת סגירה 1" → מארז "אחרי" ש-05 עכבר שלו לא הגיע | 05 בענבר: "השדות יוצגו אחרי ההחלטה". "נדרשת החלטה" → "נארז בכל זאת" → השדות מופיעים; "חסר במארז" → אין שדות. "בדיקות האריזה" לפני 3 התיבות. ב-DB: `decisions[i].fields` לפריט 05 |
| **ח** | פריט ישן באמצע מסלול | פריט "לפני" בעמדת חשמל | חלון קבוע (`fields_version = NULL`) |
| **ט** | פרסום והקפאה (שלב 2) | שינוי שדה בחשמל · מחשב → "פרסום לעמדות" → פעם "רק לפריטים חדשים", פעם "גם לפריטים שטרם הגיעו…" | הראשון: מחשב שכבר בחשמל ממשיך בגרסה הקודמת. השני: מחשב שעוד בפתיחה עובר לחדשה; מחשב שעבר את חשמל נשאר |
| **י** | שיתוף (שלב 2) | עורך "מכניקה · מסך" ב"מארז עמדת עבודה" → "צור מסלול נפרד למארז הזה" | "מארז ציוד היקפי" לא השתנה; "משותף ל:" נעלם מהתא; מארז עמדת עבודה חדש הולך במסלול החדש של מסך |
| **יא** | באג שלב 0 | `/settings/test-stations` → שינוי המזהה של "בדיקה ויזואלית" | כל המסלולים מכילים את המזהה החדש; פריטים בתור ויזואלית עדיין בתור; השדות שלו לא אבדו |
| **יב** | RTL ונגישות | בחלון שיקוף: Tab בלבד, ובקורא מסך (NVDA) | הסדר נכון; כל אפשרות מוקראת עם מילת הטון; "מוצע…" מוכרז; `1005 1509 2600 01` לא מתהפך |

### 9.3 בדיקות דפדפן קיימות (רגרסיה)

`scripts/e2e-packages/01-smoke.mjs`, `02-flow.mjs`, `03-wizards-ui.mjs`, `05-rules.mjs`, `07-hydration.mjs`, `08-scroll-fields.mjs` — מול DB **בלי** הגדרה מפורסמת. כולן עוברות כמו היום: ההוכחה ש"אין הגדרה → אין שינוי". דורשות puppeteer-core ו-Chrome בנתיב Windows קבוע **(לא הורצו בהכנת המסמך)**.

---

## 10. החלטות פתוחות

**לא מכריעים אותן בשקט.** כל אחת מומשה לפי ברירת המחדל שבטבלה, באופן שמשנה שורה אחת כשתוכרע. ציינו ב-PR מה נבחר.

### 10.1 חמש ההחלטות

| # | שאלה | ברירת מחדל / המלצה | למה | מה זה משנה בקוד |
|---|---|---|---|---|
| **1** | לחסום סיום כשחסרים שדות חובה או הערות חובה? | **כן** (ברירת המחדל) | ארטבורדים 12–18 מציירים את החסימה ואת הטקסטים שלה. בלי שער, שדה חובה הוא רק המלצה | `GATE_FINISH_ON_REQUIRED` (§2.6), לקוח ושרת. "העבר לחקר" לא חסום. אורך הערה נאכף בכל מקרה |
| **2** | עמדות צילום (פירוק / הרכבה): שדות בשלב הצילום, או אפשרות "שדות בשלב נפרד" בהגדרת הפריסה? | **בשלב הצילום**, כמו ארטבורד 13. "שלב נפרד" — לשלב 3 | זה מה שמצויר. ל"שדות בשלב נפרד" אין טקסט ואין עיצוב | המפתח השמור `layout.fields_placement` (§2.2); בשלבים 1–2 מתעלמים. אם יוחלט "נפרד": phase שלישי ב-`PhotoStation` (`:56-59`), בלי טקסט מאושר |
| **3** | להרחיב את `PopUpTestDialog` מ-sm 600 ל-md 900 כשיש בו שדות? | **כן, רק כשיש שדות** | ב-600 עמודת ההערה ~162px (`LegacyFallback.dc.html:360`) | `maxWidth={hasFields ? "md" : "sm"}`; `Dialog` כבר תומך ב-`md: 900` (`Dialog.tsx:14`). 14 מצויר ב-600 (`:79`); השבירה ב-900 לא מצוירת |
| **4** | שדות של עמדה ברמת פריט: משותפים לכל המארזים דרך מסלול הפריט, או override לכל מארז? | **משותף**, עם "צור מסלול נפרד למארז הזה" כפתח מילוט | override היה מוסיף יעד `{item_type_id, package_type_id}`, סדר עדיפויות בזמן ריצה ושורה במפה. מסלול נפרד כבר קיים במודל (`package_contents.route_number`) | `POST …/[id]/fork` (§3.2.1); "משותף ל: …"; אזהרה בפרסום. בצד העובד אין הבדל |
| **5** | לתקן את באג ה-cascade של מזהה סוג עמדה? | **כן, בשלב 0** | טקסט העזרה כבר מבטיח שהמסלולים יתעדכנו (`StationTypesTable.tsx:289`) | §3.6 |

### 10.2 שאלות נוספות שעלו (ברירת מחדל ממומשת, לאשר)

1. **הרשאת פרסום:** המסך פתוח ל-`manager` ול-`tester` (`routes.ts:78`). **המלצה:** פרסום ל-`manager` בלבד, טיוטה לשניהם. ממומש בקבוע `PUBLISH_ROLES` (§3.0), ברירת מחדל `["manager", "tester"]` עד אישור.
2. **תוצאה בלי `schema` כשקיימת הגדרה:** **המלצה (ממומשת):** השרת דוחה ב-409 `FIELDS_SCHEMA_MISMATCH` (§3.4 צעד 2), כדי שלקוח ישן או תקלה לא ישמרו בשקט תוצאה בלי שדות. החיסרון: לשונית פתוחה עם JS ישן בזמן פריסה תיכשל פעם אחת עד רענון.
3. **עקיפת ההצעה:** האם לדרוש הערה כשהעובד בוחר "תקין" למרות "מוצע: לא תקין"? **המלצה:** לא לחסום, לרשום `overridden` ("ההחלטה בידי העובד", 13).
4. **פרסום אחד, כמה מסלולים:** כל מסלול בהקשר מקבל מספר גרסה משלו, וכולם ב-`publish_batch` אחד; "גרסה 5" בדיאלוג = גרסת המסלול שהמסך פתוח עליו (המארז). לאשר שזו הכוונה.
5. **הדוח לא יציג את השדות החדשים:** `normalizeTestDetails` (`testDetails.ts:76-95`) קורא `fields` רק כמערך. **המלצה:** להוסיף לקורא ענף ל-`schema` + `fields` כאובייקט (לא לשנות את צורת השמירה). אין נזק היום — הדוח לא מחובר למסך.
6. **התג "מהגדרות המסלול"** — מופיע בכל 12–18 דרך `markNew`. **המלצה:** להשאיר בייצור (המסגרת הכחולה לא).
7. **`Result` של הקופסה בסגירה** כשיש כשל בשדות נשאר `anyMissing ? 0 : 1`, ושורות פריטים שהגיעו נשארות `Result: 1` — לפי "העובד מחליט".
8. **מגבלת 1000 התווים על ההערות הקיימות** חלה רק כש-`hasFields`. על `Comments` אין אכיפה בשרת.
9. **"שדות בשלב נפרד"** (החלטה 2) — אין לו טקסט ואין עיצוב בכלל.

### 10.3 סתירות בין ארטבורדים (ההכרעה במסמך)

| סתירה | הכרעה |
|---|---|
| **לחיצה על תא:** ב-1 מסמנת, ב-11 "לחיצה על תא פותחת את עורך השדות" | **פותחת.** בחירה ב-Ctrl/⌘ או רווח |
| **"שלבי המסלול 5"** למארז עם 2 שלבים | לא הוכרע — מה המספר מייצג. ברירת מחדל: מספר השלבים במסלול **שנבחר** (2) |
| **"כיסוי 3/16"** ב-11 מול 8 תאים מכוסים | נתון הדגמה שגוי; מחשבים מהנתונים |
| **"אורך מרבי":** ghost ב-2, select עם תווית ב-7א | **ארטבורד 2** |
| **רוחב דיאלוג הפרסום:** 640 מול `sm` 600 | **`sm`** |
| **נוסחי סטטוס/רגל רשימה/הצעה** שונים בין 12–18 | כל חלון לפי הארטבורד שלו (§4.4) |
| **קיצור שם ערכה בתג התא** ("ערכה: חזותית בסיסית" מול "בדיקה חזותית בסיסית") | השם המלא עם ellipsis |
| **"תצוגה מקדימה כעובד"** מוביל ב-1 לארטבורד 5 | בשלבים 1–2 — החלון הקיים עם השדות (12–18) |
| **ארטבורד 2 (חשמל) מצייר שורות נעולות ותצוגת עובד בסגנון VerdictStation** ("סריקת מק״ט יצרן · חלק קבוע", "'בדיקה תקינה?' · תמיד אחרון", "שלב 2 מתוך 3", "סיום בדיקת חשמל"), אבל חשמל נפתח ב-`PopUpTestDialog` (14) | השורות הנעולות והתצוגה החיה (§5.5.2 ב/ה, §5.5.3) נגזרות מהחלון שהעמדה באמת פותחת (`getStartTestDialog`). ל-`PopUpTestDialog`: עליונה "תוצאת בדיקה · עובד מבצע" ותחתונה בלי "בדיקה תקינה?" — נוסח **COPY-PENDING**; התצוגה = ארטבורד 14 ("שמור וסיים") |

### 10.4 טקסט חסר (COPY-PENDING — לא להמציא)

- תווית מסלול מפורסם בכותרת (spec ישן: "מפורסם · גרסה N").
- דיאלוגים: "העתק ממסלול אחר…", "העתק מ…", "העתק לפריטים…", "שמור כערכה…", "היסטוריית גרסאות"; אישורים: ביטול טיוטה, מחיקת ערכה/רשימה, "נקה", "צור מסלול נפרד"; popover הבעיות; Snackbar אחרי פרסום/הדבקה; שמירה אוטומטית שנכשלה / 409; עורך עמדת `package_level`; מסלול פריט בודד במפה.
- תפריט ⋯ בשורה (מוצע "שכפל" / "מחק"); שגיאות מספר; שם כפול; 0 אפשרויות; "{n} שגיאות" בתא; רוב סוגי שורות ה-diff בפרסום; "בשניהם" ליותר משני מארזים; נטיית "עוברת" ב-tooltip; "שורת מספר" עם `min`/`ref`/`tol_pct` אצל העובד.
- צד העובד: מחרוזות מצב השגיאה בטעינה (לקוחות מ-11); כותרות "בדיקות מראה שחורה" / "בדיקות הרכבה"; כל סוגי השדות פרט ל-choice/number/pass-fail; שורה עם `notes: "off"`; אייקון קבוצת סוג פריט שאינו מסך.
- הודעות השרת ל-`NOTE_TOO_LONG` ול-`FIELDS_SCHEMA_MISMATCH`.

---

## 11. מה לא לעשות

1. **לא לשנות את מעטפת החלונות** — `StationShell`, `PackageWizardShell`, ה-`Dialog` של `PopUpTestDialog`, הרייל, השלבים, הסדר, הפוטר, `mainPopUp.ts`. רק בלוק אחד, שורת הצעה ותנאי הכפתור.
2. **לא לשנות כלום כשאין הגדרה מפורסמת** — לא רוחב, לא מגבלת אורך, לא `TextField`, לא `Details`.
3. **לא למפות הגדרה לפי אינדקס של שלב.** תמיד `step_uid`. לא `key={index}`, לא uid שמחושב מאינדקס, לא השוואה ל-`station_type_id` שבתוך ההגדרה.
4. **לא להחליף את `route_steps`** ב-JSON ולא לשנות את הטיפוס שלו. `step_uids` מקביל, באותו UPDATE.
5. **לא לשבור קוראים קיימים של `details`** — לא לשנות, להזיז או לשנות שם של אף מפתח קיים. `verdict` מורחב, לא מוחלף. `fields` של "נארז בכל זאת" בתוך `decisions[i]`. **שימו לב להתנגשות שם:** `details.fields` הוא כבר הצורה ה"מועדפת" המתועדת של הדוח — `{ fields: TestDetailField[] }` כ**מערך** (`src/app/components/reports/testDetails.ts:6`, `:81`). ה-`fields` החדש הוא **אובייקט** לפי FieldId, ולכן הדוח מדלג עליו בשקט (§10.2-5). לא לשנות את הצורה; להוסיף לקורא ענף ל-`schema` + `fields` כאובייקט, ולהזכיר זאת ב-PR.
6. **לא לשנות את `result`, `passed`, `comments`** לפי ההצעה. העובד מחליט.
7. **לא לסמוך על הלקוח** — תוויות, טון ו-`suggested` מחושבים מההגדרה בשרת; אורך הערה נאכף בשרת תמיד.
8. **לא להמציא טקסט, צבע או מצב.** טקסט חסר → COPY-PENDING ו"טקסט לאישור" ב-PR. אין צבע מחוץ ל-`tokens.css` חוץ מ-4 צבעי הטון (שהם טוקנים קיימים), ולא צובעים טקסט ב-`#d97706`/`#1f8a5b`.
9. **לא לממש את מסגרת `markNew`** (`#cfe3fb`) ולא לשכפל את פס הצד/הלשוניות שמצוירים בארטבורדים.
10. **לא להוסיף תלויות** (zod, ספריית DnD וכו') בלי אישור. Popover דרך `@radix-ui/react-popover` המותקן.
11. **לא להשאיר `DROP`** של `testing_routes_type_number_uq` או `ir_item_fk` במיגרציה, ולא להוסיף `@@unique` של המסלול לסכימה.
12. **לא להחזיר `[]` או אובייקט ריק על כשל** בשום endpoint של הגדרות — 500 אמיתי. המסך לא מציג "ללא שדות" לפני שהנתונים הגיעו ולא בזמן כשל.
13. **לא לגעת בגרסאות מפורסמות** (`route_field_versions` בלתי ניתנת לשינוי) ולא בתוצאות שנשמרו.
14. **לא להכריע בשקט את ההחלטות הפתוחות** (§10). ברירת המחדל ממומשת בקבוע אחד, ומצוינת ב-PR.
15. **לא לממש את ארטבורד 7, את "הכל תקין" ואת החלון המאוחד (5/6) לפני שלב 3.**

---

## נספח א' — סכמות zod (רק אם תאושר תלות חדשה)

`zod` **לא** ב-`package.json`. הוספה מחייבת לעדכן את המטמון של הבנייה ה-offline (`docs/RUNBOOK_OFFLINE_BUILD.md` §1.3). הוולידטורים ב-§2.3 הם מקור האמת עד אז.

```ts
import { z } from "zod";
const Tone = z.enum(["pass", "warn", "fail", "neutral"]);
const Notes = z.enum(["off", "optional", "required_on_fail", "required"]);
const Opt = z.object({ id: z.string().regex(/^o_[a-z0-9]{8}$/), label: z.string().max(60), tone: Tone });
const Ref = z.object({ id: z.number().int(), ver: z.number().int() });
const Base = z.object({
  id: z.string().regex(/^f_[a-z0-9]{8}$/), label: z.string().max(80), help: z.string().max(200).optional(),
  required: z.boolean(), notes: Notes, note_max: z.union([z.literal(500), z.literal(1000), z.literal(2000)]).optional(),
  from_set: Ref.optional(),
});
export const FieldZ = z.discriminatedUnion("type", [
  Base.extend({ type: z.literal("choice_row"), options: z.array(Opt).max(12), list_ref: Ref.optional() }),
  Base.extend({ type: z.literal("multi_choice"), options: z.array(Opt).max(12), list_ref: Ref.optional() }),
  Base.extend({ type: z.literal("pass_fail") }),
  Base.extend({ type: z.literal("number"), unit: z.string().max(12).optional(), min: z.number().optional(), max: z.number().optional(),
                ref: z.number().optional(), tol_pct: z.number().optional(), out_of_range_fail: z.boolean() }),
  Base.extend({ type: z.literal("text") }), Base.extend({ type: z.literal("textarea") }), Base.extend({ type: z.literal("scan") }),
  Base.extend({ type: z.literal("checklist"), items: z.array(z.object({ id: z.string(), label: z.string().max(80) })).max(20) }),
  Base.extend({ type: z.literal("photo"), photo_type: z.string().max(50), min: z.number().int().min(0).max(20) }),
  z.object({ id: z.string().regex(/^f_[a-z0-9]{8}$/), type: z.literal("section"), label: z.string().max(80) }),
]);
const Target = z.union([z.literal("item"), z.literal("box"), z.literal("each_item"), z.object({ item_type_id: z.number().int() })]);
export const StepZ = z.object({
  uid: z.string().regex(/^s_[a-z0-9]{8}$/), station_type_id: z.number().int(), station_label: z.string().max(50),
  scope: z.enum(["package", "item"]), groups: z.array(z.object({ target: Target, fields: z.array(FieldZ).max(60) })),
  layout: z.record(z.unknown()).optional(),
});
export const RouteFieldsConfigZ = z.object({ schema: z.literal(1), steps: z.record(StepZ) })
  .superRefine((c, ctx) => { for (const [k, s] of Object.entries(c.steps)) if (s.uid !== k) ctx.addIssue({ code: "custom", path: ["steps", k], message: "uid mismatch" }); });

const Snap = { label: z.string(), note: z.string().optional() };
export const FieldValueZ = z.discriminatedUnion("t", [
  z.object({ t: z.literal("choice_row"), opt: z.string().nullable(), opt_label: z.string().nullable(), tone: Tone.nullable(), ...Snap }),
  z.object({ t: z.literal("multi_choice"), opts: z.array(Opt), ...Snap }),
  z.object({ t: z.literal("pass_fail"), ok: z.enum(["pass", "fail"]).nullable(), ...Snap }),
  z.object({ t: z.literal("number"), value: z.number().nullable(), unit: z.string().optional(), in_range: z.boolean().nullable(), ...Snap }),
  z.object({ t: z.enum(["text", "textarea", "scan"]), value: z.string().max(2000), ...Snap }),
  z.object({ t: z.literal("checklist"), items: z.array(z.object({ id: z.string(), label: z.string(), ok: z.boolean() })), ...Snap }),
  z.object({ t: z.literal("photo"), photo_type: z.string(), photos: z.array(z.string().max(1024)), ...Snap }),
]);
export const FieldsResultBlockZ = z.object({
  schema: z.object({ route_id: z.number().int(), v: z.number().int(), step_uid: z.string(), target: z.enum(["item", "box", "kit_item"]) }),
  fields: z.record(FieldValueZ),
  verdict: z.object({ ok: z.enum(["pass", "fail"]).optional(), note: z.string().optional(),
                      suggested: z.enum(["pass", "fail"]).nullable(), overridden: z.boolean().optional() }),
});
```

הגבלת אורך ההערה לפי `note_max` **לא** בסכמת zod (תלויה בהגדרה); נאכפת ב-`checkFieldsSubmission` (§3.4 צעד 4).

---

## נספח ב' — מה לא אומת

- הנוהל המדויק להרצת מיגרציה חדשה בשרת הפרודקשן ה-air-gapped: `prisma migrate deploy`, או שילוב ב-`UPGRADE_ALL_IN_ONE.sql` (§1.4).
- ~~האם `metrics_refresh_run_plan` מתקן `route_run.planned_steps`~~ — נבדק: אין לה הגדרה בריפו; שום דבר לא מרענן `planned_steps` (§3.6). לציין ב-PR.
- ביצועי ספירת השימוש (`jsonb_path_query`) וספירת "מולא ב-N בדיקות" על נפח הפרודקשן (§3.2, §3.4.2).
- סדר ה-FK כשמוסיפים את הטבלאות החדשות ל-`scripts/build-settings-seed.js`.
- קיום שמות האייקונים החדשים ב-`lucide-react@^1.24.0` (`node_modules` לא היה מותקן).
- ~~שהמזהים 2–5 פנויים~~ — נבדק: ב-DB ריק הזרע תופס 1–6 לפי הסדר, וחשמל/מכניקה/ויזואלית מקבלים 2/3/4 (§9.1); ש-`seed-dev-dataset.js` רץ אחרי מודל המארזים; ש-`scripts/e2e-packages/*` רצים מחוץ ל-Windows.
- ~~איך האפליקציה בונה `DATABASE_URL`~~ — נבדק: `prisma.ts:10` קורא אותו ישירות; ב-`env.local.example:29` הוא מוער (§9.1).
- דוגמת המסלול "יחידת רדיו" עם תחנה חוזרת ב-`seed-dev-dataset.js` (מקור: מפת הקוד, לא נבדק שוב).
- שבירת השורה של `PopUpTestDialog` ב-900px (אין ארטבורד לרוחב הזה).
