# Image optimisée pour Coolify / serveur léger
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src/
COPY client ./client/
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh \
  && npm ci \
  && npm run build:deploy \
  && npm prune --omit=dev

ENV NODE_ENV=production
# Compat volume Coolify existant (maasterplan.db) + 2e base NeTEx
ENV DATABASE_URL=file:/app/data/maasterplan.db
ENV DATABASE_URL_GTFS=file:/app/data/maasterplan.db
ENV DATABASE_URL_NETEX=file:/app/data/netex.db
ENV HOST=0.0.0.0
ENV PORT=3000
# Serveur HTTP léger ; le worker d’import a son propre --max-old-space-size=3072
ENV NODE_OPTIONS=--max-old-space-size=512
ENV IMPORT_USE_WORKER=true
ENV TMP_DIR=/tmp/maasterplan

RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000

# start-period large : migrate ×2 + seed avant que le process soit « chaud »
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
