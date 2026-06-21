-- AlterTable: track who last modified each file_objects row
-- Mirrors created_by for first writes; advances on replace/edit.
ALTER TABLE "file_objects" ADD COLUMN "updated_by" VARCHAR(255);
