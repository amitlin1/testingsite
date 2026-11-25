import { NextRequest, NextResponse } from "next/server";
import { serveObject } from "@/lib/storage";
import { ShipmentKeys } from "@/lib/storage/keys";
import { hasAppSession } from "@/lib/auth/session-guard";

export const runtime = "nodejs";

// GET: Serve a shipment signature file from MinIO
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; filename: string }> }
) {
    if (!(await hasAppSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, filename } = await context.params;

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    try {
        const res = await serveObject(ShipmentKeys.signature(id, filename), { cacheControl: 'public, max-age=31536000' });
        return res ?? NextResponse.json({ error: "File not found" }, { status: 404 });
    } catch (error) {
        console.error("Error serving signature file from MinIO:", error);
        return NextResponse.json(
            { error: "Failed to serve file" },
            { status: 500 }
        );
    }
}
