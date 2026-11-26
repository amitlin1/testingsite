-- ===========================================================================
--  אימות אחרי השדרוג למודל המארזים — קריאה בלבד
-- ===========================================================================
--  מריצים אחרי 2-upgrade-to-packages.sql, לפני שמעלים את האפליקציה.
--  הרצה ב-DBeaver: Alt+X (כל הקובץ). ב-psql: -f 3-verify-after-upgrade.sql
--
--  רק אחרי השדרוג: על סכימה ישנה (לפני 2-upgrade) הוא נכשל מיד, כי הוא
--  מתייחס לעמודות שעוד לא קיימות. זה תקין ולא אומר כלום על ה-DB.
--
--  הקובץ לא משנה כלום. הוא מחזיר טבלה אחת: בדיקה · ערך · ציפייה · מצב.
--  עמודת "מצב" חייבת להיות OK בכל השורות שאינן "מידע".
--  שורות "מידע" הן מספרים שצריך להסתכל עליהם, לא תנאי מעבר.
-- ===========================================================================
WITH checks AS (

  -- 1. גרסת הסכימה שהאפליקציה דורשת (ה-image החדש מסרב לכתוב מתחת ל-3)
  SELECT 1 AS ord, 'גרסת סכימת המטריקות' AS בדיקה,
         (SELECT version::text FROM metrics_schema_version WHERE id = 1) AS ערך,
         '3' AS ציפייה

  -- 2. שתי מיגרציות המארזים רשומות, כך ש-prisma migrate deploy לא יריץ אותן שוב:
  --    הראשית (20260915120000) וביטול manufacturer_sku (20261006120000).
  UNION ALL SELECT 2, 'רישום מיגרציות המארזים ב-_prisma_migrations',
         (SELECT count(*)::text FROM _prisma_migrations
           WHERE migration_name IN ('20260915120000_package_model',
                                    '20261006120000_package_contents_drop_manufacturer_sku')
             AND finished_at IS NOT NULL),
         '2'

  -- 2א. העמודה שבוטלה: אשף הפתיחה מוצא פריט ייחוס לפי סריקה, לא לפי SKU בתבנית
  UNION ALL SELECT 2.5, 'package_contents.manufacturer_sku בוטלה',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_name = 'package_contents' AND column_name = 'manufacturer_sku'), '0'

  -- 3. אובייקטי הסכימה החדשים
  UNION ALL SELECT 3, 'טבלת package_contents',
         CASE WHEN to_regclass('public.package_contents') IS NULL THEN 'חסרה' ELSE 'קיימת' END, 'קיימת'
  UNION ALL SELECT 4, 'עמודות המארז על items',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_name = 'items'
             AND column_name IN ('package_id','package_seq','package_next_seq','template_snapshot')), '4'
  UNION ALL SELECT 5, 'item_types.is_package',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_name = 'item_types' AND column_name = 'is_package'), '1'
  UNION ALL SELECT 6, 'test_stations_type.package_level',
         (SELECT count(*)::text FROM information_schema.columns
           WHERE table_name = 'test_stations_type' AND column_name = 'package_level'), '1'
  UNION ALL SELECT 7, 'סטטוס 6 — ממתין לפריטי המארז',
         (SELECT count(*)::text FROM item_status WHERE item_status_id = 6), '1'

  -- 4. עמדת פתיחה וסגירה מסומנות (בלעדיהן אין מסלול מארז תקין)
  UNION ALL SELECT 8, 'סוגי עמדה ברמת מארז (package_level)',
         (SELECT count(*)::text FROM test_stations_type WHERE package_level), '2 ומעלה'

  -- 5. שאריות מהמצב הישן
  UNION ALL SELECT 9, 'שורות מסלול יתומות',
         (SELECT count(*)::text FROM item_routes ir
           WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = ir.item_id)), '0'
  UNION ALL SELECT 10, 'קבוצות ישנות שלא הוסבו (package_id שלא מצביע למארז)',
         (SELECT count(*)::text FROM items c
           WHERE c.package_id IS NOT NULL AND c.package_id <> c.item_id
             AND NOT EXISTS (SELECT 1 FROM items b JOIN item_types t ON t.item_type_id = b.item_type_id
                              WHERE b.item_id = c.package_id AND t.is_package)), '0'

  -- 6. שלמות המארזים
  UNION ALL SELECT 11, 'מארזים ריקים (אסור)',
         (SELECT count(*)::text FROM items b JOIN item_types t ON t.item_type_id = b.item_type_id
           WHERE t.is_package
             AND NOT EXISTS (SELECT 1 FROM items c WHERE c.package_id = b.item_id AND c.item_id <> b.item_id)), '0'
  UNION ALL SELECT 12, 'מארזים שהמזהה שלהם לא בפורמט החדש (16 ספרות, מסתיים ב-00)',
         (SELECT count(*)::text FROM items b JOIN item_types t ON t.item_type_id = b.item_type_id
           WHERE t.is_package AND (length(b.item_id::text) <> 16 OR right(b.item_id::text, 2) <> '00')), '0'

  -- 7. הלדג'ר מכיר כל פריט (אחרת הדשבורד יראה חורים)
  UNION ALL SELECT 13, 'פריטים בלי אינטרוול פתוח בלדג''ר',
         (SELECT count(*)::text FROM items i
           WHERE NOT EXISTS (SELECT 1 FROM item_state_interval s
                              WHERE s.item_id = i.item_id AND s.closed_at IS NULL)), '0'

  -- 8. מידע: מה נוצר בפועל
  UNION ALL SELECT 14, 'מידע · מארזים',
         (SELECT count(*)::text FROM items b JOIN item_types t ON t.item_type_id = b.item_type_id WHERE t.is_package), 'מידע'
  UNION ALL SELECT 15, 'מידע · פריטים בתוך מארזים',
         (SELECT count(*)::text FROM items WHERE package_id IS NOT NULL AND package_id <> item_id), 'מידע'
  UNION ALL SELECT 16, 'מידע · סוגי מארז מוגדרים',
         (SELECT count(*)::text FROM item_types WHERE is_package), 'מידע'
  -- המיפוי ישן→חדש. רק קיום הטבלה נבדק כאן: שאילתה ישירה עליה נכשלת
  -- בפרסור כשהיא לא קיימת (DB שלא היו בו פריטים ישנים להסבה).
  UNION ALL SELECT 17, 'מידע · טבלת מיפוי המזהים legacy_id_map — המקור להדפסת מדבקות',
         CASE WHEN to_regclass('public.legacy_id_map') IS NULL THEN 'לא נוצרה (לא היו פריטים להסבה)' ELSE 'קיימת — ייצא אותה ל-CSV' END, 'מידע'
)
SELECT בדיקה, ערך, ציפייה,
       CASE
         WHEN ציפייה = 'מידע' THEN 'מידע'
         WHEN ציפייה = '2 ומעלה' THEN CASE WHEN ערך ~ '^\d+$' AND ערך::int >= 2 THEN 'OK' ELSE '!! לבדוק' END
         WHEN ערך IS NOT DISTINCT FROM ציפייה THEN 'OK'
         ELSE '!! לבדוק'
       END AS מצב
FROM checks
ORDER BY ord;
