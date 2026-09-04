#!/bin/sh
set -e

mkdir -p /app/data

GTFS_URL="${DATABASE_URL_GTFS:-${DATABASE_URL:-file:/app/data/maasterplan.db}}"
NETEX_URL="${DATABASE_URL_NETEX:-file:/app/data/netex.db}"

echo "[Entrypoint] Migrations Prisma (GTFS) → $GTFS_URL"
DATABASE_URL="$GTFS_URL" npx prisma migrate deploy

echo "[Entrypoint] Migrations Prisma (NeTEx) → $NETEX_URL"
DATABASE_URL="$NETEX_URL" npx prisma migrate deploy

echo "[Entrypoint] Démarrage du serveur..."
exec node dist/index.js
