#!/bin/sh
# Production entrypoint: PocketBase (data + admin UI on :8090) and the Node app (:4747) in one process tree.
# The Docker image runs it as CMD; `pnpm co:start` runs it from a checkout. Needs a `pocketbase` binary on PATH or in .pb/.
# SIGTERM/SIGINT are forwarded to both processes; the script exits with node's exit code.
set -eu
HOME_DIR="${CODEOTTER_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
PB="$(command -v pocketbase || ls "$HOME_DIR"/.pb/pocketbase* 2>/dev/null | head -1)"
if [ -z "$PB" ]; then
  echo "PocketBase binary not found (expected on PATH or in $HOME_DIR/.pb/)" >&2
  exit 1
fi
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-admin@codeotter.local}"
if [ -z "${PB_ADMIN_PASSWORD:-}" ]; then
  echo "warning: PB_ADMIN_PASSWORD is not set; PocketBase superuser uses the default password. Set PB_ADMIN_PASSWORD." >&2
fi
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-AdminPassword123!}"
export PB_URL="${PB_URL:-http://127.0.0.1:8090}"
"$PB" superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir "$HOME_DIR/pb_data" --migrationsDir "$HOME_DIR/core/pb_migrations"
"$PB" serve --http=0.0.0.0:8090 --dir "$HOME_DIR/pb_data" --migrationsDir "$HOME_DIR/core/pb_migrations" &
PB_PID=$!
node "$HOME_DIR/core/server.mjs" &
NODE_PID=$!

forward() {
  kill -TERM "$NODE_PID" 2>/dev/null || true
  kill -TERM "$PB_PID" 2>/dev/null || true
}
trap forward TERM INT

# `wait` returns early when a trapped signal arrives; keep waiting while node is still alive.
CODE=0
while :; do
  if wait "$NODE_PID"; then CODE=0; else CODE=$?; fi
  kill -0 "$NODE_PID" 2>/dev/null || break
done

kill -TERM "$PB_PID" 2>/dev/null || true
wait "$PB_PID" 2>/dev/null || true
exit "$CODE"
