# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS builder
# Install tools needed for bcrypt or prisma engine build
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY prisma prisma

# Install all dependencies (including devDependencies) to build the app
RUN npm ci

COPY . .

# Generate Prisma client and build backend apps/packages
RUN npm run db:generate && npm run build:backend

FROM base AS runner
# Install runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 pitchpresence \
    && useradd --system --create-home --uid 1001 --gid pitchpresence nodejs

WORKDIR /app
COPY --from=builder --chown=nodejs:pitchpresence /app .

# Expose port and configure runtime
USER nodejs
ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:4000/api/v1/health/ready || exit 1

CMD ["sh", "scripts/start-api.sh"]
