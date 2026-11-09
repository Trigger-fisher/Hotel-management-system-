"""Geometry ENSEMBLE. Several candidates for the page geometry are flattened and each is scored by what matters, readability:
the mean OCR confidence of a quick first-pass read (character weighted), with a small bonus for text-line straightness.

Candidates: the best quad from EACH method (edges, background colour, bright paper, dark paper) plus "whole picture, deskew only".
`fast` tries the whole picture and the best quad; `thorough` tries every method's best quad. When scores are close the LARGER crop
wins (never crop away content when unsure). The audit says which candidate won, every score, and how much warp was applied.

The learned dewarp UVDoc is NOT used: its licence was not verified here (sources disagree: MIT, Apache-2.0, CC BY 4.0 for the paper)."""
from __future__ import annotations

import time

import cv2
import numpy as np

from . import geometry
from .merge import merge_readings
from .quality import to_gray

CLOSE = 0.95  # scores within 5% count as equal: then the bigger crop wins
READ_SIDE = 900


def _score(lines) -> tuple[float, float]:
    chars = sum(len(l.text) for l in lines)
    if not chars:
        return 0.0, 0.0
    conf = sum(l.confidence * len(l.text) for l in lines) / chars
    return sum(len(l.text) * l.confidence ** 2 for l in lines), conf


def _warp_amount(quad) -> dict:
    q = geometry.order_corners(quad)
    top, bottom = np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[2] - q[3])
    left, right = np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[2] - q[1])
    angle = float(np.degrees(np.arctan2(q[1][1] - q[0][1], q[1][0] - q[0][0])))
    return {"rotationDeg": round(angle, 1), "keystone": round(1 - min(top, bottom) / max(top, bottom, 1e-6), 3),
            "sideSkew": round(1 - min(left, right) / max(left, right, 1e-6), 3)}


def localise(reader, img: np.ndarray, mode: str = "fast") -> tuple[list[geometry.Region], dict]:
    """(regions, audit). Falls back to the plain finder when there is no engine to score with."""
    started = time.monotonic()
    whole = geometry.Region(0, img, None)
    if not reader.engines:
        return geometry.localise(img, True), {"winner": "plain", "candidates": []}
    candidates = [("whole", whole, 1.0, None)]
    try:
        raw = geometry.find_quads(img, keep_all=True)
    except cv2.error:
        raw = []
    flags: list[str] = []
    best_by_method: dict[str, geometry.Quad] = {}
    for q in raw:
        if q.score >= geometry.MIN_SCORE and q.share < geometry.FILLS_FRAME:
            if q.touches_border:
                flags.append("partlyCutOff")
                continue
            if q.method not in best_by_method or q.score > best_by_method[q.method].score:
                best_by_method[q.method] = q
    ordered = sorted(best_by_method.values(), key=lambda q: q.score, reverse=True)
    for q in ordered[: (len(ordered) if mode == "thorough" else 1)]:
        candidates.append((q.method, geometry.Region(0, geometry.warp(img, q.corners), q.corners), q.share, q.corners))
    if len(candidates) == 1 and not raw:
        flags.append("documentNotFound")
    audit_rows, scored = [], []
    for name, region, share, quad in candidates:
        gray = to_gray(region.image)
        longest = max(gray.shape)
        small = cv2.resize(gray, None, fx=READ_SIDE / longest, fy=READ_SIDE / longest, interpolation=cv2.INTER_AREA) if longest > READ_SIDE else gray
        skew = geometry_skew(small)
        used: set[str] = set()
        lines = merge_readings(reader._read(small, ["Latin"], {}, used))
        total, conf = _score(lines)
        scored.append((total, share, name, region))
        audit_rows.append({"method": name, "score": round(total, 1), "ocrConfidence": round(conf, 3), "areaShare": round(share, 3),
                           "residualSkewDeg": round(skew, 2), **({"warp": _warp_amount(quad)} if quad is not None else {})})
    top = max(s[0] for s in scored)
    # Close scores: the larger crop wins, so content is never cropped away on a hunch.
    pool = [s for s in scored if s[0] >= CLOSE * top]
    winner = max(pool, key=lambda s: s[1])
    for row in audit_rows:
        row["chosen"] = row["method"] == winner[2]
    region = winner[3]
    region.flags = list(dict.fromkeys(flags + (["documentNotFound"] if winner[2] == "whole" and "documentNotFound" in flags else [])))
    audit = {"winner": winner[2], "candidates": audit_rows, "ms": int((time.monotonic() - started) * 1000)}
    return [region], audit


def geometry_skew(gray: np.ndarray) -> float:
    from .quality import estimate_skew
    return estimate_skew(gray)
