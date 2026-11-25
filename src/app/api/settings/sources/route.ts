import { listJson, listSources } from "@/app/lib/lookups";
import { SOURCE_WRITES } from "./writes";

export const runtime = "nodejs";

export async function GET() {
  return listJson(listSources, "Error fetching sources:", { emptyOnError: true });
}

export const { POST } = SOURCE_WRITES;
