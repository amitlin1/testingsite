import { listItemTypes, listJson } from "@/app/lib/lookups";

export const runtime = "nodejs";

export async function GET() {
  return listJson(listItemTypes, "Error loading item types:", { emptyOnError: true });
}
