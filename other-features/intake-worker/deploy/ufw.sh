#!/bin/sh
# WRITTEN BUT NOT RUN OR TESTED. Firewall for the VPS: nothing comes in except SSH on a non-standard port.
# Edit SSH_PORT and the outbound allow-list addresses first. Run as root.
set -eu
SSH_PORT="${SSH_PORT:-52222}"

ufw --force reset
ufw default deny incoming
ufw default deny outgoing                       # outbound is an allow-list: a stolen worker cannot phone home
ufw allow in "${SSH_PORT}/tcp" comment 'ssh, key only'
ufw allow out 53 comment 'dns'
ufw allow out 123/udp comment 'time'
# Supabase database and storage, the ClamAV signature mirror and the OS package mirror. Resolve the host names
# to addresses (or use the provider's published ranges) and list them here. Examples with placeholders:
#   ufw allow out to <supabase-db-ip> port 5432 proto tcp
#   ufw allow out to <supabase-storage-ip> port 443 proto tcp
#   ufw allow out to <clamav-mirror-ip> port 443 proto tcp
#   ufw allow out to <mirror.seichter.de-ip> port 80 proto tcp     (Sanesecurity feeds, every file SHA-256 checked)
#   ufw allow out to <os-mirror-ip> port 443 proto tcp
ufw logging low
ufw --force enable
ufw status verbose
