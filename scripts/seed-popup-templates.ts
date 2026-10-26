// Seeds popup templates that reproduce the popups the code gives station types today
// (docs/popup-templates/PLAN.md, steps 1.5 and 2.4):
//   - lib/popup-templates/codePopups.ts → one item template per listed type. A photo popup's
//     template links the photo group it captures today, so the reference images stay where they are.
//   - every package-level type → today's opening or closing wizard as a package template, by the
//     type's place on the package routes (lib/popup-templates/placement.ts). A type that plays both
//     roles, or none, is skipped and reported. The opening links the wizard's two photo groups.
// A type that does not exist, or already has a template, is skipped.
//
// Dry run by default; --apply writes. DATABASE_URL must point at the target database:
//   DATABASE_URL=postgresql://… node --import tsx scripts/seed-popup-templates.ts [--apply]
//
// Prints station type ids only — never a station's name.
import { CODE_POPUPS, OPENING_PHOTO_CODES } from "../src/app/lib/popup-templates/codePopups";
import { packageRolesByType, soleRole } from "../src/app/lib/popup-templates/placement";
import { closingTemplate, openingTemplate, photoStationTemplate, verdictStationTemplate } from "../src/app/lib/popup-templates/templates";
import type { PopupTemplateConfig } from "../src/app/lib/popup-templates/schema";

const ACTOR = { username: "seed-popup-templates", name: null };

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("set DATABASE_URL");
  const apply = process.argv.includes("--apply");
  // After DATABASE_URL is known: the Prisma client reads it when its module loads.
  const { prisma } = await import("../src/app/lib/prisma");
  const store = await import("../src/app/lib/popup-templates/store");
  try {
    for (const [id, popup] of Object.entries(CODE_POPUPS)) {
      const typeId = Number(id);
      const type = await prisma.test_stations_type.findUnique({ where: { test_station_type_id: typeId }, select: { package_level: true } });
      if (!type) { console.log(`type ${typeId}: no such station type — skipped`); continue; }
      if (type.package_level) { console.log(`type ${typeId}: package-level — seeded by its place on the routes, below`); continue; }
      if (await store.getTemplate(typeId)) { console.log(`type ${typeId}: already has a template — skipped`); continue; }

      let config: PopupTemplateConfig;
      if (popup.kind === "photo") {
        const group = await prisma.photo_types.findUnique({ where: { photo_type_id: popup.photoTypeId }, select: { code: true } });
        if (!group) { console.log(`type ${typeId}: photo group ${popup.photoTypeId} missing — skipped`); continue; }
        config = photoStationTemplate(group.code);
      } else {
        config = verdictStationTemplate();
      }
      if (!apply) { console.log(`type ${typeId}: would seed the ${popup.kind} template`); continue; }
      const saved = await store.saveTemplate(typeId, { base: "item", config, expectedVersion: null }, ACTOR);
      console.log(`type ${typeId}: seeded the ${popup.kind} template, version ${saved.version}`);
    }

    // ---- the package-level types (step 2.4) ----
    const routes = await prisma.testing_routes.findMany({ select: { item_type_id: true, route_steps: true } });
    const packageItemTypes = new Set((await prisma.item_types.findMany({ where: { is_package: true }, select: { item_type_id: true } })).map((r) => r.item_type_id));
    const roles = packageRolesByType(routes, (id) => packageItemTypes.has(id));
    const levels = await prisma.test_stations_type.findMany({ where: { package_level: true }, select: { test_station_type_id: true }, orderBy: { test_station_type_id: "asc" } });
    const codes = new Set((await prisma.photo_types.findMany({ where: { code: { in: [OPENING_PHOTO_CODES.box, OPENING_PHOTO_CODES.item] } }, select: { code: true } })).map((r) => r.code));
    for (const { test_station_type_id: typeId } of levels) {
      if (await store.getTemplate(typeId)) { console.log(`type ${typeId}: already has a template — skipped`); continue; }
      const role = soleRole(roles.get(typeId));
      if (!role) {
        console.log(`type ${typeId}: package-level, ${roles.has(typeId) ? "both opens and closes boxes" : "on no package route"} — skipped`);
        continue;
      }
      if (role === "opening" && !(codes.has(OPENING_PHOTO_CODES.box) && codes.has(OPENING_PHOTO_CODES.item))) {
        console.log(`type ${typeId}: the opening's photo groups are missing — skipped`);
        continue;
      }
      const config = role === "opening" ? openingTemplate(OPENING_PHOTO_CODES.box, OPENING_PHOTO_CODES.item) : closingTemplate();
      if (!apply) { console.log(`type ${typeId}: would seed the ${role} template`); continue; }
      const saved = await store.saveTemplate(typeId, { base: "package", config, expectedVersion: null }, ACTOR);
      console.log(`type ${typeId}: seeded the ${role} template, version ${saved.version}`);
    }
    if (!apply) console.log("dry run — nothing written (add --apply)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
