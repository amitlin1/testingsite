-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "poc_details" VARCHAR(255);

-- AlterTable
ALTER TABLE "workers" ADD COLUMN     "stokekeeper" BOOLEAN NOT NULL DEFAULT false;
