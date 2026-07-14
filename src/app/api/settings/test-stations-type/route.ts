import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { fixSequence } from "@/app/lib/fix-sequence";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.test_stations_type.findMany({
      orderBy: { test_station_type_id: "asc" },
    });

    const result = rows.map((r) => ({
      test_station_type_id: r.test_station_type_id,
      test_type_desc: r.test_type_desc.trim(),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching test station types:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { test_type_desc } = body;

  if (!test_type_desc || typeof test_type_desc !== "string" || !test_type_desc.trim()) {
    return NextResponse.json(
      { error: "Description is required" },
      { status: 400 }
    );
  }

  const trimmedDesc = test_type_desc.trim();

  const existing = await prisma.test_stations_type.findFirst({
    where: { test_type_desc: { equals: trimmedDesc, mode: "insensitive" } },
  });
  if (existing) {
    return NextResponse.json({ error: "סוג עמדה בשם זה כבר קיים במערכת" }, { status: 400 });
  }

  // Fix sequence before insert
  await fixSequence(prisma, "test_stations_type", "test_station_type_id", "test_stations_type_test_station_type_id_seq");

  try {
    const created = await prisma.test_stations_type.create({
      data: { test_type_desc: trimmedDesc },
    });

    return NextResponse.json({
      test_station_type_id: created.test_station_type_id,
      test_type_desc: created.test_type_desc.trim(),
    });
  } catch (error: any) {
    const msg = String(error?.message ?? "");
    const isDup = error?.code === "P2002" || /unique constraint/i.test(msg);

    // Real duplicate NAME → clean message (distinct from a PK/sequence desync).
    if (isDup && msg.includes("test_type_desc")) {
      return NextResponse.json({ error: "סוג עמדה בשם זה כבר קיים במערכת" }, { status: 400 });
    }

    console.error("Error creating test station type:", error);

    // PK/sequence desync duplicate → fix sequence and retry.
    if (isDup) {
      try {
        console.log("Duplicate key detected, fixing sequence and retrying...");
        await fixSequence(prisma, "test_stations_type", "test_station_type_id", "test_stations_type_test_station_type_id_seq");
        const retryCreated = await prisma.test_stations_type.create({
          data: { test_type_desc: trimmedDesc },
        });
        return NextResponse.json({
          test_station_type_id: retryCreated.test_station_type_id,
          test_type_desc: retryCreated.test_type_desc.trim(),
        });
      } catch (retryError: any) {
        console.error("Retry after sequence fix failed:", retryError);
        return NextResponse.json(
          { error: "שגיאה ביצירת סוג עמדה. נא לנסות שוב." },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: error.message || "Failed to create test station type" },
      { status: 500 }
    );
  }
}
