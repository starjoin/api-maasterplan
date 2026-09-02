# Image optimisée pour Coolify / serveur léger
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY prisma ./prisma/
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src/
COPY client ./client/

RUN npm install && npm run build:deploy

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/maasterplan.db
ENV HOST=0.0.0.0
ENV PORT=3000

RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "prisma migrate deploy && node dist/index.js"]
