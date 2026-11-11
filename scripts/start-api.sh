#!/bin/sh
set -e

node scripts/check-runtime-env.mjs

echo "Running Prisma migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "Starting API server..."
exec node apps/api/dist/server.js
