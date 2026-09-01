#!/usr/bin/env sh
# ===========================================
# Restore PostgreSQL + MinIO from a backup (DB server)
# ===========================================
# !! DESTRUCTIVE !! Overwrites the live database and bucket contents.
# Run on the DB server, from the project root, with the db stack up.
#
#   ./scripts/restore.sh <db_dump> [minio_backup_dir]
#
# The dump format is detected from the file extension:
#   *.dump    - pg_dump -Fc archive (what the backup sidecar writes now)
#               -> pg_restore --clean --if-exists -j 4
#   *.sql.gz  - legacy gzipped plain-SQL dump (pre-ledger backups)
#               -> gunzip | psql ON_ERROR_STOP=1
#
# Examples:
#   ./scripts/restore.sh ./backups/daily/testingsite-20260825-020000.dump ./backups/minio
#   ./scripts/restore.sh ./backups/db-20260528-120000.sql.gz
# ===========================================
set -eu

ENV_FILE="${ENV_FILE:-.env.db}"
DB_DUMP="${1:-}"
MINIO_DIR="${2:-}"

[ -n "$DB_DUMP" ] || { echo "Usage: $0 <db_dump.dump|db_dump.sql.gz> [minio_backup_dir]"; exit 1; }
[ -f "$DB_DUMP" ] || { echo "Dump not found: $DB_DUMP"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"
BUCKET="${MINIO_BUCKET:-digitalfactory-files}"

case "$DB_DUMP" in
  *.dump) FORMAT=custom ;;
  *.sql.gz) FORMAT=plain ;;
  *) echo "Unrecognised dump extension: $DB_DUMP (expected .dump or .sql.gz)"; exit 1 ;;
esac

printf 'This OVERWRITES database "%s" and bucket "%s". Type "yes" to continue: ' "$POSTGRES_DB" "$BUCKET"
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 0; }

echo "[restore] PostgreSQL <- $DB_DUMP ($FORMAT format)"
if [ "$FORMAT" = "custom" ]; then
  # pg_restore -j needs a seekable file, not a pipe - copy the archive into
  # the container first. --clean --if-exists drops and recreates the objects;
  # -j 4 restores in parallel (this is what turns the RTO from hours into
  # minutes). By default pg_restore keeps going after an error and exits 0;
  # --exit-on-error makes any error fatal so a half-restored database cannot
  # report success (the psql path's ON_ERROR_STOP, in pg_restore terms).
  docker cp "$DB_DUMP" postgres:/tmp/restore.dump
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    pg_restore --exit-on-error --clean --if-exists -j 4 -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/restore.dump
  docker exec postgres rm -f /tmp/restore.dump
else
  # ON_ERROR_STOP: without it psql keeps going after a failed statement and the
  # script reports success over a HALF-restored database.
  gunzip -c "$DB_DUMP" | docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"
fi

if [ -n "$MINIO_DIR" ]; then
  [ -d "$MINIO_DIR" ] || { echo "MinIO backup dir not found: $MINIO_DIR"; exit 1; }
  echo "[restore] MinIO bucket '$BUCKET' <- $MINIO_DIR"
  docker run --rm --network db-network \
    -v "$(cd "$MINIO_DIR" && pwd):/backup:ro" \
    --entrypoint sh minio/minio -c \
    "mc alias set dst http://minio:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' && mc mb -p dst/'$BUCKET' || true && mc mirror --overwrite /backup dst/'$BUCKET'"
fi

echo "[restore] done."
