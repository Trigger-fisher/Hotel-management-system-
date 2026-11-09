# Shared helpers for the deploy scripts (sourced, not run). WRITTEN, NEVER RUN.

# Read HMS_DOMAIN, LETSENCRYPT_EMAIL and HMS_TAG from .env without printing anything else from it.
load_env() {
  [ -f .env ] || { echo "deploy/.env is missing: cp .env.example .env, fill it, chmod 600 .env" >&2; exit 1; }
  HMS_DOMAIN=$(sed -n 's/^HMS_DOMAIN=//p' .env | tail -n 1)
  LETSENCRYPT_EMAIL=$(sed -n 's/^LETSENCRYPT_EMAIL=//p' .env | tail -n 1)
  HMS_TAG=$(sed -n 's/^HMS_TAG=//p' .env | tail -n 1)
  [ -n "$HMS_DOMAIN" ] && [ "$HMS_DOMAIN" != "example.com" ] || { echo "Set HMS_DOMAIN in .env" >&2; exit 1; }
  export HMS_DOMAIN LETSENCRYPT_EMAIL HMS_TAG
}

# Write a new HMS_TAG into .env (the only line the scripts ever change).
set_tag() {
  sed -i "s/^HMS_TAG=.*/HMS_TAG=$1/" .env
}

# The long-running services (certbot is a tool, not a service).
SERVICES="nginx compressor antivirus pdf-to-image reader quality-gate intake-worker clamd"

# Wait until every service with a healthcheck says healthy; give up after $1 seconds. Returns 1 on time-out.
wait_healthy() {
  limit=${1:-600}
  waited=0
  while [ "$waited" -lt "$limit" ]; do
    bad=""
    for s in $SERVICES; do
      id=$(docker compose ps -q "$s")
      [ -n "$id" ] || { bad="$bad $s(not running)"; continue; }
      state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
      case "$state" in healthy|running) ;; *) bad="$bad $s($state)";; esac
    done
    [ -z "$bad" ] && { echo "All services healthy."; return 0; }
    sleep 10
    waited=$((waited + 10))
  done
  echo "Not healthy after ${limit}s:$bad" >&2
  return 1
}
