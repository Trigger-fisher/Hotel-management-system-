# The worker's own clamd: the official ClamAV image (GPL-2.0, run as a separate program) plus the Sanesecurity feeds through
# fangfrisch (GPL-3.0 downloader, its own virtualenv). Signatures are downloaded on the server, never baked into the image.
# Written on a PC without Docker: never built.
FROM clamav/clamav:1.4

RUN apk add --no-cache python3 \
    && python3 -m venv /opt/fangfrisch \
    && /opt/fangfrisch/bin/pip install --no-cache-dir fangfrisch==1.9.3
COPY fangfrisch.conf /etc/fangfrisch.conf
COPY stamp.py /usr/local/lib/feeds/stamp.py
COPY feeds.sh /usr/local/bin/feeds.sh
COPY entry.sh /usr/local/bin/entry.sh
RUN sed -i 's/\r$//' /usr/local/bin/feeds.sh /usr/local/bin/entry.sh /etc/fangfrisch.conf \
    && chmod 0755 /usr/local/bin/feeds.sh /usr/local/bin/entry.sh

# freshclam: twice a day (the plan asks for at least daily; one missed run still leaves a day before the 48-hour alert).
ENV FRESHCLAM_CHECKS=2
ENTRYPOINT ["/usr/local/bin/entry.sh"]
