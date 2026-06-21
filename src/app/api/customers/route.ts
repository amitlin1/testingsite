import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export interface CustomerOption {
  id: number;
  name: string;
  customer_code: string;
}

export async function GET() {
  try {
    const rows = await prisma.customers.findMany({
      orderBy: { name: "asc" },
    });

    const customers: CustomerOption[] = rows.map((row: any) => ({
      id: row.id,
      name: (row.name ?? "").trim(),
      customer_code: row.customer_code ?? "",
    }));

    return NextResponse.json(customers);
  } catch (error) {
    console.error("Error fetching customers:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}
