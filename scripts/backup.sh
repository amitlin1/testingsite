#!/usr/bin/env sh
# ===========================================
# Manual backup of PostgreSQL + MinIO (DB server)
# ===========================================
# Runs alongside the automated sidecars in docker-compose.db.yml; use this for
# an on-demand snapshot (e.g. before a risky migration). Run on the DB server,
# from the project root, with the db stack up.
#
#   ./scripts/backup.sh [output_dir]
#
# Output (default ./backups):
#   <out>/db-<ts>.sql.gz      gzipped pg_dump
#   <out>/minio/              incremental mirror of the bucket
# ===========================================
set -eu

ENV_FILE="${ENV_FILE:-.env.db}"
OUT_DIR="${1:-./backups}"
TS="$(date -u +%Y%m%d-%H%M%S)"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"
BUCKET="${MINIO_BUCKET:-digitalfactory-files}"

mkdir -p "$OUT_DIR/minio"

echo "[backup] PostgreSQL -> $OUT_DIR/db-$TS.sql.gz"
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$OUT_DIR/db-$TS.sql.gz"

echo "[backup] MinIO bucket '$BUCKET' -> $OUT_DIR/minio"
docker run --rm --network db-network \
  -v "$(cd "$OUT_DIR/minio" && pwd):/backup" \
  --entrypoint sh minio/minio -c \
  "mc alias set src http://minio:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' && mc mirror --overwrite src/'$BUCKET' /backup"

echo "[backup] done: $OUT_DIR (db-$TS.sql.gz + minio/)"
