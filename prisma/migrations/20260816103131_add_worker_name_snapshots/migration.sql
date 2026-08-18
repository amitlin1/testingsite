-- AlterTable
ALTER TABLE "shipment_history" ADD COLUMN     "sending_worker_name" TEXT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "recieving_worker_name" TEXT,
ADD COLUMN     "sending_worker_name" TEXT;
