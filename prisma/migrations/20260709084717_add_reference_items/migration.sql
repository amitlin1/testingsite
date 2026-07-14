-- CreateTable
CREATE TABLE "reference_items" (
    "reference_item_id" SERIAL NOT NULL,
    "item_type_id" INTEGER NOT NULL,
    "manufacturer_sku" VARCHAR(255) NOT NULL,
    "manufacturer" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "notes" TEXT,
    "primary_image_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("reference_item_id")
);

-- CreateTable
CREATE TABLE "reference_item_images" (
    "reference_item_image_id" SERIAL NOT NULL,
    "reference_item_id" INTEGER NOT NULL,
    "bucket" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(255),
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_item_images_pkey" PRIMARY KEY ("reference_item_image_id")
);

-- CreateIndex
CREATE INDEX "idx_reference_items_item_type" ON "reference_items"("item_type_id");

-- CreateIndex
CREATE INDEX "idx_reference_items_sku" ON "reference_items"("manufacturer_sku");

-- CreateIndex
CREATE UNIQUE INDEX "reference_item_images_object_key_key" ON "reference_item_images"("object_key");

-- CreateIndex
CREATE INDEX "idx_reference_item_images_item" ON "reference_item_images"("reference_item_id");

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_item_type_id_fkey" FOREIGN KEY ("item_type_id") REFERENCES "item_types"("item_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reference_item_images" ADD CONSTRAINT "reference_item_images_reference_item_id_fkey" FOREIGN KEY ("reference_item_id") REFERENCES "reference_items"("reference_item_id") ON DELETE CASCADE ON UPDATE CASCADE;
