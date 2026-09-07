FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_OPTIONS=--max-old-space-size=768
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src/
RUN npm run build
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client
COPY client ./client/
RUN npm run build --prefix client && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/prisma ./prisma
COPY package.json docker-entrypoint.sh ./
COPY scripts/benchmark-import.cjs ./scripts/benchmark-import.cjs
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
ENV DATABASE_URL=file:/app/data/maasterplan.db DATABASE_URL_GTFS=file:/app/data/maasterplan.db DATABASE_URL_NETEX=file:/app/data/netex.db
ENV NODE_OPTIONS=--max-old-space-size=384 UV_THREADPOOL_SIZE=2
ENV IMPORT_HEAP_MB=768 IMPORT_RSS_MB=1400 IMPORT_BATCH_SIZE=500
ENV TMP_DIR=/app/data/tmp AUTO_IMPORT_ON_START=false
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
