-- שעות עבודה וחופשות: weekly template, single-date overrides, and the
-- department's internal-absence catalogue. National Israeli holidays are NOT
-- stored — they are computed from the Hebrew calendar at read time.

-- CreateTable
CREATE TABLE "weekday_defaults" (
    "weekday" INTEGER NOT NULL,
    "is_working" BOOLEAN NOT NULL DEFAULT true,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "break_start" VARCHAR(5),
    "break_end" VARCHAR(5),
    "updated_by" VARCHAR(255),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekday_defaults_pkey" PRIMARY KEY ("weekday")
);

-- CreateTable
CREATE TABLE "workday_overrides" (
    "id" SERIAL NOT NULL,
    "work_date" DATE NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "break_start" VARCHAR(5),
    "break_end" VARCHAR(5),
    "note" VARCHAR(500),
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workday_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_holidays" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type_id" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_half_day" BOOLEAN NOT NULL DEFAULT false,
    "half_day_end_time" VARCHAR(5),
    "note" VARCHAR(500),
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workday_overrides_work_date_key" ON "workday_overrides"("work_date");

-- CreateIndex
CREATE INDEX "idx_workday_overrides_date" ON "workday_overrides"("work_date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_types_name_key" ON "holiday_types"("name");

-- CreateIndex
CREATE INDEX "idx_department_holidays_range" ON "department_holidays"("start_date", "end_date");

-- AddForeignKey
ALTER TABLE "department_holidays" ADD CONSTRAINT "department_holidays_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "holiday_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Seed — the page is empty without it. Idempotent, so re-running is safe.
-- ============================================================================

-- Weekly template: ראשון–חמישי 07:00–15:35 with a 12:00–13:00 break (net 7h35m);
-- שישי and שבת are non-working (שישי may be opened per-day via an override).
INSERT INTO "weekday_defaults" ("weekday", "is_working", "start_time", "end_time", "break_start", "break_end") VALUES
    (0, true,  '07:00', '15:35', '12:00', '13:00'),
    (1, true,  '07:00', '15:35', '12:00', '13:00'),
    (2, true,  '07:00', '15:35', '12:00', '13:00'),
    (3, true,  '07:00', '15:35', '12:00', '13:00'),
    (4, true,  '07:00', '15:35', '12:00', '13:00'),
    (5, false, NULL, NULL, NULL, NULL),
    (6, false, NULL, NULL, NULL, NULL)
ON CONFLICT ("weekday") DO NOTHING;

-- Internal-absence categories only. National חגים are automatic (library-driven),
-- so no 'חג' type is seeded here.
INSERT INTO "holiday_types" ("name", "is_system") VALUES
    ('חופשה מרוכזת', true),
    ('יום גיבוש', true),
    ('השבתה', true)
ON CONFLICT ("name") DO NOTHING;
