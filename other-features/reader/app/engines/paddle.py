"""PaddleOCR adapter (primary engine on the VPS). Pre-trained models only, CPU only.

WRITTEN BUT NOT TESTED on the development PC: paddlepaddle was not installed here. The adapter
is only used when `paddleocr` and `paddle` import; otherwise the reader uses Tesseract."""
from __future__ import annotations

import importlib.util

import numpy as np

from ..scripts import SCRIPTS
from .base import OcrLine, Osd


def available() -> bool:
    return importlib.util.find_spec("paddleocr") is not None and importlib.util.find_spec("paddle") is not None


class PaddleEngine:
    name = "paddleocr"

    def __init__(self) -> None:
        self._models: dict[str, object] = {}  # one loaded model per language code

    def supports(self, script: str) -> bool:
        return script in SCRIPTS and SCRIPTS[script].paddle is not None

    def _model(self, lang: str):
        if lang not in self._models:
            from paddleocr import PaddleOCR  # imported late: it is heavy
            self._models[lang] = PaddleOCR(lang=lang, use_angle_cls=True, use_gpu=False, show_log=False)
        return self._models[lang]

    def recognize(self, img: np.ndarray, scripts: list[str], hints: dict[str, list[str]],
                  whitelist: str | None = None, psm: int | None = None) -> list[OcrLine]:
        lines: list[OcrLine] = []
        for script in scripts:
            lang = SCRIPTS[script].paddle
            if not lang:
                continue
            result = self._model(lang).ocr(img, cls=True) or []
            for page in result:
                for box, (text, conf) in page or []:
                    xs, ys = [p[0] for p in box], [p[1] for p in box]
                    lines.append(OcrLine(text, (min(xs), min(ys), max(xs), max(ys)), float(conf), None, self.name))
        return lines

    def osd(self, img: np.ndarray) -> Osd | None:
        return None  # orientation comes from Tesseract OSD or from comparing confidences
