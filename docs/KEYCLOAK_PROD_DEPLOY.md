# Keycloak — production / air-gap deployment

Move the Keycloak auth stack (built & verified in dev) to production.

## Topology

```
  Machine A  (Docker Desktop)            Machine B  (DB server)
  ┌───────────────────────────┐         ┌──────────────────────────┐
  │  nginx (TLS)               │         │  PostgreSQL               │
  │  Keycloak (this stack)  ───┼────────▶│    • app DB (testingsite) │
  │  Next.js app            ───┼────────▶│    • keycloak DB          │
  └───────────────────────────┘         │  MinIO                    │
                                         └──────────────────────────┘
```

Keycloak + the app run together on machine A; **both databases run on machine B.**
So the prod Keycloak stack has **no local db** — Keycloak connects to the remote
Postgres. Dev uses `docker-compose.keycloak.yml` (`start-dev`, local db);
production uses `docker-compose.keycloak.prod.yml`.

> Realm config (roles, the 2 clients, `shifthouse` login theme, `employeeNumber`
> attribute, brute-force, token lifespans 15m/30m/13h, the service account + its
> Admin-REST role mapping) all live in the **realm JSON** and are re-applied on
> import — nothing is hand-configured. Only the **secrets** are regenerated.

---

## 0. Prereqs (air-gap): pre-load images
On a connected machine: `docker pull` → `docker save` → copy → `docker load`:
- `quay.io/keycloak/keycloak:26.7.0`  · `postgres:16-alpine`

## 1. Machine B (DB) — create Keycloak's database (DBeaver)
Run **`keycloak/keycloak-db-init.sql`** against machine B's PostgreSQL (as a
superuser). It creates the `keycloak` database + `keycloak` login role — Keycloak
builds its own tables on first boot. Set the password there = `KC_DB_PASSWORD`
(step 3). *(Read the notes in the script — `CREATE DATABASE` needs auto-commit.)*

## 2. Machine A — copy the deployment files
- `docker-compose.keycloak.prod.yml`
- `keycloak/Dockerfile.prod`
- `keycloak/themes/`  (the `shifthouse` login theme)
- `keycloak/import-prod/testing-realm.json`  (the realm JSON — step below)
- `env.keycloak.prod.example`, `env.auth.prod.example`

### The realm JSON
`keycloak/import-prod/testing-realm.json` is generated from the current dev realm
by `node keycloak/strip-realm-for-prod.js` — it reproduces everything here **minus
the dev test users and minus the baked client secrets** (Keycloak regenerates
those). It already exists in the repo; re-run the script if you change realm config.

## 3. Machine A — configure the Keycloak stack env
```bash
cp env.keycloak.prod.example .env.keycloak.prod
```
Fill: `KC_DB_URL` host = **machine B's address**, `KC_DB_PASSWORD` = the SQL
password from step 1, `KC_HOSTNAME` = the public HTTPS URL, and a bootstrap admin
password.

## 4. Machine A — bring Keycloak up
```bash
docker compose -f docker-compose.keycloak.prod.yml up -d --build
```
Builds the optimized image, connects to machine B's Postgres, runs migrations,
imports the realm. Put **nginx** in front to terminate TLS:

```nginx
server {
  listen 443 ssl;  server_name keycloak.factory.local;    # == KC_HOSTNAME host
  ssl_certificate /etc/nginx/certs/kc.crt; ssl_certificate_key /etc/nginx/certs/kc.key;
  location / {
    proxy_pass http://127.0.0.1:8080;                      # Keycloak (published)
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;            # https — Keycloak trusts this
  }
}
```

---

## 5. AFTER Keycloak is up — the secret dance
1. Open the admin console at `KC_HOSTNAME` (bootstrap admin from step 3).
2. **Regenerate the client secrets** (they were stripped from the import):
   Clients → `testing-web` → Credentials → **Regenerate** → copy.
   Same for `testing-admin-api`.
3. **Update `testing-web` redirect URIs** to the app's public host:
   - Valid redirect URIs: `https://<app-host>/api/auth/callback/keycloak` (+ `/*`)
   - Web origins / post-logout: `https://<app-host>`
4. **Create the first manager**: Users → Add user → set a password → Role mapping →
   assign `manager` → set the `employeeNumber` attribute. (Then all further users
   are created from the app's ניהול משתמשים page.)

## 6. App auth env — fill the template
```bash
cp env.auth.prod.example  (merge into your app's prod env)
```
Fill the CHANGE_ME values with the regenerated secrets from step 5:
- `AUTH_KEYCLOAK_SECRET` ← `testing-web` secret
- `KEYCLOAK_ADMIN_CLIENT_SECRET` ← `testing-admin-api` secret
- `AUTH_SECRET` ← `openssl rand -base64 32` (fresh)
- `AUTH_KEYCLOAK_ISSUER` / `NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER` ← `https://<kc-host>/realms/testing`
- `CRON_SECRET`, `ONLYOFFICE_JWT_SECRET`

Restart the app. **Do not set `IS_DEV`.**

## 7. Post-deploy checklist
- [ ] `https://<app-host>/` → themed Keycloak login → login works, role in session.
- [ ] `/settings/users` reachable only by a manager (tester → `/no-auth`).
- [ ] Cron `.bat`s send `x-cron-secret: $CRON_SECRET`.
- [ ] OnlyOffice edit→save round-trip works.
- [ ] Bootstrap Keycloak admin password rotated/removed.
- [ ] `.env.keycloak.prod` + app prod env backed up securely, NOT in git.

## Secret rotation summary
| secret | lives in | rotate by |
|---|---|---|
| `testing-web` / `testing-admin-api` secrets | Keycloak + app env | Regenerate in Keycloak → update `AUTH_KEYCLOAK_SECRET` / `KEYCLOAK_ADMIN_CLIENT_SECRET` → restart app |
| `AUTH_SECRET` | app env | new random (invalidates sessions) |
| Keycloak DB password | SQL role + `.env.keycloak.prod` | `ALTER ROLE keycloak PASSWORD …` + update env + restart Keycloak |
| bootstrap admin | `.env.keycloak.prod` | change value (first run) / rotate in console |
| `CRON_SECRET` / `ONLYOFFICE_JWT_SECRET` | app env + callers | update both sides together |
