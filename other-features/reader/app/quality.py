"""Measure the picture before reading it, so a bad photo gets honest flags instead of a bluff."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

# One place for every threshold.
BLUR_MIN = 120.0  # sharpest-tiles Laplacian variance (at 1600 px long side) below this = blurry
CONTRAST_MIN = 90.0  # spread between the darkest and lightest 1% of pixels (a sparse text page has a small standard deviation)
DARK_MAX = 70.0  # mean brightness below this = too dark
GLARE_MAX_SHARE = 0.04  # share of near-white blown-out pixels sitting in big blobs
NOISE_MAX = 12.0
LOW_DPI = 150
MIN_TEXT_HEIGHT_PX = 14  # median letter height below this = too small to read reliably
NORMAL_SIDE = 1600


@dataclass
class Quality:
    blur: float
    contrast: float
    brightness: float
    glare: float
    noise: float
    resolution_dpi: float | None
    skew: float
    overall: float  # 0..1
    flags: list[str]

    def as_dict(self) -> dict:
        return {"blur": round(self.blur, 1), "contrast": round(self.contrast, 1),
                "brightness": round(self.brightness, 1), "glare": round(self.glare, 4),
                "noise": round(self.noise, 2), "skew": round(self.skew, 2),
                "resolutionDpi": None if self.resolution_dpi is None else round(self.resolution_dpi),
                "overall": round(self.overall, 3)}


def to_gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def normalised(gray: np.ndarray, side: int = NORMAL_SIDE) -> np.ndarray:
    longest = max(gray.shape)
    if longest <= side:
        return gray
    scale = side / longest
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def blur_score(gray: np.ndarray) -> float:
    """Sharpest regions decide: a page is mostly blank paper, which is 'smooth' even when sharp."""
    small = normalised(gray)
    lap = cv2.Laplacian(small, cv2.CV_64F)
    tile, values = 48, []
    for y in range(0, small.shape[0] - tile + 1, tile):
        for x in range(0, small.shape[1] - tile + 1, tile):
            values.append(lap[y:y + tile, x:x + tile].var())
    return float(np.percentile(values, 95)) if values else float(lap.var())


def glare_share(gray: np.ndarray) -> float:
    """Share of the picture taken by blown-out blobs. Only meaningful when the paper itself is not
    saturated (a photographed page is grey-white, around 190-235): then a 255 patch is a reflection.
    On a scan with pure white paper nothing can be told apart, so it reports 0."""
    small = normalised(gray, 800)
    if np.percentile(small, 50) >= 238:  # median = the paper, unless glare covers over half the picture
        return 0.0
    bright = (small >= 250).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    big = sum(int(s[cv2.CC_STAT_AREA]) for s in stats[1:] if s[cv2.CC_STAT_AREA] > 0.004 * small.size)
    return big / small.size

def noise_sigma(gray: np.ndarray) -> float:
    """Immerkaer's fast noise estimate."""
    small = normalised(gray, 1000).astype(np.float64)
    kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
    h, w = small.shape
    if h < 3 or w < 3:
        return 0.0
    conv = cv2.filter2D(small, -1, kernel)[1:-1, 1:-1]
    return float(np.sqrt(np.pi / 2) * np.abs(conv).sum() / (6.0 * (w - 2) * (h - 2)))


def estimate_skew(gray: np.ndarray, limit: float = 20.0) -> float:
    """Degrees the text is tilted (positive = counter-clockwise), by projection-profile search."""
    small = normalised(gray, 700)
    _, binary = cv2.threshold(cv2.GaussianBlur(small, (3, 3), 0), 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    if binary.mean() < 1.0:  # almost nothing dark: no text to measure
        return 0.0
    h, w = binary.shape
    centre = (w / 2, h / 2)

    def sharpness(angle: float) -> float:
        m = cv2.getRotationMatrix2D(centre, angle, 1.0)
        rotated = cv2.warpAffine(binary, m, (w, h), flags=cv2.INTER_NEAREST)
        profile = rotated.sum(axis=1, dtype=np.float64)
        return float(np.var(np.diff(profile)))

    coarse = max(np.arange(-limit, limit + 0.01, 1.0), key=sharpness)
    fine = max(np.arange(coarse - 1.0, coarse + 1.01, 0.1), key=sharpness)
    return float(fine)


def median_text_height(gray: np.ndarray) -> float | None:
    """Median height of letter-sized connected parts, at the picture's own resolution."""
    _, binary = cv2.threshold(cv2.GaussianBlur(gray, (3, 3), 0), 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    n, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    heights = [int(s[cv2.CC_STAT_HEIGHT]) for s in stats[1:]
               if 4 <= s[cv2.CC_STAT_HEIGHT] <= gray.shape[0] / 4 and 2 <= s[cv2.CC_STAT_WIDTH] <= gray.shape[1] / 4
               and s[cv2.CC_STAT_AREA] >= 6]
    return float(np.median(heights)) if len(heights) >= 8 else None


def measure(img: np.ndarray, dpi: float | None = None) -> Quality:
    gray = to_gray(img)
    blur = blur_score(gray)
    contrast = float(np.percentile(gray, 99) - np.percentile(gray, 1))
    brightness = float(gray.mean())
    glare = glare_share(gray)
    noise = noise_sigma(gray)
    skew = estimate_skew(gray)
    flags: list[str] = []
    if blur < BLUR_MIN:
        flags.append("blurry")
    if brightness < DARK_MAX:
        flags.append("tooDark")
    if contrast < CONTRAST_MIN and brightness >= DARK_MAX:
        flags.append("lowContrast")
    if glare > GLARE_MAX_SHARE:
        flags.append("glare")
    if noise > NOISE_MAX:
        flags.append("noisy")
    height = median_text_height(gray)
    if (dpi is not None and dpi < LOW_DPI) or (height is not None and height < MIN_TEXT_HEIGHT_PX):
        flags.append("lowResolution")
    if dpi is None and height is not None:
        dpi = None  # unknown for photos: only the letter height speaks
    parts = [min(1.0, blur / (BLUR_MIN * 3)), min(1.0, contrast / (CONTRAST_MIN * 1.5)),
             1.0 if brightness >= 110 else max(0.0, brightness / 110.0), max(0.0, 1.0 - glare * 8),
             max(0.0, 1.0 - noise / (NOISE_MAX * 2))]
    return Quality(blur, contrast, brightness, glare, noise, dpi, skew, float(np.mean(parts)), flags)
