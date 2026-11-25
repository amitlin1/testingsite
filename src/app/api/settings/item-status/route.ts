import { listItemStatuses, listJson } from "@/app/lib/lookups";
import { ITEM_STATUS_WRITES } from "./writes";

export const runtime = "nodejs";

export async function GET() {
  return listJson(listItemStatuses, "Error fetching item statuses:", { emptyOnError: true });
}

export const { POST } = ITEM_STATUS_WRITES;
