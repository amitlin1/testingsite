import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.workers.findMany({
      orderBy: { worker_id: "asc" },
    });

    const result = rows.map((r) => ({
      worker_id: r.worker_id,
      worker_name: r.worker_name.trim(),
      stokekeeper: r.stokekeeper,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching workers:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { worker_id, worker_name, stokekeeper } = body;

  // Validate worker_id is provided and is a valid integer
  if (worker_id === undefined || worker_id === null || worker_id === "") {
    return NextResponse.json(
      { error: "מזהה עובד הוא שדה חובה" },
      { status: 400 }
    );
  }

  const workerIdNum = typeof worker_id === "number" ? worker_id : parseInt(String(worker_id), 10);
  if (isNaN(workerIdNum) || workerIdNum <= 0 || !Number.isInteger(workerIdNum)) {
    return NextResponse.json(
      { error: "מזהה עובד חייב להיות מספר שלם חיובי" },
      { status: 400 }
    );
  }

  // Validate worker_name
  if (!worker_name || typeof worker_name !== "string" || !worker_name.trim()) {
    return NextResponse.json(
      { error: "שם עובד הוא שדה חובה" },
      { status: 400 }
    );
  }

  const trimmedName = worker_name.trim();

  try {
    const created = await prisma.workers.create({
      data: { worker_id: workerIdNum, worker_name: trimmedName, stokekeeper: !!stokekeeper },
    });

    return NextResponse.json({
      worker_id: created.worker_id,
      worker_name: created.worker_name.trim(),
      stokekeeper: created.stokekeeper,
    });
  } catch (error: any) {
    console.error("Error creating worker:", error);

    // Handle duplicate key error (primary key violation)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `עובד עם מזהה ${workerIdNum} כבר קיים במערכת. נא לבחור מזהה אחר.` },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: error.message || "שגיאה ביצירת עובד" },
      { status: 500 }
    );
  }
}
