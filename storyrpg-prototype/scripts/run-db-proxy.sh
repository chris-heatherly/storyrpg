#!/usr/bin/env bash
# Cloud SQL Auth Proxy — forwards instance to 127.0.0.1 for DATABASE_URL.
# Requires: cloud-sql-proxy on PATH, gcloud application-default credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

INSTANCE="${CLOUD_SQL_INSTANCE:-sd-mvp:us-central1:sd-mvp}"
PORT="${CLOUD_SQL_PORT:-5433}"

echo "[db:proxy] Connecting $INSTANCE → 127.0.0.1:$PORT (Ctrl+C to stop)"
exec cloud-sql-proxy "$INSTANCE" --port "$PORT"
