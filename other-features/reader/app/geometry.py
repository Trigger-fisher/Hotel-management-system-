"""Find the document in a photo, flatten it, and spot curled pages.

Free tools only (OpenCV + numpy), no training. The rule everywhere: when unsure, keep more of the
picture, never less."""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .quality import normalised, to_gray

WORK_SIDE = 900  # candidate search happens on a downscaled copy
MIN_SHARE = 0.08  # a document covers at least this much of the frame
FILLS_FRAME = 0.9  # a quad this large means the document already fills the picture
MIN_SCORE = 0.45
EXPAND = 0.008  # grow the quad slightly so edges are never shaved
MAX_OUT_SIDE = 5000  # never produce more pixels than this (and never upscale)
BORDER_TOL = 0.012  # corners this close to the frame edge count as touching it


@dataclass
class Quad:
    corners: np.ndarray  # 4x2 float, order: top-left, top-right, bottom-right, bottom-left
    score: float
    method: str
    share: float
    touches_border: bool = False


@dataclass
class Region:
    index: int
    image: np.ndarray
    quad: np.ndarray | None  # corners in the ORIGINAL picture, None when the whole picture is used
    flags: list[str] = field(default_factory=list)


def order_corners(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def _angles_ok(c: np.ndarray) -> bool:
    for i in range(4):
        a, b = c[i - 1] - c[i], c[(i + 1) % 4] - c[i]
        cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        if not 60 <= np.degrees(np.arccos(np.clip(cos, -1, 1))) <= 120:
            return False
    return True


def score_quad(c: np.ndarray, frame_area: float, fill: float) -> tuple[float, float]:
    """(score 0..1, area share). `fill` = how well the underlying shape fills the quad (0..1)."""
    area = cv2.contourArea(c.reshape(-1, 1, 2))
    share = area / frame_area
    if share < MIN_SHARE or not _angles_ok(c) or not cv2.isContourConvex(c.astype(np.float32).reshape(-1, 1, 2)):
        return 0.0, share
    top, bottom = np.linalg.norm(c[1] - c[0]), np.linalg.norm(c[2] - c[3])
    left, right = np.linalg.norm(c[3] - c[0]), np.linalg.norm(c[2] - c[1])
    sides = min(top, bottom) / max(top, bottom, 1e-6) * min(left, right) / max(left, right, 1e-6)
    ratio = max((top + bottom), (left + right)) / max(min((top + bottom), (left + right)), 1e-6)
    if ratio > 5.0:
        return 0.0, share
    aspect = 1.0 if ratio <= 1.8 else max(0.5, 1.0 - (ratio - 1.8) * 0.16)
    size = min(1.0, share / 0.25)
    return float(fill * np.sqrt(sides) * aspect * size), share


def _quad_from_contour(cnt: np.ndarray) -> tuple[np.ndarray, float] | None:
    """A 4-corner approximation of a contour and how well the contour fills it."""
    hull = cv2.convexHull(cnt)
    peri = cv2.arcLength(hull, True)
    for eps in (0.01, 0.015, 0.02, 0.03, 0.045, 0.06):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            quad = order_corners(approx.reshape(4, 2))
            qa = cv2.contourArea(quad.reshape(-1, 1, 2))
            return quad, float(min(1.0, cv2.contourArea(hull) / qa)) if qa > 0 else None
    rect = order_corners(cv2.boxPoints(cv2.minAreaRect(hull)))
    qa = cv2.contourArea(rect.reshape(-1, 1, 2))
    if qa > 0 and cv2.contourArea(hull) / qa > 0.8:
        return rect, float(cv2.contourArea(hull) / qa)
    return None


def _from_mask(mask: np.ndarray, method: str, frame_area: float) -> list[Quad]:
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        if cv2.contourArea(cnt) < MIN_SHARE * frame_area * 0.8:
            break
        found = _quad_from_contour(cnt)
        if found:
            quad, fill = found
            score, share = score_quad(quad, frame_area, fill)
            if score > 0:
                out.append(Quad(quad, score, method, share))
    return out


def _edge_mask(gray: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    med = float(np.median(blur))
    edges = cv2.Canny(blur, max(10, 0.66 * med), min(250, 1.33 * med + 30))
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    return cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))


def _colour_mask(small_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(small_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    h, w = lab.shape[:2]
    t = max(2, int(0.04 * min(h, w)))
    border = np.concatenate([lab[:t].reshape(-1, 3), lab[-t:].reshape(-1, 3),
                             lab[:, :t].reshape(-1, 3), lab[:, -t:].reshape(-1, 3)])
    background = np.median(border, axis=0)
    dist = cv2.GaussianBlur(np.linalg.norm(lab - background, axis=2), (9, 9), 0)
    norm = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    mask = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25)))
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))


def _paper_masks(gray: np.ndarray) -> list[np.ndarray]:
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    masks = []
    for flag in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
        m = cv2.threshold(blur, 0, 255, flag + cv2.THRESH_OTSU)[1]
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (31, 31)))
        masks.append(cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8)))
    return masks


def _poly_overlap(a: np.ndarray, b: np.ndarray) -> float:
    """Intersection area divided by the smaller polygon's area."""
    area, _ = cv2.intersectConvexConvex(a.astype(np.float32), b.astype(np.float32))
    smaller = min(cv2.contourArea(a.astype(np.float32)), cv2.contourArea(b.astype(np.float32)))
    return float(area / smaller) if smaller > 0 else 0.0


def find_quads(img: np.ndarray, keep_all: bool = False) -> list[Quad]:
    """Candidate document quads in the picture's own pixel coordinates, best first, overlaps removed."""
    h, w = img.shape[:2]
    scale = min(1.0, WORK_SIDE / max(h, w))
    small = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else img
    bgr = small if small.ndim == 3 else cv2.cvtColor(small, cv2.COLOR_GRAY2BGR)
    gray = to_gray(small)
    sh, sw = gray.shape
    frame_area = float(sh * sw)
    # Pad with a thin border so documents touching the frame still form closed contours.
    pad = 6
    candidates: list[Quad] = []
    masks = [("edges", _edge_mask(gray)), ("colour", _colour_mask(bgr))] + \
            [(f"paper{i}", m) for i, m in enumerate(_paper_masks(gray))]
    for method, mask in masks:
        candidates += _from_mask(cv2.copyMakeBorder(mask, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0),
                                 method, frame_area)
    for q in candidates:
        q.corners = q.corners - pad  # undo the padding offset
    # A quad that is the whole frame is what a "bright everywhere" mask gives: it only counts when
    # nothing smaller fits, so it goes last and must not swallow the real candidates in overlap removal.
    kept: list[Quad] = []
    for q in sorted((c for c in candidates if c.share < FILLS_FRAME), key=lambda q: q.score, reverse=True):
        if keep_all or all(_poly_overlap(q.corners, k.corners) < 0.7 for k in kept):
            kept.append(q)
    kept += sorted((c for c in candidates if c.share >= FILLS_FRAME), key=lambda q: q.score, reverse=True)[:(None if keep_all else 1)]
    tol = BORDER_TOL
    for q in kept:
        c = q.corners
        q.touches_border = bool(((c[:, 0] < tol * sw) | (c[:, 0] > (1 - tol) * sw)
                                 | (c[:, 1] < tol * sh) | (c[:, 1] > (1 - tol) * sh)).any())
        q.corners = (np.clip(c, 0, [sw - 1, sh - 1]) / scale).astype(np.float32)
    return kept


def warp(img: np.ndarray, corners: np.ndarray, expand: float = EXPAND) -> np.ndarray:
    """Flatten the quad into an upright rectangle at the picture's own resolution (never upscaled)."""
    c = order_corners(corners)
    centre = c.mean(axis=0)
    h, w = img.shape[:2]
    c = np.clip(centre + (c - centre) * (1 + expand), 0, [w - 1, h - 1]).astype(np.float32)
    width = int(round(max(np.linalg.norm(c[1] - c[0]), np.linalg.norm(c[2] - c[3]))))
    height = int(round(max(np.linalg.norm(c[3] - c[0]), np.linalg.norm(c[2] - c[1]))))
    shrink = min(1.0, MAX_OUT_SIDE / max(width, height, 1))
    width, height = max(8, int(width * shrink)), max(8, int(height * shrink))
    target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(c, target)
    return cv2.warpPerspective(img, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def localise(img: np.ndarray, enabled: bool = True) -> list[Region]:
    """One Region per document found. Falls back to the whole picture, with flags, when unsure."""
    whole = Region(0, img, None)
    if not enabled:
        return [whole]
    try:
        quads = find_quads(img)
    except cv2.error:
        whole.flags.append("documentNotFound")
        return [whole]
    good = [q for q in quads if q.score >= MIN_SCORE]
    if not good:
        whole.flags.append("documentNotFound")
        return [whole]
    best = good[0]
    if best.share >= FILLS_FRAME:
        return [whole]  # the document already fills the frame: nothing to crop
    if best.touches_border:
        whole.flags.append("partlyCutOff")
        return [whole]  # the true edge is outside the picture: do not guess it
    chosen = [best] + [q for q in good[1:] if q.score >= 0.6 * best.score and q.share >= 0.06
                       and not q.touches_border]
    chosen.sort(key=lambda q: (round(q.corners[:, 1].mean() / max(img.shape[0], 1) * 4), q.corners[:, 0].mean()))
    return [Region(i, warp(img, q.corners), q.corners) for i, q in enumerate(chosen)]


# ---- curled pages ----------------------------------------------------------------------

@dataclass
class LineCurve:
    y: float  # line centre (in the analysed image)
    xs: np.ndarray
    offset: np.ndarray  # how far the line sits from its straight fit at each x


def _running_median(values: np.ndarray, window: int) -> np.ndarray:
    """Smooth letter-shape jitter (ascenders, descenders) away so only the slow bend of a line remains."""
    half = window // 2
    padded = np.pad(values, half, mode="edge")
    return np.array([np.median(padded[i:i + window]) for i in range(len(values))])


def line_curves(gray: np.ndarray) -> tuple[list[LineCurve], float]:
    """Wavy text lines: per-line deviation from a straight fit, plus the scale used (analysed / original)."""
    small = normalised(gray, 1000)
    scale = small.shape[1] / gray.shape[1] if gray.shape[1] >= gray.shape[0] else small.shape[0] / gray.shape[0]
    _, binary = cv2.threshold(cv2.GaussianBlur(small, (3, 3), 0), 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = binary.shape
    joined = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (max(25, w // 25), 5)))
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    curves = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        if cw < 0.3 * w or ch > 0.2 * h:
            continue
        xs, ys = [], []
        for col in range(x, x + cw, max(1, cw // 40)):
            on = np.nonzero(binary[y:y + ch, col])[0]
            if len(on) >= 2:
                xs.append(col)
                ys.append(y + float(np.mean(on)))
        if len(xs) < 10:
            continue
        xs_a, ys_a = np.array(xs, dtype=np.float64), _running_median(np.array(ys, dtype=np.float64), 9)
        slope, intercept = np.polyfit(xs_a, ys_a, 1)
        curves.append(LineCurve(float(np.mean(ys_a)), xs_a, ys_a - (slope * xs_a + intercept)))
    return curves, scale


def curl_amount(curves: list[LineCurve], line_height: float = 20.0) -> float:
    """How far the average line bends, in line heights. A curled page bends ALL its lines the same way, so the
    average curve keeps the bend while letter-shape jitter on a flat page averages away."""
    if len(curves) < 3:
        return 0.0
    grid = np.linspace(0.05, 0.95, 24)
    stack = []
    for c in curves:
        span = c.xs.max() - c.xs.min()
        if span <= 0:
            continue
        stack.append(np.interp(c.xs.min() + grid * span, c.xs, c.offset))
    if len(stack) < 3:
        return 0.0
    mean_curve = np.median(np.array(stack), axis=0)
    return float((mean_curve.max() - mean_curve.min()) / max(line_height, 1.0))


CURL_FLAG = 0.15  # average bend of this many line heights or more marks the page as curved

def straighten(gray: np.ndarray, curves: list[LineCurve], scale: float) -> np.ndarray:
    """Per-line baseline straightening: shift every column so the measured lines become straight."""
    h, w = gray.shape[:2]
    ys = np.array([c.y for c in curves])
    order = np.argsort(ys)
    cols = np.arange(w, dtype=np.float32)
    disp = np.zeros((len(curves), w), dtype=np.float32)
    for row, idx in enumerate(order):
        c = curves[idx]
        disp[row] = np.interp(cols * scale, c.xs, c.offset) / scale
    centres = ys[order] / scale
    map_x, map_y = np.meshgrid(cols, np.arange(h, dtype=np.float32))
    shift = np.empty((h, w), dtype=np.float32)
    for x in range(w):
        shift[:, x] = np.interp(np.arange(h), centres, disp[:, x])
    return cv2.remap(gray, map_x, map_y + shift, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
