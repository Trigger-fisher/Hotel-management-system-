#!/bin/sh
# The official image's /init starts freshclam (FRESHCLAM_CHECKS a day) and clamd; the Sanesecurity loop runs beside them.
set -eu
mkdir -p /var/lib/fangfrisch
chown clamav:clamav /var/lib/fangfrisch
su -s /bin/sh clamav -c /usr/local/bin/feeds.sh &
exec /init "$@"
