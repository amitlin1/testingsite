import { listItemStatuses, listJson } from "@/app/lib/lookups";

export const runtime = "nodejs";

export async function GET() {
  return listJson(
    async () => (await listItemStatuses()).map((s) => ({ id: s.item_status_id, label: s.item_status_desc })),
    "Error loading statuses:",
    { emptyOnError: true },
  );
}
