"""The quality number: SSIM on the luminance channel, so quality is measured, not guessed."""
from __future__ import annotations

import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity

# Compare at most this many pixels on the long side: keeps big photos fast (SSIM runs on a box-shrunk copy).
SSIM_MAX_SIDE = 1600


def _flat(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        rgba = img.convert("RGBA")
        base = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        img = Image.alpha_composite(base, rgba)
    return img


def shrink_factor(size: tuple[int, int], max_side: int) -> int:
    longest = max(size)
    return -(-longest // max_side) if longest > max_side else 1  # ceil


def luma(img: Image.Image, max_side: int = SSIM_MAX_SIDE) -> np.ndarray:
    """Grey values, transparency flattened onto white, shrunk with a box filter."""
    grey = _flat(img).convert("L")
    factor = shrink_factor(grey.size, max_side)
    if factor > 1:
        grey = grey.reduce(factor)
    return np.asarray(grey, dtype=np.float32)


def _score(x: np.ndarray, y: np.ndarray) -> float:
    side = min(x.shape)
    if side < 3:  # too small for a window: compare directly
        return 1.0 if np.allclose(x, y, atol=2) else 0.0
    win = min(7, side if side % 2 else side - 1)
    return float(structural_similarity(x, y, data_range=255, win_size=win))


def ssim(a: Image.Image, b: Image.Image, max_side: int = SSIM_MAX_SIDE) -> float:
    """1.0 means identical to the eye's main signal; lower is worse."""
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)
    return _score(luma(a, max_side), luma(b, max_side))


class Reference:
    """The source picture measured once. `score(candidate)` equals `ssim(source, candidate)` for a same-size candidate
    (the source's grey copy is simply not recomputed for every encoder try).

    A smaller candidate (a downscaled picture) is compared with the full-size source: when the source is larger than the
    SSIM size, the candidate goes straight to the shrunk grey size instead of first being blown up to full size, which
    keeps the check cheap for big pictures."""

    def __init__(self, img: Image.Image, max_side: int = SSIM_MAX_SIDE, factor: int | None = None) -> None:
        """`factor` forces the shrink factor (a sample cut from a bigger picture is measured at that picture's scale)."""
        self.size = img.size
        self.factor = factor or shrink_factor(img.size, max_side)
        self.x = self._grey(img)

    def _grey(self, img: Image.Image) -> np.ndarray:
        grey = _flat(img).convert("L")
        if self.factor > 1:
            grey = grey.reduce(self.factor)
        return np.asarray(grey, dtype=np.float32)

    def score(self, cand: Image.Image) -> float:
        if cand.size == self.size:
            return _score(self.x, self._grey(cand))
        grey = _flat(cand).convert("L")
        if self.factor == 1:
            grey = grey.resize(self.size, Image.LANCZOS)
        else:
            grey = grey.resize((self.x.shape[1], self.x.shape[0]), Image.LANCZOS)
        return _score(self.x, np.asarray(grey, dtype=np.float32))
