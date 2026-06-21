import { NextRequest, NextResponse } from "next/server";
import {
    getObjectStream,
    statObject,
    nodeToWebStream,
    contentTypeFromName,
} from "@/lib/storage";
import { signatureObjectKey } from "@/lib/file-utils";

export const runtime = "nodejs";

// GET: Serve a shipment signature file from MinIO
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; filename: string }> }
) {
    const { id, filename } = await context.params;

    // Security: prevent traversal / key injection
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    try {
        const objectKey = signatureObjectKey(id, filename);

        const stat = await statObject(objectKey);
        if (!stat) {
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        const nodeStream = await getObjectStream(objectKey);
        const webStream = nodeToWebStream(nodeStream);

        const contentType =
            (stat.metaData?.['content-type'] as string) || contentTypeFromName(filename);

        return new Response(webStream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': stat.size.toString(),
                'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
            },
        });
    } catch (error) {
        console.error("Error serving signature file from MinIO:", error);
        return NextResponse.json(
            { error: "Failed to serve file" },
            { status: 500 }
        );
    }
}
