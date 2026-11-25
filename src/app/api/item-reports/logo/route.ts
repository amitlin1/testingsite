import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { putObject, serveObject } from "@/lib/storage";
import { ReportKeys } from "@/lib/storage/keys";
import { registerFileObject } from "@/lib/file-registry";
import { decodeImageDataUrl } from "@/lib/data-url";
import { actorOf } from "@/app/lib/item-report/http";

export const runtime = "nodejs";

/** GET ?key=reports/logos/… — a header logo uploaded in the template editor. */
export const GET = withAuth(async (req) => {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!ReportKeys.isLogo(key)) {
    return NextResponse.json({ error: "Bad key" }, { status: 400 });
  }
  try {
    const res = await serveObject(key, { cacheControl: "private, max-age=3600" });
    if (res) return res;
  } catch (e) {
    console.error(`[item-report] logo ${key} could not be read`, e);
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
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
}, { role: ACCESS.reportTemplate });
