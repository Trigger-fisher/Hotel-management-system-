"""Automatic enhance of the STORED copy only (after reading: OCR, the field checks and the evidence use the untouched re-saved pixels).

Conservative: every fix is chosen from a measured problem and skipped when the picture does not need it. Nothing is invented:
levels, gamma, a gentle white balance, a mild denoise and a mild unsharp mask, plus at most a 2x enlargement for a tiny card.
Returns the new pixels and the NAMES of the fixes that ran."""
from __future__ import annotations

import cv2
import numpy as np

MEASURE_SIDE = 1000
TINY_SIDE = 700  # long side below this: enlarge, never beyond 2x
NOISE_SIGMA = 4.0  # Immerkaer noise estimate above this: denoise
BLUR_SHARPNESS = 0.6  # sharpness score below this: unsharp mask (clean cards score 0.85-1.1, blurred ones 0.25-0.4)
RANGE_LOW = 200  # p1..p99 spread (of 255) below this: stretch the levels
MEDIAN_DARK = 70  # a mostly dark picture after the levels: lift the middle (white paper is normally bright, so no bright rule)
CAST = 1.25  # strongest/weakest channel of the paper white above this: gentle white balance


def _grey(px: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(px, cv2.COLOR_RGB2GRAY)


def _small(g: np.ndarray) -> np.ndarray:
    longest = max(g.shape[:2])
    if longest <= MEASURE_SIDE:
        return g
    return cv2.resize(g, None, fx=MEASURE_SIDE / longest, fy=MEASURE_SIDE / longest, interpolation=cv2.INTER_AREA)


def noise_sigma(px: np.ndarray) -> float:
    """Immerkaer's fast estimate of the noise standard deviation (grey levels)."""
    g = _grey(px).astype(np.float32)
    if max(g.shape) > 2000:  # measure on a crop: cheap, and noise is the same everywhere
        h, w = g.shape
        g = g[h // 2 - 500:h // 2 + 500, w // 2 - 500:w // 2 + 500] if min(h, w) > 1000 else g
    k = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    r = cv2.filter2D(g, -1, k)[1:-1, 1:-1]
    return float(np.sqrt(np.pi / 2) * np.abs(r).mean() / 6.0)


def sharpness(px: np.ndarray) -> float:
    """Mean gradient magnitude on the median-filtered, 1000 px grey picture, divided by the local contrast range (0..1).
    Higher = sharper. Insensitive to noise (median) and to the picture's size and brightness."""
    g = cv2.medianBlur(_small(_grey(px)), 3).astype(np.float32)
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    spread = max(float(np.percentile(g, 99) - np.percentile(g, 1)), 1.0)
    return float(np.percentile(mag, 99) / (spread * 4.0))


def contrast(px: np.ndarray) -> float:
    """Spread of the grey levels between the 1st and 99th percentile (0..255)."""
    g = _grey(px)
    return float(np.percentile(g, 99) - np.percentile(g, 1))


def _levels(px: np.ndarray, names: list[str]) -> np.ndarray:
    g = _small(_grey(px))
    lo, hi, med = np.percentile(g, 1), np.percentile(g, 99), float(np.median(g))
    if hi - lo < RANGE_LOW and hi - lo > 12:  # a flat picture: spread to 5..250 (a blank one is left alone)
        scale = 245.0 / (hi - lo)
        px = np.clip((px.astype(np.float32) - lo) * scale + 5, 0, 255).astype(np.uint8)
        names.append("contrast")
        g = _small(_grey(px))
        med = float(np.median(g))
    if med < MEDIAN_DARK:  # exposure: gamma lifts the middle toward 128, within 1..1.8
        gamma = float(np.clip(np.log(max(med, 1) / 255) / np.log(128.0 / 255), 1.0, 1.8))
        table = (np.power(np.arange(256) / 255.0, 1.0 / gamma) * 255).astype(np.uint8)
        px = table[px]
        names.append("exposure")
    return px


def _white_balance(px: np.ndarray) -> np.ndarray | None:
    g = _grey(px)
    bright = g >= np.percentile(g, 80)
    white = np.array([np.percentile(px[..., c][bright], 50) for c in range(3)], np.float32)
    if white.min() < 40 or white.max() / white.min() < CAST:
        return None
    gains = np.clip(white.mean() / white, 0.85, 1.2)
    gains = 1 + (gains - 1) * 0.6  # gentle: only 60% of the way to neutral
    return np.clip(px.astype(np.float32) * gains, 0, 255).astype(np.uint8)


def enhance(pixels: np.ndarray) -> tuple[np.ndarray, list[str]]:
    names: list[str] = []
    px = pixels
    if max(px.shape[:2]) < TINY_SIDE:
        factor = min(2.0, TINY_SIDE / max(px.shape[:2]))
        px = cv2.resize(px, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        names.append("upscale")
    px = _levels(px, names)
    balanced = _white_balance(px)
    if balanced is not None:
        px, _ = balanced, names.append("whiteBalance")
    sigma = noise_sigma(px)
    if sigma > NOISE_SIGMA:
        h = float(np.clip(sigma * 0.8, 3, 8))  # strength follows the measured noise, never above 8
        px = cv2.bilateralFilter(px, 5, 2 * h + 10, 3) if max(px.shape[:2]) > 2500 else cv2.fastNlMeansDenoisingColored(px, None, h, h, 5, 15)
        names.append("denoise")
    if sharpness(px) < BLUR_SHARPNESS:
        blur = cv2.GaussianBlur(px, (0, 0), 1.6)
        px = cv2.addWeighted(px, 1.7, blur, -0.7, 0)
        names.append("sharpen")
    return px, names
