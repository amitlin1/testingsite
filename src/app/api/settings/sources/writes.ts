import { prisma } from "@/lib/db";
import { lookupWrites } from "@/app/lib/lookups";

export const SOURCE_WRITES = lookupWrites({
  table: "sources",
  field: "source_desc",
  duplicate: "מקור בשם זה כבר קיים במערכת",
  create: (name) => prisma.sources.create({ data: { source_desc: name } }),
  update: (id, name) => prisma.sources.update({ where: { source_id: id }, data: { source_desc: name } }),
  remove: (id) => prisma.sources.delete({ where: { source_id: id } }),
  json: (r) => ({ source_id: r.source_id, source_desc: r.source_desc.trim() }),
  texts: {
    notFound: "Source not found",
    createFailed: "Failed to create source",
    updateFailed: "Failed to update source",
    deleteFailed: "Failed to delete source",
  },
});
