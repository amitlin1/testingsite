import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { source_desc } = await req.json();

    if (!source_desc || typeof source_desc !== "string" || !source_desc.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const updated = await prisma.sources.update({
      where: { source_id: Number(id) },
      data: { source_desc: source_desc.trim() },
    });

    return NextResponse.json({
      source_id: updated.source_id,
      source_desc: updated.source_desc.trim(),
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    console.error("Error updating source:", error);
    return NextResponse.json(
      { error: "Failed to update source" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.sources.delete({
      where: { source_id: Number(id) },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Source not found" }, { status: 404 });
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Cannot delete source because it is referenced by other records." },
          { status: 409 }
        );
      }
    }
    console.error("Error deleting source:", error);
    return NextResponse.json(
      { error: "Failed to delete source" },
      { status: 500 }
    );
  }
}
