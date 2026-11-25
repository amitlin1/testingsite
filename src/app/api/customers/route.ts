import { listCustomers, listJson } from "@/app/lib/lookups";

export const runtime = "nodejs";

export async function GET() {
  return listJson(async () => (await listCustomers("name")).map((c) => ({ id: c.id, name: c.name, customer_code: c.customer_code })), "Error fetching customers:", { emptyOnError: true });
}
