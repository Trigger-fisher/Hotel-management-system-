FROM python:3.12-slim

# ClamAV daemon + signature updater. clamd listens on a unix socket shared with the app (same container).
RUN apt-get update && apt-get install -y --no-install-recommends \
        clamav clamav-daemon clamav-freshclam supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/clamav /var/log/clamav \
    && chown clamav:clamav /var/run/clamav /var/log/clamav \
    && sed -i 's/^#\?StreamMaxLength.*/StreamMaxLength 100M/' /etc/clamav/clamd.conf \
    && echo "LocalSocketMode 666" >> /etc/clamav/clamd.conf

# fangfrisch (GPL-3.0 downloader, used as a separate program, not linked) in its own virtualenv, so it cannot clash with the app.
RUN python -m venv /opt/fangfrisch && /opt/fangfrisch/bin/pip install --no-cache-dir fangfrisch==1.9.3 \
    && mkdir -p /var/lib/fangfrisch && chown clamav:clamav /var/lib/fangfrisch
COPY deploy/clamav/fangfrisch.conf /etc/fangfrisch.conf
COPY deploy/clamav/extra-sigs.sh /usr/local/bin/extra-sigs.sh
RUN sed -i 's/\r$//' /usr/local/bin/extra-sigs.sh /etc/fangfrisch.conf

RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY deploy/supervisord.conf /etc/supervisord.conf

EXPOSE 8081
# The first start downloads signatures (a few minutes); /health says "degraded" until clamd answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s \
  CMD python -c "import urllib.request,json,sys; sys.exit(0 if json.load(urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=4))['status']=='ok' else 1)"
CMD ["supervisord", "-c", "/etc/supervisord.conf"]


