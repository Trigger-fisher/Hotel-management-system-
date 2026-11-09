"""Size, pixel, page and time limits, kept together so they are easy to audit."""
from __future__ import annotations

import time
from dataclasses import dataclass

from .errors import CompressorError


@dataclass(frozen=True)
class Limits:
    max_bytes: int = 100 * 1024 * 1024
    max_pixels: int = 100_000_000
    max_pages: int = 300
    job_seconds: float = 300.0


class Deadline:
    """Cooperative time limit: worker code calls check() between heavy steps."""

    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + seconds

    def check(self) -> None:
        if time.monotonic() > self._end:
            raise CompressorError("timeout", "The file took too long to process.", 504)

    def remaining(self) -> float:
        return max(1.0, self._end - time.monotonic())
