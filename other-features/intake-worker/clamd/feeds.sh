#!/bin/sh
# Sanesecurity feeds for the worker's clamd, run as user clamav. fangfrisch fetches a file only when its 24-hour interval has
# passed and its SHA-256 matches; the hourly loop retries a failed check. After each run stamp.py sets the stamp to the oldest
# good check, which the worker reads for the 48-hour alert. A failed download never stops clamd: the older files stay in use.
set -u
FF="/opt/fangfrisch/bin/fangfrisch --conf /etc/fangfrisch.conf"
STAMP=/var/lib/clamav/sanesecurity.checked
until ls /var/lib/clamav/*.c[vl]d >/dev/null 2>&1; do sleep 10; done
[ -f /var/lib/fangfrisch/db.sqlite ] || $FF initdb
while true; do
  $FF refresh || echo "feeds: refresh failed, will retry"
  /opt/fangfrisch/bin/python /usr/local/lib/feeds/stamp.py /etc/fangfrisch.conf "$STAMP" || true
  sleep 3600
done
