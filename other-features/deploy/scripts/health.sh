#!/bin/sh
# WRITTEN, NEVER RUN. One look at everything: container health, each /health answer, models present, ClamAV signature age.
#   sudo sh scripts/health.sh
# Prints only states, versions and dates: no keys, no guest values.
set -eu
cd "$(dirname "$0")/.."
. ./scripts/lib.sh
load_env

echo "== containers"
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}'

echo "== /health of each HTTP service (from inside its own container)"
for pair in compressor:8080 antivirus:8081 pdf-to-image:8082 reader:8083 quality-gate:8084; do
  s=${pair%%:*}; p=${pair##*:}
  printf '%s: ' "$s"
  docker compose exec -T "$s" python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:$p/health', timeout=5).read().decode()[:300])" \
    || echo "NO ANSWER"
done

echo "== through nginx and TLS (from this VPS)"
for h in compressor scanner pdf reader gate; do
  printf '%s.%s: ' "$h" "$HMS_DOMAIN"
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "https://$h.$HMS_DOMAIN/health" || echo "NO ANSWER"
done

echo "== models (each folder's own get_model scripts; 'present' means the SHA-256 matched)"
docker compose exec -T reader python scripts/get_model.py --to /srv/models/sam_vit_b.pth || echo "reader: card cutter model NOT OK"
docker compose exec -T intake-worker python scripts/get_model.py || echo "intake-worker: card cutter model NOT OK"
docker compose exec -T reader sh -c 'ls /srv/models/faces' || echo "reader: face models missing"
docker compose exec -T intake-worker sh -c 'ls /srv/models/faces' || echo "intake-worker: face models missing"

echo "== ClamAV signatures (version/daily number/date)"
printf 'antivirus: '; docker compose exec -T antivirus python -c "import urllib.request,json; print(json.load(urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=5)).get('clamd'))" || echo "NO ANSWER"
printf 'clamd (worker): '; docker compose exec -T clamd clamdscan --version || echo "NO ANSWER"
printf 'clamd (worker) Sanesecurity, oldest good check: '
docker compose exec -T clamd stat -c '%y' /var/lib/clamav/sanesecurity.checked || echo "NONE YET (the first check runs a few minutes after the first start)"

echo "== memory now"
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
free -h
