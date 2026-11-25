import { HttpError } from "@/lib/http/errors";
import { CUSTOMER_CODE_RULE, idCustomerCode } from "@/app/lib/packages/ids";
import { requiredText, uniqueName } from "@/app/lib/lookups";

/** A customer as /api/settings/customers answers it. */
export const customerJson = (c: { id: number; name: string; customer_code: string }) => ({
  id: c.id,
  name: c.name.trim(),
  customer_code: c.customer_code.trim(),
});

/** The body of a customer write: a name and a code, both required. */
export function readCustomer(body: Record<string, unknown>): { name: string; customer_code: string } {
  const name = requiredText(body.name);
  if (!name) throw new HttpError(400, "שם לקוח הוא שדה חובה");
  const code = requiredText(body.customer_code);
  if (!code) throw new HttpError(400, "קוד לקוח הוא שדה חובה");
  // The code goes into every box id minted for the customer (lib/packages/ids.ts).
  if (idCustomerCode(code) == null) throw new HttpError(400, CUSTOMER_CODE_RULE);
  return { name, customer_code: code };
}

/** No two customers share a name (customers.name has no unique index: this is the rule). */
export const customerName = (name: string) => uniqueName("customers", name, "לקוח בשם זה כבר קיים במערכת");
