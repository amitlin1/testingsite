import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { insertLookupRow, listCustomers, listJson } from "@/app/lib/lookups";
import { customerJson, customerName, readCustomer } from "./customer";

export const runtime = "nodejs";

export async function GET() {
  return listJson(async () => (await listCustomers("id")).map(customerJson), "Error fetching customers:", { emptyOnError: true });
}

export async function POST(req: Request) {
  try {
    const data = readCustomer(await readJsonObject(req));
    const created = await insertLookupRow(() => prisma.customers.create({ data }), {
      duplicate: customerName(data.name),
      sequence: { table: "customers", idColumn: "id", name: "customers_id_seq", retryFailed: "שגיאה ביצירת לקוח. נא לנסות שוב." },
    });
    return NextResponse.json(customerJson(created));
  } catch (error) {
    return errorResponse(error, "שגיאה ביצירת לקוח");
  }
}
