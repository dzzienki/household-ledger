#!/usr/bin/env bash
#
# One-time server setup: installs nginx + the systemd unit and wires them up.
# Run this ON THE SERVER, once, after the repo is cloned to $APP_DIR and
# deploy/config.env is filled in.
#
#   sudo ./deploy/setup.sh
#
# Idempotent: safe to re-run after editing config.env or the templates.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$SCRIPT_DIR/config.env" ]]; then
  echo "ERROR: $SCRIPT_DIR/config.env not found." >&2
  echo "Copy it first:  cp deploy/config.example.env deploy/config.env  (then edit)" >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Installing $2..."; apt-get install -y "$2"; }; }

echo "==> Installing system packages (nginx, gettext for envsubst)"
apt-get update -qq
need nginx nginx
need envsubst gettext-base

echo "==> Rendering nginx site -> /etc/nginx/sites-available/household-ledger"
export DOMAIN CONTEXT_ROOT APP_DIR API_HOST API_PORT
envsubst '${DOMAIN} ${CONTEXT_ROOT} ${APP_DIR} ${API_HOST} ${API_PORT}' \
  < "$SCRIPT_DIR/nginx.conf.template" \
  > /etc/nginx/sites-available/household-ledger
ln -sf /etc/nginx/sites-available/household-ledger /etc/nginx/sites-enabled/household-ledger
# Drop the default site so it doesn't shadow ours.
rm -f /etc/nginx/sites-enabled/default

echo "==> Rendering systemd unit -> /etc/systemd/system/household-ledger-api.service"
export SERVICE_USER API_WORKERS UV_BIN
envsubst '${SERVICE_USER} ${APP_DIR} ${API_HOST} ${API_PORT} ${API_WORKERS} ${UV_BIN}' \
  < "$SCRIPT_DIR/household-ledger-api.service.template" \
  > /etc/systemd/system/household-ledger-api.service

echo "==> Validating nginx config"
nginx -t

echo "==> Enabling + starting services"
systemctl daemon-reload
systemctl enable --now household-ledger-api
systemctl reload nginx

cat <<EOF

Setup complete.

Next steps:
  1. Make sure ${APP_DIR}/backend/.env exists (see backend/.env.example) with a
     real DATABASE_URL / SYNC_DATABASE_URL / JWT_SECRET.
  2. Run the first deploy:   ./deploy/deploy.sh
  3. Enable HTTPS (recommended):
        apt-get install -y certbot python3-certbot-nginx
        certbot --nginx -d ${DOMAIN}

Check status any time with:
  systemctl status household-ledger-api
  journalctl -u household-ledger-api -f
EOF
