"""Step 8: merge front over back, then the ONLY lossy step: compression to the size cap with a similarity floor.

Quality always wins over size: if the floor cannot be met under the cap, the larger picture is kept and `sizeCapExceeded`
is flagged. `lossless` (the hotel's "keep an exact copy" setting) writes WebP lossless and changes nothing; a copy above the cap
is flagged `sizeCapExceeded`, never made smaller."""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image

SSIM_FLOOR = 0.98
DEFAULT_CAP = 512_000  # 500 KB per saved picture: never more (unless the quality floor cannot be kept, flagged)
DEFAULT_TARGET = 153_600  # 150 KB: tried first; the 500 KB cap is used only when 150 KB cannot keep the quality floor
RELAXED_FLOORS = (0.97, 0.96, 0.95, 0.93, 0.90)  # used only to stay under the hard cap, each step flagged
GAP = 40
LADDER = (60, 70, 78, 84, 88, 92, 95, 98)  # qualities, lowest first
DOWNSCALES = (0.9, 0.8, 0.7)  # last resort only
WEBP_TRY_PIXELS = 6_000_000
PNG_TRY_PIXELS = 2_000_000  # lossless PNG is only tried for pictures up to this size
TRUST_QUALITY = 92  # JPEG 4:4:4 at 92+ with SSIM >= 0.98 does not change what OCR reads: the OCR round trip is skipped from here


def layout(pictures: list[np.ndarray]) -> list[tuple[int, int]]:
    """Row range (top, bottom) of each picture inside the stacked result, same rules as stack()."""
    width = max(p.shape[1] for p in pictures)
    rows, top = [], 0
    for p in pictures:
        h = p.shape[0] if p.shape[1] == width else round(p.shape[0] * width / p.shape[1])
        rows.append((top, top + h))
        top += h + GAP
    return rows


def stack(pictures: list[np.ndarray]) -> np.ndarray:
    """First picture on top, the others below, same width (narrower ones are scaled up), white gap between."""
    if len(pictures) == 1:
        return pictures[0]
    width = max(p.shape[1] for p in pictures)
    parts = []
    for p in pictures:
        if p.shape[1] != width:
            p = cv2.resize(p, (width, round(p.shape[0] * width / p.shape[1])), interpolation=cv2.INTER_CUBIC)
        parts.append(p)
    gap = np.full((GAP, width, 3), 255, np.uint8)
    out = [parts[0]]
    for p in parts[1:]:
        out += [gap, p]
    return np.concatenate(out, axis=0)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """SSIM on the luminance channel (Gaussian window), own implementation on OpenCV."""
    x = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float64)
    y = cv2.cvtColor(b, cv2.COLOR_RGB2GRAY).astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    g = lambda v: cv2.GaussianBlur(v, (11, 11), 1.5)  # noqa: E731
    mx, my = g(x), g(y)
    vx, vy, cxy = g(x * x) - mx ** 2, g(y * y) - my ** 2, g(x * y) - mx * my
    return float((((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2))).mean())


def _jpeg(pixels: np.ndarray, quality: int) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, "JPEG", quality=quality, optimize=True, subsampling=0)
    return buf.getvalue()


def png(pixels: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, "PNG", compress_level=6)
    return buf.getvalue()


def webp_lossless(pixels: np.ndarray) -> bytes:
    """Exact pixels, about a third smaller than PNG on ID photos; effort 80 / method 4 (method 6 saved 2 % for 10x the time)."""
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, "WEBP", lossless=True, quality=80, method=4)
    return buf.getvalue()


def decode(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))


def _webp(pixels: np.ndarray, quality: int) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


def _search(pixels, encode, floor, cap, accept, trust, back=None):
    """The BEST quality that fits under the cap and keeps the floor. File size only grows with quality, so the largest fitting
    quality is found by bisection (few encodes); SSIM is measured only for candidates that fit.
    Returns (fit, over): fit = (bytes, scores) or None; over = the smallest candidate that keeps the floor but not the cap."""
    cache: dict[int, bytes] = {}

    def enc(i: int) -> bytes:
        if i not in cache:
            cache[i] = encode(LADDER[i])
        return cache[i]

    def score_of(data: bytes) -> tuple[np.ndarray, float]:
        decoded = decode(data)
        return decoded, ssim(pixels, back(decoded) if back else decoded)

    lo, hi, best = 0, len(LADDER) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if len(enc(mid)) <= cap:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    for i in range(best, -1, -1):
        decoded, score = score_of(enc(i))
        if score < floor:
            break  # lower qualities only score lower
        if accept is None or LADDER[i] >= trust or accept(decoded):
            return (enc(i), {"ssim": round(score, 4), "quality": LADDER[i]}), None
    for nxt in range(best + 1, len(LADDER)):  # nothing fits (or the best fitting one fails the floor): the smallest above the cap that keeps it
        _, score = score_of(enc(nxt))
        if score >= floor:
            return None, (enc(nxt), {"ssim": round(score, 4), "quality": LADDER[nxt]})
    return None, None

def compress(pixels: np.ndarray, cap: int = DEFAULT_CAP, lossless: bool = False, floor: float = SSIM_FLOOR,
             accept=None, trust_quality: int = TRUST_QUALITY, target: int | None = DEFAULT_TARGET,
             hard_cap: bool = True) -> tuple[bytes, str, list[str], dict]:
    """(bytes, format, flags, scores). Size priority: first the `target` (150 KB) at full size with SSIM >= floor; when the floor
    cannot be kept that small, the smallest picture that keeps it is taken if it is under the `cap` (flag `targetMissed`);
    only then the full search under the cap (500 KB), downscaling included. With `hard_cap` (default) the cap is never exceeded:
    the floor is lowered step by step (flag `qualityFloorRelaxed`). `scores["target"]` says "met" or "missed"."""
    if lossless:
        # the hotel's "keep an exact copy" (MJ, 5 Nov 2026): WebP lossless, the same pixels; the cap is never met by losing quality,
        # a copy above it is flagged. PNG only when WebP cannot hold the picture (above 16383 px on a side).
        try:
            data, name = webp_lossless(pixels), "webp"
        except (OSError, ValueError):
            data, name = png(pixels), "png"
        return data, name, ["sizeCapExceeded"] if len(data) > cap else [], {"ssim": 1.0, "lossless": True}
    if target and target < cap:
        data, name, flags, scores = _compress(pixels, target, floor, accept, trust_quality, downscale=False)
        if "sizeCapExceeded" not in flags:
            return data, name, flags, {**scores, "target": "met"}
        if len(data) <= cap:
            return data, name, ["targetMissed"], {**scores, "target": "missed"}
    data, name, flags, scores = _compress(pixels, cap, floor, accept, trust_quality, downscale=True)
    if "sizeCapExceeded" in flags and hard_cap:
        # MJ (4 Nov 2026): 500 KB is a hard maximum. The similarity floor is lowered one step at a time (flagged) before the cap is broken;
        # a heavily noisy picture cannot keep SSIM 0.98 small because the noise itself does not compress.
        for relaxed in RELAXED_FLOORS:
            data, name, flags, scores = _compress(pixels, cap, relaxed, accept, trust_quality, downscale=True)
            if "sizeCapExceeded" not in flags:
                flags = flags + ["qualityFloorRelaxed"]
                scores = {**scores, "floor": relaxed}
                break
        else:
            h, w = pixels.shape[:2]
            scale = 0.6
            while True:  # shrink until it fits: the cap is never exceeded
                data = _jpeg(cv2.resize(pixels, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA), LADDER[0])
                if len(data) <= cap or scale < 0.05:
                    break
                scale *= 0.85
            name, flags, scores = "jpeg", ["downscaled", "qualityFloorRelaxed"], {"quality": LADDER[0], "scale": scale}
    missed = bool(target and target < cap)
    return data, name, flags + (["targetMissed"] if missed else []), {**scores, "target": "missed" if missed else "none"}


def _compress(pixels: np.ndarray, cap: int, floor: float, accept, trust_quality: int, downscale: bool) -> tuple[bytes, str, list[str], dict]:
    """Lossless PNG when it already fits (small pictures); else the best JPEG quality that fits the cap with SSIM >= floor; else WebP
    the same way; else (when `downscale`) the picture is scaled DOWN in steps (flag `downscaled`, SSIM measured against the full-size
    picture); else the smallest picture that keeps the floor is returned with `sizeCapExceeded`.
    `accept(candidate_pixels) -> bool` is the optional extra check (the OCR round-trip for ID profiles), asked only below `trust_quality`."""
    if pixels.shape[0] * pixels.shape[1] <= PNG_TRY_PIXELS:
        data = png(pixels)
        if len(data) <= cap:
            return data, "png", [], {"ssim": 1.0}
    over = None
    for name, encode in (("jpeg", _jpeg), ("webp", _webp)):
        if name == "webp" and pixels.shape[0] * pixels.shape[1] > WEBP_TRY_PIXELS:
            continue  # WebP encoding of a very large picture is slow and rarely rescues the cap
        try:
            fit, smallest = _search(pixels, lambda q, e=encode: e(pixels, q), floor, cap, accept, trust_quality)
        except (OSError, ValueError):  # e.g. WebP size limit
            continue
        if fit:
            return fit[0], name, [], fit[1]
        if smallest and (over is None or len(smallest[0]) < len(over[0][0])):
            over = (smallest, name)
    h, w = pixels.shape[:2]
    hopeless = over is not None and len(over[0][0]) > 2.2 * cap  # even 0.7x (half the pixels) could not bring it under the cap
    for scale in () if hopeless or not downscale else DOWNSCALES:
        small = cv2.resize(pixels, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        fit, _ = _search(pixels, lambda q: _jpeg(small, q), floor, cap, None, trust_quality,
                         back=lambda d: cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC))
        if fit:
            return fit[0], "jpeg", ["downscaled"], {**fit[1], "scale": scale}
    if over:
        (data, scores), name = over
        return data, name, ["sizeCapExceeded"], scores
    data = png(pixels)  # not even the best lossy setting keeps the floor: store the lossless picture
    return data, "png", ["sizeCapExceeded"] if len(data) > cap else [], {"ssim": 1.0}