-- ============================================================================
-- The general report template (docs/ITEM_REPORTS.md): every item gets a PDF
-- report. An item route with its own template (report_templates) uses it;
-- every other item route uses this one. A kit's box gets no report.
--
--   report_general_template  one row (id = 1): a Puck document, edited in
--                            מסלולי בדיקה → דוח PDF → "התבנית הכללית"
--
-- The row is seeded with the starting document (item-report/starter.ts
-- generalStarterTemplate): the item's particulars, the results table, every
-- station's detail with its photos (StepDetails), a summary and the approver's
-- signature. ON CONFLICT keeps a template that was already edited.
--
-- Additive only: a new table, nothing existing changes. The previous image
-- never reads it, so this runs any time before the new image. No
-- metrics_schema_version bump: the ledger does not read it.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "report_general_template" (
    "id"              SMALLINT     NOT NULL DEFAULT 1,
    "template"        JSONB        NOT NULL,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by"      VARCHAR(255),
    "updated_by_name" TEXT,
    CONSTRAINT "report_general_template_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_general_template_one_row" CHECK ("id" = 1)
);

INSERT INTO "report_general_template" ("id", "template", "updated_by_name")
VALUES (1, '{"root":{"props":{"header":{"show":true,"org":[{"text":"מדינת ישראל","b":true},{"text":"\nשם היחידה\nמעבדת הבדיקות"}],"meta":[{"text":"מספר: "},{"v":"item.item_id"},{"text":"\nתאריך: "},{"v":"report.generated_at"},{"text":"\nסימוכין: "},{"v":"item.shipment_code"}],"title":[{"text":"דוח בדיקה","b":true,"u":true}],"subtitle":[{"v":"item.item_type"},{"text":" · מק\"ט "},{"v":"item.makat"}],"rightLogo":"/report-logos/emblem-navy.png","leftLogo":"/report-logos/emblem-atom.jpg"},"footer":{"show":true,"text":"","textAlign":"center","pageNumbers":true,"pageNumberStyle":"of","pageNumberAlign":"center"},"border":"none","font":"david","classification":""}},"content":[{"type":"Section","props":{"id":"Section-general-1","heading":[{"text":"פרטי הפריט","b":true,"u":true}],"variant":"numbered","align":"right","width":"full"}},{"type":"DetailsTable","props":{"id":"DetailsTable-general-2","perRow":2,"rows":[{"label":"מספר פריט","value":[{"v":"item.item_id"}]},{"label":"מספר סידורי","value":[{"v":"item.serial_no"}]},{"label":"סוג פריט","value":[{"v":"item.item_type"}]},{"label":"מק\"ט","value":[{"v":"item.makat"}]},{"label":"דגם","value":[{"v":"item.model"}]},{"label":"יצרן","value":[{"v":"item.manufacturer_name"}]},{"label":"לקוח","value":[{"v":"item.customer"}]},{"label":"מספר משלוח","value":[{"v":"item.shipment_code"}]},{"label":"תאריך קליטה","value":[{"v":"item.created_at"}]},{"label":"תאריך סיום הבדיקות","value":[{"v":"item.finished_at"}]}],"width":"full"}},{"type":"Section","props":{"id":"Section-general-3","heading":[{"text":"תוצאות הבדיקות","b":true,"u":true}],"variant":"numbered","align":"right","width":"full"}},{"type":"ResultsTable","props":{"id":"ResultsTable-general-4","showFields":false,"showStation":true,"showWorker":true,"showDate":true,"showComments":true,"width":"full"}},{"type":"Section","props":{"id":"Section-general-5","heading":[{"text":"פירוט לפי עמדה","b":true,"u":true}],"variant":"numbered","align":"right","width":"full"}},{"type":"StepDetails","props":{"id":"StepDetails-general-6","showPhotos":true,"perRow":3,"height":45,"showComments":true,"width":"full"}},{"type":"Section","props":{"id":"Section-general-7","heading":[{"text":"סיכום","b":true,"u":true}],"variant":"numbered","align":"right","width":"full"}},{"type":"Text","props":{"id":"Text-general-8","content":[{"text":"הפריט עבר את שלבי מסלול הבדיקה המפורטים לעיל. תוצאה כוללת: "},{"v":"item.verdict"},{"text":"."}],"align":"justify","width":"full"}},{"type":"Section","props":{"id":"Section-general-9","heading":[{"text":"אישור","b":true,"u":true}],"variant":"numbered","align":"right","width":"full"}},{"type":"Spacer","props":{"id":"Spacer-general-10","height":6}},{"type":"Signature","props":{"id":"Signature-general-11","bind":"final","cells":[{"kind":"fullName","label":"שם ושם משפחה","text":"","weight":1},{"kind":"number","label":"מספר עובד","text":"","weight":1},{"kind":"date","label":"תאריך","text":"","weight":1},{"kind":"signature","label":"חתימה","text":"","weight":1}],"width":"full"}}],"zones":{}}'::jsonb, 'התבנית הכללית ההתחלתית')
ON CONFLICT ("id") DO NOTHING;
