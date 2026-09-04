#!/bin/sh
set -e

mkdir -p /app/data

GTFS_URL="${DATABASE_URL_GTFS:-${DATABASE_URL:-file:/app/data/maasterplan.db}}"
NETEX_URL="${DATABASE_URL_NETEX:-file:/app/data/netex.db}"

echo "[Entrypoint] Dossier data : /app/data"
if [ -f /proc/mounts ] && grep -q ' /app/data ' /proc/mounts; then
  echo "[Entrypoint] ✅ /app/data est un volume monté (persistant)"
else
  echo "[Entrypoint] ⚠️  /app/data N’EST PAS un volume Docker/Coolify monté"
  echo "[Entrypoint] ⚠️  Les imports GTFS/NeTEx seront EFFACÉS à chaque redéploiement"
  echo "[Entrypoint] ⚠️  Coolify → votre application → Storages → Add :"
  echo "[Entrypoint] ⚠️    Name: maasterplan-data"
  echo "[Entrypoint] ⚠️    Destination Path: /app/data"
fi

echo "[Entrypoint] Contenu actuel de /app/data :"
ls -lah /app/data 2>/dev/null || echo "(vide ou inaccessible)"

echo "[Entrypoint] Migrations Prisma (GTFS) → $GTFS_URL"
DATABASE_URL="$GTFS_URL" npx prisma migrate deploy

echo "[Entrypoint] Migrations Prisma (NeTEx) → $NETEX_URL"
DATABASE_URL="$NETEX_URL" npx prisma migrate deploy

echo "[Entrypoint] Démarrage du serveur..."
exec node dist/index.js
