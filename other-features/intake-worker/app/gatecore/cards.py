# copied from quality-gate on 2026-11-04
"""A simple card finder for photos that carry several ID cards (profile `multi-id`). Own copy, classical
OpenCV only. It finds rectangles of card-like shape; touching cards may merge into one region and are then judged
as one, which is why the advice is always to photograph in smaller groups."""
from __future__ import annotations

import cv2
import numpy as np

from .metrics import glare_share, to_gray, blur_scores

WORK_SIDE = 900
MIN_SHARE = 0.003  # a card covers at least this share of the frame
MAX_SHARE = 0.9


def _order(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def _quad(cnt: np.ndarray) -> np.ndarray | None:
    hull = cv2.convexHull(cnt)
    peri = cv2.arcLength(hull, True)
    for eps in (0.015, 0.025, 0.04, 0.06):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return _order(approx.reshape(4, 2))
    box = _order(cv2.boxPoints(cv2.minAreaRect(hull)))
    return box if cv2.contourArea(hull) / max(cv2.contourArea(box.reshape(-1, 1, 2)), 1) > 0.85 else None


def _plausible(q: np.ndarray, frame_area: float) -> bool:
    area = cv2.contourArea(q.reshape(-1, 1, 2))
    if not MIN_SHARE <= area / frame_area <= MAX_SHARE:
        return False
    w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    h = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    ratio = max(w, h) / max(min(w, h), 1)
    return 1.15 <= ratio <= 2.2  # ID-1 cards are 1.586; A6 and passports page also fit


def find_cards(img: np.ndarray, limit: int) -> list[np.ndarray]:
    """Corner arrays (tl, tr, br, bl) in the picture's own pixels, largest first, at most `limit`."""
    h, w = img.shape[:2]
    scale = min(1.0, WORK_SIDE / max(h, w))
    small = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else img
    bgr = small if small.ndim == 3 else cv2.cvtColor(small, cv2.COLOR_GRAY2BGR)
    gray = to_gray(small)
    area = float(gray.size)
    masks = []
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    masks.append(cv2.morphologyEx(cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)))
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    t = max(2, int(0.04 * min(gray.shape)))
    border = np.concatenate([lab[:t].reshape(-1, 3), lab[-t:].reshape(-1, 3), lab[:, :t].reshape(-1, 3), lab[:, -t:].reshape(-1, 3)])
    dist = cv2.GaussianBlur(np.linalg.norm(lab - np.median(border, axis=0), axis=2), (9, 9), 0)
    m = cv2.threshold(cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    masks.append(cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)), cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)))
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    for flag in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
        p = cv2.threshold(blur, 0, 255, flag + cv2.THRESH_OTSU)[1]
        masks.append(cv2.morphologyEx(cv2.morphologyEx(p, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8)), cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)))
    found: list[tuple[float, np.ndarray]] = []
    for mask in masks:
        padded = cv2.copyMakeBorder(mask, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=0)
        contours, _ = cv2.findContours(padded, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            if cv2.contourArea(cnt) < MIN_SHARE * area:
                continue
            q = _quad(cnt)
            if q is not None:
                q = q - 4
                if _plausible(q, area):
                    found.append((cv2.contourArea(q.reshape(-1, 1, 2)), q))
    kept: list[np.ndarray] = []
    for _, q in sorted(found, key=lambda f: f[0], reverse=True):
        poly_area = cv2.contourArea(q.reshape(-1, 1, 2))
        overlaps = False
        for k in kept:
            inter, _ = cv2.intersectConvexConvex(q.astype(np.float32), k.astype(np.float32))
            if inter / max(min(poly_area, cv2.contourArea(k.reshape(-1, 1, 2))), 1) > 0.5:
                overlaps = True
                break
        if not overlaps:
            kept.append(q)
        if len(kept) >= limit + 1:  # one extra so "too many" can be told from "exactly the limit"
            break
    return [np.clip(q / scale, 0, [w - 1, h - 1]).astype(np.float32) for q in kept]


def flatten(img: np.ndarray, corners: np.ndarray) -> np.ndarray:
    q = _order(corners)
    width = int(round(max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[2] - q[3]))))
    height = int(round(max(np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[2] - q[1]))))
    target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(q, target), (max(width, 8), max(height, 8)),
                               flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def card_scores(crop: np.ndarray) -> dict:
    gray = to_gray(crop)
    return {**blur_scores(gray), "glare": glare_share(gray), "longSidePx": int(max(gray.shape))}
