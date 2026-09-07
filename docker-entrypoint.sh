#!/bin/sh
set -e

mkdir -p /app/data

GTFS_URL="${DATABASE_URL_GTFS:-${DATABASE_URL:-file:/app/data/maasterplan.db}}"
NETEX_URL="${DATABASE_URL_NETEX:-file:/app/data/netex.db}"

echo "[Entrypoint] Dossier data : /app/data"
DATA_MOUNTED=false
if [ -f /proc/mounts ] && grep -q ' /app/data ' /proc/mounts; then
  DATA_MOUNTED=true
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

# Le Dockerfile ne déclare volontairement aucun VOLUME : Docker ne doit jamais
# masquer une configuration Coolify absente avec un volume anonyme jetable.
if [ "${REQUIRE_PERSISTENT_STORAGE:-false}" = "true" ] && [ "$DATA_MOUNTED" != "true" ]; then
  echo "[Entrypoint] ❌ Démarrage refusé : aucun stockage persistant explicite sur /app/data"
  echo "[Entrypoint] ❌ L’ancien conteneur Coolify reste alors disponible pendant le rolling update."
  exit 1
fi

# Le serveur migre les bases de contrôle et les versions publiées une seule fois.
echo "[Entrypoint] Démarrage du serveur..."
exec node dist/index.js
