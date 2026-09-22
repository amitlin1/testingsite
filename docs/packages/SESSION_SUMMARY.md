# Package model — session summary and review handoff

Branch `feat/package-model` (base `main`). Work done 2026-09-15 → 2026-09-17 in one Claude Code
session; written for a reviewing agent that has this repo checked out. Later work on the same
branch by another session is listed at the end so it is not mistaken for part of this one.

Everything described here is committed unless a section says otherwise. Revised 2026-09-22 after a
review pass; what that pass changed is in [REVIEW-scroll-and-fields.md](REVIEW-scroll-and-fields.md)
§0 and is uncommitted (see §10).

---

## 1. What changed, in one paragraph

The "parent item / accessory" model (`items.parent_item_id`, `test_stations_type.parents_only`)
was replaced by "package / package item" (מארז / פריט במארז). A package is an `items` row whose
type has `item_types.is_package = true`; it has its own testing route; the items inside point at
it via `items.package_id` and carry `package_seq` (01..99). Ids are 16 digits
`1 CCC ddMMyy NNNN SS` (package `00`). Package-level station types (`package_level`) open and
close a package: opening group-starts the box and its items, each item then runs its own route,
and they meet again at the closing type — a box that arrives before its items waits in the new
status 6 `waiting_for_package_items`. Shipments declare package types only. The whole rewrite
plan and every closed decision are in [PLAN.md](PLAN.md) (§9 = decisions, §10 = status, §11 =
interpretations that still deserve a nod from the owner).

Design came from an external Claude Design round-trip; the handoff package is
`claude-code-handoff/packages/` (start at `START_HERE.md`, then `IMPLEMENTATION_PROMPT.md`,
artboards in `design/*.dc.html`). Where the design contradicted the agreed logic, what was
implemented and what is still the owner's call is in [DESIGN_REVIEW.md](DESIGN_REVIEW.md).

---

## 2. Commits to review (oldest first)

| Commit | Phase | What it is |
|---|---|---|
| `519bf10` | 1 | Schema + Prisma migration `20260915120000_package_model`, id helpers (`ids.ts`), package creation path, templates (`package_contents`) |
| `cf01cc1` | 2 | Routing: group start/release, route-shape rules, readiness gate (status 6), whole-box reset on retype after opening |
| `86eb0c2` | 4 | Ledger reads and dashboard vocabulary (`package_id`, `is_package_item`, new state) |
| `45aa861` | 5 | Legacy conversion script `scripts/convert-legacy-to-packages.mjs` (node, dry-run/apply) |
| `9a53807` | — | First run against a real DB: ledger reason vocabulary (CHECK constraint replaced under the metrics guard), test fixes |
| `ae1983e` | 3a | Settings → מארזים screen, package read model + read APIs, navigation |
| `1f10d2b` | 3b | `/packages` list, `/packages/[id]`, intake / labels / edit / delete / last-item dialogs |
| `b7a5c7a` | 3c | Testing screen: package-level queues, opening + closing wizards, blocked-packages banner |
| `a7758a2` | 3d | Shipments by package type, "המארז שלי" card on item screens, command-palette search |
| `8018ca0` | fix | `is_package` lives on `item_types`, three raw queries had read it from `items` |
| `254f1e2`, `7167b8b` | prod | Read-only production diagnostic SQL |
| `2e94b6e`, `e28394a` | prod | Production migration + data-fix SQL, one-shot upgrade, backup script |
| `9f6ca5b` | fix | Closing decision dialog reset itself every second (found by the browser tests) |
| `8e32f26` | fix | Command palette "לוח ניהול" linked to the 404 `/dashboard` (pre-existing) |
| `0382a7a` | tests | Browser test suite `scripts/e2e-packages/` |

Useful diffs: `git diff main..0382a7a --stat` for the whole picture; each phase commit message
lists its own scope. Two later commits by the owner, `a38dc93` ("85454") and `277fc3d` ("5454"),
should be reworded before a pull request; and because phases 1/3a/3c import
`@/lib/api/direct-upload`, which `a38dc93` added, the branch does not build at any commit before it.

---

## 3. Where the code lives

- **Domain logic** `src/app/lib/packages/`: `ids.ts` (id format), `create-package.ts`
  (intake + add item), `route-rules.ts` (route shape checks), `context.ts` (is this row a box /
  in a box, is this station type package-level), `readiness.ts` (the closing gate, status 6),
  `reset.ts` (retype → whole box back to opening), `read.ts` (`PackageView`, list / detail /
  timeline), `settings.ts`, `shipment-types.ts`, `errors.ts` (`PackageError` → HTTP codes).
- **APIs**: `src/app/api/packages/` (list, create, detail, PATCH, DELETE cascade, add item),
  `src/app/api/settings/package-types/`, `src/app/api/settings/item-types/[id]/contents/`,
  `src/app/api/testing/blocked-packages/`. Changed existing routes: `testing/items` (attaches each
  row's package view), `testing/stations` (`packageLevel`), `testing/start-test` and
  `release-test` (group start / release), `testing/results` (per-item and box results, the gate),
  `testing/locate-by-barcode` (`waitingForPackageItems`), `items/[id]` (package view, reset on
  retype, last-item rule), `search/items`, `shipments` (+ `[id]`, package-type validation and
  box counters).
- **Screens / components**: `src/app/packages/`, `src/app/settings/packages/`,
  `src/app/components/packages/` (dialogs, `PackageIdText`, `MyPackageCard`, `packageUi.ts`
  tokens), `src/app/testing/tests-popups/Package*.tsx` (wizards, shell, decision dialog),
  `src/app/components/testing/PackageQueueCard.tsx`, `src/app/testing/page.tsx`,
  `src/app/components/shipments/*`, `src/components/CommandPalette.tsx`.
- **Removed**: the old add-item form (`insertPopup.tsx`, `AddItemDialog.tsx`) and the old
  "קליטה וצילום" / "אריזה" wizards (`Photo.tsx`, `Packaging.tsx`).
- **Prisma**: `prisma/schema.prisma`, `prisma/migrations/20260915120000_package_model/migration.sql`.
  The migration replaces a CHECK constraint on a metrics table; that is declared to
  `scripts/check-migration-safety.js` with a `-- metrics-guard: intentional-drop` marker (see
  `docs/PRISMA_UNMANAGED_OBJECTS.md`).

---

## 4. Production upgrade kit — the part that touches real data

Production (`testingsite` on the customer's DB server) is still on the pre-package schema. The kit
is three files in the repo; the operator runs copies outside it (where they live on this machine is
in §6, with the rest of the machine-local state):

| Run order | Source in repo | What it does |
|---|---|---|
| already run (2026-09-17) | `scripts/diagnose-legacy-for-packages.sql` | Read-only diagnostic (temp table + DO block, SELECTs only, adapts to old/new schema). |
| 1 | `scripts/prod-package-model/1-backup-before-packages.ps1` | `pg_dump -Fc` inside the `postgres` container, copied out with `docker cp`, verified with `pg_restore --list`, then **restored into `<db>_restorecheck` and its row counts compared** before the scratch DB is dropped (`-SkipRestoreCheck` skips); prints the restore commands. |
| 2 | `scripts/prod-package-model/2-upgrade-to-packages.sql` | ONE `DO` block (atomic, no BEGIN/COMMIT for the operator): preconditions → the Prisma migration verbatim (`SELECT setval` → `PERFORM`) → `_prisma_migrations` row with the file's sha256 → all data fixes → `legacy_id_map` table (with `relabeled_at`, read by the app) + two result sets (report, old→new ids). Refuses to run twice. |

`2-upgrade-to-packages.sql` is **generated** by `scripts/prod-package-model/build-upgrade.mjs`
from the migration file and `scripts/prod-package-model/03-fix-production.sql` (the data-fix
source of truth, with the CONFIG block). `02-migrate-production.sql` is the migration alone
(same bookkeeping) for anyone who prefers two steps. Edit `03`, rerun the builder, re-copy to E.

**Production findings (from the diagnostic, 2026-09-17):** 1 shipment (`4908464746`), 108
declared (KVM 4 PORTS ×54, KVM 8 PORTS ×54), 110 items registered, all top-level, none
tested (0 results, 0 station history), 6 waiting for research (status 4 at step 1), 3 with
attached files, 2 orphan `item_routes` rows, 4 duplicate serials, 0 package types defined,
station types: צילום (#1, the only `parents_only`), פירוק, שיקוף, מראה שחורה, הרכבה, אריזה
(#6), דוח סופי (#7); KVM routes `1→2→3→4→5→6→7`, "מחשב" route `1→…→6`.

**What the CONFIG in `03` / `2-upgrade` assumes (owner-approved on 2026-09-17):**
- opening = צילום, closing = אריזה; "דוח סופי" is removed from item routes (a package-level
  step is only allowed first and last; the final report comes from the package page);
- package types created: "מארז מחשב" (מחשב ×1, עכבר ×1, מקלדת ×1 — the two latter item types
  are created if missing), "מארז KVM 4 PORTS", "מארז KVM 8 PORTS" (one item each);
- legacy map: every KVM 4 / KVM 8 item becomes a box of its own type (owner chose this over
  deleting them); the shipment's declared lines are re-typed to the package types, amount = 108;
- the 6 research items are converted and put back to waiting (their `research_history` rows
  move to the new id); the 3 items with files are converted and `file_objects.entity_id` is
  re-pointed (objects stay under the old key — listing is by registry, verified);
- orphan routes deleted with `metrics_forget_item`;
- `cfg_strict` differs between the two forms, deliberately: **false in `03`** (a manual dry run
  reports every blocked group and rolls back with the full report) and **forced to true by the
  builder in `2-upgrade`** (any blocked group aborts the one-shot, nothing half-done). So a clean
  dry run does not by itself prove the one-shot will not abort — read the blocked-group lines of
  the dry-run report.

**Verified on this machine:** `2-upgrade` on an old-schema clone of the dev DB (dev config):
migration applied and recorded with the right checksum, converted groups got 16-digit ids,
`route_run` + open `queued` intervals + `legacy_import` events, no ledger rows left for deleted
ids, second run refused. The backup script produced a valid dump of the dev DB.

**Not done / owner's steps:** stop `next-app` in production → backup (the script now rehearses
the restore) → upgrade → **check `MINIO_PUBLIC_ENDPOINT` from a browser on the shop floor** (a wrong
value now blocks "המשך" in the wizards instead of silently losing photos, so it will be noticed at
the first box, but it should be right before that) → deploy the image built from this branch →
print new labels for the 110 boxes from `/packages` → "מדבקות למארזים שהוסבו" (one bulk print;
marks them relabeled through `POST /api/packages/converted`). Until a box is relabeled its old
label still scans: `locate-by-barcode` resolves it through `legacy_id_map` and the testing screen
says to reprint.

---

## 5. Test evidence

- **Integration suites** (`npm test`, needs `TEST_DATABASE_URL` → `testingsite_metrics_test`):
  144 / 144 (2026-09-22; was 143 / 144 — the one failure, the §2.8 p95
  queue age on `tests/by-station` without a work-clock twin, is fixed: `_new_p95QueueAgeWorkMinutes`
  ships beside it). Suites #16–#19 in
  `src/app/lib/metrics/__tests__/write-path.integration.test.ts` cover the package routing.
- **Browser suites** `scripts/e2e-packages/` (puppeteer-core + local Chrome, README inside),
  run against the new build on this machine:

  | Suite | Covers | Result |
  |---|---|---|
  | `01-smoke` | login, every screen, every read API | 22/22; rerun 2026-09-22: 22/22 |
  | `02-flow` | API lifecycle: intake → opening → item stations → status 6 → closing → done | 29/30 on 2026-09-17 (the 1 was a deliberate 409 logged as a console error, filtered since); rerun 2026-09-22: 30/30 |
  | `03-wizards-ui` | both wizards in Chrome incl. real MinIO uploads, dialogs, palette | 37/37; rerun 2026-09-22: 37/37 |
  | `05-rules` | retype reset, last item, cascade delete, shipment validation, settings API, "never arrived" decision, dashboard | 30/30; rerun 2026-09-22: 30/30 |
  | `07-hydration` | browser errors per page | 9/9; rerun 2026-09-22: 9/9 |
  | `08-scroll-fields` | `/packages` internal scroll, the dense combobox contract | 2026-09-22: 60/60 |

- **Bugs the browser tests found** (both fixed and committed): the closing decision dialog
  wiped the worker's choice every second (`PackageDecisionDialog` reset effect keyed on a
  per-render object while the testing page re-renders on its clocks); the palette's dashboard
  link. Also found: the wizards let a photo upload fail silently (badge "ההעלאה נכשלה" but
  "המשך" stays enabled) — **fixed 2026-09-22**: a failed shot blocks the step (and finishing at
  the regular photo station) until it is removed and retaken.

---

## 6. Environment on this machine (dev box, not production)

- `next-app` container now runs image `testingsite-next-app:packages` (built from the working
  tree) against DB **`testingsite_pkgtest`** (dev data + the upgrade with a *dev* config:
  opening אשף קליטה #5, closing בדיקת סביבה #8, package types 13–16), behind the same nginx /
  Keycloak / MinIO, reachable at `http://10.10.200.120`. The live dev DB `testingsite` is
  untouched (old schema). The container was recreated with
  `docker compose -p testingsite -f prod-deploy/app-server/docker-compose.yml -f <override> up -d --no-deps next-app`
  (+ `docker restart nginx`); the override sets the image tag, `DATABASE_URL` and
  `MINIO_PUBLIC_ENDPOINT=http://10.10.200.120:9000`. Revert = same command without the override.
- Other DBs created for verification: `testingsite_packages` (dev data + Prisma migration
  only), `testingsite_prodsim` (old-schema clone used for dry runs). Safe to drop.
- Keycloak test user `pkgtest` (employeeNumber 9902, roles manager/tester/storekeeper), created
  through the admin service account; `node scripts/e2e-packages/kc-test-user.mjs delete` removes it.
- Gotcha worth remembering: with `MINIO_PUBLIC_ENDPOINT` empty the browser is told to upload
  to `host.docker.internal:9000`, which times out from Chrome on the host; uploads then stay
  `pending` in `file_objects`. Since 2026-09-22 the wizards refuse to continue past a failed
  shot, so this is loud rather than silent — but it is still a precondition of the deploy (§4).
- Operator copies of the production kit on this machine: `E:\package-model\`
  (`1-backup-before-packages.ps1`, `2-upgrade-to-packages.sql`, the diagnostic as
  `01-diagnose-production.sql`, and its production output `diag_202609170032.csv`). Refreshed
  2026-09-22 after the builder change; byte-identical to the repo sources at that time.
- `testingsite_pkgtest` had `legacy_id_map.relabeled_at` (+ index) added by hand on 2026-09-22 —
  the same DDL the rebuilt one-shot creates — so the relabel path could be exercised there.

---

## 7. Open decisions (owner)

From [DESIGN_REVIEW.md](DESIGN_REVIEW.md), all implemented with a default and awaiting a yes/no:
1. Reference-item (RU) gate in the opening wizard was dropped by the design; lookup is automatic
   and silent, a soft note when none exists.
2. "Photos and weights are deleted" on a retype reset was in the design; nothing is deleted
   (history is kept, PLAN §4).
3. Separate `/packages` page (design) vs "packages expanded inside the items page" (decision 17).
   **Close this before the scroll/combobox work merges**: the fixed-height `/packages` layout,
   `packages.css` and browser suite 08 all assume the separate page.
4. The design's Items artboard still had a tiny "הוסף פריט" dialog; removed, items are only
   created through package intake.

The failed-upload question from testing is settled by the safe default: it blocks (§5).

---

## 8. Known gaps

- Not exercised: a physical barcode scanner, printing on a real label printer (only the print
  dialog path), dashboard numbers with packages (only that pages render), concurrent workers,
  OnlyOffice.
- The conversion script only converts untouched groups (by design, PLAN §8); production has
  none touched, but any site with tested legacy items would keep them as loose legacy items,
  which still flow through regular stations and appear as item rows even at package-level ones.
- `scripts/e2e-packages` resolves the ids it needs by name after login (`resolveConfig` in
  `lib.mjs`; env overrides in the README), so the suites run against any database. Suites 04 and
  06 never existed; the numbering gap is noted in the README.

---

## 9. Suggested review focus

1. **Transactions and the ledger** in `results/route.ts` (box + item results under one
   `SubmitID`, the gate recheck in the same transaction), `start-test` / `release-test` group
   semantics, `reset.ts` (what a reset abandons in `route_run`).
2. **`2-upgrade-to-packages.sql`**: preconditions, `daily_counters` use for the historical
   date part, `metrics_forget_item` / `metrics_record('legacy_import')` calls, the shipment
   line re-typing, and that the CHECK-constraint replacement is guarded.
3. **Route-shape rules** (`route-rules.ts`) vs. what the settings screens let a user save.
4. **Shipments counters** (`api/shipments/route.ts` CTE) now count boxes; anything else that
   read `sampled_amount` as items.
5. **Search** (`api/search/items`) and the palette rows for boxes vs items.
6. The wizards' result payloads (`Details` shapes in `PackageOpenWizard` / `PackageCloseWizard`)
   against what `read.ts` derives `pack_decision` / `state = missing` from.

---

## 10. Later work on this branch, not part of this session

- `a38dc93` "85454" (2026-09-17): the owner's direct-MinIO-upload (presigned) work, committed by
  the owner. Phases 1/3a/3c depend on it (`@/lib/api/direct-upload`), so the branch now builds
  on its own.
- `277fc3d` "5454" (2026-09-17): the design handoff folder `claude-code-handoff/packages/` added
  to git.
- **Uncommitted in the working tree** (another session, written up on 2026-09-22): internal
  scroll on `/packages` and the shared `SearchableCombobox` in every package field, with its
  own review doc [REVIEW-scroll-and-fields.md](REVIEW-scroll-and-fields.md) and test
  `scripts/e2e-packages/08-scroll-fields.mjs` — plus the review pass of the same day (that
  doc's §0): the combobox behaviour moved into the `Autocomplete` primitive, the dialog
  z-index fix, failed uploads blocking, the legacy-barcode fallback and bulk relabel (new API
  `/api/packages/converted`, `relabeled_at` in the upgrade's `legacy_id_map`, builder rerun),
  the §2.8 p95 twin, the e2e ids by name, the backup restore rehearsal, and the guard entry for
  `legacy_id_map`. Commit it together with this summary, which links to it.
