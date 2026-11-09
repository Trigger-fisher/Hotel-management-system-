#!/bin/sh
# WRITTEN, NEVER RUN. Back up the VPS's SETTINGS only. Nothing personal lives on this VPS: no guest picture, field or job is ever
# written to disk here (guest data stays in HMS's encrypted store and database, which HMS backs up).
#
# What goes in (an allow-list; nothing else is ever added):
#   deploy/.env                  the keys and settings (so the archive is ENCRYPTED with a passphrase you type)
#   deploy/state/                the deploy history (tags and dates only)
#   the Let's Encrypt volume     certificate + account (can also be re-issued with scripts/first-certs.sh)
# What stays out on purpose: ClamAV signatures (re-downloaded), images (rebuilt from git), models (re-fetched and SHA-256 checked),
# container logs, /tmp. Code is in git.
#
#   sudo sh scripts/backup.sh            -> backups/hms-settings-<date>.tar.gz.gpg  (copy it off the VPS, e.g. to your PC)
set -eu
cd "$(dirname "$0")/.."
command -v gpg >/dev/null || { echo "Install gpg: apt-get install -y gnupg" >&2; exit 1; }
stamp=$(date -u +%Y%m%d-%H%M%S)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p backups "$work/hms"

cp .env "$work/hms/env"
[ -d state ] && cp -r state "$work/hms/state"
docker run --rm -v hms-services_letsencrypt:/le:ro -v "$work/hms":/out alpine:3.20 tar -C /le -czf /out/letsencrypt.tar.gz .

tar -C "$work" -czf - hms | gpg --symmetric --cipher-algo AES256 -o "backups/hms-settings-$stamp.tar.gz.gpg"
chmod 600 "backups/hms-settings-$stamp.tar.gz.gpg"
echo "Wrote backups/hms-settings-$stamp.tar.gz.gpg. Copy it off the VPS; keep the passphrase in your password manager."
echo "Restore: gpg -d <file> | tar -xzf -   then put env back as deploy/.env (chmod 600)."
