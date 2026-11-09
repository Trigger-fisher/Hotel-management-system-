"""Calibrate the trace of an EARLIER JPEG compression (app/compression.traced_quality) on INVENTED pictures only.

    python scripts/calibrate_recompression.py [--cards 12]

Every invented card (tests/idcards.py) is taken as a clean scan and as a photo on an invented table. Clean: saved as PNG and as a
fresh JPEG at quality 90, 95 and 100. Re-compressed: first saved as a JPEG at quality 10, 15, 20, 25, 30 or 35, then saved again as
PNG or as a quality 95 JPEG. Prints the confusion table (flagged = an earlier quality below 45 found), the qualities read back and
the time per picture (decode included, and the trace alone)."""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.compression import earlier_quality, traced_quality  # noqa: E402

LOW = (10, 15, 20, 25, 30, 35)


def _jpeg(img: np.ndarray, q: int) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()


def _png(img: np.ndarray) -> bytes:
    return cv2.imencode(".png", img)[1].tobytes()


def variants(img: np.ndarray):
    """(label, truth, bytes, earlier quality or None). truth: clean | recompressed."""
    yield "png", "clean", _png(img), None
    for q in (90, 95, 100):
        yield f"jpeg {q}", "clean", _jpeg(img, q), None
    for q in LOW:
        once = cv2.imdecode(np.frombuffer(_jpeg(img, q), np.uint8), cv2.IMREAD_COLOR)
        yield f"q{q} -> png", "recompressed", _png(once), q
        yield f"q{q} -> jpeg 95", "recompressed", _jpeg(once, 95), q
    once = cv2.imdecode(np.frombuffer(_jpeg(img, 20), np.uint8), cv2.IMREAD_COLOR)
    yield "q20 -> cut 3 px -> png", "recompressed", _png(once[5:, 3:]), 20


def pictures(cards: int):
    from tests import idcards as C
    for seed in range(cards):
        card = C.card(seed)
        yield f"card {seed} scan", card
        yield f"card {seed} photo", C.on_table(card, seed=seed)


def run(cards: int = 12) -> dict:
    table = {"clean": [0, 0], "recompressed": [0, 0]}
    read: dict[str, list] = {}
    misses: list[str] = []
    total, trace_only = [], []
    for name, img in pictures(cards):
        for label, truth, data, q0 in variants(img):
            t = time.perf_counter()
            q = traced_quality(data)
            total.append(time.perf_counter() - t)
            gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
            t = time.perf_counter()
            earlier_quality(gray)
            trace_only.append(time.perf_counter() - t)
            flagged = q is not None and q < 45
            table[truth][int(flagged)] += 1
            read.setdefault(label, []).append(q)
            if flagged != (truth == "recompressed"):
                misses.append(f"{name} / {label}: {q}")
    return {"table": table, "read": read, "misses": misses,
            "ms": {"medianWithDecode": 1000 * float(np.median(total)), "p95WithDecode": 1000 * float(np.percentile(total, 95)),
                   "medianTrace": 1000 * float(np.median(trace_only)), "p95Trace": 1000 * float(np.percentile(trace_only, 95)),
                   "fastestTrace": 1000 * float(np.min(trace_only))}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cards", type=int, default=12)
    out = run(ap.parse_args().cards)
    t = out["table"]
    print("truth \\ result     not flagged  flagged")
    for truth in ("clean", "recompressed"):
        print(f"{truth:18s} {t[truth][0]:11d} {t[truth][1]:8d}")
    for label, qs in out["read"].items():
        found = [q for q in qs if q is not None]
        print(f"{label:16s} read back {min(found) if found else '-'}-{max(found) if found else '-'} ({len(found)}/{len(qs)} found)")
    print("time per picture: " + ", ".join(f"{k} {v:.1f} ms" for k, v in out["ms"].items()))
    for m in out["misses"]:
        print("  miss:", m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
