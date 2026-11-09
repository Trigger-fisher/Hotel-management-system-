#!/bin/sh
# Keeps the extra free ClamAV signatures (Sanesecurity, own malware sets only) up to date.
# Runs under supervisord as user clamav. fangfrisch itself only downloads a file again when its interval
# (4h, see fangfrisch.conf) has passed and the mirror's SHA-256 check succeeds, so a short loop is polite.
# A failed download never stops the scanner: the older files and the official ClamAV databases stay in use.
FF="/opt/fangfrisch/bin/fangfrisch --conf /etc/fangfrisch.conf"
mkdir -p /var/lib/fangfrisch
$FF initdb 2>/dev/null || true
while true; do
  $FF refresh || echo "extra-sigs: refresh failed, will retry"
  sleep 3600
done