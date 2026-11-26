import { listCustomers, listJson } from "@/app/lib/lookups";

export const runtime = "nodejs";

// The customer lookup every screen loads (pickers, filters). It carries the
// CODE only: inside the system a customer is known by its code, and its name is
// shown on the customers settings page alone (/api/settings/customers).
export async function GET() {
  return listJson(
    async () =>
      (await listCustomers("id"))
        .map((c) => ({ id: c.id, customer_code: c.customer_code.trim() }))
        .sort((a, b) => a.customer_code.localeCompare(b.customer_code, "he", { numeric: true })),
    "Error fetching customers:",
    { emptyOnError: true },
  );
}
