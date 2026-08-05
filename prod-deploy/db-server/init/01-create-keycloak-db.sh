#!/bin/bash
# ===========================================================================
# Create Keycloak's database and login role
# ===========================================================================
# Runs automatically on a FRESH postgres data volume (the postgres image executes
# /docker-entrypoint-initdb.d/* in filename order, before accepting outside
# connections). Keycloak builds its own ~100 tables inside this database on its
# first boot — we only create the empty database and the role it logs in with.
#
# WHY A .sh AND NOT A .sql: the password comes from the environment, and plain
# .sql files in initdb.d cannot read environment variables.
#
# NOT re-run on an existing volume. For a DB server that already holds data, use
# scripts/3-create-keycloak-db.ps1 instead — same result, idempotent.
# ===========================================================================
set -e

: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD must be set in .env}"
KEYCLOAK_DB_USER="${KEYCLOAK_DB_USER:-keycloak}"
KEYCLOAK_DB_NAME="${KEYCLOAK_DB_NAME:-keycloak}"

echo "[init] creating Keycloak role '${KEYCLOAK_DB_USER}' and database '${KEYCLOAK_DB_NAME}'"

# psql -c cannot run CREATE DATABASE inside the implicit transaction block that
# --single-transaction would create, so each statement is issued separately.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${KEYCLOAK_DB_USER}') THEN
            CREATE ROLE ${KEYCLOAK_DB_USER} LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
        END IF;
    END
    \$\$;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -c "CREATE DATABASE ${KEYCLOAK_DB_NAME} OWNER ${KEYCLOAK_DB_USER};"

# Keycloak creates its tables in the public schema of its own database, so it
# needs CREATE there. On PostgreSQL 15+ the public schema is no longer writable
# by default, which otherwise fails at first boot with a bare "permission denied
# for schema public".
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${KEYCLOAK_DB_NAME}" \
     -c "GRANT ALL ON SCHEMA public TO ${KEYCLOAK_DB_USER};"

echo "[init] Keycloak database ready"
