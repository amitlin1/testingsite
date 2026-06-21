#!/usr/bin/env sh
# ===========================================
# Restore PostgreSQL + MinIO from a backup (DB server)
# ===========================================
# !! DESTRUCTIVE !! Overwrites the live database and bucket contents.
# Run on the DB server, from the project root, with the db stack up.
#
#   ./scripts/restore.sh <db_dump.sql.gz> [minio_backup_dir]
#
# Examples:
#   ./scripts/restore.sh ./backups/db-20260528-120000.sql.gz ./backups/minio
# ===========================================
set -eu

ENV_FILE="${ENV_FILE:-.env.db}"
DB_DUMP="${1:-}"
MINIO_DIR="${2:-}"

[ -n "$DB_DUMP" ] || { echo "Usage: $0 <db_dump.sql.gz> [minio_backup_dir]"; exit 1; }
[ -f "$DB_DUMP" ] || { echo "Dump not found: $DB_DUMP"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"
BUCKET="${MINIO_BUCKET:-digitalfactory-files}"

printf 'This OVERWRITES database "%s" and bucket "%s". Type "yes" to continue: ' "$POSTGRES_DB" "$BUCKET"
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 0; }

echo "[restore] PostgreSQL <- $DB_DUMP"
gunzip -c "$DB_DUMP" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

if [ -n "$MINIO_DIR" ]; then
  [ -d "$MINIO_DIR" ] || { echo "MinIO backup dir not found: $MINIO_DIR"; exit 1; }
  echo "[restore] MinIO bucket '$BUCKET' <- $MINIO_DIR"
  docker run --rm --network db-network \
    -v "$(cd "$MINIO_DIR" && pwd):/backup:ro" \
    --entrypoint sh minio/minio -c \
    "mc alias set dst http://minio:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' && mc mb -p dst/'$BUCKET' || true && mc mirror --overwrite /backup dst/'$BUCKET'"
fi

echo "[restore] done."
