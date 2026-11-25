import { prisma } from "@/lib/db";
import { lookupWrites } from "@/app/lib/lookups";

export const ITEM_STATUS_WRITES = lookupWrites({
  table: "item_status",
  field: "item_status_desc",
  duplicate: "סטטוס פריט בשם זה כבר קיים במערכת",
  create: (name) => prisma.item_status.create({ data: { item_status_desc: name } }),
  update: (id, name) => prisma.item_status.update({ where: { item_status_id: id }, data: { item_status_desc: name } }),
  remove: (id) => prisma.item_status.delete({ where: { item_status_id: id } }),
  json: (r) => ({ item_status_id: r.item_status_id, item_status_desc: r.item_status_desc.trim() }),
  texts: {
    notFound: "Item status not found",
    createFailed: "Failed to create item status",
    updateFailed: "Failed to update item status",
    deleteFailed: "Failed to delete item status",
  },
});
