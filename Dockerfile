FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY prisma prisma
RUN npm ci
COPY . .
RUN npm run db:generate && npm run build:backend
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
