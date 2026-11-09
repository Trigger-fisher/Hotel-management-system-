"""Calibrate and check the clarity grades (app/clarity.py) on INVENTED cards with controlled damage. No real ID is used.

    python scripts/calibrate_clarity.py [--ocr] [--metrics]

Every invented card (several ID kinds, with an invented portrait in the photo box) is graded clean, mildly changed (still clear) and
badly damaged (blur, motion blur, glare over the photo / number / name, noise, darkness, low contrast, low resolution, heavy JPEG).
Prints the confusion table: true state (clear / degraded) against the grade (clear / usable / unclear) and how many damaged cards
were caught (graded unclear). --ocr also reads every card (slower: the OCR confidence and the OCR line boxes take part).
--metrics prints the raw measures per variant (to pick thresholds)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import clarity, faces  # noqa: E402

ID1_LONG_MM = 85.6


def _cards():
    """(name, rgb, kind, side, photo box or None) for invented cards drawn by the tests' helpers, each with an invented face."""
    from tests import faces as F
    from tests import idkinds as K
    from tests import sheets as S
    out = []
    people = [K.ANIL, K.KAVITA, K.SURESH, K.MEENA, K.FARHAN]
    for i, p in enumerate(people):
        face = F.photo(F.identity(i), 0)
        out.append((f"aadhaar-front-{i}", F.put_photo(np.asarray(K.aadhaar_old_front(p)), face, (30, 150, 220, 390)), "aadhaar", "front"))
        out.append((f"aadhaar-back-{i}", np.asarray(K.aadhaar_old_back(p)), "aadhaar", "back"))
        g = S.GUESTS[i]
        out.append((f"sheet-front-{i}", F.put_photo(np.asarray(S.front(g)), F.photo(F.identity(20 + i), 0), (30, 160, 230, 400)), "aadhaar", "front"))
        out.append((f"pan-{i}", F.put_photo(np.asarray(K.pan_old(p, K.ANIL_PAN)), F.photo(F.identity(40 + i), 0), (760, 180, 960, 420)), "pan", "single"))
        out.append((f"dl-{i}", F.put_photo(np.asarray(K.dl_smart_front(p, K.KAVITA_DL)), F.photo(F.identity(60 + i), 0), (790, 120, 970, 360)),
                    "driving-licence", "front"))
    return out


def _ellipse_glare(rgb: np.ndarray, box: tuple[float, float, float, float], strength: float = 1.3) -> np.ndarray:
    """A lamp's reflection: blown out to white in the middle (the camera clips), fading at the rim."""
    h, w = rgb.shape[:2]
    mask = np.zeros((h, w), np.float32)
    cx, cy = int((box[0] + box[2]) / 2 * w), int((box[1] + box[3]) / 2 * h)
    ax, ay = int((box[2] - box[0]) / 2 * w * 1.1), int((box[3] - box[1]) / 2 * h * 1.1)
    cv2.ellipse(mask, (cx, cy), (max(ax, 4), max(ay, 4)), 0, 0, 360, 1.0, -1)
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 8) * strength, 0, 1)
    return np.clip(rgb * (1 - mask[..., None]) + 255 * mask[..., None], 0, 255).astype(np.uint8)


def _motion(rgb: np.ndarray, length: int) -> np.ndarray:
    k = np.zeros((length, length), np.float32)
    k[length // 2, :] = 1.0 / length
    return cv2.filter2D(rgb, -1, k)


def _lowres(rgb: np.ndarray, dpi: float) -> tuple[np.ndarray, float]:
    src = dpi * ID1_LONG_MM / 25.4
    f = src / max(rgb.shape[:2])
    small = cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return cv2.resize(small, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC), src


def _jpeg(rgb: np.ndarray, q: int) -> np.ndarray:
    ok, enc = cv2.imencode(".jpg", rgb, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(enc, cv2.IMREAD_UNCHANGED)


def _noise(rgb: np.ndarray, sigma: float, seed: int = 0) -> np.ndarray:
    return np.clip(rgb + np.random.default_rng(seed).normal(0, sigma, rgb.shape), 0, 255).astype(np.uint8)


def variants(rgb: np.ndarray, kind: str, side: str, photo_box):
    """(label, truth, picture, source long side px). truth: clear | degraded | borderline (borderline is shown, not scored)."""
    base_src = 300 * ID1_LONG_MM / 25.4  # the card scanned at 300 dpi
    layout = clarity.LAYOUTS.get((kind, side), {})
    yield "clean", "clear", rgb, base_src
    yield "blur 0.7", "clear", cv2.GaussianBlur(rgb, (0, 0), 0.7), base_src
    yield "noise 3", "clear", _noise(rgb, 3), base_src
    yield "jpeg 80", "clear", _jpeg(rgb, 80), base_src
    yield "260 dpi", "clear", *_lowres(rgb, 260)
    yield "a little darker", "clear", (rgb * 0.85).astype(np.uint8), base_src
    yield "blur 1.5", "borderline", cv2.GaussianBlur(rgb, (0, 0), 1.5), base_src
    yield "170 dpi", "borderline", *_lowres(rgb, 170)
    yield "noise 9", "borderline", _noise(rgb, 9), base_src
    yield "jpeg 5", "borderline", _jpeg(rgb, 5), base_src  # blocky, but the cutter's resampling hides the 8 px grid: not judged
    yield "blur 2.5", "degraded", cv2.GaussianBlur(rgb, (0, 0), 2.5), base_src
    yield "blur 3.5", "degraded", cv2.GaussianBlur(rgb, (0, 0), 3.5), base_src
    yield "motion 15 px", "degraded", _motion(rgb, 15), base_src
    yield "noise 22", "degraded", _noise(rgb, 22), base_src
    yield "120 dpi", "degraded", *_lowres(rgb, 120)
    yield "dark", "degraded", (rgb * 0.28).astype(np.uint8), base_src
    yield "low contrast", "degraded", (128 + (rgb.astype(np.float32) - 128) * 0.25).astype(np.uint8), base_src
    if photo_box is not None:
        h, w = rgb.shape[:2]
        yield "glare over photo", "degraded", _ellipse_glare(rgb, (photo_box[0] / w, photo_box[1] / h, photo_box[2] / w, photo_box[3] / h)), base_src
    if "number" in layout:
        yield "glare over number", "degraded", _ellipse_glare(rgb, layout["number"]), base_src
    if "nameDob" in layout:
        yield "glare over name", "degraded", _ellipse_glare(rgb, layout["nameDob"]), base_src


PHOTO_BOXES = {"aadhaar-front": (30, 150, 220, 390), "sheet-front": (30, 160, 230, 400), "pan": (760, 180, 960, 420), "dl": (790, 120, 970, 360)}


def run(with_ocr: bool = False, metrics: bool = False, limit: int = 0) -> dict:
    reader = None
    if with_ocr:
        from app.config import Settings
        from app.pipeline import Deps, Pipeline
        from app.readcore.config import WorkerConfig
        from app.readcore.engines import load_engines
        tess = str(ROOT / ".tessdata")
        reader = Pipeline(Deps(Settings(allow_no_av=True, tessdata=tess), load_engines(WorkerConfig(tessdata=tess))))
    table: dict[str, dict[str, int]] = {t: {g: 0 for g in clarity.GRADES} for t in ("clear", "degraded", "borderline")}
    misses: list[str] = []
    cards = _cards()[:limit] if limit else _cards()
    for name, rgb, kind, side in cards:
        stem = name.rsplit("-", 1)[0]
        box = PHOTO_BOXES.get(stem)
        for label, truth, pic, src in variants(rgb, kind, side, box):
            portrait = faces.find_portrait(pic, src / max(pic.shape[:2])) if faces.available() else None
            result, doc = reader.read_card(pic, {}) if reader else ({}, {})
            got = clarity.assess(pic, result, doc, kind, side, src, portrait)
            table[truth][got["grade"]] += 1
            if (truth == "clear" and got["grade"] == "unclear") or (truth == "degraded" and got["grade"] != "unclear"):
                misses.append(f"{name} / {label}: {got['grade']} {got['reasons']}")
            if metrics:
                face = f"{portrait.status}{portrait.quality}" if portrait is not None else "-"
                print(f"{name:18s} {label:18s} {truth:10s} {got['grade']:8s} face={face} {got['scores']} "
                      f"{ {k: (v.get('sharpness'), v.get('glare'), v.get('grade')) for k, v in got['regions'].items()} } {got['reasons']}")
    return {"table": table, "misses": misses}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ocr", action="store_true")
    ap.add_argument("--metrics", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    out = run(args.ocr, args.metrics, args.limit)
    t = out["table"]
    print("\ntruth \\ grade   clear  usable  unclear")
    for truth in ("clear", "degraded", "borderline"):
        print(f"{truth:14s} {t[truth]['clear']:6d} {t[truth]['usable']:7d} {t[truth]['unclear']:8d}")
    deg = sum(t["degraded"].values())
    print(f"damaged cards caught (unclear): {t['degraded']['unclear']}/{deg}; clear cards graded unclear: "
          f"{t['clear']['unclear']}/{sum(t['clear'].values())}")
    for m in out["misses"]:
        print("  miss:", m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
