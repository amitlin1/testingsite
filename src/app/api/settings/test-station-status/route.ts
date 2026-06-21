import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { fixSequence } from "@/app/lib/fix-sequence";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.test_station_status.findMany({
      orderBy: { test_station_status_id: "asc" },
    });

    const result = rows.map((r) => ({
      test_station_status_id: r.test_station_status_id,
      test_station_status_desc: r.test_station_status_desc.trim(),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching test station statuses:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { test_station_status_desc } = body;

  if (!test_station_status_desc || typeof test_station_status_desc !== "string" || !test_station_status_desc.trim()) {
    return NextResponse.json(
      { error: "Description is required" },
      { status: 400 }
    );
  }

  const trimmedDesc = test_station_status_desc.trim();

  // Fix sequence before insert
  await fixSequence(prisma, "test_station_status", "test_station_status_id", "test_station_status_test_station_status_id_seq");

  try {
    const created = await prisma.test_station_status.create({
      data: { test_station_status_desc: trimmedDesc },
    });

    return NextResponse.json({
      test_station_status_id: created.test_station_status_id,
      test_station_status_desc: created.test_station_status_desc.trim(),
    });
  } catch (error: any) {
    console.error("Error creating test station status:", error);

    // If duplicate key, fix sequence and retry
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      try {
        console.log("Duplicate key detected, fixing sequence and retrying...");
        await fixSequence(prisma, "test_station_status", "test_station_status_id", "test_station_status_test_station_status_id_seq");
        const retryCreated = await prisma.test_station_status.create({
          data: { test_station_status_desc: trimmedDesc },
        });
        return NextResponse.json({
          test_station_status_id: retryCreated.test_station_status_id,
          test_station_status_desc: retryCreated.test_station_status_desc.trim(),
        });
      } catch (retryError: any) {
        console.error("Retry after sequence fix failed:", retryError);
        return NextResponse.json(
          { error: "שגיאה ביצירת סטטוס. נא לנסות שוב." },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: error.message || "Failed to create test station status" },
      { status: 500 }
    );
  }
}
