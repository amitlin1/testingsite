# רשימה לעמית – רפקטור refactor/untangle-codebase

סיכום: סעיף 1 – 69 באגים שלא תוקנו (אבטחה וכתיבות לא מוגנות ראשונים, אחר כך נתונים, תצוגה, קטן).
סעיף 2 – 24 החלטות שממתינות לך. סעיף 3 – 24 שינויי התנהגות.
סעיף 4 – 21 תיקונים שנעשו בדרך. (שורה אחת מקבצת לעיתים כמה באגים קרובים.)

הערות קריאה: "אומת" = נקרא/שוחזר ואושר על ידי סוכן או הרכז, או דווח באופן עצמאי על ידי 2 קוראים ומעלה. "מדווח" = קורא אחד. מיקומי file:line לפי הדוח האחרון שמזכיר את הבאג (שורות עלולות לזוז קצת אחרי הרפקטור). אף אחד מהבאגים בסעיף 1 לא תוקן ברפקטור (כלל העבודה: באגים מדווחים ולא מתוקנים בנפרד).

## 1. באגים שנמצאו ולא תוקנו

### אבטחה

- אבטחה | אומת | callback של OnlyOffice מקבל גוף לא מאומת כשקיים כל token: `api/onlyoffice/callback/[...key]/route.ts:88-93` (`body = verified ?? rawBody`; הנתיב ציבורי ב-`src/lib/routes.ts:38`) – מי שלא מחובר יכול לגרום לשרת למשוך נתיב לפי בחירתו ולדרוס כל אובייקט `items/{id}/…` ואת שורת ה-registry שלו. התיקון: כש-`ONLYOFFICE_JWT_SECRET` מוגדר לדרוש אימות מוצלח.
- אבטחה | אומת | `/api/files` (GET/DELETE/PATCH, presign/confirm) לא מוגבל לפי תפקיד ופותח את כל ה-bucket: `api/files/route.ts:21-145`, `src/lib/routes.ts:97` (רק הדף `/files` מוגן) – כל משתמש מחובר (גם מחסנאי) יכול לראות/להחליף/למחוק צרופות פריטים, חתימות ואפילו PDF סופי קפוא; ב-PATCH/DELETE אין בדיקת `..`. דורש החלטה כי קבצי מנהל הקבצים יושבים בשורש ה-bucket.
- אבטחה | אומת | כתיבות בלי בדיקת תפקיד: כ-25 כתיבות ב-`api/settings/**` (customers, item-status, item-types, reference-items כולל presign, test-station-status, test-stations, test-stations-type), `testing-routes/[id]/route.ts:34` DELETE (בעוד ה-PUT דורש `FIELDS_EDIT_ROLES`), ובמארזים: DELETE/PATCH `api/packages/[id]`, `…/items`, `…/contents`, `…/cert-row` – כל משתמש מחובר (מחסנאי, משאן) יכול למחוק מארז עם היסטוריית בדיקות. (החלטה בסעיף 2.)
- אבטחה | אומת | `PUT api/users/[id]/route.ts:39-49` (דוח אחר: `:55-86`) כותב שם/שם משפחה/מספר עובד לפני בדיקות התפקיד – בקשה שנדחית ב-400 ("אי אפשר להוריד את עצמך") כבר שינתה את הפרופיל.
- אבטחה/נתונים | אומת | `keycloak-admin.ts:167-171` (דוח אחר `:208`) `getUserRealmRoles` מחזיר `[]` בכל כשל, ואז `setUserRole`/`setSingleAppRole` מוסיף תפקיד חדש בלי להסיר את הישן ומחזיר הצלחה – למשתמש נשארים שני תפקידים.
- אבטחה/נתונים | אומת | `keycloak-admin.ts:174` / `:372-376`: כשל חולף ב-`getUser` מחזיר null ואז `updateUserProfile` שולח `attributes={employeeNumber}` ומוחק את שאר ה-attributes של המשתמש.
- אבטחה | אומת | `keycloak-admin.ts:409`/`:361` (requiredActions אחרי איפוס סיסמה) ו-`:390`/`:342` (ניקוי brute-force בהפעלה מחדש) לא נבדקים – "איפוס" או "שחרור נעילה" יכולים להצליח בלי שהסיסמה תכפה שינוי או שהמשתמש ישוחרר.
- נתונים | אומת | `lib/users/rules.ts:80-83` `employeeNumberEdit` (דוח אחר `users/[id]:63-68`): בעריכה אפשר לשמור מספר עובד כמו "12a" (ביצירה יש `^\d{1,32}$`); המשתמש נופל מספריית העובדים ולא יכול לשמור משלוח.
- אבטחה | מדווח | `POST api/shipment-history` (`:71-104`) סומך על הלקוח: אין מקסימום לפי סוג, אין בדיקה שהסוג/מק"ט שייכים למשלוח, שורות רעות מדולגות בשקט – קריאת API יכולה "לשלוח יותר מדי", לסגור את המשלוח ולמחוק את המארזים הממתינים.
- אבטחה | מדווח | `PUBLIC_ROUTES` עם התאמת prefix על `/api/health` (`routes.ts:31,139`) הופך כל `/api/health/*` עתידי לציבורי; ה-matcher `"/api/((?!auth).*)"` (`middleware.ts:268`) מדלג על כל נתיב עתידי שמתחיל ב-`/api/auth…`; `IS_DEV=1` עוקף auth ב-middleware אבל לא ב-`withAuth` (`require-user.ts:54-56`) (כולם רדומים).
- אבטחה | מדווח | `safeCallbackUrl` מקבל `//host/…` (Auth.js שומר אותו same-origin כברירת מחדל); `/api/item-reports/logo` POST בלי טיפול בשגיאות – כשל אחסון = 500 חשוף של Next.

### נתונים

- נתונים | אומת | שינוי id של סוג עמדה מוחק במפל את תבנית הפופאפ והיסטוריית הגרסאות שלה ומנתק תמונות ייחוס וקבוצות תמונה: `api/settings/test-stations-type/[id]/route.ts:93-135` מול `prisma/schema.prisma:830,842` (Cascade) ו-`:196,225` (SetNull); `test_results` וה-ledger נשארים עם id הישן; `CODE_POPUPS` מפסיק להתאים ופופאפ קוד יורד לדיאלוג רגיל. הבדיקה `station-type-rename` מכסה רק מסלולים/טיוטות.
- נתונים | אומת | דף הבדיקות שולח את זמן יצירת שורת המסלול כ-`QueueStartTime`: `src/app/testing/useTestWindow.ts:93` (קודם `page.tsx:1105`) → `lib/testing/submit-result.ts:334-335`; `item_route_history.queue_start_time` ו"התחלת תור" בהיסטוריית העמדה שגויים לכל תוצאה מפופאפ פריט (אשפי המארז לא שולחים ומקבלים נכון). התיקון המומלץ: לקרוא מהשורה הנעולה בשרת (recheck-1 F3).
- נתונים | אומת | `scripts/reconcile-file-registry.mjs:84-98` מוחק רכות כל שורת `file_objects` שאינה ב-bucket הדיפולטיבי – כולל כל תמונות פריט הייחוס (ב-`REFERENCE_BUCKET`); `:64` רושם מחדש `items/`/`reports/` כ-`file_manager` בלי entity id והצרופה נעלמת מהפריט.
- נתונים | מדווח | העברה/שינוי שם תיקייה (`api/files/route.ts:118-139`) מעתיקה ומוחקת אובייקט-אובייקט בלי rollback ודורסת בשקט שם קיים – כשל באמצע משאיר שני עצים חצויים.
- נתונים | מדווח | `storage.statObject` הופך כל שגיאת MinIO ל"לא נמצא" – בתקלה המשתמש רואה "הקובץ לא נמצא / ההעלאה לא הושלמה" במקום שגיאת שרת.
- נתונים | אומת | `lib/testing/submit-result.ts:653-667` (`calc_error`, recheck-1 #22): כל שגיאה בבחירת העמדה הבאה גורמת לפריט להיסגר כ"הסתיים" במקום rollback (500).
- נתונים | אומת | `submit-result.ts:565-573` (ישן `results/route.ts:888-892,983-987`, #20/B6): שני מסלולי "אין המשך" מציבים `current_status=3, finished_at` בלי `is_finished=true` – קוראים שבודקים רק `is_finished` רואים אותם כלא גמורים.
- נתונים | אומת | `submit-result.ts:482-513` (ישן `results/route.ts:594-617/936-955`, `535-557/757-774`, #23/B7): העמדה הבאה (ועמדת המחקר) נבחרות פעמיים בכל התקדמות עם שתי מדיניות שונות; נכתבות שתי הערות `station_reassigned` והשנייה גוברת; `step-back` משתמש רק בראשונה.
- נתונים | מדווח | `results/route.ts:706-710` (B12): כל תוצאה מחזירה את העמדה ל"פנויה" (status 2), גם תוצאה של פריט בודד באשף מארז כשהמארז עדיין בבדיקה שם; `findBestStation` מעדיף פנויות.
- נתונים | מדווח | `release-test/route.ts:64,106`, `start-release.ts:126`, `group.ts:72`: `queue_start_time = NOW()` (שעון/אזור זמן של ה-DB) בעוד שאר הכותבים משתמשים בשעון האפליקציה UTC – אם ה-DB לא ב-UTC טיימרי ההמתנה יוזזו.
- נתונים | מדווח | `submit-result.ts`: בחירת ענף לפי `returnToRoute === true` אבל בדיקות המשך לפי truthiness (דגל לא-בוליאני על פריט מחקר מקבל עמדה של מסלול רגיל); `WorkerID`/`WorkerName` לא נבדקים (`""` נשמר כשם); `stationId` ב-start/release/results לא נבדק (מחרוזת → 500); ה-catch של המלצת המחקר "best-effort" לא באמת מציל – SELECT שנכשל מבטל את ה-transaction.
- נתונים | מדווח | `lib/packages/item-writes.ts:193-207` `deleteItem` בודק "הפריט האחרון במארז" והילדים מחוץ ל-transaction שלו.
- נתונים | מדווח | `PATCH api/packages/[id]/route.ts:73-84` משנה מק"ט/דגם/יצרן של המארז אבל לא של הפריטים שבו (intake ו-cert-row כן מעתיקים) – המארז והפריטים אינם תואמים אחרי עריכה בלוח/בדיאלוג.
- נתונים | מדווח | `api/items/[id]/route.ts:352` שינוי סוג פריט תמיד על מסלול 1 (intake בוחר מסלול ברירת מחדל של הסוג/שורת התכולה) – הפריט עלול לנחות במסלול אחר או להיכשל בבדיקת התאמה; `EditItemDialog.tsx:188` מאפשר לשנות לקוח של פריט בתוך מארז בנפרד מהמארז (`PUT` לא בודק).
- נתונים | מדווח | `PUT api/items/[id]/route.ts:340-341` כותב `model`/`manufacturer_name` בלי trim ובלי קיצוץ ל-CHAR(50) – ערך ארוך נכשל ב-500 (עכשיו עם הודעת fallback עברית, אבל עדיין 500).
- נתונים | מדווח | תור/איתור/היסטוריית עמדה מחזירים ids של פריט כמספרי JSON (`Number(bigint)`) – id מעל 2^53 יאבד ספרות בדרך לדפדפן. (קריאת מדבקה כבר נעשית כטקסט: `idOfLabel` ב-`packages/ids.ts`.)
- נתונים | מדווח | משלוחים B2: `ShipmentSendPopup.tsx:453-493` – כששתי שורות חולקות סוג ומק"ט (היום נפוץ: שורה לכל שורת תעודה) השליחה נפתרת תמיד לשורה הראשונה ו"מקסימום 0" חוסם שליחה מאוחרת של שאר המארזים; `ShipmentHistoryPopup.tsx:161-169` מציג לכל שורה את כל הסכום.
- נתונים | מדווח | `shipments.shipment_sent_date` לא נכתב בזרימת השליחה הנוכחית (`shipment-history/route.ts:93` כותב `finished_at`) – "יצא ללקוח ב-…" בלוח המארזים (`lib/packages/read.ts:244,382`, `PackagesBoard.tsx:254,271`) תמיד ריק.
- נתונים | מדווח | `PUT api/shipments/[id]/route.ts:109-110` מאפס `sending_worker_id/name` בכל עריכה (טופס העריכה לא שולח אותם) – מוחק ערכי legacy; `POST api/shipments` (`route.ts:234`) מקבל גוף בלי שורות ו-`amount>0` ויוצר משלוח שאי אפשר לשמור; POC מעל 255 תווים → 500 כללי (`:` ללא בדיקה).
- נתונים | מדווח | `ShipmentUpdatePopup.tsx:265` תשובת dry-run שלא ניתן לקרוא נחשבת "אין שינוי בארגזים" והשמירה האמיתית ממשיכה בלי אישור; `ShipmentSendPopup.tsx:176-177` שגיאת רשת בטעינת תכולה מוצגת כ"אין תבנית תכולה" וחוסמת הדפסה בסיבה שגויה.
- נתונים | מדווח | `lib/packages/read.ts:246-247` `opened_at` = סיום שלב 1 האחרון, בעוד `:443` (ציר הזמן) לוקח את הראשון – אחרי איפוס מארז הרשימה והציר חולקים שעת פתיחה שונה.
- נתונים | מדווח | `items/read.ts:150-153` join על `test_stations_type … ANY(route_steps)` עם `LIMIT 1` – `test_type_desc` הוא סוג של שלב אקראי (אף לקוח לא קורא אותו); `api/items/[id]/route.ts:121-127` join פנימי מפיל שלב שחסרה לו שורת סוג והתוויות בדיאלוג/היסטוריה זזות.
- נתונים | מדווח | `api/settings/test-stations/[id]/route.ts:86` `(test_station_desc as string).trim()` – חוסר תיאור בעריכת עמדה → 500; `POST/PUT test-stations` לא בודקים טיפוסים; `reference-items-save.ts` `keepImageIds` מתעלם בשקט ממזהים פגומים ו-`item_type_id: 1.5` מגיע ל-Prisma (500); פילטרי `testing-routes` GET עם `parseInt` ("12abc" → 12).
- נתונים | מדווח | `lib/fix-sequence.ts:52-66` החלופה האחרונה `LIKE '%<idColumn>%'` (למשל `%id%` ל-customers) עלולה להזיז sequence של טבלה אחרת; בולעת כל שגיאה.
- נתונים | מדווח | `PackageReferenceDialog.tsx:201-202` כפתור הסגירה בכותרת סוגר באמצע שמירה (בלי הגנה) ומבטל object URLs של תמונות שעדיין עולות.
- נתונים | מדווח | פופאפ `PhotoStation`/`VerdictStation`/`TemplateStation` לא שומרים `SubmitID` יציב – ניסיון חוזר אחרי תשובה שאבדה פוגע ב-404 ("Item route not found or already finished") למרות שהתוצאה נשמרה.
- נתונים | מדווח | `fields/FieldRow.tsx:214-231` הסרת תמונת שדה לא מוחקת את הקובץ שנשמר (אין `useShotDiscard`) – פריט עם תמונה כזו לא יכול להיות מסומן "לא הגיע".
- נתונים | מדווח | שדות סריקת SKU בלי `typeAsUsKeyboard`: `stationKit.tsx:94` (`SkuScreen`), `referenceScan.tsx:178`, `packageTemplateParts.tsx:195`; גם `lib/hooks/useGlobalScanner.ts:77` (בונה את הקוד מ-`e.key`) ו-`app/testing/scan.tsx:172-186` – ברכב עברית סורק מקליד אותיות עבריות ל-SKU לטיני והמק"ט הלא נכון נשמר ונקרא חזרה כ-`last_sku`.
- נתונים | מדווח | כללי משקל סותרים: `PackageOpenWizard.tsx:63,98-105` מול `templateModel.ts:61-70` (משקל ייחוס 0 עובר באשף הקוד, "אין השוואה" בתבנית; סבילות 5% קבועה); `lookupRU` זורק משקלים ≤0 ו-`gramsOf` שומר אותם. `stationKit.tsx:92-100` `lookupRU` לא בודק `res.ok` – 500 נקרא כ"אין פריט ייחוס".
- נתונים | מדווח | אשפי המארז (פתיחה/סגירה, קוד ותבנית) מסיימים בלי עובד נבחר ושולחים `WorkerID` undefined (`PackageOpenWizard.tsx:237`, `PackageCloseWizard.tsx:145`); פופאפים של פריט מסרבים במקרה כזה.
- נתונים | מדווח | `ReportKit`/`generate.ts`: `countGeneralRoutes` (`catalog.ts:137-139`) לא סופר מסלול ששמר תבנית ריקה, בעוד `generate.ts:180-184` נותן לו את התבנית הכללית; `PUT templates/[routeId]` מקבל מסמך ריק (`route.ts:53`).
- נתונים | מדווח | `package-types/route.ts:56` שופט בריאות לפי מסלול ברירת המחדל בלבד, `contents/route.ts:61-75` לפי כל מסלולי הערכה – ערכה עם מסלול לא-ברירת-מחדל פגום "תקינה" ברשימה ועם אזהרה בעורך (שאלה: איזה כלל נכון).
- נתונים | מדווח | `referenceForm.ts:132,135` דורש משקל ושם, השרת (`reference-items-save.ts:75-98`) והפריטים הישנים לא (שאלה: איזה כלל נכון).
- נתונים | מדווח | דשבורד – מספרים: B-01 עמודת "ניסיון" בטאב פריטים איטיים (`lib/dashboard/format.ts:193-198`) בודקת `entry_reason` שה-ledger לא כותב אף פעם ולכן כל צעד שהועבר ע"י ה-reaper ונוסה שוב מוצג "N · חזרה"; B-04 קיפול שבועי בהיסטוריה (`HistoryOverlay.tsx:158-187`) לוקח יום אחרון/פרוסות של 7/ממוצע לא משוקלל במקום הכלל המתועד (`metrics/history-fold.ts:11-39`) – משנה מספרים; B-12 `waiting_for_package_items` מחושב ולא מוצג (`queries.ts:1388,1411`; `api-types.ts:266-279`) – מארזים שמחכים לפריטים נעלמים מרצועת התור ומונים לא מתחברים ל-`itemsInRoutes`; B-03 עקומת סיום משלוחים מתחילה יום אחד לפני חלון היסטוריה של אותו פריסט (תועד ב-`completionCurveRange`); B-05/B-06 מסננים (עמדה/סטטוס/עובד) נשמטים בשקט בטאב סוגי פריט, ו-KPI/סטטוס לא מציגים "מסננים שהתעלמו מהם" – מספרי "מסלולים שנסגרו" לא מסוננים בלי הודעה.
- נתונים | מדווח | בחירת תאריך מקומית של הדפדפן: `useStationQueue.ts:48` "הושלמו היום" נספר ממחצות בדפדפן ולא בשעון העסקי (W-B4); `ShipmentTable.tsx:183-188` מסנן תאריכים של משלוחים מוזז באזור זמן (`new Date("YYYY-MM-DD")` = חצות UTC) ומפיל משלוחי יום הסיום; `minioFileUtils.formatDate`, `files/page.tsx:51`, `users/page.tsx:101` מפרמטים בזמן הדפדפן ולא `Asia/Jerusalem`.
- נתונים | מדווח | B-14: שמירת הגדרות שעות עבודה יכולה לאבד rebuild של לוח השנה כשקיים נעילה (`work-calendar.ts:99-127`; נרפא רק ב-01:00); selfcheck מבצע self-heal תחת נעילה אחרת מ-rebuild-work-calendar ולכן לא מסונכרן איתו; DayEditorDialog מניח התחלה 07:00 לחצי יום (`resolveDay` משתמש בתבנית היום); `overrides GET` משתמש בחודש לפי שעון המארח ולא `businessDay()`.

### תצוגה

- תצוגה | אומת | 8-11 נקודות קצה של רשימות מחזירות `200 []` (או `{count:0}`) בכשל DB: `settings/{customers,item-status,package-types,reference-items,sources,test-station-status,test-stations,test-stations-type}`, `api/{customers,item-types,itemTypes,stations,statuses}`, ובבדיקות `testing/{items,stations,station-history,completed-today,blocked-packages,test-stations}` – המסך אומר "אין עדיין …" במקום שגיאה; פס השגיאה ו"נסה שוב" לא יכולים להופיע (מפר את כלל ה-spec §11 rule 12). ב-`stationId` חסר/שגוי יש עכשיו 400. (החלטה בסעיף 2.)
- תצוגה | אומת | `api/items/route.ts:92-95` מחזיר `[]` ו-`api/items/[id]/route.ts:241-246` מחזיר `{item:null}` בכשל – הדיאלוג מציג שלד לנצח ודף ההיסטוריה "פריט לא נמצא" גם בתקלת שרת.
- תצוגה | אומת | `EditItemDialog.tsx` (דף /items): לא ניתן לשנות סוג של פריט בתוך מארז שעבר פתיחה (409 `PACKAGE_RESET_REQUIRED` מוצג כשגיאה ו-`confirmPackageReset` לא נשלח); דורש serial לכל שורה אבל שורת מארז אין לה serial ו-`/api/items` לא שולח `package_id`/`is_package`, כך שהדיאלוג מתייחס לפריטים בארגז כעומדים בפני עצמם ואינו מציג התקדמות "—".
- תצוגה | אומת | "ניהול פריטים" בפלטה (`navigation.ts:113`, `CommandPalette.tsx:160`) מפנה ל-`/` שמפנה ל-`/packages`; `/items` לא ניתן להגעה מהפלטה; הפלטה (`NAV_DEFS`) לא מסוננת לפי תפקיד ומציעה לבודק "לוח ניהול" שיקפוץ ל-`/no-auth`.
- תצוגה | אומת | הודעות לינט שגויות בתבניות פופאפ: `popup-templates/validate.ts:292`/`:310` `SYSTEM_DUPLICATE` מציג "חייב להיות לבד בשלב" ו-`:333`/`:351` `ITEM_FLOW_NOT_HERE` מציג טקסט של עמדת פריט.
- תצוגה | אומת | תצוגת מקדימה של דוח חתימה מרפדת תמיד 14/16 מ"מ אבל PDF של תבנית ממוסגרת בלי שוליים (`build.ts:152`) – שורות נשברות אחרת; תחתית התבנית בעורך שונה מהמודפס (`ReportCanvas.tsx:509-516` מול `generate.ts:343-350`).
- תצוגה | מדווח | דאשבורד: B-02 צ'יפ "רשומות פתוחות בסחיפה: —" קבוע (`JobHealthStrip.tsx:88-91`); B-08 `?itemId=` נספר כמסנן בלי צ'יפ (חלקית תוקן – ראו סעיף 4: כבר לא נספר); B-09 "משלוחים פתוחים" גם כש"כלול נשלחו" דלוק (`DashboardShell.tsx:316-320`, `ShipmentsTab.tsx:132,160`); B-10 כשל בעקומת סיום מוצג כגרף ריק; `FILTER_LABEL_HE` עם `status` (לא נשלח) וללא `states` (נשלח) – הצ'יפ בטאב לקוחות מדפיס "states"; טווחי `recordDetail` ברשימת "החודש" בלי `<Bdi>` (RTL יכול להתהפך); `CustomerOption.code` לא קיים בחוט (`customer_code`).
- תצוגה | מדווח | טקסט "16 ספרות" במדבקת מארז (`PackageScanIntakeDialog.tsx:80/87`) – מזהים חדשים 15 ספרות (`ID_TOTAL_DIGITS`).
- תצוגה | מדווח | הצעת "הוסף פריט" למארז בשלב 1 במחקר/ממתין למחקר (`PackageRow.tsx:21`, `PackageEditDialog.tsx:87`) והשרת מסרב (`create-package.ts:396-397` רק סטטוס 1|2); עריכה/מחיקה מוצעות למארז במשלוח שנשלח (דף המארז) בעוד הלוח מסתיר והשרת לא מסרב.
- תצוגה | מדווח | `PackageScanIntakeDialog.tsx:118` נסגר באמצע ריצת סריקה (Escape/רקע) – מדבקות שנותרו בתור נשלחות אחרי הסגירה ו"בטל" לא נראה; `PackageRow.tsx:139-143,172` מחיקת הפריט האחרון מהלוח מציגה 409 גולמי (בדיאלוג יש `LastItemDialog`).
- תצוגה | מדווח | `ItemReportControl` מציג "טוען את הדוח…" לנצח כשהתצוגה המקדימה נכשלה; "הכל נשמר בזמן אמת" שקר באשפי סגירה ובעיקר בפתיחה (`PackageCloseWizard.tsx:194`, `TemplatePackageClosing.tsx:350`, `PackageOpenWizard.tsx:345`, `TemplatePackageOpening.tsx:467`).
- תצוגה | מדווח | `PopUpTestDialog` וארבעת האשפים מציגים טקסט אנגלי טכני `FIELDS_INVALID`/`DETAILS_TOO_LARGE`; `Verdict/Photo/TemplateStation` מסתירים כל סירוב שאינו שדה מאחורי טקסט כללי; `PhotoStation.tsx:50-63` טעינת סוגי תמונות שנכשלה לא מנסה שוב באותו mount וכל צילום נקרא ככשל.
- תצוגה | מדווח | W-B5/B14: פריטים בודדים בעמדה ברמת מארז לא מקבלים `hasWizard`/ribbon – "התחל בדיקה" מתחיל בלי להפתח הפופאפ; W-B6 סריקה גלובלית לפני שסוגי העמדה נטענו נכשלת ב"סוג העמדה של הפריט לא נמצא" (`scan.tsx:74`).
- תצוגה | מדווח | K-B4 שורת תבנית עם כמות 0 נספרת כ-0 פריטים בדיאלוג החזרה אך הטבעת מארז שמה לפחות 1 – סכום הפריטים בטופס המשלוח יוצא קצר (`ShipmentSendPopup:167`); K-B9 מסנן "הסתר גמורים" ומונה ב-/items בודקים Done בלבד בעוד KPI "הושלמו" סופר גם `is_finished`.
- תצוגה | מדווח | הפריסט `settings/testing-routes`: B1 צ'יפים של ספרייה שמצביעים על מסלול פריט פותחים מסך ריק ושומרים אותו כ"מסלול אחרון" (`lib/libraryModel.ts:269-278`, `page.tsx:220-224`); B2 "פתח את {kit}" תמיד פותח מסלול 1 (`page.tsx:500`); B3/B4 "עדכן את כולם" (`lib/useLibrary.ts:265-273`) ושמירת הצעדים (`RouteStepsTab.tsx:411`) מתעלמים מתוצאת `flushAll()` ועלולים לאבד עריכות שלא נשמרו; B6 שגיאה ללא תא נקראת מהקונפיג בשרת (`lib/mapModel.ts:733-735`).
- תצוגה | מדווח | קבצים: B8 אישור מחיקה אומר "לצמיתות" (`ItemFilesPanel.tsx:556`) אבל זו מחיקה רכה ו-MinIO שומר גרסה; B9 `saveSignature` קורא לכל קובץ `.png` (`file-utils.ts:52`, `shipment-signatures.ts:41`) גם ל-JPEG; B11 `docKey` ב-OnlyOffice (`config:120`) מכיל `/` (רדום).
- תצוגה | מדווח | תחזוקה זעירה: דגל `id="pv-title"` כפול ב-`WorkerPreviewCard`; `APPLY_MODES` מוגדר פעמיים (`admin-types.ts:39`, `admin.ts:96`); `lastResponsive` מול `sx` נותנים כיוון שונה ל-`Stack direction={{md:"row",xs:"column"}}` (רדום); `TONE_DOT` ב-2 מקומות עם מפתחות שונים; `Autocomplete.tsx:364` timer של blur לא מנוקה (דורש אישורך); סף URL objects לתמונות לא מבוטלים (`shots.ts:49`, `FieldRow.tsx:221`).

### קטן

- קטן | מדווח | `parent_serial_no`/`has_children`/`connected_items` מחושבים לכל שורת תור ב-`api/testing/items/route.ts:97,108-123` ואף לקוח לא קורא אותם (עלות ביצועים); `api/testing/stations/types` כפול ל-`/api/testing/stations` (רק הדשבורד קורא).
- קטן | מדווח | `REPORT_SIGN_TEXT.cannotSign` מקודד שמות תפקידים (טקסט גלוי); `PACKAGE_TYPE_LOCKED` עם שני טקסטים עבריים (PATCH מול PUT); `CommandPalette.tsx:417-418` עם מספרי סטטוס עמדה 1,3 משלו.
- קטן | מדווח | `scripts/seed-dev-dataset.mjs:774` שולח `shipment_items: []` (נדחה ב-400 ונבלע) ו-`:1052` POST ל-`/api/items` (410) – מסלולי הזריעה האלה לא רצים; תיעוד/סקריפטים מצביעים על נתיבים ישנים (`docs/packages/PLAN.md:68`, `scripts/prod-reference-images-by-station/2-…sql:51`, `src/lib/directUpload/shared.ts:109`, `prod-deploy/app-server/scripts/8-register-tasks.ps1:32` → `src/app/lib/jobs/jobRun.ts`, כ-22 נתיבים מיושנים ב-`docs/`), nginx `entrypoint.sh`/`nginx.conf` עדיין מייצרים `/config.js` שאינו בשימוש.
- קטן | מדווח | שמות שיטות עמדות בבדיקות קיימות (`step-uids.test` הערה, `validate.test` `optionEmptyMapText("מכניקה", …)`) – מפר את כלל הסודיות שלך; לא נגעו.
- קטן | מדווח | `reference-items-save` suite `before` מתנגש ב-sequence של item_types אחרי fixtures עם ids מפורשים; סוויטת freeze של דוח פריט (fire-and-forget `registerFileObject`) מציגה flakiness (נתקן בסוויטה אך המירוץ באפליקציה קיים).

## 2. החלטות שמחכות לך

- הוספת בדיקות תפקיד לכ-25 כתיבות ה-settings, למחיקת מארז/PATCH/items/contents/cert-row, ול-`/api/files` – היום כל משתמש מחובר יכול; ישנה התנהגות (משתמשי מחסן/משאן יקבלו 403).
- הגבלת מנהל הקבצים (`/api/files`) לשורש משלו/prefix לא-מערכתי – יחסום גישה לצרופות ולחתימות, אבל קבצים קיימים בשורש ה-bucket ידרשו מיגרציה.
- תשובת `[]`/`{count:0}` בכשל ב-GETs (settings lists, `/api/items`, בדיקות, itemTypes) → שגיאה אמיתית: מסכים יציגו פס שגיאה ו"נסה שוב" במקום "אין עדיין …" (ישנה גם אופן ההתנהגות של מסך הבדיקות, ST-1).
- העברת פופאפים של קוד (B-F2b) דרך מנוע התבניות – סיכון גבוה, משנה מסלולי נתונים שמורים.
- `/packages/old` והסימון מחדש של "converted box" (F Fix 10) – נשאר כמו שהיה.
- `apiFetch`: ניסיון חוזר לפני שמאמינים לדוח terminal (`client.ts:44-48`, `retryOnUnauthorized`) – ישנה התנהגות auth.
- `Autocomplete.tsx`: ניקוי timer ה-blur (B17, `:364`) וה-freeze של `ChoiceAutocomplete` – הקובץ נעול בלי אישור שלך.
- `item-status` ו-`test-station-status`: הסרת create/delete בהגדרות (ה-ids קבועים בקוד – ItemStatus 1–6 ו-StationStatus; רק שינוי שם בטוח) – מסיר פונקציה קיימת.
- תקרת "3 שנים" (פריסט `3years`) בדיאלוג היסטוריית הדשבורד – החלטה נשארה פתוחה בדוח U ("Fix 4").
- שאריות auth מ-skill ה-keycloak: pass-through של Server Action ב-middleware והנימוק ב-`require-user`, `current-user.ts`, והענפים של מחרוזת-תפקיד-יחיד ב-`withAuth`/`require-user` – שלושתם לא הוסרו.
- Tailwind: ייבוא `@import "tailwindcss"` נשאר (יש גם Preflight; אין מחלקת Tailwind בשימוש) – הסרה = סיכון בינוני לכל הדפים; בלוק `@theme` כבר הוסר.
- מיזוגים גלויים בערכת ה-UI (משנים מראה): שלוש "נקודת סטטוס" (7px/6px, ריפוד שונה), `Segmented` של הדשבורד מול `ToggleButtonGroup`, `.sh-btn` מול `.pkg-pill`, `Notice` ו-snackbars של `ReportTemplatesPanel` → טוסט הערכה (דורש וריאנט "plain"), `TagTone "danger"`→`"error"`, `RoleInfoDrawer` → Dialog של הערכה, `CommandPalette` → `ui/Dialog` (מוסיף focus trap), טוסט השגיאה של `/testing` (32px, 8 שניות) → טוסט הערכה.
- טקסט לא מאושר: התווית החדשה "התפוקה היומית" (`SOURCE_LABEL_HE.workThroughput` ב-`lib/dashboard/format.ts`); כל טקסטי הכשל העבריים החדשים (סעיף 3); "התווית של `StatusTrendChart`" נשארה קשיחה ("ממתין" מול "בתור").
- ה-"כלל מי פועל" בדף הבדיקות (מי שאין לו `employeeNumber` ואינו מנהל רשאי לבחור כל עובד) לעומת משלוחים – נשמר כפי שהיה.
- בחירת עמדה כפולה (B7/#23): איזו מדיניות רצויה (פנויה-קודם או הכי פחות עמוסה) ופיסת `markFinished=false` ב-#11(b)/(c) (#20).
- הסרת מסלולי "שגיאה-להצלחה" ב-`submit-result` (#18/#19/#21/#22) והשעון השני שלו – שגיאות פנימיות יהפכו ל-500 במקום פריט שנסגר.
- "השרת קורא עובדות מהשורה הנעולה" (recheck-1 F3) – מתקנת את `QueueStartTime` אבל משנה חותמות זמן שמורות ב-`item_route_history`.
- כלל אחד לפרטי ארגז ופריט (recheck-1 F8): האם עריכת ארגז מעתיקה לפריטים, והאם `POST /api/packages/[id]/items` רשאי לקבל פרטים מהלקוח (P-B4).
- בריאות ערכת-מארז ברשימה מול בעורך, וטופס ייחוס מחמיר מהשרת (שתי שאלות פתוחות מ-C: BUG 8/9).
- סטיות מבנה API שנדחו (חוק "JSON shape"): הסרת שדות לא נקראים (`in_work_items`, `valid_items`, `valid_amount`, `item_type_id/desc` legacy, `parent_serial_no`/`has_children`/`connected_items`, `images`/`coverUrl`, `SentAt`/`ReturnAt`), `POST /api/items` 410, נקודת קצה e2e בלבד, `X-Report-*`, `PhotoField.photo_type`.
- שינויי סטטוס/בקשות שנדחו ב-shipments (F12 #3–#7): `DELETE shipments/[id]` ממפה `PackageError` ל-400, `POST` עם `amount` בלי שורות, `byLineId=false`, עריכה-לשליחה, שורת שליחה בלי סוג/כמות מדולגת; ו-#9 (`items/read.ts` בולע כשל בתצוגת מארז), #13 (retype מדלג בשקט על בדיקת התאמת מסלול).
- שעון DB `NOW()` מול שעון אפליקציה בשחרור לתור (F10) – איחוד עלול להזיז זמנים שמורים.
- Keycloak: האם 502 הוא הקוד הנכון (סעיף 3), ו-`getBruteForceStatus`/`getUserRealmRoles` שמחזירים ערך "בטוח" בכשל (ראו סעיף 1).
- נשארו: `overrides GET` (חודש ברירת מחדל) ו-holidays (טווח אופציונלי) – שינוי מה שבקשה קיימת מקבלת.

## 3. שינויי התנהגות שנכנסו ברפקטור

(משתמש ירגיש? כן = נראה במסך/בזרימה רגילה, כשל = רק במסלול שגיאה/קלט חריג, לא = לוגים/פנימי)

- כשל | 500 לא מחזיר טקסט שגיאה גולמי (Prisma/Postgres) לדפדפן אלא `{error: <fallback>}` – packages/items/shipments/templates, settings POST/PUT, reference-items, results/start-test, dashboard `history` (`details`), cron ו-`health/jobs`/`health/schema` (`message`).
- כשל | JSON פגום או גוף שאינו אובייקט → 400 `{error:"Body must be a JSON object", code:"INVALID_BODY"}` (settings CRUD, testing-routes, work-hours, users, uploads, reference-items, item-report sign/previews, results/start/release; כל אלה היו crash/500).
- כשל | מזהים לא תקינים בנתיב/פרמטר ("abc", "1.5", 0, "1e3", " 12", מעל int4/int8) → 400/404 במקום 500 או שורה שגויה ("12abc" היה משלוח 12); ids מעל 2^53 שומרים כל ספרה; `stationId` חסר/שגוי ב-testing items/station-history/completed-today/blocked-packages → 400 (היה `[]`); `reference-items?itemTypeId=1.5` מציג הכל.
- כשל | כשלי Keycloak (users API וספריית עובדים) → 502 + הודעת fallback עברית במקום סטטוס/טקסט אנגלי של Keycloak; 401/403 של Keycloak לא מועברים עוד כ-401/403 של האפליקציה.
- כן | שם לקוח כפול נדחה גם ב-API (`code:"NAME_TAKEN"`); שינוי שם לשם קיים → 400 ולא 500; `uniqueName` משווה trim+lower (בדיקות כפילות על CHAR(50) מעולם לא עבדו); `seed-dev-dataset.mjs` מתאים לקוחות לפי קוד וסובל סירוב.
- כן | רשימות settings/משתמשים: React Query – מציג מטמון מיד ומרענן ברקע, refetch בפוקוס חלון, retry אחד; בורר-רשימות מתרעננים אחרי כתיבת settings באותה לשונית; טעינה כושלת מציגה פס שגיאה אחרי ניסיון אחד.
- כן | טוסטים הם ה-Toaster הכללי (שורדים ניווט; טוסט שני מאתחל את 4 שניות); אישורי מחיקה (`EditItemDialog.tsx:283`, `TextEditorModal.tsx:215`) כבר לא נגררים בכותרת.
- כן | דשבורד שולח תאריכי לוח (`YYYY-MM-DD`) ולא ISO: אותם מספרים באסיה/ירושלים; חלון שחוצה את מעבר השעון באוקטובר משווה 7 ימים עם 7 (היה 8); `?itemId=` לא נספר כמסנן; id ≤0 ב-URL = אין מסנן; `itemSerial` אחרי `workerId` בסדר הצ'יפים; ב-1100px מדויקים המגירה עובדת; כל רשימת בורר נטענת בנפרד.
- כן | `/testing`: התחלה אחת בכל פעם (לחיצה שנייה בזמן start-test מתעלמת); `ItemCard` בלי מצב busy.
- כן | טקסטי כשל באנגלית/גולמיים → fallback עברי קיים במסכים: START_FAILED_ITEM/PACKAGE, "שגיאה באיתור הפריט", החזרה לעמדה קודמת, "שגיאה בשמירת תוצאת בדיקה", פתיחת/סגירת מארז, "שמירת תכולת המארז נכשלה", מחיקת/עריכת מארז, "עדכון/מחיקת הפריט נכשל", ItemFilesPanel, TextEditorModal, העלאת קובץ, תצוגה מקדימה של תבנית דוח, ConfirmDialog של מחיקה ב-CrudTable ("המחיקה נכשלה. ייתכן שהרשומה בשימוש…"), StationTypesTable/StationsTable/משתמשים ("הפעולה נכשלה. נסה שוב.") – רשימת האתרים ב-`done-R2-U.md` ו-`done-R2-W.md`.
- כשל | שרת/רשת: תשובת 2xx שאינה JSON נקראת כ-`{}` (איתור, היסטוריית עמדה, שמירת תכולה, סטטוס דוח); פופאפ TemplateEditor: שגיאת שרת ריקה מציגה fallback.
- כשל | `POST /api/packages/[id]/items`: `itemType:""` → 400 "יש למלא סוג ומספר סריאלי" (היה 404); `routeNumber` לא מספרי לוקח את מסלול התבנית (היה 500); `createPackage` בלי `routeNumber` לוקח מסלול ברירת מחדל של הסוג (היה תמיד 1).
- כשל | שער הסכימה (503 כשה-DB מאחור) חל גם על `PUT/DELETE /api/items/[id]` ו-`DELETE /api/packages/[id]`.
- כשל | start-test/release-test: `itemId` לא מספרי יחד עם עמדה לא קיימת → 500 במקום 404; גוף `ItemID` עם אפסים מובילים ("007") מפתח אירועים לפי "7"; actor: id פעולה שאינו UUID → 400 (היה נשמר/מוחלף); `WorkerID`/`WorkerName` ב-results נבדקים בטיפוס.
- כשל | ליצירת תיקייה בקבצים: מחיקת `/` מובילה, `\`→`/`, `..` נדחה, `"/"` → 400; חתימות משלוח מקבלות רק PNG/JPEG/WebP/SVG; שמות קבצי חתימה `<kind>_<ms>_<8 chars>.png`; `.svg` ללא סוג שמור מוגש כ-`image/svg+xml`; config של שדות שנכשל מחוץ ל-ShapeError זורק בקוד המקור של הדוח; שחזור דפדפן מת: ניסיון `newPage` אחד.
- כשל | שמות חלקי מפתח: מפתח הנעילה המייעצת של תעודה כפולה `shipment:CODE|cust` (היה `:`), `SHIPMENT_DUPLICATE` סדר מפתחות `{error,code,existing}`; טיוטת route-steps נחתמת ב-`now()` של ה-DB; קבוצות תמונה מקבלות `max(sort_order)+1`; לוגו כותרת הוא emblem אם הנתיב `/`; סדר שדות בדוח מזהה רכיבי תבנית לפי תבנית `k_` מלאה.
- כשל | `kpis` שולח גם `X-Metrics-Ignored-Filters`; `completion-history` בלי תאריכים: 400 "startDate and endDate are required" ו-`grain` לא נקרא; `showAllHistory=true` בלי `scope` מתעלמים; `history [id]` "1.5"/"0" → 400; בקשה עם id ותאריכים שגויים מקבלת קודם 400 של תאריכים.
- כן | החלקים בלוח זמני: "נטו" של הפסקה מחוץ לשעות עבודה תואם ל-ledger; תצוגה מקדימה לא מנכה הפסקה מחוץ לשעות; שעון יחסי של `RouteFieldsHeader`/meta של סט שדות מתקתק מהטעינה.
- כן | חיפוש: כותרת עמוד/סרגל צד מתאימים על גבול מקטע ("/testingX" כבר לא "/testing"); `/api/logout` ללא issuer → `/login`; `/api/health/jobs` מוגן גם ב-middleware.
- כן | הגדרות מסלולים: לחיצה על פריט מושבת בתפריט ערכה לא מפעילה onClick; radiogroups מתעלמים מחיצים עם Alt/Ctrl/Meta; טוסט שמירת צעדים הוא הכללי; שמות עמדות בלשונית צעדים מ-fields context; סט "פרסם" מרשימה משותפת; מילוי שחוצה מגבלת 60 שדות וחוזר על שם נספר כדילוג בחלוקה אחרת בטוסט; סמן הגרירה של רשימת אפשרויות מתנקה ביציאה.
- כן | חבילות/פריטים/משלוחים: הלוח מסמן "לא עדכני" ומרענן אחרי עריכה; עמוד מארז מציג מטמון ואז רענון; `PackageEditDialog` משתמש ברשימת סוגים מטמון 5 דקות; קישורי קבצי היסטוריה כוללים base path; `/items` lookups במטמון 5 דקות; "נסה שוב" מריץ מחדש רק את הרשימה; ברירת מחדל של תאריך הטופס "שליחה" לפי שעון ישראל; שורת makat ריקה בפופאפ שליחה נקראת כ"אין makat"; כשל ספריית עובדים נרשם בלוג ושמות נשארים ריקים.
- כן | אשפים: אלמנטים נסגרים מחזיקים את השורות האחרונות בזמן אנימציית סגירה (`StationHistoryDialog`, `ShipmentBarcodesDialog`); פריטי סוגי פריט באשף התכולה מ-`useItemTypes` (מטמון 5 דקות); פתיחת פופאפ קוד מציג את כל התמונות שנבחרו ביחד.
- לא | לוגים בלבד – שגיאות שנבלעו עכשיו `console.error`, 500 נרשם דרך `errorResponse`, ה-reaper מעביר reason כ-bind parameter, ביטול שלוש ענפי איזון עומסים בלתי ניתנים להשגה, קריאת בדיקות אחרונה/עמדה באותה `route_steps`.
- לא | Layering/מבנה: `src/types/index.ts` פוצל ל-`contract.ts` לפי בעלים; `/api/testing-routes`, `items/[id]/recommend-station`, `GET shipments/[id]/items` נמחקו (אין קוראים); `prisma` → `src/lib/db.ts`; `page.tsx` של `/testing` 1,932 → 454 שורות.

## 4. תוקן בדרך

- C BUG 4: JSON פגום כבר לא מפיל 7 handlers של POST (settings) – 400 במקום unhandled rejection.
- C BUG 5: כשל DB/MinIO בבדיקת סוג עמדה או `verifyUploaded` בשמירת reference ו-presign כבר לא מוצג כ-400 עם הודעה גולמית; 500 לא מדליף טקסט פנימי.
- C BUG 11 / shipments B9 / items 10 / recheck-1 BigInt ו-F6: ids לא תקינים בנתיבים (`abc`, 1.5, מעל int4/int8) כבר לא נותנים 500/NaN או שורה שגויה.
- C BUG 12 / recheck-4 bug 12 / recheck-2 #12: שינוי שם לשם קיים (item-status, sources, test-station-status, stations, station-types) → 400 עברי ולא 500; בדיקת כפילות על CHAR(50) עובדת (הייתה לא תופסת רעפים רווחים וגיוון אותיות).
- D B-13 / G B15: 500 בנתיבי היסטוריית דשבורד, cron ו-health ובנתיבי `packages` כבר לא מדליפים טקסט שגיאה של DB.
- D B-11: "נטו" של הגדרות שעות עבודה עם הפסקה מחוץ לשעות עבודה תואם עכשיו את שעון ה-ledger (כלל `workingWindows` אחד).
- D (על הדרך): חלון שחוצה את מעבר השעון באוקטובר השווה 7 ימים מול 8 במגמת "התקופה הקודמת" – תוקן ע"י תאריכי לוח.
- recheck-4 bug 3 / D B-08 (חלקי): `?itemId=` ב-URL כבר לא נספר כמסנן פעיל (השרת עדיין מתעלם ממנו).
- recheck-4 bug 4: ב-1100px בדיוק מגירת מסנני הדשבורד עובדת (פיצול 1099/1100 הוסר).
- recheck-4 bug 5: אחרי שינוי customers/sources/item types/package types/stations/station types ב-settings הבוררים באותה לשונית מתרעננים (עד 5 דקות מיושנים לפני כן); K-B6: שמירת/מחיקת משלוח מרעננת את רשימת `["shipments"]`, ושליחה מרעננת את חלון ההיסטוריה שלו.
- recheck-4 bug 2 / W-B2 / K-B8: מחיקת רשומה בשימוש ב-CrudTable ו-start-test שנדחה (מישהו אחר לקח) וכשלי רשת ("Failed to fetch") מציגים עכשיו fallback עברי ולא אנגלית.
- W-B3: לחיצה כפולה על "התחל בדיקה" כבר לא מתחילה פעמיים (דגל busy אחד).
- G B7: `keycloak-admin` משתמש ב-`||` כמו `auth.ts` – `KEYCLOAK_INTERNAL_ISSUER` ריק נופל ל-issuer הציבורי; G B14: `StationsTable` בודק `ok` ומערך – אין קריסת רינדור על גוף אובייקט.
- E B4 (ו-G B12): `TextEditorModal`/`OnlyOfficeEditorModal` עוברים דרך `apiFetch`/`getJson` – refresh שקט אחרי פקיעת access token ו-`withBasePath`.
- recheck-2 #3, #6, #13 + #16 (חלקי): reference ids 1.5/מעל int4 → 400; מזהי דוח פריט מעל int8 → 400; ids של work-hours מעל int4 → 400 וקריאה בלי try ב-`overrides/[id]/route.ts:19` מטופלת.
- B8 (popups): תבנית הפופאפ בעורך הגדרות מעוצבת גם בטעינה ישירה (כל פופאפ מביא ה-CSS שלו).
- F P30 / recheck-1: `routeNumber` לא מספרי ב-`POST …/items` ולא 500; `createPackage` בלי `routeNumber` לוקח את מסלול ברירת המחדל של הסוג.
- B3 הצילום המרובה: אשף פתיחת הקוד הראה רק את הצילום האחרון מבין כמה שנבחרו ביחד – כל התמונות מוצגות עכשיו.
- I (history-page): קישורי קבצים בהיסטוריה כוללים base path (טעות ב-prefix כשיש basePath).
- B-07 (חלקי): למפת התוויות יש עכשיו ערך ל-`workThroughput` (טקסט לא מאושר, ראו סעיף 2).
- W Behavior: מירוץ ה-`registerFileObject` בסוויטת freeze של דוח – הסוויטה מחכה לשורה (תיקון בדיקה בלבד).
