import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { CUSTOMER_CODE_RULE, idCustomerCode } from "@/app/lib/packages/ids";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { name, customer_code } = await req.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "שם לקוח הוא שדה חובה" },
        { status: 400 }
      );
    }

    if (!customer_code || typeof customer_code !== "string" || !customer_code.trim()) {
      return NextResponse.json(
        { error: "קוד לקוח הוא שדה חובה" },
        { status: 400 }
      );
    }

    // The code goes into every box id minted for the customer (lib/packages/ids.ts).
    if (idCustomerCode(customer_code) == null) {
      return NextResponse.json({ error: CUSTOMER_CODE_RULE }, { status: 400 });
    }

    const updated = await prisma.customers.update({
      where: { id: parseInt(id, 10) },
      data: { name: name.trim(), customer_code: customer_code.trim() },
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name.trim(),
      customer_code: updated.customer_code.trim(),
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
    }
    console.error("Error updating customer:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון לקוח" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    try {
      await prisma.customers.delete({
        where: { id: parseInt(id, 10) },
      });

      return NextResponse.json({ success: true, id });
    } catch (dbError: any) {
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2003"
      ) {
        return NextResponse.json(
          { error: "Cannot delete customer because it is referenced by other records." },
          { status: 409 }
        );
      }
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2025"
      ) {
        return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Error deleting customer:", error);
    return NextResponse.json(
      { error: "Failed to delete customer" },
      { status: 500 }
    );
  }
}
