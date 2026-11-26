/** The HTTP edge of the /api/item-reports routes: their params, bodies and replies. Server-only. */
import { NextResponse, type NextRequest } from "next/server";
import type { Data } from "@measured/puck";
import type { Session } from "next-auth";
import { withAuth, type WithAuthOptions } from "@/lib/auth/withAuth";
import { actorFromSession, identityOf } from "@/lib/auth/identity";
import { ACCESS, ROLE_LABEL } from "@/lib/auth/roles";
import { decodeImageDataUrl } from "@/lib/data-url";
import { errorResponse } from "@/lib/http/errors";
import { parseDbId, parseItemId, readJsonObject } from "@/lib/http/request";
import type { ExternalApproval, Signer } from "./lifecycle";
import { isTemplate } from "./template-utils";

type Ctx = { session: Session };

/** withAuth for a /[itemId] route: the handler gets the parsed id; a malformed one answers 400. */
export function withItemId(
  handler: (req: NextRequest, ctx: Ctx & { itemId: bigint }) => Promise<Response>,
  options?: WithAuthOptions,
) {
  return withAuth<{ itemId: string }>(async (req, { session, params: { itemId: raw } }) => {
    const itemId = parseItemId(raw);
    if (itemId == null) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
    return handler(req, { session, itemId });
  }, options);
}

/** withAuth for a /templates/[routeId] route: the handler gets the parsed id; a malformed one answers 400. */
export function withRouteId(
  handler: (req: NextRequest, ctx: Ctx & { routeId: number }) => Promise<Response>,
  options?: WithAuthOptions,
) {
  return withAuth<{ routeId: string }>(async (req, { session, params: { routeId: raw } }) => {
    const routeId = parseDbId(raw);
    if (routeId == null) return NextResponse.json({ error: "Bad route id" }, { status: 400 });
    return handler(req, { session, routeId });
  }, options);
}

/** A drawn signature as the routes take it: a PNG data URL of at most 2 MB. */
export function decodePngSignature(value: unknown): Buffer | null {
  const img = decodeImageDataUrl(value, 2 * 1024 * 1024);
  return img && img.type === "image/png" ? img.bytes : null;
}

/** The role a closing signature prints in its "תפקיד החותם" cell — of the signed-in user at the
 *  moment they sign: the first of ACCESS.reportClosingSign they hold (a manager who is a tester
 *  too prints "מנהל"); anyone else gets "". */
function signerRoleLabel(roles: readonly string[]): string {
  const role = ACCESS.reportClosingSign.find((r) => roles.includes(r));
  return role ? ROLE_LABEL[role] : "";
}

/** The signed-in user as a report signer: the actor (its username, else the e-mail), their number,
 *  and the role a closing signature prints (from their roles now — kept with the signature). */
export function actorOf(session: Session): Signer {
  const actor = actorFromSession(session);
  const { employeeNumber } = identityOf(session);
  return {
    username: actor.username ?? (session.user.email || ""),
    name: actor.name ?? "",
    number: employeeNumber ? String(employeeNumber) : "",
    role: signerRoleLabel(session.roles ?? []),
  };
}

const PNG_REQUIRED = "signature must be a PNG data URL";

/** A sign route's POST { signature: "data:image/png;base64,…" } → { version }. */
export function signHandler(
  sign: (itemId: bigint, png: Buffer, signer: Signer) => Promise<{ version: number }>,
  options: WithAuthOptions,
) {
  return withItemId(async (req, { session, itemId }) => {
    try {
      const body = await readJsonObject(req, PNG_REQUIRED);
      const png = decodePngSignature(body.signature);
      if (!png) return NextResponse.json({ error: PNG_REQUIRED }, { status: 400 });
      return NextResponse.json(await sign(itemId, png, actorOf(session)));
    } catch (e) {
      return errorResponse(e, "Failed to sign the report");
    }
  }, options);
}

/** The longest name / role and reason an external approver may write. */
const EXTERNAL_TEXT_MAX = 200;
const EXTERNAL_NOTE_MAX = 2000;

/** An external approval's body { name, role?, note?, signature } — the approval and the PNG, or the
 *  400 to answer. */
export async function readExternalApproval(req: Request): Promise<{ approval: ExternalApproval; png: Buffer } | { error: Response }> {
  const body = await readJsonObject(req, "name and signature are required");
  const bad = (error: string) => ({ error: NextResponse.json({ error }, { status: 400 }) });
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = text(body.name);
  const role = text(body.role);
  const note = text(body.note);
  if (!name) return bad("name is required");
  if (name.length > EXTERNAL_TEXT_MAX || role.length > EXTERNAL_TEXT_MAX) return bad(`name and role are at most ${EXTERNAL_TEXT_MAX} characters`);
  if (note.length > EXTERNAL_NOTE_MAX) return bad(`note is at most ${EXTERNAL_NOTE_MAX} characters`);
  const png = decodePngSignature(body.signature);
  if (!png) return bad(PNG_REQUIRED);
  return { approval: { name, role, note }, png };
}

/** A template is a Puck document; anything bigger than this is not one somebody drew. */
const MAX_TEMPLATE_BYTES = 1024 * 1024;

/** A template PUT's body { template }: the document, or the 413 / 400 to answer. */
export async function readTemplateBody(req: Request): Promise<{ template: Data } | { error: Response }> {
  const text = await req.text();
  if (text.length > MAX_TEMPLATE_BYTES) return { error: NextResponse.json({ error: "Template too large" }, { status: 413 }) };
  let body: { template?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
  if (!isTemplate(body.template)) return { error: NextResponse.json({ error: NOT_A_TEMPLATE }, { status: 400 }) };
  return { template: body.template };
}

const NOT_A_TEMPLATE = "template must be a Puck document";

/** A preview POST's body { template, item_id? }: the document and the item (null = none); a 400
 *  (thrown, or as `error`) otherwise. */
export async function readPreviewBody(req: Request): Promise<{ template: Data; itemId: bigint | null } | { error: Response }> {
  const body = await readJsonObject(req, NOT_A_TEMPLATE);
  if (!isTemplate(body.template)) return { error: NextResponse.json({ error: NOT_A_TEMPLATE }, { status: 400 }) };
  if (body.item_id == null || body.item_id === "") return { template: body.template, itemId: null };
  const itemId = parseItemId(String(body.item_id));
  if (itemId == null) return { error: NextResponse.json({ error: "Bad item id" }, { status: 400 }) };
  return { template: body.template, itemId };
}

/** Who saved a template (report_templates / report_general_template columns). */
export function templateActor(session: Session): { updated_by: string; updated_by_name: string } {
  const actor = actorOf(session);
  return { updated_by: actor.username, updated_by_name: actor.name };
}

export function pdfResponse(bytes: Buffer, filename: string, extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // A draft changes with every result; the final copy is MinIO's — never cache.
      "Cache-Control": "private, no-store",
      ...extra,
    },
  });
}
