-- Photo types: global classification for photos ("package", "product", ...).
-- Screens speak the stable `code`; the numeric id stays a DB-internal detail.
-- Applies to BOTH reference images (reference_item_images.photo_type_id) and
-- worker-captured item photos (file_objects.metadata.photoType — no column
-- needed there, the JSONB metadata already carries per-file tags).

-- CreateTable
CREATE TABLE "photo_types" (
    "photo_type_id" SERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "photo_type_desc" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_types_pkey" PRIMARY KEY ("photo_type_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_types_code_key" ON "photo_types"("code");

-- Seed the initial types here (no seed script exists in this project) so every
-- environment gets identical codes even if the SERIAL ids differ.
INSERT INTO "photo_types" ("code", "photo_type_desc", "sort_order") VALUES
    ('package', 'צילום אריזה', 1),
    ('product', 'צילום פריט', 2);

-- Existing reference images predate classification (pre-production data, approved
-- for deletion). Clear the primary pointers first, then drop the rows and
-- soft-delete their file_objects registry entries. MinIO bytes are left behind
-- (versioned bucket) — acceptable for pre-production cleanup.
UPDATE "reference_items" SET "primary_image_id" = NULL;
UPDATE "file_objects"
   SET "status" = 'deleted', "deleted_at" = CURRENT_TIMESTAMP
 WHERE "entity_type" = 'reference_item_image';
DELETE FROM "reference_item_images";

-- AlterTable: every reference image must belong to a photo type.
ALTER TABLE "reference_item_images" ADD COLUMN "photo_type_id" INTEGER NOT NULL;

-- AddForeignKey (RESTRICT: a type that has images cannot be deleted)
ALTER TABLE "reference_item_images" ADD CONSTRAINT "reference_item_images_photo_type_id_fkey"
    FOREIGN KEY ("photo_type_id") REFERENCES "photo_types"("photo_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "idx_reference_item_images_type" ON "reference_item_images"("photo_type_id");
