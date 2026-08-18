-- DropForeignKey
ALTER TABLE "shipment_history" DROP CONSTRAINT "shipment_history_sending_worker_id_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_recieving_worker_id_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_sending_worker_id_fkey";

-- DropTable
DROP TABLE "workers";
