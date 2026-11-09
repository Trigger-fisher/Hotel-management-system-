#!/bin/sh
# WRITTEN, NEVER RUN. Renew the TLS certificate through nginx's port 80 and reload nginx. Safe to run daily (renews only near expiry).
# Cron (root):  17 3 * * *  sh /opt/hms/other-features/deploy/scripts/renew-certs.sh >> /var/log/hms-renew.log 2>&1
set -eu
cd "$(dirname "$0")/.."
docker compose --profile tools run --rm certbot renew --webroot -w /var/www/certbot --quiet
docker compose exec -T nginx nginx -s reload
