"""Preprocessing variants. The reader tries a few and keeps the one that reads best."""
from __future__ import annotations

from typing import Callable

import cv2
import numpy as np

from .quality import Quality, median_text_height, to_gray

TARGET_TEXT_HEIGHT = 28
MAX_UPSCALE = 3.0
MAX_SIDE = 6000


def rotate_cw(img: np.ndarray, degrees: int) -> np.ndarray:
    degrees %= 360
    if degrees == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if degrees == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    if degrees == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img


def deskew(img: np.ndarray, angle: float) -> np.ndarray:
    """Apply the correction estimate_skew returned (degrees, counter-clockwise), keeping the whole page."""
    if abs(angle) < 0.2:
        return img
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    border = 255 if img.ndim == 2 else (255, 255, 255)
    return cv2.warpAffine(img, m, (nw, nh), flags=cv2.INTER_CUBIC, borderValue=border)


def _clahe(gray: np.ndarray) -> np.ndarray:
    return cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)


def _denoise(gray: np.ndarray) -> np.ndarray:
    return cv2.fastNlMeansDenoising(gray, None, h=12, templateWindowSize=7, searchWindowSize=21)


def _upscale(gray: np.ndarray) -> np.ndarray:
    height = median_text_height(gray)
    factor = 2.0 if not height else min(MAX_UPSCALE, max(1.0, TARGET_TEXT_HEIGHT / height))
    factor = min(factor, MAX_SIDE / max(gray.shape))
    if factor <= 1.05:
        return gray
    return cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_LANCZOS4)


def _unsharp(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, (0, 0), 2.0)
    return cv2.addWeighted(gray, 1.8, blurred, -0.8, 0)


def _shadow(gray: np.ndarray) -> np.ndarray:
    """Divide by an estimate of the lighting, so shadows and uneven light flatten out."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))
    background = cv2.medianBlur(cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel), 31)
    return cv2.normalize(cv2.divide(gray, background, scale=255), None, 0, 255, cv2.NORM_MINMAX)


def _adaptive(gray: np.ndarray) -> np.ndarray:
    block = max(15, (min(gray.shape) // 20) | 1)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 12)


def _otsu(gray: np.ndarray) -> np.ndarray:
    return cv2.threshold(cv2.GaussianBlur(gray, (3, 3), 0), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]


VARIANTS: dict[str, Callable[[np.ndarray], np.ndarray]] = {
    "clahe": _clahe, "denoise": _denoise, "upscale": _upscale, "unsharp": _unsharp,
    "shadow": _shadow, "adaptive": _adaptive, "otsu": _otsu,
}


def plan(quality: Quality, thorough: bool) -> list[str]:
    """Variant names, most promising first. 'orig' is always first. The caller stops at its time budget."""
    order: list[str] = ["orig"]
    flags = set(quality.flags)
    if "lowResolution" in flags:
        order.append("upscale")
    if "lowContrast" in flags or "tooDark" in flags:
        order += ["clahe", "shadow"]
    if "blurry" in flags:
        order += ["unsharp", "upscale"]
    if "noisy" in flags:
        order.append("denoise")
    if "glare" in flags:
        order.append("shadow")
    if not thorough:
        return list(dict.fromkeys(order))[:2 if len(order) > 1 else 1]
    order += ["shadow", "clahe", "adaptive", "otsu", "unsharp", "upscale", "denoise"]
    return list(dict.fromkeys(order))


def apply(name: str, img: np.ndarray) -> np.ndarray:
    return img if name == "orig" else VARIANTS[name](to_gray(img))
