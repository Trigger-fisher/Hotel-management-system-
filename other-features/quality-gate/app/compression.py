"""How heavily a picture was compressed, read from the ORIGINAL upload before anything resamples it.

jpeg_quality(): the JPEG quality from the file's own quantisation table (copied from intake-worker app/clarity.py on 2026-11-05).
traced_quality(): an EARLIER JPEG compression traced in the pixels, for a hard-compressed copy re-saved as PNG or as a high-quality
JPEG (the table then reads high). The 8 x 8 blocks of the decoded picture are compressed again with each candidate quality's table
(libjpeg scale, clipping re-applied); a block that comes back unchanged at one quality and clearly worse at both neighbours is a trace
of that quality. Added 5 Nov 2026; the same logic is copied into intake-worker and reader (app/clarity.py)."""
from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image

# libjpeg's standard luminance table (ITU-T T.81 Annex K) at quality 50 sums to this; a file's own table is compared with it.
_STD_LUMA_SUM = 3688.0
_STD_LUMA = np.array([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
                      14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
                      49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99], np.float32)
_D8 = np.array([[(np.sqrt(0.125) if k == 0 else 0.5) * np.cos((2 * n + 1) * k * np.pi / 16) for n in range(8)] for k in range(8)])
_DCT = np.kron(_D8, _D8).astype(np.float32)  # row-major 8 x 8 block -> its 64 DCT coefficients: coef = block @ _DCT.T
_DCT_T = np.ascontiguousarray(_DCT.T)
TRACE_QUALITIES = np.arange(5, 48)  # candidates 5-45 are reported; 46 and 47 are only neighbours
TRACE_REPORT_BELOW = 46
TRACE_WINDOW = 1024  # px: the centre of the picture, on the 8 px grid
TRACE_BLOCKS = 512  # textured blocks used at most
TRACE_MIN_BLOCKS = 40
TRACE_SPREAD = 24  # grey levels between a block's darkest and lightest pixel: flat paper and plain colour carry no trace
TRACE_SAME = 1.0  # mean grey-level error of a block that comes back unchanged
TRACE_GAP = 0.5  # how much worse both neighbouring qualities must be
TRACE_SHARE = 0.07  # share of blocks with that dip at one quality. Invented cards: clean 0.000-0.038, re-saved after q10-q35 0.104-0.80
TRACE_CANDIDATES = 3
TRACE_ROUGH_BLOCKS = 256  # blocks on which the candidates are picked
TRACE_CROP_EDGES = 1.3  # a second grid phase is tried when its block edges are this much stronger than the whole picture's


def jpeg_quality(data: bytes) -> float | None:
    """The JPEG quality (libjpeg scale 1-100) of an ORIGINAL upload, estimated from its luminance quantisation table; None for
    anything that is not a JPEG. Invented pictures saved by libjpeg read back exactly (q20 -> 20); at q12 and below the table
    saturates and reads 13-16. Phone cameras save at 85-97, chat apps at about 70-80."""
    if not data or data[:3] != b"\xff\xd8\xff":
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            tables = getattr(img, "quantization", None) or {}
            if not tables:
                return None
            scale = float(sum(tables[min(tables)])) / _STD_LUMA_SUM * 100.0
    except (OSError, ValueError, SyntaxError):
        return None
    quality = (200.0 - scale) / 2.0 if scale <= 100 else 5000.0 / scale
    return round(max(1.0, min(100.0, quality)), 1)


def _table(quality: int) -> np.ndarray:
    scale = 5000 // quality if quality < 50 else 200 - 2 * quality
    return np.clip(np.floor((_STD_LUMA * scale + 50) / 100), 1, 255).astype(np.float32)


_TABLES = np.stack([_table(int(q)) for q in TRACE_QUALITIES])


def _grid_phases(gray: np.ndarray) -> list[tuple[int, int]]:
    """Where the 8 px grid starts: (0, 0) for a picture saved whole, plus the phase of the strongest block edges when a cropped
    copy shows them clearly stronger (measured on the centre window only)."""
    h, w = gray.shape
    y0, x0 = max(0, (h - TRACE_WINDOW) // 16 * 8), max(0, (w - TRACE_WINDOW) // 16 * 8)
    g = gray[y0:y0 + TRACE_WINDOW, x0:x0 + TRACE_WINDOW]
    dx = cv2.reduce(cv2.absdiff(g[:, 1:], g[:, :-1]), 0, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    dy = cv2.reduce(cv2.absdiff(g[1:], g[:-1]), 1, cv2.REDUCE_AVG, dtype=cv2.CV_32F).ravel()
    px = np.array([dx[k::8].mean() for k in range(8)])  # px[k]: jumps between column k and k + 1 (k mod 8)
    py = np.array([dy[k::8].mean() for k in range(8)])
    kx, ky = int(np.argmax(px)), int(np.argmax(py))
    strong = px[kx] >= TRACE_CROP_EDGES * px[7] or py[ky] >= TRACE_CROP_EDGES * py[7]
    phase = ((kx + 1) % 8, (ky + 1) % 8)
    return [(0, 0)] + ([phase] if strong and phase != (0, 0) else [])


def _blocks(gray: np.ndarray, ox: int, oy: int) -> np.ndarray:
    h, w = gray.shape
    y0 = oy + max(0, (h - oy - TRACE_WINDOW) // 16 * 8)
    x0 = ox + max(0, (w - ox - TRACE_WINDOW) // 16 * 8)
    ny, nx = min(TRACE_WINDOW, h - y0) // 8, min(TRACE_WINDOW, w - x0) // 8
    if ny < 2 or nx < 2:
        return np.zeros((0, 64), np.float32)
    b = gray[y0:y0 + ny * 8, x0:x0 + nx * 8].reshape(ny, 8, nx, 8).swapaxes(1, 2).reshape(-1, 64)
    idx = np.nonzero(b.max(axis=1).astype(np.int16) - b.min(axis=1) >= TRACE_SPREAD)[0]
    if idx.size > TRACE_BLOCKS:
        idx = idx[np.linspace(0, idx.size - 1, TRACE_BLOCKS).astype(int)]
    return b[idx].astype(np.float32)


def _unclipped_error(bc: np.ndarray, table: np.ndarray) -> np.ndarray:
    """Recompression error of blocks with pixels at 0 or 255: the values the first decoder clipped are let past the clip for two
    rounds, so the clip does not hide the trace."""
    hi, lo = bc >= 253, bc <= 2
    yc = (np.rint(((bc - 128.0) @ _DCT_T) / table) * table) @ _DCT + 128.0
    for _ in range(2):
        x = np.where(hi & (yc > bc), yc, np.where(lo & (yc < bc), yc, bc))
        yc = (np.rint(((x - 128.0) @ _DCT_T) / table) * table) @ _DCT + 128.0
    return np.abs(np.clip(np.rint(yc), 0, 255) - bc).mean(axis=1)


def _dip_share(e: np.ndarray, left: np.ndarray, right: np.ndarray) -> np.ndarray:
    return ((e <= TRACE_SAME) & (np.minimum(left, right) >= e + TRACE_GAP)).mean(axis=0)


def _trace(b: np.ndarray) -> tuple[int | None, float]:
    """Each block compressed again with every candidate table (mean grey-level change per block and quality), then the best
    candidates checked again with the clipped blocks handled."""
    coef = (b - 128.0) @ _DCT_T
    rough_rows = slice(None, None, max(1, len(b) // TRACE_ROUGH_BLOCKS))  # candidates are picked on a sample
    rb, rc = b[rough_rows], coef[rough_rows]
    rec = ((np.rint(rc[None] / _TABLES[:, None]) * _TABLES[:, None]).reshape(-1, 64) @ _DCT).reshape(len(_TABLES), len(rb), 64)
    errors = np.abs(np.clip(np.rint(rec + 128.0), 0, 255) - rb[None]).mean(axis=2).T
    far = np.full((len(rb), 1), 1e9, np.float32)
    left, right = np.concatenate([far, errors[:, :-1]], axis=1), np.concatenate([errors[:, 1:], far], axis=1)
    rough = _dip_share(errors, left, right)
    clipped = ((b >= 253) | (b <= 2)).any(axis=1)
    refined: dict[int, np.ndarray] = {}

    def column(j: int) -> np.ndarray:
        if j < 0 or j >= len(_TABLES):
            return np.full(len(b), 1e9, np.float32)
        if j not in refined:
            t = _TABLES[j]
            e = np.abs(np.clip(np.rint((np.rint(coef / t) * t) @ _DCT + 128.0), 0, 255) - b).mean(axis=1)
            if clipped.any():
                e[clipped] = _unclipped_error(b[clipped], t)
            refined[j] = e
        return refined[j]

    found, best = None, 0.0
    for i in [int(i) for i in np.argsort(-rough) if TRACE_QUALITIES[i] < TRACE_REPORT_BELOW][:TRACE_CANDIDATES]:
        share = float(_dip_share(column(i), column(i - 1), column(i + 1)))
        best = max(best, share)
        if share >= TRACE_SHARE and (found is None or TRACE_QUALITIES[i] < found):
            found = int(TRACE_QUALITIES[i])
    return found, best


def earlier_quality(gray: np.ndarray) -> tuple[int | None, float]:
    """(quality 5-45 of an earlier JPEG compression traced in this grey picture or None, the strongest trace share). The picture
    must be the upload's own pixels: resizing or turning it by other than whole 8 px blocks wipes the trace."""
    if gray.ndim != 2 or min(gray.shape) < 64:
        return None, 0.0
    found, best = None, 0.0
    for ox, oy in _grid_phases(gray):
        b = _blocks(gray, ox, oy)
        if len(b) < TRACE_MIN_BLOCKS:
            continue
        q, share = _trace(b)
        best = max(best, share)
        if q is not None and (found is None or q < found):
            found = q
    return found, round(best, 3)


def traced_quality(data: bytes) -> int | None:
    """Quality of an earlier JPEG compression traced in an upload's pixels (JPEG, PNG or WebP), or None. A JPEG is decoded to its
    own luminance (no colour step, no EXIF turn: the 8 px grid stays where the encoder put it)."""
    if not data:
        return None
    try:
        gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
    except cv2.error:
        return None
    if gray is None:
        return None
    return earlier_quality(gray)[0]
