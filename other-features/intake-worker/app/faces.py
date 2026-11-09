"""Photo check on every ID (MJ, 4 Nov 2026): find the holder's printed portrait on a card side and compare portraits between cards
as EXTRA evidence, offline.

Models (opencv_zoo, pinned commit, fetched and checked by scripts/get_face_models.py, git-ignored, folder FACE_MODELS_DIR):
  * YuNet face detector (MIT licence)   face_detection_yunet_2026may.onnx (dynamic input, for OpenCV 5's ONNX engine)
  * SFace face recogniser (Apache-2.0)  face_recognition_sface_2021dec.onnx
Run through OpenCV's FaceDetectorYN / FaceRecognizerSF. No InsightFace, no non-commercial model.

Rules:
  * A score is EVIDENCE, never identity proof. Cosine similarity >= FACE_MATCH_AT_LEAST (0.363, the SFace default) = match: it may
    support a pair or a guest link. Below FACE_MISMATCH_BELOW (0.15) = a clear mismatch: it BLOCKS a pair, a duplicate or a guest
    link even when names and numbers agree, and is shown for a human check. In between = unclear.
  * No portrait, a tiny, blurred or glared one: "unclear", no evidence either way.
  * PRIVACY: the face embedding (128 numbers) lives in memory only, on the Portrait object; it is never written to disk, logs,
    reports or the database. Only the outcome (match / mismatch / unclear) and the score rounded to 2 decimals leave this module."""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import thresholds as T

DETECTOR = "face_detection_yunet_2026may.onnx"
RECOGNISER = "face_recognition_sface_2021dec.onnx"
DEFAULT_DIR = Path(__file__).resolve().parents[1] / "models" / "faces"
DETECT_SIDE = 1000  # the card is searched at no more than this on its long side
_local = threading.local()  # one detector and recogniser per thread: OpenCV's objects keep state between calls


def models_dir() -> Path:
    return Path(os.environ.get("FACE_MODELS_DIR", "").strip() or DEFAULT_DIR)


def available() -> bool:
    d = models_dir()
    return (d / DETECTOR).is_file() and (d / RECOGNISER).is_file() and hasattr(cv2, "FaceDetectorYN")


def _models():
    if getattr(_local, "dir", None) != models_dir():
        d = models_dir()
        _local.detector = cv2.FaceDetectorYN.create(str(d / DETECTOR), "", (320, 320), T.get("FACE_DETECT_SCORE"), 0.3, 20)
        _local.recogniser = cv2.FaceRecognizerSF.create(str(d / RECOGNISER), "")
        _local.dir = d
    return _local.detector, _local.recogniser


@dataclass
class Portrait:
    status: str  # found | none | unclear | unavailable
    reasons: list[str] = field(default_factory=list)
    box: tuple[int, int, int, int] | None = None  # x, y, w, h on the card picture given
    detection: float = 0.0
    quality: dict = field(default_factory=dict)  # height in source pixels, sharpness, glare
    feature: np.ndarray | None = field(default=None, repr=False)  # IN MEMORY ONLY: never serialised

    def public(self) -> dict:
        """What may be stored: the status and reasons, never the embedding or the face box pixels."""
        return {"status": self.status, "reasons": list(self.reasons), **({"quality": self.quality} if self.quality else {})}


def steepness(gray: np.ndarray) -> float:
    """How steep the strongest edges are, relative to the contrast, in the WORSE of the two directions (a motion blur smears one
    direction only): about 1.0 for crisp print, 0.6 at a Gaussian blur of 1.5 px, 0.3 at 2.5 px (on a card 1000 px long)."""
    if gray.size == 0 or min(gray.shape[:2]) < 3:
        return 0.0
    g = gray.astype(np.float32)
    lo, hi = np.percentile(g, [1, 99])
    if hi - lo < 1:
        return 0.0
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)) / 4.0
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)) / 4.0
    return float(min(np.percentile(gx, 99.5), np.percentile(gy, 99.5)) / (hi - lo))


def find_portrait(rgb: np.ndarray, source_scale: float = 1.0) -> Portrait:
    """The holder's portrait on one card side (RGB, upright). `source_scale` = source pixels per card pixel (below 1 when the cutter
    enlarged the card), so "too small" is judged on what the camera really saw."""
    if not available():
        return Portrait("unavailable", ["face models not installed"])
    detector, recogniser = _models()
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    scale = min(1.0, DETECT_SIDE / max(bgr.shape[:2]))
    small = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else bgr
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, found = detector.detect(small)
    if found is None or len(found) == 0:
        return Portrait("none")
    best = max(found, key=lambda f: f[2] * f[3] * f[14])  # the biggest clear face (a ghost image is smaller and fainter)
    face = best.copy()
    face[:14] /= scale
    x, y, w, h = (int(round(v)) for v in face[:4])
    crop = bgr[max(0, y):y + h, max(0, x):x + w]
    gray = cv2.cvtColor(cv2.resize(crop, (112, 112), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY) if crop.size else np.zeros((1, 1), np.uint8)
    source_px = h * source_scale
    sharp = steepness(gray)
    glare = float((gray >= 250).mean())
    quality = {"heightPx": int(round(source_px)), "sharpness": round(sharp, 3), "glare": round(glare, 3)}
    reasons = []
    if source_px < T.get("FACE_MIN_PX"):
        reasons.append("photo too small")
    if sharp < T.get("FACE_SHARP_MIN"):
        reasons.append("photo blurred")
    if glare > T.get("FACE_GLARE_MAX"):
        reasons.append("glare over photo")
    portrait = Portrait("unclear" if reasons else "found", reasons, (x, y, w, h), round(float(best[14]), 3), quality)
    if not reasons:
        portrait.feature = recogniser.feature(recogniser.alignCrop(bgr, face)).copy()
    return portrait


def compare(a: "Portrait | None", b: "Portrait | None") -> dict:
    """{outcome: match | mismatch | unclear, score: rounded to 2 decimals or None, reason}. Only clear portraits are compared."""
    if a is None or b is None or a.feature is None or b.feature is None:
        why = "no photo" if any(p is None or p.status in ("none",) for p in (a, b)) else \
            "face models not installed" if any(p is not None and p.status == "unavailable" for p in (a, b)) else "photo unclear"
        return {"outcome": "unclear", "score": None, "reason": why}
    _, recogniser = _models()
    score = float(recogniser.match(a.feature, b.feature, cv2.FaceRecognizerSF_FR_COSINE))
    if score >= T.get("FACE_MATCH_AT_LEAST"):
        outcome = "match"
    elif score < T.get("FACE_MISMATCH_BELOW"):
        outcome = "mismatch"
    else:
        outcome = "unclear"
    return {"outcome": outcome, "score": round(score, 2), "reason": "between the lines" if outcome == "unclear" else ""}


def compare_sets(a: list["Portrait | None"], b: list["Portrait | None"]) -> dict:
    """Two people's portraits (one per card side that has one): the best-matching pair decides; a mismatch needs every clear pair
    to be a mismatch."""
    results = [compare(x, y) for x in a for y in b if x is not None and y is not None and x.feature is not None and y.feature is not None]
    if not results:
        return compare(next((x for x in a if x is not None), None), next((y for y in b if y is not None), None))
    return max(results, key=lambda r: r["score"])


def forget(portraits) -> None:
    """Drop the embeddings once grouping is done (they were never stored; this frees them early)."""
    for p in portraits:
        if p is not None:
            p.feature = None
