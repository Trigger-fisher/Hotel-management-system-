"""A scripted OCR engine for tests that must not depend on a real engine."""
from __future__ import annotations

import numpy as np

from app.engines.base import OcrLine, Osd


class FakeEngine:
    name = "fake"

    def __init__(self, lines_by_script: dict[str, list[OcrLine]] | None = None, osd: Osd | None = None,
                 supported=("Latin", "Devanagari", "Gujarati", "Arabic", "Hebrew")) -> None:
        self.lines_by_script = lines_by_script or {}
        self._osd = osd
        self.supported = set(supported)
        self.calls: list[tuple[str, ...]] = []

    def supports(self, script: str) -> bool:
        return script in self.supported

    def recognize(self, img: np.ndarray, scripts: list[str], hints, whitelist=None, psm=None) -> list[OcrLine]:
        self.calls.append(tuple(scripts))
        out: list[OcrLine] = []
        for s in scripts:
            out += [OcrLine(l.text, l.bbox, l.confidence, None, self.name) for l in self.lines_by_script.get(s, [])]
        return out

    def osd(self, img: np.ndarray) -> Osd | None:
        return self._osd


def line(text: str, y: int, x0: int = 20, x1: int = 600, conf: float = 0.95) -> OcrLine:
    return OcrLine(text, (x0, y, x1, y + 40), conf)
