-- =============================================================================
-- פריטים במארז מקבלים את פרטי המארז (שורת התעודה מהמשלוח) במקום פרטי התבנית
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261020150000_package_items_box_details/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: מודל המארזים מותקן (20260915120000_package_model רשומה),
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (נתונים בלבד): פריטים של מארז שעדיין בעמדת הפתיחה, שעוד לא הוזן
--      להם סריאלי, מקבלים את המק״ט / הדגם / היצרן / מספר היצרן של המארז. פריט
--      שכבר הוזן לו סריאלי, ומארז בלי פרטים משלו — לא משתנים. אין שינוי בטבלאות.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ אחרי העלאת ה-image החדש — ה-image הקודם עדיין נותן לפריטים
-- בקליטה את פרטי התבנית, וקליטה שתיעשה אחרי ההרצה ועד ההחלפה לא תתוקן.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-package-items-box-details.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261020150000_package_items_box_details') THEN
    RAISE EXCEPTION 'מיגרציית פרטי המארז לפריטים כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'מודל המארזים עוד לא הותקן (20260915120000_package_model חסרה) — להריץ קודם את scripts/prod-package-model. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- items: a box's items still at the opening, with no serial yet, take the
-- box's details (its shipment line's certificate row).
--
-- WHY: intake used to give an item its template line's makat / model /
-- manufacturer / manufacturer number when the line had any, and the box's only
-- when it had none. Items now always take the box's (lib/packages/boxes.ts
-- intakeBox); the template names types, quantities and routes only. Boxes
-- taken in before that still carry the template's details on items the
-- opening has not recorded yet — this moves them to the box's.
--
-- Only items whose contents are not recorded yet: no serial (the opening
-- records serials and details together, PUT /api/packages/[id]/contents), in a
-- box still at its opening step (route step 1, not finished). A box without
-- any details of its own leaves its items as they are.
--
-- Data only, no schema change. No metrics_schema_version bump: the ledger
-- does not read item details.
--
-- Idempotent: a second run finds nothing left to move.
-- ============================================================================

UPDATE "items" AS i
   SET "makat"             = b."makat",
       "model"             = b."model",
       "manufacturer_name" = b."manufacturer_name",
       "manufacturer_no"   = b."manufacturer_no"
  FROM "items" AS b
  JOIN "item_routes" AS r ON r."item_id" = b."item_id"
 WHERE i."package_id" = b."item_id"
   AND b."package_id" IS NULL
   AND r."current_route_step" = 1
   AND r."is_finished" = false
   AND NULLIF(TRIM(COALESCE(i."serial_no", '')), '') IS NULL
   AND COALESCE(NULLIF(TRIM(b."makat"), ''), NULLIF(TRIM(b."model"), ''),
                NULLIF(TRIM(b."manufacturer_name"), ''), NULLIF(TRIM(b."manufacturer_no"), '')) IS NOT NULL
   AND (i."makat", i."model", i."manufacturer_name", i."manufacturer_no")
       IS DISTINCT FROM (b."makat", b."model", b."manufacturer_name", b."manufacturer_no");

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '601151f9e6ba8b2252f1a3719867b36868dedfac89162c36c5a3c7aedb0f3add', now(), '20261020150000_package_items_box_details', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
-- פריטים בעמדת הפתיחה, בלי סריאלי, שפרטיהם עדיין שונים מפרטי המארז — צריך להיות 0.
SELECT 'פריטים שנשארו עם פרטים שונים מהמארז' AS בדיקה, count(*)::text AS תוצאה
  FROM items i
  JOIN items b ON b.item_id = i.package_id AND b.package_id IS NULL
  JOIN item_routes r ON r.item_id = b.item_id AND r.current_route_step = 1 AND NOT r.is_finished
 WHERE NULLIF(TRIM(COALESCE(i.serial_no, '')), '') IS NULL
   AND COALESCE(NULLIF(TRIM(b.makat), ''), NULLIF(TRIM(b.model), ''), NULLIF(TRIM(b.manufacturer_name), ''), NULLIF(TRIM(b.manufacturer_no), '')) IS NOT NULL
   AND (i.makat, i.model, i.manufacturer_name, i.manufacturer_no) IS DISTINCT FROM (b.makat, b.model, b.manufacturer_name, b.manufacturer_no)
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261020150000_package_items_box_details';
