# copied from reader on 2026-11-04
"""One interface for every OCR engine, so engines can be swapped without touching the reader."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class OcrLine:
    text: str
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1 in the pixels of the image given to the engine
    confidence: float  # 0..1
    script: str | None = None
    engine: str = ""
    region: int = 0


@dataclass(frozen=True)
class Osd:
    rotate_cw: int  # degrees (0/90/180/270) to turn the image clockwise to make it upright
    script: str | None
    confidence: float


class Engine(Protocol):
    name: str

    def supports(self, script: str) -> bool: ...

    def recognize(self, img: np.ndarray, scripts: list[str], hints: dict[str, list[str]],
                  whitelist: str | None = None, psm: int | None = None) -> list[OcrLine]:
        """Read `img` (grey or BGR, uint8) with the models for `scripts`. `hints` adds language codes per script."""

    def osd(self, img: np.ndarray) -> Osd | None:
        """Orientation and script when the engine can tell, else None."""
