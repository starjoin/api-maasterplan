#!/bin/sh
set -e

mkdir -p /app/data

echo "[Entrypoint] Migrations Prisma..."
npx prisma migrate deploy

echo "[Entrypoint] Démarrage du serveur..."
exec node dist/index.js
