import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { contentTypeFromName, getObjectStream, nodeToWebStream, putObject } from "@/lib/storage";
import { registerFileObject } from "@/lib/file-registry";
import { ReportKeys } from "@/app/lib/item-report/generate";
import { REPORT_TEMPLATE_ROLES } from "@/app/lib/item-report/roles";
import { actorOf, decodeImageDataUrl } from "@/app/lib/item-report/http";

export const runtime = "nodejs";

/** GET ?key=reports/logos/… — a header logo uploaded in the template editor. */
export const GET = withAuth(async (req) => {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith(ReportKeys.LOGO_PREFIX) || key.includes("..")) {
    return NextResponse.json({ error: "Bad key" }, { status: 400 });
  }
  try {
    const stream = await getObjectStream(key);
    const type = key.endsWith(".svg") ? "image/svg+xml" : contentTypeFromName(key);
    return new Response(nodeToWebStream(stream), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
});

/** POST { dataUrl } → { key }: upload a header logo (PNG / JPEG / WebP / SVG, ≤ 2MB). */
export const POST = withAuth(async (req, { session }) => {
  const body = (await req.json().catch(() => null)) as { dataUrl?: unknown } | null;
  const img = decodeImageDataUrl(body?.dataUrl, 2 * 1024 * 1024);
  if (!img) return NextResponse.json({ error: "dataUrl must be a PNG / JPEG / WebP / SVG image up to 2MB" }, { status: 400 });
  const key = ReportKeys.logo(img.ext);
  const stored = await putObject(key, img.bytes, img.type);
  void registerFileObject({
    objectKey: key, fileName: `logo.${img.ext}`, contentType: img.type, sizeBytes: stored.size,
    checksum: stored.checksum, entityType: "report_logo", createdBy: actorOf(session).username,
  });
  return NextResponse.json({ key });
}, { role: REPORT_TEMPLATE_ROLES });
