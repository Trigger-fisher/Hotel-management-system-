#!/bin/sh
# WRITTEN, NEVER RUN. Firewall for the VPS: in = SSH (your port), 80 and 443 only. Run as root ONCE, from a session you can recover
# (Hostinger's browser terminal), because a wrong SSH port locks you out.
#   sudo SSH_PORT=52222 sh scripts/ufw.sh
# Note: Docker writes its own iptables rules for PUBLISHED ports and ufw does not see them. Only nginx publishes ports (80, 443),
# which are open here anyway; every other service publishes nothing, so nothing else is reachable from outside.
# Also set the same rules in Hostinger's panel firewall (hPanel > VPS > Firewall) as a second layer.
set -eu
SSH_PORT="${SSH_PORT:-22}"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing          # containers need: signature mirrors, the storage hosts in *_ALLOWED_HOSTS, Supabase, OS mirror
ufw limit in "${SSH_PORT}/tcp" comment 'ssh, key only, rate limited'
ufw allow in 80/tcp comment 'http: certbot + redirect'
ufw allow in 443/tcp comment 'https: nginx'
ufw logging low
ufw --force enable
ufw status verbose
