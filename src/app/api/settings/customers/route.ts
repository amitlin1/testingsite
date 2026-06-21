import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { fixSequence } from "@/app/lib/fix-sequence";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.customers.findMany({
      orderBy: { id: "asc" },
    });

    const result = rows.map((r) => ({
      id: r.id,
      name: r.name.trim(),
      customer_code: r.customer_code.trim(),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching customers:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, customer_code } = body;

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

  const trimmedName = name.trim();
  const trimmedCode = customer_code.trim();

  // Fix sequence before insert
  await fixSequence(prisma, "customers", "id", "customers_id_seq");

  try {
    const created = await prisma.customers.create({
      data: { name: trimmedName, customer_code: trimmedCode },
    });

    return NextResponse.json({
      id: created.id,
      name: created.name.trim(),
      customer_code: created.customer_code.trim(),
    });
  } catch (error: any) {
    console.error("Error creating customer:", error);

    // If duplicate key, fix sequence and retry
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      try {
        console.log("Duplicate key detected, fixing sequence and retrying...");
        await fixSequence(prisma, "customers", "id", "customers_id_seq");
        const retryCreated = await prisma.customers.create({
          data: { name: trimmedName, customer_code: trimmedCode },
        });
        return NextResponse.json({
          id: retryCreated.id,
          name: retryCreated.name.trim(),
          customer_code: retryCreated.customer_code.trim(),
        });
      } catch (retryError: any) {
        console.error("Retry after sequence fix failed:", retryError);
        return NextResponse.json(
          { error: "שגיאה ביצירת לקוח. נא לנסות שוב." },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: error.message || "שגיאה ביצירת לקוח" },
      { status: 500 }
    );
  }
}
