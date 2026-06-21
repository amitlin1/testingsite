import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { item_type_desc } = await req.json();

    if (!item_type_desc || typeof item_type_desc !== "string" || !item_type_desc.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const updated = await prisma.item_types.update({
      where: { item_type_id: Number(id) },
      data: { item_type_desc: item_type_desc.trim() },
    });

    return NextResponse.json({
      item_type_id: updated.item_type_id,
      item_type_desc: updated.item_type_desc.trim(),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Item type not found" }, { status: 404 });
    }
    console.error("Error updating item type:", error);
    return NextResponse.json(
      { error: "Failed to update item type" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.item_types.delete({
      where: { item_type_id: Number(id) },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Item type not found" }, { status: 404 });
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Cannot delete item type because it is referenced by other records." },
          { status: 409 }
        );
      }
    }
    console.error("Error deleting item type:", error);
    return NextResponse.json(
      { error: "Failed to delete item type" },
      { status: 500 }
    );
  }
}
