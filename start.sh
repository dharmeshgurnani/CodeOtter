#!/bin/sh
# Single-container entrypoint: PocketBase (data + admin UI on :8090) and the Node app (:4747).
set -e
PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-admin@codeotter.local}"
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-AdminPassword123!}"
pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir /app/pb_data --migrationsDir /app/core/pb_migrations
pocketbase serve --http=0.0.0.0:8090 --dir /app/pb_data --migrationsDir /app/core/pb_migrations &
exec node /app/core/server.mjs
