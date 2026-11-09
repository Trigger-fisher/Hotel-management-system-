# copied from quality-gate on 2026-11-04
"""Image quality measurements. Classical computer vision only. Every function returns plain numbers."""
from __future__ import annotations

import cv2
import numpy as np

NORMAL_SIDE = 1000  # blur is measured at this long side so a big and a small copy of a scene compare equally


def to_gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def normalise(gray: np.ndarray, side: int = NORMAL_SIDE) -> np.ndarray:
    longest = max(gray.shape)
    if longest == side:
        return gray
    scale = side / longest
    return cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)


def blur_scores(gray: np.ndarray) -> dict:
    """Two views of sharpness at a fixed size: the sharpest tiles' Laplacian variance and Sobel gradient strength.
    The sharpest tiles decide because most of a page is smooth paper."""
    small = normalise(gray)
    lap = cv2.Laplacian(small, cv2.CV_64F)
    gx = cv2.Sobel(small, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(small, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    tile, lap_vars, grad = 40, [], []
    for y in range(0, small.shape[0] - tile + 1, tile):
        for x in range(0, small.shape[1] - tile + 1, tile):
            lap_vars.append(lap[y:y + tile, x:x + tile].var())
            grad.append(mag[y:y + tile, x:x + tile].max())
    if not lap_vars:
        lap_vars, grad = [lap.var()], [mag.max()]
    strong = mag > np.percentile(mag, 97)
    ax, ay = float(np.abs(gx[strong]).mean()) if strong.any() else 0.0, float(np.abs(gy[strong]).mean()) if strong.any() else 0.0
    ratio = (ax + 1e-6) / (ay + 1e-6)
    return {"blurLaplacian": float(np.percentile(lap_vars, 95)), "blurGradient": float(np.percentile(grad, 95)),
            "gradientRatio": float(ratio),
            "motionDirection": "horizontal" if ratio < 0.45 else "vertical" if ratio > 2.2 else None}


def exposure(gray: np.ndarray) -> dict:
    p1, p5, p50, p95, p99 = (float(v) for v in np.percentile(gray, [1, 5, 50, 95, 99]))
    return {"brightness": float(gray.mean()), "contrast": p99 - p1, "p1": p1, "p99": p99, "median": p50,
            "clippedWhite": float((gray >= 250).mean()), "clippedBlack": float((gray <= 5).mean())}


def glare_share(gray: np.ndarray) -> float:
    """Blown-out blobs on paper that is otherwise grey-white. Pure white scans cannot show glare."""
    small = normalise(gray, 800)
    if np.percentile(small, 50) >= 238:
        return 0.0
    bright = (small >= 250).astype(np.uint8)
    _, _, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    return float(sum(int(s[cv2.CC_STAT_AREA]) for s in stats[1:] if s[cv2.CC_STAT_AREA] > 0.004 * small.size) / small.size)


def noise_sigma(gray: np.ndarray) -> float:
    """Immerkaer's fast estimate, at the picture's own resolution capped for speed."""
    small = normalise(gray, 1000).astype(np.float64)
    h, w = small.shape
    if h < 3 or w < 3:
        return 0.0
    kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float64)
    conv = cv2.filter2D(small, -1, kernel)[1:-1, 1:-1]
    return float(np.sqrt(np.pi / 2) * np.abs(conv).sum() / (6.0 * (w - 2) * (h - 2)))


def blockiness(gray: np.ndarray) -> float:
    """Ratio of intensity jumps on 8-pixel block borders to jumps elsewhere. About 1 for clean pictures."""
    g = gray.astype(np.float32)
    if min(g.shape) < 32:
        return 1.0
    dx = np.abs(np.diff(g, axis=1))
    cols = np.arange(dx.shape[1])
    on, off = dx[:, cols % 8 == 7].mean(), dx[:, cols % 8 != 7].mean()
    return float((on + 1e-6) / (off + 1e-6))


def moire_hint(gray: np.ndarray) -> float:
    """How much a single mid-frequency peak stands out of the spectrum (screen photos show strong peaks)."""
    small = normalise(gray, 512).astype(np.float32)
    spec = np.log1p(np.abs(np.fft.fftshift(np.fft.fft2(small * np.hanning(small.shape[0])[:, None] * np.hanning(small.shape[1])[None, :]))))
    h, w = spec.shape
    yy, xx = np.ogrid[:h, :w]
    radius = np.hypot(yy - h / 2, xx - w / 2)
    band = spec[(radius > 0.12 * w) & (radius < 0.45 * w)]
    return float((band.max() - np.median(band)) / (band.std() + 1e-6))


def content_box(gray: np.ndarray) -> tuple[float, tuple[int, int, int, int]]:
    """Share of the frame taken by the main object and its box (x0, y0, x1, y1): everything that differs
    from the border colour. 1.0 when the whole frame is content."""
    small = normalise(gray, 400)
    h, w = small.shape
    t = max(2, int(0.03 * min(h, w)))
    border = np.concatenate([small[:t].ravel(), small[-t:].ravel(), small[:, :t].ravel(), small[:, -t:].ravel()])
    background = float(np.median(border))
    diff = np.abs(small.astype(np.float32) - background)
    mask = (cv2.GaussianBlur(diff, (9, 9), 0) > 25).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return 0.0, (0, 0, 0, 0)
    big = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    x, y, bw, bh = (int(stats[big, c]) for c in (cv2.CC_STAT_LEFT, cv2.CC_STAT_TOP, cv2.CC_STAT_WIDTH, cv2.CC_STAT_HEIGHT))
    scale = gray.shape[1] / w
    return float(bw * bh) / float(h * w), (int(x * scale), int(y * scale), int((x + bw) * scale), int((y + bh) * scale))


def border_content(gray: np.ndarray) -> float:
    """Largest share of edge pixels in a thin strip along any side of the frame: content running into the border."""
    small = normalise(gray, 600)
    edges = cv2.Canny(cv2.GaussianBlur(small, (3, 3), 0), 60, 150) > 0
    h, w = edges.shape
    t = max(2, int(0.012 * min(h, w)))
    strips = [edges[:t], edges[-t:], edges[:, :t], edges[:, -t:]]
    return float(max(s.mean() for s in strips))


def measure_image(img: np.ndarray) -> dict:
    """Every score for one picture, as plain numbers."""
    gray = to_gray(img)
    h, w = gray.shape
    scores = {"width": int(w), "height": int(h), "megapixels": round(h * w / 1e6, 3),
              "aspect": float(max(h, w) / max(1, min(h, w)))}
    scores.update(blur_scores(gray))
    scores.update(exposure(gray))
    share, box = content_box(gray)
    scores.update({"glare": glare_share(gray), "noise": noise_sigma(gray), "blockiness": blockiness(gray),
                   "moire": moire_hint(gray), "contentShare": share, "contentLongSidePx": int(max(box[2] - box[0], box[3] - box[1])),
                   "borderContent": border_content(gray)})
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in scores.items()}
