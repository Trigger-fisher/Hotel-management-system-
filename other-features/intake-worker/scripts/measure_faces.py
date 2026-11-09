"""Measure the photo check (YuNet + SFace) on INVENTED drawn faces printed at ID size. No real face is used.

    python scripts/measure_faces.py [--people 30]

Each invented person (tests/faces.py) gets three "photos" (small shift, scale, tilt, light, smile). Every photo is printed into an
invented card's photo box at a real printed size (portrait 120, 160 or 180 px tall, about what a card scanned at 300 dpi holds),
the card is softened and saved as JPEG like a scan, the portrait is found on the CARD by YuNet and compared by SFace. Prints, per
size: portraits found, same-person scores (lowest, 5th percentile, mean), different-person scores (highest, 95th percentile, mean),
and what the two lines (match >= FACE_MATCH_AT_LEAST, mismatch < FACE_MISMATCH_BELOW) do with them. Nothing is written to disk."""
from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import faces  # noqa: E402
from app import thresholds as T  # noqa: E402


def printed_card(face_bgr: np.ndarray, tall: int, seed: int) -> np.ndarray:
    """An invented card (1011 x 638, an ID-1 card at 300 dpi) with the portrait printed `tall` px high, scanned (blur, noise, JPEG 85)."""
    card = np.full((638, 1011, 3), (236, 242, 250), np.uint8)
    cv2.rectangle(card, (0, 0), (1011, 70), (51, 153, 255), -1)
    w = int(round(tall * 0.8))
    card[160:160 + tall, 40:40 + w] = cv2.resize(face_bgr, (w, tall), interpolation=cv2.INTER_AREA)
    for i, y in enumerate(range(190, 420, 60)):
        cv2.putText(card, "INVENTED TEXT %d" % (seed * 7 + i), (300, y), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 2, cv2.LINE_AA)
    rng = np.random.default_rng(seed)
    soft = cv2.GaussianBlur(card, (0, 0), 0.8).astype(np.float32) + rng.normal(0, 3, card.shape)
    ok, enc = cv2.imencode(".jpg", np.clip(soft, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return cv2.cvtColor(cv2.imdecode(enc, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)


def measure(people: int, tall: int) -> dict:
    from tests import faces as F
    found, missed = {}, 0
    for s in range(people):
        for take in range(3):
            p = faces.find_portrait(printed_card(F.photo(F.identity(s), take), tall, 10 * s + take))
            if p.feature is None:
                missed += 1
            else:
                found[(s, take)] = p
    same, diff = [], []
    for a, b in itertools.combinations(found, 2):
        score = faces.compare(found[a], found[b])["score"]
        (same if a[0] == b[0] else diff).append(score)
    faces.forget(found.values())
    return {"tall": tall, "found": len(found), "of": 3 * people, "missed": missed, "same": np.array(same), "diff": np.array(diff)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--people", type=int, default=30)
    args = ap.parse_args()
    if not faces.available():
        print("face models missing: run scripts/get_face_models.py")
        return 1
    hi, lo = T.get("FACE_MATCH_AT_LEAST"), T.get("FACE_MISMATCH_BELOW")
    print(f"{args.people} invented people x 3 photos; match >= {hi}, mismatch < {lo}")
    print("printed  found   same: low  p5   mean | different: high  p95  mean | same->mismatch  same->match  diff->match  diff->mismatch")
    for tall in (120, 160, 180):
        r = measure(args.people, tall)
        s, d = r["same"], r["diff"]
        print(f"{tall:4d} px  {r['found']:3d}/{r['of']:<3d}  {s.min():.2f} {np.percentile(s, 5):.2f} {s.mean():.2f} |"
              f"            {d.max():.2f} {np.percentile(d, 95):.2f} {d.mean():.2f} |"
              f"  {np.mean(s < lo):6.1%}          {np.mean(s >= hi):6.1%}      {np.mean(d >= hi):6.1%}       {np.mean(d < lo):6.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
