import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Extract worker_name and stokekeeper, ignore worker_id if present (it cannot be modified)
    const { worker_name, stokekeeper } = body;

    if (!id) {
      return NextResponse.json({ error: "מזהה עובד נדרש" }, { status: 400 });
    }

    // Validate the ID from URL is a valid integer
    const workerIdNum = parseInt(id, 10);
    if (isNaN(workerIdNum) || workerIdNum <= 0) {
      return NextResponse.json({ error: "מזהה עובד לא תקין" }, { status: 400 });
    }

    if (!worker_name || typeof worker_name !== "string" || !worker_name.trim()) {
      return NextResponse.json(
        { error: "שם עובד הוא שדה חובה" },
        { status: 400 }
      );
    }

    const updated = await prisma.workers.update({
      where: { worker_id: workerIdNum },
      data: {
        worker_name: worker_name.trim(),
        ...(stokekeeper !== undefined && { stokekeeper: !!stokekeeper }),
      },
    });

    return NextResponse.json({
      worker_id: updated.worker_id,
      worker_name: updated.worker_name.trim(),
      stokekeeper: updated.stokekeeper,
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "עובד לא נמצא" }, { status: 404 });
    }
    console.error("Error updating worker:", error);
    return NextResponse.json(
      { error: error.message || "שגיאה בעדכון עובד" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "Worker ID is required" }, { status: 400 });
    }

    try {
      await prisma.workers.delete({
        where: { worker_id: parseInt(id, 10) },
      });

      return NextResponse.json({ success: true, id });
    } catch (dbError: any) {
      // Handle foreign key constraint violation
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2003"
      ) {
        return NextResponse.json(
          { error: "לא ניתן למחוק עובד זה מכיוון שהוא משוייך לנתונים אחרים במערכת." },
          { status: 409 }
        );
      }
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2025"
      ) {
        return NextResponse.json({ error: "Worker not found" }, { status: 404 });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error("Error deleting worker:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete worker" },
      { status: 500 }
    );
  }
}
