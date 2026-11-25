import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { fixSequence } from "@/app/lib/fix-sequence";
import { assertNameFree, parseStaleAfterMinutes, prismaRefusal, requiredText } from "@/app/lib/lookups";
import { DEFAULT_STALE_AFTER_MINUTES } from "@/lib/item-status";
import { renameStationTypeInDrafts } from "@/app/lib/station-fields/route-steps";
import { stationTypeName } from "../name";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = "Test station type not found";

/** Body { test_type_desc, package_level, stale_after_minutes?, test_station_type_id? (a new id) }. */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const oldId = parseDbId((await params).id);
    const body = await readJsonObject(req);
    const packageLevel = Boolean(body.package_level);
    // Absent: the column keeps whatever it holds (Prisma skips undefined).
    const staleAfterMinutes = parseStaleAfterMinutes(body.stale_after_minutes);
    const desc = requiredText(body.test_type_desc);
    if (!desc) throw new HttpError(400, "Description is required");
    if (oldId === null) throw new HttpError(404, NOT_FOUND);

    const newIdRaw = body.test_station_type_id;
    let newId = oldId;
    if (newIdRaw !== undefined && newIdRaw !== null && `${newIdRaw}`.trim() !== "") {
      newId = typeof newIdRaw === "number" ? newIdRaw : parseInt(`${newIdRaw}`, 10);
      if (!Number.isInteger(newId) || newId <= 0) throw new HttpError(400, "מזהה חייב להיות מספר שלם חיובי");
    }
    await assertNameFree(stationTypeName(desc), oldId);

    if (newId === oldId) {
      const updated = await prisma.test_stations_type.update({
        where: { test_station_type_id: oldId },
        data: { test_type_desc: desc, package_level: packageLevel, stale_after_minutes: staleAfterMinutes },
      });
      return NextResponse.json({
        test_station_type_id: updated.test_station_type_id,
        test_type_desc: updated.test_type_desc.trim(),
        package_level: updated.package_level,
        stale_after_minutes: updated.stale_after_minutes,
      });
    }

    const existing = await prisma.test_stations_type.findUnique({ where: { test_station_type_id: newId } });
    if (existing) throw new HttpError(409, `מזהה ${newId} כבר קיים`);

    // The id change recreates the row, so the column needs a concrete value even when the body
    // omitted it: carry the current one over.
    const current = await prisma.test_stations_type.findUnique({
      where: { test_station_type_id: oldId },
      select: { stale_after_minutes: true },
    });
    const stale = staleAfterMinutes ?? current?.stale_after_minutes ?? DEFAULT_STALE_AFTER_MINUTES;

    // Cascade the id change across the referencing tables inside one transaction.
    // (FKs are declared onUpdate: NoAction, so we repoint children manually:
    //  insert the new parent, move children to it, then delete the old parent.)
    await prisma.$transaction(async (tx) => {
      // test_type_desc is UNIQUE and the new row normally keeps the old
      // description, so release it first. The old row is deleted below, so
      // this placeholder never commits.
      await tx.test_stations_type.update({
        where: { test_station_type_id: oldId },
        data: { test_type_desc: `__renaming_${oldId}` },
      });
      await tx.test_stations_type.create({
        data: { test_station_type_id: newId, test_type_desc: desc, package_level: packageLevel, stale_after_minutes: stale },
      });
      await tx.test_stations.updateMany({
        where: { test_station_type_id: oldId },
        data: { test_station_type_id: newId },
      });
      await tx.testing_routes.updateMany({
        where: { test_station_type_id: oldId },
        data: { test_station_type_id: newId },
      });
      // route_steps stores station type ids as plain array elements, which no
      // FK covers. Rewrite every occurrence (a type may appear more than once in
      // one route), or the station queue and the route-step lookups keep asking
      // for the id deleted below.
      await tx.$executeRaw`
        UPDATE testing_routes
           SET route_steps = array_replace(route_steps, ${oldId}::int, ${newId}::int)
         WHERE ${oldId}::int = ANY(route_steps)
      `;
      // Field-config drafts name each step's station type too — as information
      // only, resolution goes through the step uids, which stay as they are.
      // Published versions are history and keep the old id.
      await renameStationTypeInDrafts(tx, oldId, newId);
      await tx.test_stations_type.delete({
        where: { test_station_type_id: oldId },
      });
    });

    await fixSequence(prisma, "test_stations_type", "test_station_type_id", "test_stations_type_test_station_type_id_seq");

    return NextResponse.json({
      test_station_type_id: newId,
      test_type_desc: desc,
      package_level: packageLevel,
      stale_after_minutes: stale,
    });
  } catch (error) {
    return prismaRefusal(error, { notFound: NOT_FOUND }, "Failed to update test station type");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const typeId = parseDbId(id);
    if (typeId === null) throw new HttpError(404, NOT_FOUND);
    await prisma.test_stations_type.delete({ where: { test_station_type_id: typeId } });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return prismaRefusal(error, {
      notFound: NOT_FOUND,
      inUse: "לא ניתן למחוק כי קיימות עמדות משויכות. מחק או העבר אותן קודם.",
    }, "Failed to delete test station type");
  }
}
