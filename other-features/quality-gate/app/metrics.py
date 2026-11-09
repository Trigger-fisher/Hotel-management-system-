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


def _tiles(a: np.ndarray, tile: int) -> np.ndarray:
    """View of `a` cut into whole tile x tile blocks: shape (rows, tile, cols, tile)."""
    ny, nx = a.shape[0] // tile, a.shape[1] // tile
    return a[:ny * tile, :nx * tile].reshape(ny, tile, nx, tile)


def blur_scores(gray: np.ndarray) -> dict:
    """Two views of sharpness at a fixed size: the sharpest tiles' Laplacian variance and Sobel gradient strength.
    The sharpest tiles decide because most of a page is smooth paper. (Vectorised over 40 px tiles, 5 Nov 2026.)"""
    small = normalise(gray)
    lap = cv2.Laplacian(small, cv2.CV_32F)
    gx = cv2.Sobel(small, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(small, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    tile = 40
    if small.shape[0] >= tile and small.shape[1] >= tile:
        ny, nx = small.shape[0] // tile, small.shape[1] // tile
        cut = lap[:ny * tile, :nx * tile].astype(np.float64)
        means = cv2.resize(cut, (nx, ny), interpolation=cv2.INTER_AREA)  # exact tile means: whole tiles
        lap_vars = (cv2.resize(cut * cut, (nx, ny), interpolation=cv2.INTER_AREA) - means * means).ravel()
        grad = _tiles(mag, tile).max(axis=(1, 3)).ravel()
    else:
        lap_vars, grad = np.array([lap.var()]), np.array([mag.max()])
    sample = mag[::2, ::2].ravel()  # the 97th percentile from every 4th pixel: the same edges, a quarter of the sorting
    strong = mag > np.partition(sample, int(0.97 * (sample.size - 1)))[int(0.97 * (sample.size - 1))]
    ax, ay = float(np.abs(gx[strong]).mean()) if strong.any() else 0.0, float(np.abs(gy[strong]).mean()) if strong.any() else 0.0
    ratio = (ax + 1e-6) / (ay + 1e-6)
    return {"blurLaplacian": float(np.percentile(lap_vars, 95)), "blurGradient": float(np.percentile(grad, 95)),
            "gradientRatio": float(ratio),
            "motionDirection": "horizontal" if ratio < 0.45 else "vertical" if ratio > 2.2 else None}


def percentiles_u8(gray: np.ndarray, ps, hist: np.ndarray | None = None) -> list[float]:
    """np.percentile (linear) of an 8-bit picture from its histogram: exact, and fast on 12 MP pictures."""
    if gray.dtype != np.uint8:
        return [float(v) for v in np.percentile(gray, ps)]
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel() if hist is None else hist
    cum = np.cumsum(hist)
    n = int(cum[-1])
    out = []
    for p in ps:
        rank = p / 100.0 * (n - 1)
        lo, hi = int(np.floor(rank)), int(np.ceil(rank))
        v_lo = float(np.searchsorted(cum, lo, side="right"))
        v_hi = float(np.searchsorted(cum, hi, side="right"))
        out.append(v_lo + (v_hi - v_lo) * (rank - lo))
    return out


def exposure(gray: np.ndarray) -> dict:
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel() if gray.dtype == np.uint8 else None
    p1, p50, p99 = percentiles_u8(gray, [1, 50, 99], hist)
    n = float(gray.size)
    white = float(hist[250:].sum() / n) if hist is not None else float((gray >= 250).mean())
    black = float(hist[:6].sum() / n) if hist is not None else float((gray <= 5).mean())
    return {"brightness": float(cv2.mean(gray)[0]), "contrast": p99 - p1, "p1": p1, "p99": p99, "median": p50,
            "clippedWhite": white, "clippedBlack": black}


def glare_share(gray: np.ndarray) -> float:
    """Blown-out blobs on paper that is otherwise grey-white. Pure white scans cannot show glare."""
    small = normalise(gray, 800)
    if percentiles_u8(small, [50])[0] >= 238:
        return 0.0
    bright = (small >= 250).astype(np.uint8)
    _, _, stats, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    return float(sum(int(s[cv2.CC_STAT_AREA]) for s in stats[1:] if s[cv2.CC_STAT_AREA] > 0.004 * small.size) / small.size)


def noise_sigma(gray: np.ndarray) -> float:
    """Immerkaer's fast estimate, at the picture's own resolution capped for speed."""
    small = normalise(gray, 1000).astype(np.float32)
    h, w = small.shape
    if h < 3 or w < 3:
        return 0.0
    kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float32)
    conv = cv2.filter2D(small, -1, kernel)[1:-1, 1:-1]
    return float(np.sqrt(np.pi / 2) * cv2.norm(conv, cv2.NORM_L1) / (6.0 * (w - 2) * (h - 2)))


def blockiness(gray: np.ndarray, period: int = 8) -> float:
    """Ratio of intensity jumps on JPEG block borders to jumps elsewhere. About 1 for clean pictures. `period` is 8 on the
    picture as stored and 4 when the JPEG was decoded at half size (its 8 px blocks become 4 px)."""
    if min(gray.shape) < 32 or period < 2:
        return 1.0
    g = gray if gray.dtype == np.uint8 else np.clip(gray, 0, 255).astype(np.uint8)
    dx = cv2.absdiff(g[:, 1:], g[:, :-1])
    per_col = cv2.reduce(dx, 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    cols = np.arange(per_col.size)
    on, off = per_col[cols % period == period - 1].mean(), per_col[cols % period != period - 1].mean()
    return float((on + 1e-6) / (off + 1e-6))


_WINDOWS: dict[tuple[int, int], np.ndarray] = {}


def moire_hint(gray: np.ndarray) -> float:
    """How much a single mid-frequency peak stands out of the spectrum (screen photos show strong peaks)."""
    small = normalise(gray, 512).astype(np.float32)
    win = _WINDOWS.get(small.shape)
    if win is None:
        win = _WINDOWS.setdefault(small.shape, (np.hanning(small.shape[0])[:, None] * np.hanning(small.shape[1])[None, :]).astype(np.float32))
    planes = cv2.dft(small * win, flags=cv2.DFT_COMPLEX_OUTPUT)
    spec = np.log1p(np.fft.fftshift(cv2.magnitude(planes[..., 0], planes[..., 1])))
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
    # the main object and every sizeable part beside it: on a card scan that fills the frame, the "content" is the printing (a
    # header band, the portrait, the text lines), which closing does not join into one piece (5 Nov 2026)
    parts = [i for i in range(1, n) if i == big or stats[i, cv2.CC_STAT_AREA] >= 0.005 * h * w]
    x0 = min(int(stats[i, cv2.CC_STAT_LEFT]) for i in parts)
    y0 = min(int(stats[i, cv2.CC_STAT_TOP]) for i in parts)
    x1 = max(int(stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH]) for i in parts)
    y1 = max(int(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT]) for i in parts)
    bw, bh = x1 - x0, y1 - y0
    scale = gray.shape[1] / w
    return float(bw * bh) / float(h * w), (int(x0 * scale), int(y0 * scale), int(x1 * scale), int(y1 * scale))


def border_content(gray: np.ndarray) -> float:
    """Largest share of edge pixels in a thin strip along any side of the frame: content running into the border."""
    small = normalise(gray, 600)
    edges = cv2.Canny(cv2.GaussianBlur(small, (3, 3), 0), 60, 150) > 0
    h, w = edges.shape
    t = max(2, int(0.012 * min(h, w)))
    strips = [edges[:t], edges[-t:], edges[:, :t], edges[:, -t:]]
    return float(max(s.mean() for s in strips))


def measure_card(img: np.ndarray, full_size: tuple[int, int] | None = None) -> dict:
    """The scores the per-card rules of a multi-id photo use (blur, exposure, glare, noise, size), without the whole-picture ones
    (moire, framing): one card of twelve must stay cheap."""
    gray = to_gray(img)
    h, w = gray.shape
    fw, fh = full_size or (w, h)
    scores = {"width": int(fw), "height": int(fh), "aspect": float(max(fh, fw) / max(1, min(fh, fw)))}
    scores.update(blur_scores(gray))
    scores.update(exposure(gray))
    scores.update({"glare": glare_share(gray), "noise": noise_sigma(gray), "contentLongSidePx": int(max(fw, fh))})
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in scores.items()}


def measure_image(img: np.ndarray, full_size: tuple[int, int] | None = None, block_period: int = 8) -> dict:
    """Every score for one picture, as plain numbers. `full_size` = (width, height) of the picture as stored when `img` was
    decoded smaller (a JPEG decoded at half size for speed): sizes are reported in the stored picture's pixels."""
    gray = to_gray(img)
    h, w = gray.shape
    fw, fh = full_size or (w, h)
    # every measure but exposure and blockiness works at 1000 px or less: shrink once, not once per measure (5 Nov 2026)
    small = normalise(gray) if max(h, w) > NORMAL_SIDE else gray
    up = fw / max(small.shape[1], 1)
    scores = {"width": int(fw), "height": int(fh), "megapixels": round(fh * fw / 1e6, 3),
              "aspect": float(max(fh, fw) / max(1, min(fh, fw)))}
    scores.update(blur_scores(small))
    scores.update(exposure(gray))
    share, box = content_box(small)
    scores.update({"glare": glare_share(small), "noise": noise_sigma(small), "blockiness": blockiness(gray, block_period),
                   "moire": moire_hint(small), "contentShare": share,
                   "contentLongSidePx": int(round(max(box[2] - box[0], box[3] - box[1]) * up)),
                   "borderContent": border_content(small)})
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in scores.items()}
