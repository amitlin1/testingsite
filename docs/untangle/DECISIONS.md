# Untangle — decision log (branch `refactor/untangle-codebase`, from main 3b74211, 2026-11-24)

Skill: untangle-codebase (caldoai/skills). Additions chosen by Amit: **Comments + Tests**. After it: ponytail trim of the whole diff.

Per-area problem lists (file:line, with every problem under the fix that solves it) were written by 7 audit agents;
they are the detailed log this file summarizes. Each area's implementation works from its own list:
`A` settings/testing-routes · `B` testing-station flow · `C` station fields, popup templates, settings API, reference items ·
`D` metrics, dashboard, time · `E` item reports, files · `F` packages, shipments, items, search · `G` platform, auth, ui kit.

## Baseline (before any change)
- `tsc --noEmit` clean (after `prisma generate` — the client was stale after the pull) · `eslint` 0 problems.
- `npm test` with a throwaway DB (docker `untangle-test-pg`, 127.0.0.1:5491, all 41 migrations): 752 tests, 749 pass.
  Pre-existing failures (main, untouched): `metrics-selfcheck answers 200` (240 s timeout), `#12 regular route: the
  in-tx step assignment … two events`, `reference images go by station: an unassigned image …`.

## Rules every change follows
- Intended behavior stays the same. API URLs and JSON shapes stay the same (UI + scripts/e2e-packages depend on them).
- No DB schema change, no migration. `Autocomplete.tsx` behavior untouched (owner's OK needed).
- No MUI. Never write test-station method names. `typeAsUsKeyboard` scan fields are deliberate.
- Durations ship in two clocks on purpose. Never fake a number the API cannot answer.
- Bugs found are NOT fixed separately; they are listed for Amit (section "Bugs for the owner"). A structural fix that
  fixes one on the way is fine and is noted.
- Lower layers never import higher ones: `src/lib` and `src/components` never import `src/app`.
  A feature's client-safe contract never imports prisma.

## The redesign — cross-cutting decisions (the one fix behind many problems)

### X1. Infrastructure lives at the bottom (`src/lib`)
- `src/lib/db.ts` — the Prisma client (was `src/app/lib/prisma.ts`, 158 importers, 5 of them in `src/lib` reaching up).
- `src/lib/http/` — the server HTTP contract:
  `HttpError(status, message, {code?, extra?})` → body `{error, code?, ...extra}` (reproduces the 4 current contracts);
  `errorResponse(e, fallback)` (logs unknown / ≥500, answers `{error: fallback}` 500 — no raw DB text to the browser);
  `readJsonObject(req)`, `parseDbId`, `isDbId`, `INT4_MAX`. Every domain error (`PackageError`, `AdminFieldsError`,
  `TemplateStoreError`, `RouteStepsError`, `ReferenceSaveError`, `StepBackError`, `ReportSignError`, `AdminError`,
  `PeriodError`, …) extends `HttpError`; routes throw, one responder maps.
  Solves: 9 error classes with 9 responders, 7 int4 checks, 4 JSON readers, 3 AdminError mappers, 500s leaking DB text.
- `src/lib/json-guards.ts` (isPlainObj/own/isStr/isInt/isNum/oneOf/size check — copied 9+ times) and
  `src/lib/random-id.ts` (id minting, today borrowed from route-step rules).
- `src/lib/item-status.ts` — `ItemStatus` named ids + names + tones (merges status-names/status-tones; ~101 bare literals).

### X2. Who-may-do-what in one table (`src/lib/auth`)
- `roles.ts` owns `APP_ROLES`, `ROLE_LABEL`, `isAppRole`, and a named `ACCESS` map. `ROLE_PROTECTED`, every
  `withAuth({role})`, client checks (`useCan`) and the users screen's role panel read it. Values identical.
  Solves: role sets ×6, Hebrew role labels ×3, a permissions change touching 12 files (e2951c4), `src/lib → src/app` edge.
- `withAuth<P>` is typed and hands the handler awaited `params`; `isLiveSession` is the one "signed in" rule.
  Solves: 25 casts, 8 `RouteCtx` copies, 7 URL re-parsers, 5 spellings of "session alive".
- `identity.ts` (`identityOf`, `workerIdOf`, `actorFromSession`) and `base-path.ts` (`SERVER_BASE_PATH`, `loginUrl`,
  `noAuthUrl`). Solves: display-name chain ×8, worker id ×3, login URL ×6, base-path env ×6.
- One shared integration-test session stub (7 copies tied to auth.ts's module-cache key).

### X3. One client data contract (`src/lib/api/client.ts`)
`apiFetch` + `getJson`/`sendJson`/`ApiError` (moved from packages/board/queries.ts). Solves 59 hand-rolled
`res.json().catch` sites, 3 raw fetches that skip the silent refresh, private copies of getJson that drop the message.

### X4. Each feature owns a client-safe contract
`src/app/lib/<feature>/contract.ts` (or the existing `admin-types.ts` / `api-types.ts`): wire types, constants and
pure parsers, no prisma import. Server modules import prisma and return the contract types; clients import only the
contract. `src/types/index.ts` is split by owner into these. Solves: every wire type written twice (route + client),
~20 client files importing the prisma module `packages/read.ts` for a type, `CommandPalette` importing route files.

### X5. UI kit owns UI primitives
`SearchableCombobox`, `FieldLabel`, the toast (`useToast` — 19 hand-rolled snackbar state machines), dialog focus
return (4 `setTimeout(0)` focus fixes), the `.pkg-*` controls that every screen borrows from `packages.css`, the
signature pad, scan sound. Dead kit exports and the unused MUI-style theme palette go.

## Work order and file ownership
Waves run one after another; agents inside a wave run in parallel on disjoint files. An agent that renames an export
updates every caller (mechanical edit only); if a caller belongs to an agent running in the same wave, it keeps a
compatible re-export instead and lists it here, and the cleanup wave removes it.

1. **Foundation** (X1–X5 core + `types/index.ts` split + prisma move codemod).
2. **Areas, parallel:** G-rest (users admin, navigation registry, kit cleanup, small settings pages, auth de-dup) ·
   C · D · E (also owns `settings/testing-routes/components/report/**`, moved to the report feature) ·
   F (also owns `settings/packages/**` and the package template module).
3. **Areas, parallel:** A (`settings/testing-routes/**` minus report) · B (testing flow, `api/testing/**`).
4. **Check:** fresh subagents hunt for special cases / hidden links / needless links / surplus left; fix; repeat.
   Then tsc, lint, unit + integration tests, build, e2e on pkgtest.
5. **Ponytail:** trim anything the refactor added that the need does not justify.

Each area also does its Comments sweep, and its Tests sweep last.

## Not done on purpose (owner decisions)
- B-F2b: running the code popups through the template engine (high risk, changes saved data paths).
- `/packages/old` and the converted-box relabel (F Fix 10).
- Adding role guards to the ~25 unguarded settings writes, the package delete, `/api/files` — behavior change.
- `client.ts:44-48` retry-before-trusting-a-terminal-report — changes auth behavior.

## Progress
- **Wave 1 (foundation) — done.** prisma → `src/lib/db.ts`; `src/lib/http/{errors,request}.ts` (12 error classes extend
  `HttpError`); `src/lib/item-status.ts`; `src/lib/auth/{roles (ACCESS, ROLE_LABEL), session, identity, testing}.ts`,
  typed `withAuth<P>` (25 casts, 8 RouteCtx copies, 7 URL re-parsers gone); `src/lib/base-path.ts` login/no-auth URLs;
  `getJson`/`sendJson`/`ApiError` in `src/lib/api/client.ts`; `src/types/index.ts` split into
  `src/app/lib/{packages,items,shipments,testing,search}/contract.ts`; SearchableCombobox/FieldLabel into the ui kit;
  command palette → `src/app/components/command-palette/`; kit toast mounted once.
  Behavior: 500 fallback no longer returns raw error text (packages routes); one display-name rule; middleware login
  redirect uses `encodeURIComponent`. tsc 0 · eslint 0 · unit 538/538 · integration as baseline (flaky DB race noted).
- **Wave 2 — done.** C: `route-store.ts`, wire types only in `admin-types.ts`, `src/lib/{json-guards,random-id}.ts`,
  `src/app/lib/lookups.ts` (one read per lookup table + settings CRUD kit), reference items → `src/app/lib/reference-items/`,
  popup-template rules in `popup-templates/`; `/api/testing-routes` deleted (no callers). D: `src/lib/time/civil.ts`,
  `metrics/{ledger,read}/`, `src/app/lib/jobs/`, `dashboard/contract.ts` (one adapter per endpoint, `_new_` fields read
  only there), one dashboard route shell, one cron shell, `requestCalendarRebuild()`, dashboard client in
  `dashboard/tests/{_lib,_components}`. E: `src/lib/storage/`, `src/lib/file-types.ts`, report lib split
  (`source/build/lifecycle/document/contract/variables`), report editor → `src/app/components/item-report/`
  (PDF HTML byte-identical on 10 templates). F: `lib/packages/{lifecycle,rules,template}.ts`, `lib/shipments/{save,read,
  boxes,worker}.ts`, kit gets colours/controls/ArtboardDialog/SignaturePad, one labels module, `useIdleScan`,
  `usePrintWhenReady`, `/items/_components`; dead routes `items/[id]/recommend-station`, `GET shipments/[id]/items`
  deleted (no callers). G-rest: `src/app/navigation.ts`, `applyClaims` + `keycloak-env.ts` + `timing.ts` in auth,
  `src/lib/users/rules.ts`, `useListQuery` (React Query) for settings lists, 31 dead kit exports + theme.ts + 5 unused
  radix packages removed, 33 new unit tests on auth/routing helpers.
  Behavior (error paths / small UI): malformed JSON → 400 instead of crash; bad path ids → 404 instead of 500; settings
  lists refetch on window focus and retry once; destructive confirms don't drag; dashboard sends calendar dates
  (same numbers; a window across the October clock change now compares 7 days with 7, not 8); work-hours net hours with a
  break outside working hours now match the ledger (B-11).
  tsc 0 · eslint 0 · unit 665/665 · integration 879 tests, 876 pass — the same 3 baseline failures.
- **Wave 3 — done.** A: `testing-routes/lib/{wire,api,resources,fieldsContext,cellGroups,optionFields,cellFill}.ts` —
  one data layer, one "put fields into a cell" walk (paste, apply-set, preview and TSV paste can no longer differ), the
  area's 3 import cycles gone, the unreachable item-route mode removed client-side (server untouched), shared
  `useFieldListEditor`; kit `Dialog` returns focus (4 `setTimeout(0)` hacks gone), `Menu` ignores disabled clicks.
  B: `lib/testing/{contract,popup-kind,queue-rule}.ts`, one testing client (`testing/api.ts`), page.tsx 1,932 → 454
  lines (queue, worker, scan, step-back, test window, result dialogs moved out; the 1 s clock runs per timer, not per
  page), results route 1,124 → 94 lines over write-path services (ledger events, order and tx options unchanged),
  the popups' import cycle gone. W: wave-2 shims removed, integration harness → `src/test-support/db-harness.ts`, one
  `getArray`, settings item-types routes on the lookups kit, dates in one `datetime.ts`.
  Test fix: the report-freeze suite now waits for the fire-and-forget registry row (a pre-existing race).
  tsc 0 · eslint 0 · unit 702/702 · integration 916 tests, 913 pass — 2 baseline failures + the race above (fixed).
  No import cycles (was 5); no src/lib|src/components → src/app imports (was 21). src TS: 119,256 → 114,504 lines.
- **Check round 1 — done.** 4 fresh reviewers found ~280 special cases left (about half removable). Fixed in round 2:
  S (server): `ledgerWrite` frames all 10 ledger-writing handlers (3 had no schema gate), `eventKeyOf` builds event
  keys from their parts (stored bytes unchanged), one id-parser family, status groups/predicates/`StationStatus` in
  `src/lib/item-status.ts`, one default-route rule, work-hours/users/report/file handlers on the HTTP kit, 9
  pass-through error classes gone, scanner keys → `src/lib/scan`. W (worker screens): one failure-text rule
  (`components/failureText.ts`), 7 screens on React Query + `getArray`, popups lose the never-changing `open` prop,
  `useTestWindow` owns start/step-back, the settings preview reuses the testing rules. U (settings/dashboard/kit): one
  dashboard filter table on client and server, lookup contract + saves invalidate pickers, the server owns the unique-
  name rule, one tone vocabulary, settings.css split, testing-routes resources on React Query. Z: every shim removed,
  23 moved paths fixed in docs. Special cases removed this round: ~73; the ones left are needed (reasons in the reports)
  or owner decisions.
  tsc 0 · eslint 0 · unit 712/712 · integration 933 tests, 932 pass (baseline "reference images go by station") · build ok.
- **Ponytail trim — done.** 3 trimmers cut what the refactor added without need: ~190 lines net, 5 files (one-caller
  modules inlined — e.g. `packages/box-edit.ts`, `PackageQueueEntry`, the page's EmptyState/QueueFilter; unused
  options — Toast `action`, `useListQuery` `enabled`, withAuth's single-role form, popup-template `db` params; aliases
  and dead exports; refactor-history comments; dead CSS). Kept: every helper with 2+ real callers, the domain
  splits, all tests of real logic.
- **Final state.** tsc 0 · eslint 0 · unit 712/712 · integration 933 tests, 932 pass (only the baseline "reference
  images go by station") · `next build` ok · no import cycles · no src/lib|src/components → src/app imports.
  src TS 119,256 → 113,800 lines; 662 → 783 files (smaller modules, one reason to change each).
  NOT done: e2e on pkgtest (swaps the testers' container — owner's call); no screen checked in a browser.
- **Dev mode without Keycloak (Amit, 2026-11-25).** The half-wired `IS_DEV=1` (middleware open, APIs 401) is now a
  full local sign-in: `src/lib/auth/current-session.ts` gives every server read and `/api/auth/session` one local user
  (`DEV_USER`, `DEV_ROLES` default manager, `DEV_EMPLOYEE_NUMBER`). Off whenever NODE_ENV=production (next build/start,
  the Docker image) — `isDevAuthBypass` + its unit test. Documented in env.local.example.
- **Side-by-side check, main vs branch (same seeded DB, cloned; both in dev mode, one server at a time).**
  GET API: 108 requests, 96 identical; the 12 others = 7 deleted dead routes (404), 4 dashboard "current age" numbers that
  grew by exactly the 13 min between the two captures, 1 `blocked-packages` without stationId (main answered [] because
  Number(null)=0 slipped past its own "required" check; the branch answers that 400; the only caller always sends it).
  Screens: 29 pages, 28 identical text, 27 pixel-identical (dashboard: clock digits; one station page: the caret blink).
  e2e (scripts/e2e-packages, all 8 suites): 145/145 checks with the same outcome; 33/35 failure messages identical —
  the other 2 show /api/workers-directory requested twice instead of three times (shared React Query fetch).
  The e2e failures on both sides come from the environment (no Keycloak → workers-directory 502; demo data ≠ pkgtest).
- **UI parity check (2026-11-25), main vs branch, dev mode, fresh identical DB clones, one server at a time.**
  Manager: every page × 5 widths (1920/1440/1280/1100/900) + every button/tab/combobox clicked from a fresh load =
  519 screenshots; tester and storekeeper: every page at 1440 = 51 each. Clock-dependent text masked, animations and
  the caret off, iframes compared by content hash.
  Result: 0 text differences, 0 differences in the set of buttons per page, 0 native dialogs / new windows that
  differ. 387/519 manager screenshots pixel-identical (main vs itself across two runs: 346/519). The rest: ≤2/255 on
  antialiased icon / rounded-corner edge pixels (same DOM, every computed property, same composited layers —
  repaint timing), Next's dev-tools badge (dev only), and screens main itself varies on (clock, the random temporary
  password). Two causes found and fixed on the branch: the inline `style` on `<body>` that the refactor had dropped
  (restored — it changed edge-pixel rounding), and work-hours page reads that logged `console.error` on a 403 for
  roles without access (back to silent, as on main). Two tester-role differences were a cold server finishing async
  panels late; warm, they are pixel-identical to main.
- Open bugs, owner decisions and every behavior difference: **docs/untangle/OWNER-LIST.md** (Hebrew).
