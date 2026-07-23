#!/bin/bash
# Reproducible redeploy: pull latest, install deps, restart service.
# Run as root (or a sudoer). Idempotent.
set -euo pipefail

APP_DIR=/opt/punch-app
BRANCH="${1:-main}"

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
echo "[deploy] fetching origin/$BRANCH"
git fetch --depth 1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[deploy] npm install (prod)"
npm install --omit=dev --no-audit --no-fund

echo "[deploy] fixing ownership"
chown -R punch:punch "$APP_DIR"

echo "[deploy] restart service"
systemctl restart punch-app
sleep 1
systemctl --no-pager --lines=5 status punch-app || true
echo "[deploy] done"
