#!/usr/bin/env bash
# Near-zero-downtime deploy for the single-VM chatbot.
#
# Why not full blue/green?
#   PGlite locks `.pglite` exclusively — two Next processes cannot share it.
#   True zero-downtime dual-process needs a shared Postgres (or similar).
#
# What this does instead:
#   1. Build into `.next-next` while the live service keeps serving `.next`
#   2. Stop → migrate (needs exclusive DB) → atomic swap → start
#   Downtime shrinks from ~full build (60–90s) to stop/migrate/start (~a few seconds).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAGING=".next-next"
PREV=".next-prev"
LIVE=".next"

echo "==> Building into ${STAGING} (service stays up)"
rm -rf "${STAGING}"
IS_DEMO=1 NEXT_DIST_DIR="${STAGING}" pnpm exec next build

echo "==> Cutover (brief downtime)"
sudo systemctl stop fide-chatbot.service

echo "==> Migrating PGlite (exclusive lock)"
pnpm exec tsx lib/db/migrate.ts

echo "==> Swapping ${STAGING} → ${LIVE}"
if [[ -d "${LIVE}" ]]; then
  rm -rf "${PREV}"
  mv "${LIVE}" "${PREV}"
fi
mv "${STAGING}" "${LIVE}"

echo "==> Starting service"
sudo systemctl start fide-chatbot.service

# Wait until the app answers (or time out).
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-3000}/demo" 2>/dev/null \
    || curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-3000}/" 2>/dev/null; then
    echo "==> Healthy"
    exit 0
  fi
  sleep 1
done

echo "Service started but health check did not pass within 30s" >&2
systemctl --no-pager --full status fide-chatbot.service || true
exit 1
