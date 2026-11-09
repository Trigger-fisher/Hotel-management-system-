"""Calibrate the trace of an EARLIER JPEG compression (app/clarity.traced_quality, used by jpeg_quality) on INVENTED cards only.

    python scripts/calibrate_recompression.py [--limit 0]

The invented cards of scripts/calibrate_clarity.py (five kinds, five people, each with a drawn portrait) are used as drawn: pure
white paper and black print, the hardest case for the trace because most text blocks touch 0 or 255. Clean: saved as PNG and as a
fresh JPEG at quality 90, 95 and 100. Re-compressed: first saved as a JPEG at quality 10, 15, 20, 25, 30 or 35, then saved again as
PNG or as a quality 95 JPEG. Prints the confusion table (flagged = a quality below 45, the clarity line where "picture too
compressed" starts), the qualities read back and the time per picture (jpeg_quality with its decode, and the trace alone)."""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from app import clarity  # noqa: E402

LOW = (10, 15, 20, 25, 30, 35)


def _jpeg(img: np.ndarray, q: int) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()


def _png(img: np.ndarray) -> bytes:
    return cv2.imencode(".png", img)[1].tobytes()


def variants(bgr: np.ndarray):
    """(label, truth, bytes). truth: clean | recompressed."""
    yield "png", "clean", _png(bgr)
    for q in (90, 95, 100):
        yield f"jpeg {q}", "clean", _jpeg(bgr, q)
    for q in LOW:
        once = cv2.imdecode(np.frombuffer(_jpeg(bgr, q), np.uint8), cv2.IMREAD_COLOR)
        yield f"q{q} -> png", "recompressed", _png(once)
        yield f"q{q} -> jpeg 95", "recompressed", _jpeg(once, 95)


def run(limit: int = 0) -> dict:
    from calibrate_clarity import _cards
    cards = _cards()[:limit] if limit else _cards()
    usable = 45.0
    table = {"clean": [0, 0], "recompressed": [0, 0]}
    read: dict[str, list] = {}
    misses: list[str] = []
    total, trace_only = [], []
    for name, rgb, _kind, _side in cards:
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        for label, truth, data in variants(bgr):
            t = time.perf_counter()
            q = clarity.jpeg_quality(data)
            total.append(time.perf_counter() - t)
            gray = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_IGNORE_ORIENTATION)
            t = time.perf_counter()
            traced, _ = clarity.earlier_quality(gray)
            trace_only.append(time.perf_counter() - t)
            flagged = q is not None and q < usable
            table[truth][int(flagged)] += 1
            read.setdefault(label, []).append(traced)
            if flagged != (truth == "recompressed"):
                misses.append(f"{name} / {label}: {q}")
    ms = lambda v, f: 1000 * float(f(v))  # noqa: E731
    return {"table": table, "read": read, "misses": misses,
            "ms": {"medianWithDecode": ms(total, np.median), "p95WithDecode": ms(total, lambda v: np.percentile(v, 95)),
                   "medianTrace": ms(trace_only, np.median), "fastestTrace": ms(trace_only, np.min)}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=0)
    out = run(ap.parse_args().limit)
    t = out["table"]
    print("truth \\ result     not flagged  flagged")
    for truth in ("clean", "recompressed"):
        print(f"{truth:18s} {t[truth][0]:11d} {t[truth][1]:8d}")
    for label, qs in out["read"].items():
        found = [q for q in qs if q is not None]
        print(f"{label:16s} traced {min(found) if found else '-'}-{max(found) if found else '-'} ({len(found)}/{len(qs)} found)")
    print("time per picture: " + ", ".join(f"{k} {v:.1f} ms" for k, v in out["ms"].items()))
    for m in out["misses"]:
        print("  miss:", m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
