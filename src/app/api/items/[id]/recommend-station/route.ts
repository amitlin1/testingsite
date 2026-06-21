import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseBarcode } from "@/app/lib/barcode-parser";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const { itemId } = parseBarcode(id);

        // 1. Get item route info
        const routeData: {
            current_route_step: number;
            is_finished: boolean;
            route_steps: number[];
        }[] = await prisma.$queryRaw`
            SELECT
                ir.current_route_step,
                ir.is_finished,
                tr.route_steps
            FROM items i
            JOIN item_routes ir ON ir.item_id = i.item_id
            JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
            WHERE i.item_id = ${BigInt(itemId)}
        `;

        if (routeData.length === 0) {
            return NextResponse.json({ station: null });
        }

        const { current_route_step, is_finished, route_steps } = routeData[0];

        if (is_finished) {
            return NextResponse.json({ station: null });
        }

        // current_route_step is 1-based
        const neededTypeId = route_steps[current_route_step - 1];

        if (!neededTypeId) {
            return NextResponse.json({ station: null });
        }

        // 2. Find available station (status 2 = 'available')
        const station = await prisma.test_stations.findFirst({
            where: {
                test_station_type_id: neededTypeId,
                status: 2,
            },
            select: {
                test_station_id: true,
                test_station_desc: true,
            },
        });

        if (!station) {
            return NextResponse.json({ station: null });
        }

        return NextResponse.json({
            station: {
                id: station.test_station_id,
                desc: station.test_station_desc.trim(),
            },
        });
    } catch (error) {
        console.error("Error recommending station:", error);
        return NextResponse.json(
            { error: "Failed to recommend station" },
            { status: 500 }
        );
    }
}
