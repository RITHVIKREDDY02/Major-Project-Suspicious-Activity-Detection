#!/bin/sh
set -e

MAX_RETRIES=5
RETRY_DELAY=5

echo "==> Running database migrations..."

attempt=1
while [ $attempt -le $MAX_RETRIES ]; do
  echo "    Migration attempt $attempt of $MAX_RETRIES..."
  if pnpm --filter @workspace/db run push-force; then
    echo "    Migrations applied successfully."
    break
  fi

  if [ $attempt -eq $MAX_RETRIES ]; then
    echo "    ERROR: Migrations failed after $MAX_RETRIES attempts. Aborting."
    exit 1
  fi

  echo "    Migration failed. Retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
  attempt=$((attempt + 1))
done

echo "==> Starting server on port $PORT..."
exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
