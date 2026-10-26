// Seeds popup templates that reproduce the popups the code gives station types today
// (docs/popup-templates/PLAN.md, step 1.5): lib/popup-templates/codePopups.ts → one template per
// listed type. A type that does not exist, is package-level (its boxes open the package wizards)
// or already has a template is skipped. A photo popup's template links the photo group it captures
// today, so the reference images stay where they are.
//
// Dry run by default; --apply writes. DATABASE_URL must point at the target database:
//   DATABASE_URL=postgresql://… node --import tsx scripts/seed-popup-templates.ts [--apply]
//
// Prints station type ids only — never a station's name.
import { CODE_POPUPS } from "../src/app/lib/popup-templates/codePopups";
import { photoStationTemplate, verdictStationTemplate } from "../src/app/lib/popup-templates/templates";
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
      if (type.package_level) { console.log(`type ${typeId}: package-level — skipped`); continue; }
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
    if (!apply) console.log("dry run — nothing written (add --apply)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
