#!/usr/bin/env bash
# Host hardening for the Hostinger VPS (security plan 2026-11-01, section 5): SSH on another port with keys only and no root login, and a firewall that drops everything else.
# NOT RUN ANYWHERE YET: written before the VPS exists (about 14 Nov 2026). Read README.md first.
#
# Two phases, so a mistake never locks you out:
#   phase 1  adds the new SSH port NEXT TO port 22 and turns on the firewall with both open. Then open a SECOND terminal and log in on the new port.
#   phase 2  only after that login worked: closes port 22.
# Nothing changes without --apply (the default only prints what it would do).
#
#   sudo ./01-harden-host.sh --admin-user deploy --ssh-port 2222 --phase 1 [--apply]
#   sudo ./01-harden-host.sh --admin-user deploy --ssh-port 2222 --phase 2 [--apply]
set -euo pipefail

ADMIN="" PORT="" PHASE="" APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --admin-user) ADMIN="${2:-}"; shift 2 ;;
    --ssh-port) PORT="${2:-}"; shift 2 ;;
    --phase) PHASE="${2:-}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

die() { echo "STOP: $*" >&2; exit 1; }
run() { if [ "$APPLY" = 1 ]; then echo "+ $*"; "$@"; else echo "(dry run) $*"; fi; }

[[ "$ADMIN" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "--admin-user is required (a normal user you will log in as, not root)"
[ "$ADMIN" != root ] || die "--admin-user must not be root"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "--ssh-port must be a number from 1024 to 65535"
[ "$PORT" != 22 ] || die "--ssh-port must not be 22"
[ "$PHASE" = 1 ] || [ "$PHASE" = 2 ] || die "--phase must be 1 or 2"

[ "$(id -u)" = 0 ] || die "run as root (sudo)"

# the admin user must exist, be able to sudo, and already have a key: otherwise turning passwords off locks everyone out
id "$ADMIN" >/dev/null 2>&1 || die "user $ADMIN does not exist (adduser $ADMIN; usermod -aG sudo $ADMIN)"
id -nG "$ADMIN" | tr ' ' '\n' | grep -qx -e sudo -e wheel || die "$ADMIN is not in the sudo group"
HOME_DIR="$(getent passwd "$ADMIN" | cut -d: -f6)"
[ -s "$HOME_DIR/.ssh/authorized_keys" ] || die "$HOME_DIR/.ssh/authorized_keys is missing or empty: add your public key first"

SSHD_DROPIN=/etc/ssh/sshd_config.d/99-hms-hardening.conf
SOCKET_DROPIN=/etc/systemd/system/ssh.socket.d/99-hms.conf

write_sshd() { # $1 = ports line(s)
  cat > "$SSHD_DROPIN" <<CONF
# managed by security/deploy/01-harden-host.sh
$1
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $ADMIN
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
CONF
}

if [ "$PHASE" = 1 ]; then
  echo "== phase 1: SSH on 22 AND $PORT, keys only, firewall on =="
  command -v ufw >/dev/null || run apt-get install -y ufw
  if [ "$APPLY" = 1 ]; then
    mkdir -p /etc/ssh/sshd_config.d
    write_sshd "Port 22
Port $PORT"
    sshd -t || { rm -f "$SSHD_DROPIN"; die "sshd rejected the new configuration; it was removed, nothing changed"; }
    if systemctl is-active --quiet ssh.socket 2>/dev/null; then
      # Ubuntu 22.10+ starts sshd from a socket: the Port lines above are ignored, the socket decides
      mkdir -p "$(dirname "$SOCKET_DROPIN")"
      printf '[Socket]\nListenStream=\nListenStream=22\nListenStream=%s\n' "$PORT" > "$SOCKET_DROPIN"
      systemctl daemon-reload
      systemctl restart ssh.socket
    else
      systemctl reload ssh 2>/dev/null || systemctl reload sshd
    fi
  else
    echo "(dry run) write $SSHD_DROPIN with Port 22 + Port $PORT, PermitRootLogin no, PasswordAuthentication no, AllowUsers $ADMIN; sshd -t; reload"
  fi
  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw allow 22/tcp
  run ufw allow "$PORT"/tcp
  run ufw --force enable
  echo
  echo "NOW: keep this terminal open, open a NEW one and run:  ssh -p $PORT $ADMIN@<server address>"
  echo "Only when that works, run phase 2."
else
  echo "== phase 2: close port 22 =="
  if [ "$APPLY" = 1 ]; then
    ss -tln | grep -q ":$PORT " || die "nothing is listening on $PORT: phase 1 did not work, port 22 stays open"
    write_sshd "Port $PORT"
    sshd -t || die "sshd rejected the configuration; port 22 stays open"
    if systemctl is-active --quiet ssh.socket 2>/dev/null; then
      printf '[Socket]\nListenStream=\nListenStream=%s\n' "$PORT" > "$SOCKET_DROPIN"
      systemctl daemon-reload
      systemctl restart ssh.socket
    else
      systemctl reload ssh 2>/dev/null || systemctl reload sshd
    fi
  else
    echo "(dry run) rewrite $SSHD_DROPIN with Port $PORT only; sshd -t; reload"
  fi
  run ufw delete allow 22/tcp
  echo "Port 22 is closed. Test once more:  ssh -p $PORT $ADMIN@<server address>"
fi
