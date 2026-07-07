#!/usr/bin/env bash
#
# Repeatable deploy: pull latest, migrate the DB, rebuild the web app, restart.
# Run this ON THE SERVER whenever you want to ship the current $BRANCH.
#
#   ./deploy/deploy.sh
#
# Assumes deploy/setup.sh has already been run once.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

if [[ ! -f "$SCRIPT_DIR/config.env" ]]; then
  echo "ERROR: deploy/config.env not found. cp deploy/config.example.env deploy/config.env" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

echo "==> [1/5] Fetching latest ($BRANCH)"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> [2/5] Backend deps + DB migration"
pushd backend >/dev/null
"$UV_BIN" sync --no-dev
"$UV_BIN" run alembic upgrade head
popd >/dev/null

echo "==> [3/5] Building web frontend (API_PUBLIC_URL=$API_PUBLIC_URL)"
pushd frontend >/dev/null
npm ci
rm -rf dist
EXPO_PUBLIC_API_URL="$API_PUBLIC_URL" npx expo export --platform web
popd >/dev/null

echo "==> [4/5] Restarting API service"
sudo systemctl restart household-ledger-api

echo "==> [5/5] Reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "Deployed $BRANCH @ $(git rev-parse --short HEAD)"
echo "API health:  curl -fsS https://$DOMAIN/api/health && echo OK"
