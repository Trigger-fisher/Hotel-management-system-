#!/usr/bin/env bash
# Checks the finished VPS from the outside and the inside (security plan 2026-11-01, section 10 step 6). Read-only: it changes nothing.
#   sudo ./03-verify-hardening.sh --domain easyhotelsolutions.in --origin-ip <the VPS public address> --ssh-port 2222 [--container hms]
# Run it after 01, 02, the nginx file, the fail2ban files and the container are in place. Exit code 1 when any check fails.
set -uo pipefail
DOMAIN="" ORIGIN="" PORT="" CONTAINER="hms"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --origin-ip) ORIGIN="${2:-}"; shift 2 ;;
    --ssh-port) PORT="${2:-}"; shift 2 ;;
    --container) CONTAINER="${2:-}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DOMAIN" ] && [ -n "$ORIGIN" ] && [[ "$PORT" =~ ^[0-9]+$ ]] || { echo "usage: $0 --domain D --origin-ip IP --ssh-port N [--container NAME]" >&2; exit 2; }

FAILED=0
check() { # name, command...
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; FAILED=$((FAILED + 1)); fi
}
sshd_has() { sshd -T 2>/dev/null | grep -qix "$1"; }
direct_refused() { # a request straight to the server's address, without Cloudflare, must NOT get a page
  local code
  code="$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:$ORIGIN" "https://$DOMAIN/api/v1/health")"
  [ "$code" != 200 ]
}
no_plain_http() { ! curl -s --max-time 5 -o /dev/null "http://$ORIGIN/"; }

echo "== firewall =="
check "UFW is active" bash -c 'ufw status | grep -q "Status: active"'
check "UFW default for incoming is deny" bash -c 'ufw status verbose | grep -qi "Default: deny (incoming)"'
check "port 22 is closed in UFW" bash -c '! ufw status | grep -E "^22(/tcp)?\s+ALLOW"'
check "port 80 is not open to the world" bash -c '! ufw status | grep -E "^80(/tcp)?\s+ALLOW\s+Anywhere"'
check "443 is not open to Anywhere (Cloudflare ranges only)" bash -c '! ufw status | grep -E "^443(/tcp)?\s+ALLOW\s+Anywhere"'
check "the database port is not open" bash -c '! ufw status | grep -E "^5432"'

echo "== SSH =="
check "SSH listens on $PORT" bash -c "ss -tln | grep -q ':$PORT '"
check "SSH does not listen on 22" bash -c '! ss -tln | grep -q ":22 "'
check "root login is off" sshd_has "permitrootlogin no"
check "passwords are off" sshd_has "passwordauthentication no"

echo "== origin lock =="
check "a request straight to the server (no Cloudflare) gets no page" direct_refused
check "plain http to the server gets no answer" no_plain_http

echo "== fail2ban =="
check "fail2ban is running" systemctl is-active --quiet fail2ban
check "jail hms-auth is on" bash -c 'fail2ban-client status hms-auth'
check "jail hms-scan is on" bash -c 'fail2ban-client status hms-scan'
check "the Cloudflare header file is private (mode 600)" bash -c '[ "$(stat -c %a /etc/fail2ban/cloudflare.header)" = 600 ]'

echo "== container =="
check "the container is running" bash -c "[ \"\$(docker inspect -f '{{.State.Running}}' $CONTAINER)\" = true ]"
check "it does not run as root" bash -c "[ \"\$(docker inspect -f '{{.Config.User}}' $CONTAINER)\" != root ] && [ -n \"\$(docker inspect -f '{{.Config.User}}' $CONTAINER)\" ]"
check "its filesystem is read-only" bash -c "[ \"\$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' $CONTAINER)\" = true ]"
check "all capabilities are dropped" bash -c "docker inspect -f '{{.HostConfig.CapDrop}}' $CONTAINER | grep -qi all"
check "it is published on 127.0.0.1 only" bash -c "docker port $CONTAINER 3000/tcp | grep -q '^127.0.0.1:'"
check "it reports healthy" bash -c "[ \"\$(docker inspect -f '{{.State.Health.Status}}' $CONTAINER)\" = healthy ]"

echo
if [ "$FAILED" = 0 ]; then echo "all checks passed"; else echo "$FAILED check(s) failed"; exit 1; fi
echo "Also run:  node web-app/scripts/check-db-tls.mjs   and   node web-app/scripts/smoke.mjs https://$DOMAIN"
