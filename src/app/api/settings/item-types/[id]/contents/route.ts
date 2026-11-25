import { NextResponse } from "next/server";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { describeTemplate, loadPackageTypeOrRefuse, readTemplateLines, saveTemplate } from "@/app/lib/packages/template";
import { parseDefaultRoute } from "@/app/lib/packages/template-wire";

export const runtime = "nodejs";

/**
 * Package contents (the template) of one package type — docs/packages/PLAN.md
 * §3, lib/packages/template.ts. GET lists the lines with route warnings, PUT
 * replaces the whole list. The table's item-detail columns stay, unused; a
 * save leaves them NULL.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const type = await loadPackageTypeOrRefuse((await params).id);
    return NextResponse.json(await describeTemplate(type.item_type_id));
  } catch (error) {
    return errorResponse(error, "טעינת תכולת המארז נכשלה");
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const type = await loadPackageTypeOrRefuse((await params).id);
    const body = await readJsonObject(req);
    const lines = await readTemplateLines(body.lines);

    let defaultRoute: number | null | undefined = undefined;
    if (body.default_route_number !== undefined) {
      const parsed = parseDefaultRoute(body.default_route_number, "מסלול ברירת מחדל למארז חייב להיות מספר שלם, 1 או יותר");
      if ("error" in parsed) throw new HttpError(400, parsed.error);
      defaultRoute = parsed.value;
    }

    await saveTemplate(type.item_type_id, lines, defaultRoute);
    return NextResponse.json(await describeTemplate(type.item_type_id));
  } catch (error) {
    return errorResponse(error, "שמירת תכולת המארז נכשלה");
  }
}
