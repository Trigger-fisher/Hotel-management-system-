FROM python:3.12-slim

# Tesseract with language packs (add more tesseract-ocr-<code> packages for more languages).
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-osd tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-guj \
        tesseract-ocr-ara tesseract-ocr-rus tesseract-ocr-chi-sim tesseract-ocr-jpn tesseract-ocr-kor \
        tesseract-ocr-tha tesseract-ocr-heb tesseract-ocr-ell tesseract-ocr-tam tesseract-ocr-tel \
        tesseract-ocr-kan tesseract-ocr-mal tesseract-ocr-ben tesseract-ocr-pan tesseract-ocr-mar \
        tesseract-ocr-fra tesseract-ocr-deu tesseract-ocr-spa \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# OPTIONAL primary engine (large: roughly 1 GB with models). Uncomment to enable PaddleOCR, CPU only:
# RUN pip install --no-cache-dir paddlepaddle paddleocr
# The card cutter's model for multi=true (375 MB, SHA-256 checked); without it the classic finder is used.
COPY scripts/get_model.py ./scripts/get_model.py
RUN python scripts/get_model.py --arch vit_t --to /srv/models/mobile_sam.pt
ENV READER_CARDCUT_ARCH=vit_t READER_CARDCUT_MODEL=/srv/models/mobile_sam.pt
# The photo check's two face models (YuNet MIT, SFace Apache-2.0, opencv_zoo), checked against their recorded SHA-256 at build time.
COPY scripts/get_face_models.py ./scripts/get_face_models.py
ENV READER_FACE_MODELS_DIR=/srv/models/faces
RUN python scripts/get_face_models.py
COPY app ./app
USER app

EXPOSE 8083
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8083/health', timeout=4).status==200 else 1)"
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8083"]
