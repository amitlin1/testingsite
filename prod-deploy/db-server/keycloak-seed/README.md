# Keycloak seed — the realm, as SQL

This is how Keycloak gets its configuration and its user accounts. Two files,
run in DBeaver against the `keycloak` database, in this order:

1. **`keycloak-seed.sql`** — a complete copy of the development Keycloak
   database: the `testing` realm, both clients with their secrets, the roles,
   the `shifthouse` login theme settings, the token lifespans, and the user
   accounts with their password hashes.
2. **`fixup-after-restore.sql`** — points that copy at *this* server. Edit the
   one line marked `<<<< EDIT THIS`, then run the whole file.

**Keycloak must be stopped while both run.** Realm and client data are cached in
memory (Infinispan); editing the database underneath a running Keycloak leaves
it serving the old values with nothing logged to say why.

```powershell
# on the APP server
docker compose stop keycloak
#   ... run both files in DBeaver on the DB server ...
docker compose start keycloak
```

## Why the fixup is mandatory

The seed is a copy of the *development* environment, so it needs three things
corrected before it is usable here. The fixup does all three:

**1. Every client URL still says `http://localhost`.** Until they are rewritten,
login fails with *"Invalid parameter: redirect_uri"* — Keycloak refuses to send
the browser back to an address the client is not registered for.

This is not a simple find-and-replace. The dev realm registers *both*
`http://localhost:3000/*` and `http://localhost/*` for the login client, and
once the host is the same those two rows collapse into one value — which
violates the unique constraint on `(client_id, value)`. The fixup inserts the
de-duplicated results and drops the originals instead of running an `UPDATE`.

**2. The restored tables belong to the wrong role.** You will run the seed in
DBeaver as the admin/superuser, which makes that account the owner of all 100
tables. Keycloak connects as the `keycloak` role and would fail to start with:

```
ERROR: permission denied for table databasechangelog
```

before doing anything else. The fixup re-owns every table, sequence and view, so
it does not matter which account performed the restore.

**3. Dev sessions come along for the ride** and would appear as phantom
logged-in users. The fixup clears them.

## Secrets — what carries over, and what that means

The client secrets for `testing-web` and `testing-admin-api` are stored **inside
this database**, so they arrive with the seed unchanged. That is the point: the
app server's `.env` already contains those same values, so the two sides agree
on first boot and there is nothing to regenerate or copy out of the admin
console.

The consequence is that production runs with the **development secrets**, and
the seeded accounts keep their **development passwords**. On a closed network
with no route in, that is a deliberate trade for a same-day install — but it is
a starting state, not a finished one:

- **Change the account passwords** from the app's *ניהול משתמשים* page as your
  first action after logging in, and delete the accounts you do not need.
- **To rotate a client secret**, change it in *both* places or login breaks:
  Keycloak console → Clients → `testing-web` → Credentials → Regenerate, then
  paste the new value into `AUTH_KEYCLOAK_SECRET` on the app server and restart.
- **`keycloak-seed.sql` is a password file.** It holds password hashes and both
  client secrets. It is gitignored. Delete it from both machines once the
  deployment is done.

## Regenerating the seed

From the development machine, with the dev Keycloak stack running:

```powershell
.\scripts\export-keycloak-seed.ps1
```

It writes `keycloak-seed.sql` here. Two flags matter and are already set: the
dump uses `--inserts` (DBeaver cannot execute `COPY ... FROM stdin`, which is a
psql-only protocol feature) and the `\restrict` / `\unrestrict` psql
meta-commands are stripped (DBeaver cannot parse them either).

The dump encodes Keycloak 26.7.0's internal schema. It can only be restored into
the same Keycloak version — which is the version in `app-server/images/`.

## The alternative: realm JSON import

Keycloak's own interchange format is a realm JSON file, and this project can
still produce one:

```powershell
node keycloak\make-prod-realm-template.js
```

It writes `keycloak/import-prod/testing-realm.template.json` with placeholders
for the URLs, the client secrets and a bootstrap manager account. Mount it at
`/opt/keycloak/data/import` and add `--import-realm` to the Keycloak command.

| | SQL seed (used here) | Realm JSON |
|---|---|---|
| Carries user accounts + passwords | **yes** | no — one bootstrap account |
| Carries client secrets | yes (dev values) | no — injected at deploy time |
| Survives a Keycloak upgrade | no — schema is version-specific | yes |
| Reviewable before running | not realistically | yes |
| Manual cleanup afterwards | required (the fixup) | none |

The JSON path produces a cleaner result and is the better choice for a second
site or a future version upgrade. It cannot carry existing user accounts, which
is why the SQL seed is used for this install.

Two behaviours to know if you switch: realm import **only runs when the realm
does not already exist** (it will never clobber real users, so it is not an
update mechanism), and Keycloak 26.7.0 silently ignores both `temporary: true`
on a credential and per-user `requiredActions` during import — a seeded password
will *not* prompt for a change at first login unless you set that afterwards
through the admin API.
