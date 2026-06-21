import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { item_status_desc } = await req.json();

    if (!item_status_desc || typeof item_status_desc !== "string" || !item_status_desc.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const updated = await prisma.item_status.update({
      where: { item_status_id: Number(id) },
      data: { item_status_desc: item_status_desc.trim() },
    });

    return NextResponse.json({
      item_status_id: updated.item_status_id,
      item_status_desc: updated.item_status_desc.trim(),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Item status not found" }, { status: 404 });
    }
    console.error("Error updating item status:", error);
    return NextResponse.json(
      { error: "Failed to update item status" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.item_status.delete({
      where: { item_status_id: Number(id) },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Item status not found" }, { status: 404 });
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Cannot delete item status because it is referenced by other records." },
          { status: 409 }
        );
      }
    }
    console.error("Error deleting item status:", error);
    return NextResponse.json(
      { error: "Failed to delete item status" },
      { status: 500 }
    );
  }
}
