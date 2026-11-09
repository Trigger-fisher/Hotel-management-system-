FROM python:3.12-slim

# Optional tools: the code skips any path whose tool is missing (see /health). jbig2enc-tools and oxipng are not packaged in
# Debian trixie (python:3.12-slim), so they are left out (checked with a real build on 5 Nov 2026).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ghostscript qpdf poppler-utils ocrmypdf tesseract-ocr \
        tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-guj \
        pngquant \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status==200 else 1)"
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]

