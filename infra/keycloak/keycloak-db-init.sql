-- ============================================================
-- Keycloak database bootstrap — run ONCE on the DB machine's PostgreSQL
-- (the same server as the app's DB), via DBeaver, BEFORE first starting the
-- Keycloak prod stack.
--
-- This creates ONLY the database + login role. Keycloak builds all of its own
-- tables on first boot (Liquibase migrations) — do NOT create tables here.
-- The realm/roles/clients/theme come from the REALM JSON import, not from SQL.
--
-- IMPORTANT:
--   * Set the SAME password below and in .env.keycloak.prod (KC_DB_PASSWORD).
--   * CREATE DATABASE cannot run inside a transaction — in DBeaver either enable
--     auto-commit, or execute each statement separately (Ctrl+Enter per line),
--     not the whole script as one transaction.
--   * Connect as a superuser (e.g. the `appuser`/`postgres` role you already use
--     for the app DB on this server).
-- ============================================================

-- 1. Login role Keycloak connects as (KC_DB_USERNAME / KC_DB_PASSWORD).
CREATE ROLE keycloak WITH LOGIN PASSWORD 'CHANGE_ME_strong_db_password';

-- 2. Keycloak's own database, owned by that role.
CREATE DATABASE keycloak OWNER keycloak ENCODING 'UTF8';

-- 3. Make sure the role can use it.
GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak;

-- (Postgres 15+: also grant on the public schema after connecting to the DB.)
-- Run these two AFTER switching your DBeaver connection to the `keycloak` DB:
--   GRANT ALL ON SCHEMA public TO keycloak;
--   ALTER SCHEMA public OWNER TO keycloak;
