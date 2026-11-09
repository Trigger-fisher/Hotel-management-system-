"""QR codes and barcodes with zxing-cpp (a free pip wheel). Skipped when it is not importable."""
from __future__ import annotations

import cv2
import numpy as np

try:
    import zxingcpp
except ImportError:  # the reader still works without it
    zxingcpp = None


def available() -> bool:
    return zxingcpp is not None


def read_codes(img: np.ndarray) -> list[dict]:
    if zxingcpp is None:
        return []
    seen: dict[tuple[str, str], dict] = {}
    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    attempts = [img, gray]
    if max(gray.shape) < 1600:
        attempts.append(cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
    for attempt in attempts:
        try:
            results = zxingcpp.read_barcodes(attempt)
        except (RuntimeError, ValueError, TypeError):
            continue
        for r in results:
            seen.setdefault((str(r.format), r.text), {"type": getattr(r.format, "name", str(r.format)), "text": r.text})
        if seen:
            break
    return list(seen.values())
