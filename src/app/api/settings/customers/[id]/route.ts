import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { IN_USE_TEXT, prismaRefusal, updateLookupRow } from "@/app/lib/lookups";
import { customerJson, customerName, readCustomer } from "../customer";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const id = parseDbId((await params).id);
    const data = readCustomer(await readJsonObject(req));
    if (id === null) throw new HttpError(404, "לקוח לא נמצא");
    const updated = await updateLookupRow(id, () => prisma.customers.update({ where: { id }, data }), customerName(data.name));
    return NextResponse.json(customerJson(updated));
  } catch (error) {
    return prismaRefusal(error, { notFound: "לקוח לא נמצא" }, "שגיאה בעדכון לקוח");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const customerId = parseDbId(id);
    if (customerId === null) throw new HttpError(404, "Customer not found");
    await prisma.customers.delete({ where: { id: customerId } });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return prismaRefusal(error, { notFound: "Customer not found", inUse: IN_USE_TEXT }, "Failed to delete customer");
  }
}
