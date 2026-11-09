#!/bin/sh
# WRITTEN, NEVER RUN. Update to the code now in this git checkout, keep the old images for a roll back.
#   sudo sh scripts/update.sh            (run from anywhere; it works in deploy/)
# Builds images tagged with the git commit (the build also fetches and SHA-256 checks the reader's and the worker's models),
# starts them, waits for health. If they are not healthy within 10 minutes it rolls back to the previous tag by itself.
set -eu
cd "$(dirname "$0")/.."
. ./scripts/lib.sh
load_env

old_tag=$HMS_TAG
git pull --ff-only
new_tag=$(git rev-parse --short HEAD)
if [ "$new_tag" = "$old_tag" ]; then
  echo "Already on $new_tag. To rebuild with fresh OS packages anyway: docker compose build --pull && docker compose up -d"
  exit 0
fi

HMS_TAG=$new_tag docker compose build --pull
set_tag "$new_tag"
mkdir -p state
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $old_tag -> $new_tag" >> state/deploy-history.log
docker compose up -d --remove-orphans

if wait_healthy 600; then
  echo "Updated: $old_tag -> $new_tag"
else
  echo "Rolling back to $old_tag" >&2
  set_tag "$old_tag"
  docker compose up -d --no-build --remove-orphans
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto roll back $new_tag -> $old_tag" >> state/deploy-history.log
  wait_healthy 600 || true
  exit 1
fi
