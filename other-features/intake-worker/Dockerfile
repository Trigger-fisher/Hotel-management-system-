FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-osd tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-guj libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY requirements.txt .
# requirements.txt carries the CPU-only PyTorch index (no CUDA libraries are pulled in)
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt
# The card cutter's model (Segment Anything vit_b, Apache-2.0), checked against its recorded SHA-256 at build time.
COPY scripts/get_model.py ./scripts/get_model.py
ENV CARDCUT_ARCH=vit_t CARDCUT_MODEL=/srv/models/mobile_sam.pt
RUN python scripts/get_model.py && chmod -R a-w /srv/models
# The photo check's two face models (YuNet MIT, SFace Apache-2.0, opencv_zoo), checked against their recorded SHA-256 at build time.
COPY scripts/get_face_models.py ./scripts/get_face_models.py
ENV FACE_MODELS_DIR=/srv/models/faces
RUN chmod u+w /srv/models && python scripts/get_face_models.py && chmod -R a-w /srv/models
COPY app ./app
USER app
# No EXPOSE and no port: the worker only pulls jobs from the database.
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "print('worker image ok')"
CMD ["python", "-m", "app.main"]
