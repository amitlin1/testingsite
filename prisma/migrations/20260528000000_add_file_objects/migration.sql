-- CreateTable: central registry of every object stored in MinIO.
-- MinIO holds the bytes; this table is the index/audit log.
CREATE TABLE "file_objects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bucket" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "file_name" VARCHAR(512) NOT NULL,
    "content_type" VARCHAR(255),
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "checksum_sha256" VARCHAR(64),
    "entity_type" VARCHAR(64),
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_object_key_key" ON "file_objects"("object_key");

-- CreateIndex
CREATE INDEX "idx_file_objects_entity" ON "file_objects"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_file_objects_status" ON "file_objects"("status");

-- CreateIndex
CREATE INDEX "idx_file_objects_created_at" ON "file_objects"("created_at");
