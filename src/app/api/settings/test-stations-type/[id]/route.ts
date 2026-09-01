import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { fixSequence } from "@/app/lib/fix-sequence";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/**
 * stale_after_minutes = minutes an item may sit in test / in research on a
 * station of this type with no result before /api/cron/release-stale-tests
 * reverts it. 0 = never auto-release. Absent in the body means "leave the value
 * alone"; a present value must be a whole number >= 0. Deliberately duplicated
 * from ../route.ts: a Next route file may only export its handlers, so there is
 * nowhere to share it from without inventing a module.
 */
function parseStaleAfterMinutes(raw: unknown): { value?: number } | { error: string } {
  if (raw === undefined || raw === null || `${raw}`.trim() === "") return {};
  const n = typeof raw === "number" ? raw : Number(`${raw}`.trim());
  if (!Number.isInteger(n) || n < 0) {
    return { error: "זמן שחרור אוטומטי חייב להיות מספר שלם של דקות, 0 או יותר" };
  }
  return { value: n };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { test_type_desc, test_station_type_id: newIdRaw } = body;
    const parentsOnly = Boolean(body.parents_only);

    const stale = parseStaleAfterMinutes(body.stale_after_minutes);
    if ("error" in stale) {
      return NextResponse.json({ error: stale.error }, { status: 400 });
    }
    // Omitted -> the column keeps whatever it holds; Prisma skips undefined.
    const staleAfterMinutes = stale.value;

    if (!test_type_desc || typeof test_type_desc !== "string" || !test_type_desc.trim()) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    const oldId = parseInt(id, 10);
    const trimmedDesc = test_type_desc.trim();

    // Determine whether the primary key itself is being changed.
    let newId = oldId;
    if (newIdRaw !== undefined && newIdRaw !== null && `${newIdRaw}`.trim() !== "") {
      newId = typeof newIdRaw === "number" ? newIdRaw : parseInt(`${newIdRaw}`, 10);
      if (!Number.isInteger(newId) || newId <= 0) {
        return NextResponse.json(
          { error: "מזהה חייב להיות מספר שלם חיובי" },
          { status: 400 }
        );
      }
    }

    // Simple case: only the description changed.
    if (newId === oldId) {
      const updated = await prisma.test_stations_type.update({
        where: { test_station_type_id: oldId },
        data: { test_type_desc: trimmedDesc, parents_only: parentsOnly, stale_after_minutes: staleAfterMinutes },
      });

      return NextResponse.json({
        test_station_type_id: updated.test_station_type_id,
        test_type_desc: updated.test_type_desc.trim(),
        parents_only: updated.parents_only,
        stale_after_minutes: updated.stale_after_minutes,
      });
    }

    // The primary key is changing — make sure the target id is free.
    const existing = await prisma.test_stations_type.findUnique({
      where: { test_station_type_id: newId },
    });
    if (existing) {
      return NextResponse.json(
        { error: `מזהה ${newId} כבר קיים` },
        { status: 409 }
      );
    }

    // The id change recreates the row, so the column needs a concrete value
    // even when the body omitted it: carry the current one over.
    const current = await prisma.test_stations_type.findUnique({
      where: { test_station_type_id: oldId },
      select: { stale_after_minutes: true },
    });

    // Cascade the id change across the referencing tables inside one transaction.
    // (FKs are declared onUpdate: NoAction, so we repoint children manually:
    //  insert the new parent, move children to it, then delete the old parent.)
    await prisma.$transaction(async (tx) => {
      await tx.test_stations_type.create({
        data: {
          test_station_type_id: newId, test_type_desc: trimmedDesc, parents_only: parentsOnly,
          stale_after_minutes: staleAfterMinutes ?? current?.stale_after_minutes ?? 30,
        },
      });
      await tx.test_stations.updateMany({
        where: { test_station_type_id: oldId },
        data: { test_station_type_id: newId },
      });
      await tx.testing_routes.updateMany({
        where: { test_station_type_id: oldId },
        data: { test_station_type_id: newId },
      });
      await tx.test_stations_type.delete({
        where: { test_station_type_id: oldId },
      });
    });

    // Keep the autoincrement sequence ahead of any manually-assigned id.
    await fixSequence(prisma, "test_stations_type", "test_station_type_id", "test_stations_type_test_station_type_id_seq");

    return NextResponse.json({
      test_station_type_id: newId,
      test_type_desc: trimmedDesc,
      parents_only: parentsOnly,
      stale_after_minutes: staleAfterMinutes ?? current?.stale_after_minutes ?? 30,
    });
  } catch (error: any) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Test station type not found" },
        { status: 404 }
      );
    }
    console.error("Error updating test station type:", error);
    return NextResponse.json(
      { error: "Failed to update test station type" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    try {
      await prisma.test_stations_type.delete({
        where: { test_station_type_id: parseInt(id, 10) },
      });

      return NextResponse.json({ success: true, id });
    } catch (dbError: any) {
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2003"
      ) {
        return NextResponse.json(
          { error: "Cannot delete test station type because it is referenced by other records." },
          { status: 409 }
        );
      }
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === "P2025"
      ) {
        return NextResponse.json(
          { error: "Test station type not found" },
          { status: 404 }
        );
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Error deleting test station type:", error);
    return NextResponse.json(
      { error: "Failed to delete test station type" },
      { status: 500 }
    );
  }
}
