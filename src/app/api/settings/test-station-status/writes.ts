import { prisma } from "@/lib/db";
import { lookupWrites } from "@/app/lib/lookups";

export const STATION_STATUS_WRITES = lookupWrites({
  table: "test_station_status",
  field: "test_station_status_desc",
  duplicate: "סטטוס עמדה בשם זה כבר קיים במערכת",
  create: (name) => prisma.test_station_status.create({ data: { test_station_status_desc: name } }),
  update: (id, name) =>
    prisma.test_station_status.update({ where: { test_station_status_id: id }, data: { test_station_status_desc: name } }),
  remove: (id) => prisma.test_station_status.delete({ where: { test_station_status_id: id } }),
  json: (r) => ({ test_station_status_id: r.test_station_status_id, test_station_status_desc: r.test_station_status_desc.trim() }),
  sequence: {
    table: "test_station_status",
    idColumn: "test_station_status_id",
    name: "test_station_status_test_station_status_id_seq",
    retryFailed: "שגיאה ביצירת סטטוס. נא לנסות שוב.",
  },
  texts: {
    notFound: "Test station status not found",
    createFailed: "Failed to create test station status",
    updateFailed: "Failed to update test station status",
    deleteFailed: "Failed to delete test station status",
  },
});
