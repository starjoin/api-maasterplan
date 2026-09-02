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
ENV DATABASE_URL=file:/app/data/maasterplan.db
ENV HOST=0.0.0.0
ENV PORT=3000

RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
