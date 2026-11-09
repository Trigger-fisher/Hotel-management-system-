#!/bin/sh
# WRITTEN, NEVER RUN. Go back to an earlier image tag (images stay on the VPS until you prune them).
#   sudo sh scripts/rollback.sh            -> back to the tag before the current one (from state/deploy-history.log)
#   sudo sh scripts/rollback.sh 1a2b3c4    -> to that tag
# Only images are switched. The code in the git checkout is not changed; run "git checkout <tag>" yourself if you want it to match.
set -eu
cd "$(dirname "$0")/.."
. ./scripts/lib.sh
load_env

target=${1:-}
if [ -z "$target" ]; then
  [ -f state/deploy-history.log ] || { echo "No history yet; give a tag: sh scripts/rollback.sh <tag>" >&2; exit 1; }
  target=$(grep -- ' -> ' state/deploy-history.log | grep -v 'roll back' | tail -n 1 | awk '{print $2}')
fi
[ -n "$target" ] || { echo "No earlier tag found." >&2; exit 1; }

for s in compressor antivirus pdf-to-image reader quality-gate intake-worker clamd; do
  docker image inspect "hms/$s:$target" >/dev/null 2>&1 || { echo "Image hms/$s:$target is not on this VPS." >&2; exit 1; }
done

current=$HMS_TAG
set_tag "$target"
docker compose up -d --no-build --remove-orphans
mkdir -p state
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) manual roll back $current -> $target" >> state/deploy-history.log
wait_healthy 600
echo "Now on $target."
