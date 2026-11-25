import { listJson, listSources } from "@/app/lib/lookups";

export const runtime = "nodejs";

export async function GET() {
  return listJson(async () => (await listSources()).map((s) => ({ id: s.source_id, desc: s.source_desc })), "Failed to fetch sources");
}
