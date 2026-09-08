#!/bin/sh
# Applies pending database migrations before the API or worker starts.
# Safe to run on every container start: `migrate deploy` is a no-op when the
# schema is already current, and only the API container runs it.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations…"
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
fi

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] seeding service catalogue and initial administrator (idempotent)…"
  node -e "
    const { seedDefaultsIfEmpty } = require('./apps/api/dist/bootstrap.js');
    seedDefaultsIfEmpty()
      .then(() => process.exit(0))
      .catch((err) => { console.error('[entrypoint] seed failed:', err.message); process.exit(0); });
  "
fi

exec "$@"
