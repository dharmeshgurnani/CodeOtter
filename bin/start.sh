#!/bin/sh
# Production entrypoint: PocketBase (data + admin UI on :8090) and the Node app (:4747) in one process tree.
# The Docker image runs it as CMD; `pnpm co:start` runs it from a checkout. Needs a `pocketbase` binary on PATH or in .pb/.
set -e
HOME_DIR="${CODEOTTER_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
PB="$(command -v pocketbase || ls "$HOME_DIR"/.pb/pocketbase* 2>/dev/null | head -1)"
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-admin@codeotter.local}"
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-AdminPassword123!}"
export PB_URL="${PB_URL:-http://127.0.0.1:8090}"
"$PB" superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir "$HOME_DIR/pb_data" --migrationsDir "$HOME_DIR/core/pb_migrations"
"$PB" serve --http=0.0.0.0:8090 --dir "$HOME_DIR/pb_data" --migrationsDir "$HOME_DIR/core/pb_migrations" &
exec node "$HOME_DIR/core/server.mjs"
