#!/usr/bin/env node
/**
 * Baseline an existing database for Prisma Migrate.
 *
 * Use this ONCE on a database whose schema already matches `prisma/schema.prisma`
 * but was populated outside Prisma (e.g. by running migration.sql files manually).
 *
 * It iterates over every folder in `prisma/migrations/` (sorted by name, which is
 * timestamp-prefixed) and runs `prisma migrate resolve --applied <name>` for each.
 * That writes a row to `_prisma_migrations` marking the migration as already
 * applied, WITHOUT executing its SQL.
 *
 * After this, `npm run db:status` should report "Database schema is up to date"
 * and future `npm run db:deploy` will only apply NEW migrations.
 *
 * Usage:
 *   DATABASE_URL="postgres://USER:PASS@HOST:PORT/DB?schema=public" \
 *       node scripts/baseline-prisma-migrations.js
 *
 * Re-running is safe: migrations that are already recorded will be skipped.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const migrationsDir = path.join(__dirname, "..", "prisma", "migrations");

if (!fs.existsSync(migrationsDir)) {
  console.error(`✗ Cannot find ${migrationsDir}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "✗ DATABASE_URL is not set. Point it at the database you want to baseline, e.g.:\n" +
      '  $env:DATABASE_URL="postgres://..."; node scripts/baseline-prisma-migrations.js  # PowerShell\n' +
      '  DATABASE_URL="postgres://..." node scripts/baseline-prisma-migrations.js          # bash'
  );
  process.exit(1);
}

const migrations = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort(); // alphabetical == chronological because of the timestamp prefix

if (migrations.length === 0) {
  console.error("✗ No migration folders found.");
  process.exit(1);
}

console.log(`Found ${migrations.length} migration(s) to baseline:\n`);
migrations.forEach((m) => console.log(`  • ${m}`));
console.log();

let succeeded = 0;
let skipped = 0;
let failed = 0;

for (const name of migrations) {
  process.stdout.write(`→ ${name} ... `);
  try {
    execSync(`npx prisma migrate resolve --applied ${name}`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("OK");
    succeeded++;
  } catch (err) {
    const stderr = (err.stderr || err.stdout || Buffer.from("")).toString();
    // Prisma exits non-zero if the migration is already recorded as applied.
    // Treat that as "skip" — running this script twice should be a no-op.
    if (
      /already (recorded as )?applied/i.test(stderr) ||
      /already in the migrations table/i.test(stderr)
    ) {
      console.log("already applied (skipped)");
      skipped++;
    } else {
      console.log("FAILED");
      console.error(stderr.trim());
      failed++;
    }
  }
}

console.log();
console.log(`Summary: ${succeeded} marked applied, ${skipped} skipped, ${failed} failed.`);
console.log();
console.log("Now run:  npm run db:status");
console.log("Expected: \"Database schema is up to date!\"");

process.exit(failed === 0 ? 0 : 1);
