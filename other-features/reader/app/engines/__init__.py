"""Engine discovery. Both engines are optional at runtime; /health says which are present."""
from __future__ import annotations

from ..config import WorkerConfig
from . import paddle, rapid
from .base import Engine, OcrLine, Osd  # noqa: F401
from .tesseract import TesseractEngine


def load_engines(cfg: WorkerConfig) -> list[Engine]:
    """Preferred first: RapidOCR (light, CPU), PaddleOCR (optional, many scripts), then Tesseract (backup, 100+ languages)."""
    engines: list[Engine] = []
    if cfg.use_rapid and rapid.available():
        engines.append(rapid.RapidEngine())
    if cfg.use_paddle and paddle.available():
        engines.append(paddle.PaddleEngine())
    tess = TesseractEngine.find(cfg.tesseract, cfg.tessdata)
    if tess:
        engines.append(tess)
    return engines


def describe(cfg: WorkerConfig) -> dict:
    tess = TesseractEngine.find(cfg.tesseract, cfg.tessdata)
    return {"rapidocr": rapid.available(), "paddleocr": paddle.available(),
            "tesseract": {"present": tess is not None,
                          "languages": sorted(tess.languages()) if tess else []}}
