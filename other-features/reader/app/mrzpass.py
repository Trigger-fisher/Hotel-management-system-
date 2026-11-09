"""A dedicated pass for the machine readable zone (copied from intake-worker on 2026-11-05: the passport MRZ was the least reliable read).

Find the MRZ lines at the foot of the upright page (the lines the first read already placed, else a band of long, even text lines
found by shape), crop them with a margin, scale them so the letters are about TARGET_LINE_PX tall, split the band into its text
rows and read each row alone after a few binarisations. Every reading is a candidate; mrz.choose() keeps only one whose check digits
ALL pass, and nothing is corrected: when no candidate passes, the MRZ stays flagged as doubtful."""
from __future__ import annotations

import re
from typing import Callable, Iterator

import cv2
import numpy as np

WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
TARGET_LINE_PX = 40  # letter height the band is scaled to
MAX_SCALE = 4.0
ORDER = ("grey", "sharp", "otsu", "flat")  # most successful first on the invented pages (intake-worker scripts/measure_mrz.py)
_MRZ_LIKE = re.compile(r"^[A-Z0-9<«‹]{20,}$")


def _gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def mrz_like(text: str) -> bool:
    t = (text or "").upper().replace(" ", "")
    return t.count("<") + t.count("«") >= 3 and bool(_MRZ_LIKE.match(t))


def band_from_lines(boxes: list[tuple[float, float, float, float]], shape) -> tuple[int, int, int, int] | None:
    """(x0, y0, x1, y1) around the OCR lines that look like MRZ lines, with a margin."""
    if not boxes:
        return None
    h, w = shape[:2]
    line = max(8.0, float(np.median([b[3] - b[1] for b in boxes])))
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    return (max(0, int(x0 - line)), max(0, int(y0 - 0.6 * line)), min(w, int(x1 + line)), min(h, int(y1 + 0.6 * line)))


def band_from_shape(img: np.ndarray) -> tuple[int, int, int, int] | None:
    """The MRZ by its shape: two or three long, evenly tall lines of dark print in the lower half of the page."""
    gray = _gray(img)
    h, w = gray.shape
    f = 1000.0 / w
    small = cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_AREA if f < 1 else cv2.INTER_CUBIC) if abs(f - 1) > 0.05 else gray
    sh, sw = small.shape
    black = cv2.morphologyEx(small, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (15, 9)))
    grad = np.abs(cv2.Sobel(black, cv2.CV_32F, 1, 0, ksize=-1))
    grad = cv2.normalize(grad, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    joined = cv2.morphologyEx(grad, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3)))
    mask = cv2.erode(cv2.threshold(joined, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1], None, iterations=1)
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    rows = [(int(x), int(y), int(x + bw), int(y + bh)) for x, y, bw, bh, _ in stats[1:n]
            if bw >= 0.45 * sw and 6 <= bh <= 0.12 * sh and bw / max(bh, 1) >= 12 and y >= 0.45 * sh]
    if len(rows) < 2:
        return None
    rows = sorted(rows, key=lambda r: r[1])[-3:]
    middle = float(np.median([r[3] - r[1] for r in rows]))
    rows = [r for r in rows if 0.5 * middle <= r[3] - r[1] <= 1.8 * middle]
    if len(rows) < 2:
        return None
    x0, y0, x1, y1 = min(r[0] for r in rows), min(r[1] for r in rows), max(r[2] for r in rows), max(r[3] for r in rows)
    return (max(0, int((x0 - middle) / f)), max(0, int((y0 - 0.6 * middle) / f)), min(w, int((x1 + middle) / f)),
            min(h, int((y1 + 0.6 * middle) / f)))


def _otsu(g: np.ndarray) -> np.ndarray:
    return cv2.threshold(cv2.GaussianBlur(g, (3, 3), 0), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]


def _flat(g: np.ndarray) -> np.ndarray:
    """Divide by the lighting (a glare patch or a shadow), then Otsu."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    background = cv2.medianBlur(cv2.morphologyEx(g, cv2.MORPH_CLOSE, kernel), 21)
    return _otsu(cv2.normalize(cv2.divide(g, background, scale=255), None, 0, 255, cv2.NORM_MINMAX))


def _sharp(g: np.ndarray) -> np.ndarray:
    return _otsu(cv2.addWeighted(g, 1.8, cv2.GaussianBlur(g, (0, 0), 2.0), -0.8, 0))


BINARISATIONS: dict[str, Callable[[np.ndarray], np.ndarray]] = {"grey": lambda g: g, "sharp": _sharp, "otsu": _otsu, "flat": _flat}


def rows_of(band: np.ndarray) -> list[tuple[int, int]]:
    """Text rows of a band (dark print on light paper) from the horizontal ink profile."""
    ink = (_otsu(band) < 128).mean(axis=1)
    on = ink > max(0.02, 0.25 * float(ink.max()))
    rows, start = [], None
    for y, v in enumerate(on):
        if v and start is None:
            start = y
        elif not v and start is not None:
            rows.append((start, y))
            start = None
    if start is not None:
        rows.append((start, len(on)))
    return [r for r in rows if r[1] - r[0] >= 4]


def prepare(img: np.ndarray, band: tuple[int, int, int, int]) -> np.ndarray | None:
    """The band cropped (grey, contrast stretched) and scaled so its letters are about TARGET_LINE_PX tall."""
    x0, y0, x1, y1 = band
    crop = _gray(img)[y0:y1, x0:x1]
    if crop.shape[0] < 8 or crop.shape[1] < 40:
        return None
    rows = rows_of(crop)
    letter = float(np.median([b - a for a, b in rows])) if rows else crop.shape[0] / 3.0
    scale = min(MAX_SCALE, max(1.0, TARGET_LINE_PX / max(letter, 1.0)))
    if scale > 1.05:
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    return cv2.normalize(crop, None, 0, 255, cv2.NORM_MINMAX)


def readings(band: np.ndarray, read_line: Callable[[np.ndarray], str], order=ORDER) -> Iterator[tuple[str, list[str]]]:
    """(binarisation, the band's rows read one by one, top to bottom) for each binarisation in `order`. The caller stops early."""
    rows = rows_of(band)
    if not 2 <= len(rows) <= 4:
        return
    for name in order:
        view = BINARISATIONS[name](band)
        texts = []
        for a, b in rows[-3:]:
            m = int((b - a) * 0.35)
            texts.append(read_line(view[max(0, a - m):b + m]))
        yield name, texts
