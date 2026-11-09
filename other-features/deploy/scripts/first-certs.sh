#!/bin/sh
# WRITTEN, NEVER RUN. First TLS certificate (one certificate "hms-services" for the five host names), before nginx starts.
# Needs: DNS A records for compressor/scanner/pdf/reader/gate.<HMS_DOMAIN> pointing at this VPS, and port 80 free.
set -eu
cd "$(dirname "$0")/.."
. ./scripts/lib.sh
load_env

docker compose --profile tools run --rm -p 80:80 certbot certonly --standalone \
  --non-interactive --agree-tos --email "$LETSENCRYPT_EMAIL" \
  --cert-name hms-services \
  -d "compressor.$HMS_DOMAIN" -d "scanner.$HMS_DOMAIN" -d "pdf.$HMS_DOMAIN" \
  -d "reader.$HMS_DOMAIN" -d "gate.$HMS_DOMAIN"
echo "Certificate ready. Next: docker compose up -d"
