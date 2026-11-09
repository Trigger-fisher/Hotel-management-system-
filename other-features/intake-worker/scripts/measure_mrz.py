"""How often the passport MRZ is read FULLY correct, on INVENTED passport data pages only (no real ID, no real number).

    python scripts/measure_mrz.py [--people 10] [--only clean,blur 1.2]

Every invented holder (made-up surname, given names, passport number, dates, sex and nationality; the check digits computed) gets a
passport data page drawn like tests/idkinds.passport_foreign, then each damage below. Every page is read as the pipeline reads a cut
card (Pipeline.read_card, upright) and the MRZ the reader returns is compared with the truth:
  correct     both lines exactly right and every check digit passing
  doubtful    an MRZ found but a check digit fails, or readings that pass spell the names differently (flagged for a person)
  wrong       every check digit passing but a character differs from the truth (must stay 0: a silent misread)
  missing     no MRZ found
The time of each read is printed too (the whole card read, the MRZ pass included)."""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

SYLLABLES = ("ka", "ri", "mo", "ta", "ne", "lu", "sa", "vo", "de", "pi", "ro", "ma", "fe", "zu", "ha", "lo", "bi", "ve", "no", "ga")
NATIONS = ("SWE", "DEU", "ITA", "GBR", "FRA", "ESP", "NLD", "CAN", "AUS", "IRL")


def _word(rng: random.Random, parts: int) -> str:
    return "".join(rng.choice(SYLLABLES) for _ in range(parts)).upper()


def holders(n: int, seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        letters = "".join(rng.choice("ABCDEFGHJKLMNPRSTUVWXYZ") for _ in range(rng.choice((1, 2))))
        number = letters + "".join(rng.choice("0123456789") for _ in range(9 - len(letters) - rng.choice((0, 1))))
        out.append({"surname": _word(rng, rng.choice((2, 3))), "given": " ".join(_word(rng, rng.choice((2, 3))) for _ in range(rng.choice((1, 2)))),
                    "number": number, "nationality": rng.choice(NATIONS), "sex": rng.choice("MF"),
                    "dob": f"{rng.randint(50, 99):02d}{rng.randint(1, 12):02d}{rng.randint(1, 28):02d}",
                    "expiry": f"{rng.randint(27, 36):02d}{rng.randint(1, 12):02d}{rng.randint(1, 28):02d}"})
    return out


def page(h: dict) -> tuple[np.ndarray, list[str]]:
    from tests import idkinds as K
    lines = K.td3(h["nationality"], h["surname"], h["given"], h["number"], h["nationality"], h["dob"], h["sex"], h["expiry"])
    img, d = K._canvas(K.PAGE, (232, 238, 246))
    d.text((40, 20), "PASSPORT   PASS   PASSEPORT", font=K._seg(38), fill=(20, 40, 110))
    d.rectangle((40, 100, 290, 420), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    rows = [("Type / Code", f"P   {h['nationality']}"), ("Passport No.", h["number"]), ("Surname", h["surname"]), ("Given names", h["given"]),
            ("Nationality", h["nationality"]), ("Date of birth", f"{h['dob'][4:]}/{h['dob'][2:4]}/19{h['dob'][:2]}"), ("Sex", h["sex"]),
            ("Date of expiry", f"{h['expiry'][4:]}/{h['expiry'][2:4]}/20{h['expiry'][:2]}")]
    for i, (label, value) in enumerate(rows):
        x, y = (330, 100 + i * 75) if i < 6 else (760, 100 + (i - 4) * 75)
        d.text((x, y), label, font=K._seg(22), fill=(70, 70, 70))
        d.text((x, y + 28), value, font=K._seg(32), fill=0)
    K._mrz(d, lines, 730)
    return np.asarray(img.convert("RGB")), lines


def _jpeg(rgb: np.ndarray, q: int) -> np.ndarray:
    ok, enc = cv2.imencode(".jpg", rgb, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(enc, cv2.IMREAD_UNCHANGED)


def _small(rgb: np.ndarray, f: float) -> np.ndarray:
    return cv2.resize(rgb, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)


def _glare(rgb: np.ndarray, seed: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    mask = np.zeros((h, w), np.float32)
    rng = np.random.default_rng(seed)
    cx = int(w * rng.uniform(0.25, 0.6))
    cv2.ellipse(mask, (cx, int(h * 0.86)), (int(w * 0.07), int(h * 0.06)), 0, 0, 360, 1.0, -1)
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 10) * 0.8, 0, 1)
    return np.clip(rgb * (1 - mask[..., None]) + 255 * mask[..., None], 0, 255).astype(np.uint8)


def _noise(rgb: np.ndarray, sigma: float, seed: int) -> np.ndarray:
    return np.clip(rgb + np.random.default_rng(seed).normal(0, sigma, rgb.shape), 0, 255).astype(np.uint8)


DAMAGES = {
    "clean": lambda p, s: p,
    "blur 1.2": lambda p, s: cv2.GaussianBlur(p, (0, 0), 1.2),
    "blur 1.8": lambda p, s: cv2.GaussianBlur(p, (0, 0), 1.8),
    "glare on MRZ": lambda p, s: _glare(p, s),
    "small 0.5": lambda p, s: _small(p, 0.5),
    "small 0.4": lambda p, s: _small(p, 0.4),
    "jpeg 35": lambda p, s: _jpeg(p, 35),
    "jpeg 20": lambda p, s: _jpeg(p, 20),
    "noise 8 + jpeg 60": lambda p, s: _jpeg(_noise(p, 8, s), 60),
    "small 0.6 + blur 1 + jpeg 50": lambda p, s: _jpeg(cv2.GaussianBlur(_small(p, 0.6), (0, 0), 1.0), 50),
}


def outcome(mrz: dict | None, truth: list[str]) -> str:
    if not mrz:
        return "missing"
    if not mrz.get("valid") or mrz.get("namesAgree") is False:
        return "doubtful"
    return "correct" if list(mrz.get("lines") or []) == truth else "wrong"


def _timed_pass(store: list[float]):
    """Wrap the reader's MRZ pass (when this version has one) to time it alone."""
    from app.readcore import reader as R
    original = getattr(R.Reader, "_mrz_candidates", None) or getattr(R.Reader, "_mrz_texts", None)
    name = "_mrz_candidates" if hasattr(R.Reader, "_mrz_candidates") else "_mrz_texts"

    def timed(self, *a, **k):
        t = time.perf_counter()
        try:
            return original(self, *a, **k)
        finally:
            store.append(time.perf_counter() - t)
    setattr(R.Reader, name, timed)


def run(people: int = 10, only: list[str] | None = None) -> dict:
    from app.config import Settings
    from app.pipeline import Deps, Pipeline
    from app.readcore.config import WorkerConfig
    from app.readcore.engines import load_engines
    tess = str(ROOT / ".tessdata")
    pipe = Pipeline(Deps(Settings(allow_no_av=True, tessdata=tess), load_engines(WorkerConfig(tessdata=tess))))
    table: dict[str, dict[str, int]] = {}
    times: dict[str, list[float]] = {}
    pass_times: list[float] = []
    _timed_pass(pass_times)
    for i, h in enumerate(holders(people)):
        clean, truth = page(h)
        for name, damage in DAMAGES.items():
            if only and name not in only:
                continue
            pic = damage(clean, i)
            t = time.perf_counter()
            result, _doc = pipe.read_card(pic, {}, upright=True)
            times.setdefault(name, []).append(time.perf_counter() - t)
            got = outcome(result.get("mrz"), truth)
            table.setdefault(name, {k: 0 for k in ("correct", "doubtful", "wrong", "missing")})[got] += 1
    return {"table": table, "times": times, "pass": pass_times}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--people", type=int, default=10)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    out = run(args.people, [s.strip() for s in args.only.split(",") if s.strip()] or None)
    total = {k: 0 for k in ("correct", "doubtful", "wrong", "missing")}
    print(f"{'damage':30s} correct doubtful wrong missing  read s (median)")
    for name, row in out["table"].items():
        for k in total:
            total[k] += row[k]
        print(f"{name:30s} {row['correct']:7d} {row['doubtful']:8d} {row['wrong']:5d} {row['missing']:7d}  {np.median(out['times'][name]):.2f}")
    n = sum(total.values())
    print(f"{'all':30s} {total['correct']:7d} {total['doubtful']:8d} {total['wrong']:5d} {total['missing']:7d}  "
          f"{np.median([t for v in out['times'].values() for t in v]):.2f}")
    print(f"fully correct: {total['correct']}/{n} ({100 * total['correct'] / max(n, 1):.0f}%), silent misreads: {total['wrong']}")
    p = out["pass"]
    if p:
        print(f"MRZ pass alone: median {np.median(p):.2f} s, 90th percentile {np.percentile(p, 90):.2f} s, max {max(p):.2f} s "
              f"(0 when the first read already passed with the names whole)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
