import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { prismaRefusal, updateLookupRow } from "@/app/lib/lookups";
import { stationName } from "../name";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = "Test station not found";

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const id = parseDbId((await params).id);
    const { test_station_type_id, test_station_desc, status, is_research } = await readJsonObject(req);
    if (id === null) throw new HttpError(404, NOT_FOUND);
    const desc = (test_station_desc as string).trim();
    const updated = await updateLookupRow(
      id,
      () =>
        prisma.test_stations.update({
          where: { test_station_id: id },
          data: {
            test_station_type_id: test_station_type_id as number,
            test_station_desc: desc,
            status: status as number,
            is_research: is_research as boolean,
          },
        }),
      stationName(desc),
    );
    return NextResponse.json({
      test_station_id: updated.test_station_id,
      test_station_type_id: updated.test_station_type_id,
      test_station_desc: updated.test_station_desc.trim(),
      status: updated.status,
      is_research: updated.is_research,
    });
  } catch (error) {
    return prismaRefusal(error, { notFound: NOT_FOUND }, "Failed to update test station");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const stationId = parseDbId(id);
    if (stationId === null) throw new HttpError(404, NOT_FOUND);
    await prisma.test_stations.delete({ where: { test_station_id: stationId } });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return prismaRefusal(error, {
      notFound: NOT_FOUND,
      inUse: "לא ניתן למחוק כי העמדה בשימוש. שחרר אותה מבדיקות ומסלולים קודם.",
    }, "Failed to delete test station");
  }
}
