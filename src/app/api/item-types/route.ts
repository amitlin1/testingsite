import { listItemTypes, listJson } from "@/app/lib/lookups";

export const runtime = "nodejs";

export async function GET() {
  return listJson(
    async () => (await listItemTypes({ byName: true })).map((t) => ({ id: t.item_type_id, name: t.item_type_desc, is_package: t.is_package })),
    "Error loading item types:",
    { emptyOnError: true },
  );
}
