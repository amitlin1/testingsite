import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { test_station_type_id, test_station_desc, status, is_research } = body;

    const updated = await prisma.test_stations.update({
      where: { test_station_id: parseInt(id, 10) },
      data: {
        test_station_type_id,
        test_station_desc: test_station_desc.trim(),
        status,
        is_research,
      },
    });

    return NextResponse.json({
      test_station_id: updated.test_station_id,
      test_station_type_id: updated.test_station_type_id,
      test_station_desc: updated.test_station_desc.trim(),
      status: updated.status,
      is_research: updated.is_research,
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Test station not found" }, { status: 404 });
    }
    console.error("Error updating test station:", error);
    return NextResponse.json(
      { error: "Failed to update test station" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    try {
      await prisma.test_stations.delete({
        where: { test_station_id: parseInt(id, 10) },
      });

      return NextResponse.json({ success: true, id });
    } catch (dbError: any) {
      // Check for FK constraint
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2003"
      ) {
        return NextResponse.json(
          { error: "Cannot delete test station because it is referenced by other records." },
          { status: 409 }
        );
      }
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2025"
      ) {
        return NextResponse.json({ error: "Test station not found" }, { status: 404 });
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Error deleting test station:", error);
    return NextResponse.json(
      { error: "Failed to delete test station" },
      { status: 500 }
    );
  }
}
