# Production deployment — air-gapped, two servers

Everything needed to bring the system up on a closed network with no internet,
no DNS and no package registry. All container images are pre-built here and
travel as `.tar` files.

```
   CLIENT PCs
       |
       |  http://<APP-IP>/         the application
       |  http://<APP-IP>/auth/    Keycloak (same origin, different path)
       |  http://<APP-IP>:8082/    OnlyOffice editor iframe
       v
  +--------------------------+          +----------------------------+
  |  APP SERVER              |  ----->  |  DB SERVER                 |
  |    nginx      :80        |          |    PostgreSQL     :5432    |
  |    next-app   :3000      |          |      - testingsite         |
  |    keycloak   :8080      |          |      - keycloak            |
  |    onlyoffice :8082      |          |    MinIO          :9000    |
  |  (holds no data)         |          |    + nightly backups       |
  +--------------------------+          +----------------------------+
```

**Keycloak's database is not a separate server.** It is a second database
(`keycloak`) alongside the application database inside **one** PostgreSQL
instance — so they share one container, one port and one backup job. Keycloak
needs its own *database*, not its own *server*.

If port 5432 turns out to be taken on that machine (`netstat -ano | findstr
:5432`), change `POSTGRES_PORT` there and `DB_PORT` on the app server together;
both databases follow.

The app server is **stateless** — every byte that matters lives on the DB
server, in two databases and one object store, all covered by one backup job.

## What is in the box

```
prod-deploy/
├── db-server/                  <-- install this machine FIRST
│   ├── images/                 postgres.tar, minio.tar
│   ├── docker-compose.yml
│   ├── .env.template
│   ├── init/                   runs automatically on a fresh volume:
│   │   ├── 01-create-keycloak-db.sh    creates the keycloak DB + role
│   │   └── 02-app-schema.sql           builds the whole application schema
│   ├── keycloak-seed/          the Keycloak realm, as SQL
│   │   ├── keycloak-seed.sql          restore this in DBeaver
│   │   ├── fixup-after-restore.sql    then this (EDIT ONE LINE)
│   │   └── README.md
│   └── scripts/                1-load-images, 2-start, 3-create-keycloak-db, 4-check
└── app-server/                 <-- install this machine SECOND
    ├── images/                 next-app.tar, nginx.tar, keycloak.tar, onlyoffice.tar
    ├── docker-compose.yml
    ├── .env.template
    └── scripts/                1-load-images, 2-check-env, 3-start, 4-verify
```

Image sizes (as shipped, compressed): app server ~1.7 GB (OnlyOffice is 1.3 GB
of it), DB server ~170 MB.

## Before you start

- Docker Desktop installed and running on both machines, in **Linux container**
  mode, with drive `C:` shared.
- DBeaver on the DB server.
- Two fixed IPs. Write them down — you will type each one exactly twice.
- **Firewall, DB server:** allow `5432` and `9000` from the APP server's IP only.
- **Firewall, app server:** allow `80` and `8082` from the client network.
  Port 8082 must reach **end-user browsers**, not just the servers — the
  OnlyOffice editor runs in the user's browser.

---

## PART A — DB server

```powershell
cd db-server
.\scripts\1-load-images.ps1
copy .env.template .env
notepad .env                    # set three passwords
.\scripts\2-start.ps1
.\scripts\4-check.ps1           # expect: all checks passed
```

On a fresh volume this creates both databases and the entire application schema
automatically. If the machine already had PostgreSQL data, `initdb.d` is skipped
by PostgreSQL itself — run `.\scripts\3-create-keycloak-db.ps1` and apply
`init\02-app-schema.sql` in DBeaver instead.

### Then seed Keycloak (DBeaver, against the `keycloak` database)

1. Run `keycloak-seed\keycloak-seed.sql` — restores the realm, the clients, the
   roles, the login theme settings and the user accounts.
2. Open `keycloak-seed\fixup-after-restore.sql`, change the **one** line marked
   `<<<< EDIT THIS` to the app server's address, and run the whole file.
3. Read the verification output at the bottom. **"localhost left anywhere" must
   be 0.**

Why step 2 is not optional: the seed is a copy of the development Keycloak, so
every client URL in it still says `http://localhost`. Until it is rewritten,
login fails with *"Invalid parameter: redirect_uri"*.

The fixup also re-owns the restored tables to the `keycloak` role. DBeaver
connects as the admin user, which would otherwise leave Keycloak unable to read
its own tables and failing to start with `permission denied for table
databasechangelog`.

Details and the realm-JSON alternative: [keycloak-seed/README.md](db-server/keycloak-seed/README.md).

---

## PART B — app server

```powershell
cd app-server
.\scripts\1-load-images.ps1
copy .env.template .env
notepad .env                    # BLOCK 1 only: 4 values
.\scripts\2-check-env.ps1       # catches URL mistakes before anything starts
.\scripts\3-start.ps1
.\scripts\4-verify.ps1
```

`.env` BLOCK 1 is four values: this machine's URL, the OnlyOffice URL, the DB
server's IP, and the three DB passwords from Part A. Every other URL — the OIDC
issuer, the Auth.js URL, the database URL, the MinIO endpoint, all the internal
container-to-container addresses — is **derived** in `docker-compose.yml`. The
issuer has to be one byte-identical string in several places at once, so it is
computed rather than repeated.

The address in `.env` must match the one you put in the fixup SQL.
`2-check-env.ps1` prints the exact line to compare against.

> **If you get the address wrong, fix it in both places.** The fixup SQL finds
> its work by looking for `localhost`, so re-running it with a corrected address
> changes nothing — it reports 0 rows and leaves the old one in place. Either
> restore `keycloak-seed.sql` again and re-run the fixup, or correct
> *Clients → testing-web → Valid redirect URIs / Web origins* in the Keycloak
> admin console.

---

## PART C — first login

Open `http://<APP-IP>/`. The seeded accounts come from the development realm and
carry **their development passwords**:

| account | role |
|---|---|
| `admin`, `dev-manager`, `manager1` | manager |
| `bodek1` | tester |
| `mahsan1` | storekeeper |

**Your first task after logging in is to change every one of those passwords**
from the app's *ניהול משתמשים* page, and delete the accounts you do not need.
Until you do, anyone who has seen the development environment can sign in.

Once a real manager account exists you can set `v_delete_dev_users := true` in
the fixup SQL and re-run it to remove the rest. Do not do this before then —
deleting them first leaves nobody able to sign in.

Keycloak's own admin console is at `http://<APP-IP>/auth/admin`, using
`KC_BOOTSTRAP_ADMIN_*` from `.env`. That account is separate from the
application accounts and is only for managing Keycloak itself.

---

## Two things worth understanding before you change anything

### Why URLs are split into public and internal

The site is reached **by IP**, and a container on the app server cannot open a
connection back to that machine's own LAN IP — Windows Firewall drops inbound
LAN traffic arriving from the docker bridge. (Measured on this project: a
container calling the host's LAN IP times out; the same call to a docker network
name returns in milliseconds.)

With a DNS name this is solved with a docker network alias. An IP cannot be a
network alias, so instead each direction gets its own address:

| direction | address | used for |
|---|---|---|
| browser → app / Keycloak | `http://<APP-IP>` | login redirects, the issuer |
| next-app → Keycloak | `http://keycloak:8080` | code→token, refresh, admin API |
| onlyoffice → app | `http://nginx` | fetching and saving documents |

This is safe for OIDC because Keycloak derives `iss` from `KC_HOSTNAME`, not
from the network interface a request arrived on: a token fetched over the
internal URL still carries the public issuer, so validation succeeds.

**If you ever get a DNS name**, this all collapses to a single URL — set
`APP_PUBLIC_URL` to the name and give the nginx service a network alias for it.

### The application image contains no URLs

`next build` inlines every `NEXT_PUBLIC_*` variable into the static JavaScript
bundle, which would pin the image to one site. It does not: the two values the
browser needs are resolved per request on the server and delivered by route
handlers (`/api/logout`, `/api/onlyoffice/config`). So **the same tar deploys
anywhere**, and changing an address is an `.env` edit plus a restart — never a
rebuild. Please keep it that way.

---

## Routine operations

| task | where | how |
|---|---|---|
| Change any URL or password | app server | edit `.env`, `docker compose up -d` |
| Add or edit users | the app | *ניהול משתמשים* page (writes to Keycloak) |
| Check backups | DB server | `C:\backups\postgres\daily`, `C:\backups\files` |
| Restore the database | DB server | see `docs/גיבויים-README.md` |
| New application version | app server | load the new tar, `docker compose up -d` |
| Schema change | DB server | apply the new migration SQL in DBeaver |

Backups run nightly and cover **both** databases plus the MinIO bucket. The
Keycloak dump is what makes user accounts recoverable — restoring only the
application database would leave a working system nobody can log into. Copy
`C:\backups` off the machine periodically; a backup on the same disk as the data
does not survive losing the disk.
