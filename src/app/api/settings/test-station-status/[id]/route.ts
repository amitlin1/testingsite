import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { test_station_status_desc } = await req.json();

    if (!test_station_status_desc || typeof test_station_status_desc !== "string" || !test_station_status_desc.trim()) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    const updated = await prisma.test_station_status.update({
      where: { test_station_status_id: parseInt(id, 10) },
      data: { test_station_status_desc: test_station_status_desc.trim() },
    });

    return NextResponse.json({
      test_station_status_id: updated.test_station_status_id,
      test_station_status_desc: updated.test_station_status_desc.trim(),
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Test station status not found" },
        { status: 404 }
      );
    }
    console.error("Error updating test station status:", error);
    return NextResponse.json(
      { error: "Failed to update test station status" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    try {
      await prisma.test_station_status.delete({
        where: { test_station_status_id: parseInt(id, 10) },
      });

      return NextResponse.json({ success: true, id });
    } catch (dbError: any) {
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2003"
      ) {
        return NextResponse.json(
          { error: "Cannot delete test station status because it is referenced by other records." },
          { status: 409 }
        );
      }
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2025"
      ) {
        return NextResponse.json(
          { error: "Test station status not found" },
          { status: 404 }
        );
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Error deleting test station status:", error);
    return NextResponse.json(
      { error: "Failed to delete test station status" },
      { status: 500 }
    );
  }
}
