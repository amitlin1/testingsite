import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { route_steps } = body; // Only allowing updating steps for now, key fields usually immutable or require recreation

    const updated = await prisma.testing_routes.update({
      where: { test_route_id: Number(id) },
      data: { route_steps },
    });

    return NextResponse.json({
      test_route_id: updated.test_route_id,
      item_type_id: updated.item_type_id,
      test_station_type_id: updated.test_station_type_id,
      route_number: updated.route_number,
      route_steps: updated.route_steps,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }
    console.error("Error updating testing route:", error);
    return NextResponse.json(
      { error: "Failed to update testing route" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.testing_routes.delete({
      where: { test_route_id: Number(id) },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Route not found" }, { status: 404 });
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Cannot delete route because it is referenced by other records." },
          { status: 409 }
        );
      }
    }
    console.error("Error deleting testing route:", error);
    return NextResponse.json(
      { error: "Failed to delete testing route" },
      { status: 500 }
    );
  }
}
