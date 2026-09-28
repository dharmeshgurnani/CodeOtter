#!/bin/sh
# Single-container entrypoint: PocketBase (data + admin UI on :8090) and the Node app (:4747).
set -e
: "${PB_ADMIN_EMAIL:?set PB_ADMIN_EMAIL}"
: "${PB_ADMIN_PASSWORD:?set PB_ADMIN_PASSWORD}"
pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir /app/pb_data --migrationsDir /app/pb_migrations
pocketbase serve --http=0.0.0.0:8090 --dir /app/pb_data --migrationsDir /app/pb_migrations &
exec node /app/server.mjs
