"""Calibration numbers on INVENTED pictures: how the `id-card` profile judges clean and damaged photos of invented cards.

    python scripts/calibrate_invented.py [--cards 6] [--metrics]

Every invented card (tests/idcards.py: made-up words and numbers, a drawn portrait) is photographed on an invented table, saved as a
phone-style JPEG (quality 92), then judged clean and in each damaged form. Prints the confusion table, true state (clean / damaged)
against the verdict (accept / warn / reject), how many damaged pictures were caught (warn or reject) and rejected, and every miss
by its damage. No real picture is read: this is NOT a substitute for calibrating on real photos (scripts/calibrate.py)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

VERDICTS = ("accept", "warn", "reject")


def _motion(img: np.ndarray, length: int) -> np.ndarray:
    k = np.zeros((length, length), np.float32)
    k[length // 2, :] = 1.0 / length
    return cv2.filter2D(img, -1, k)


def _noise(img: np.ndarray, sigma: float, seed: int) -> np.ndarray:
    return np.clip(img + np.random.default_rng(seed).normal(0, sigma, img.shape), 0, 255).astype(np.uint8)


def variants(seed: int):
    """(label, truth, picture bytes). truth: clean | damaged."""
    from tests import idcards as C
    from tests.conftest import jpeg
    card = C.card(seed)
    photo = C.on_table(card, seed=seed)
    yield "clean", "clean", jpeg(photo, 92)
    yield "clean scan (png)", "clean", _png(card)
    yield "blur 0.7", "clean", jpeg(cv2.GaussianBlur(photo, (0, 0), 0.7), 92)
    yield "noise 3", "clean", jpeg(_noise(photo, 3, seed), 92)
    yield "jpeg 80", "clean", jpeg(photo, 80)
    yield "a little darker", "clean", jpeg((photo * 0.85).astype(np.uint8), 92)
    yield "turned 12 degrees", "clean", jpeg(C.on_table(card, seed=seed, angle=12.0), 92)
    yield "blur 3", "damaged", jpeg(cv2.GaussianBlur(photo, (0, 0), 3), 92)
    yield "blur 5", "damaged", jpeg(cv2.GaussianBlur(photo, (0, 0), 5), 92)
    yield "motion 25 px", "damaged", jpeg(_motion(photo, 25), 92)
    yield "noise 25", "damaged", jpeg(_noise(photo, 25, seed), 92)
    yield "dark", "damaged", jpeg((photo * 0.28).astype(np.uint8), 92)
    yield "low contrast", "damaged", jpeg((128 + (photo.astype(np.float32) - 128) * 0.2).astype(np.uint8), 92)
    yield "low resolution", "damaged", jpeg(cv2.resize(photo, None, fx=0.22, fy=0.22, interpolation=cv2.INTER_AREA), 92)
    yield "heavy jpeg 10", "damaged", jpeg(photo, 10)
    yield "jpeg 20", "damaged", jpeg(photo, 20)
    yield "glare over the card", "damaged", jpeg(C.on_table(C.glare_ellipse(card, (0.3, 0.2, 0.75, 0.75), 1.5), seed=seed), 92)
    yield "photo blurred", "damaged", jpeg(C.on_table(C.blur_photo(card, 4), seed=seed), 92)
    yield "glare over the photo", "damaged", jpeg(C.on_table(C.glare_photo(card), seed=seed), 92)


def _png(img: np.ndarray) -> bytes:
    from tests.conftest import png
    return png(img)


def run(cards: int = 6, metrics: bool = False) -> dict:
    from app.jobs import WorkerConfig, run_check
    cfg = WorkerConfig()
    table = {t: {v: 0 for v in VERDICTS} for t in ("clean", "damaged")}
    by_damage: dict[str, dict[str, int]] = {}
    misses: list[str] = []
    found = [0, 0]  # clean pictures where the portrait hint found the portrait, of all clean pictures
    for seed in range(cards):
        for label, truth, data in variants(seed):
            r = run_check(data, cfg, "id-card")
            v = r["verdict"]
            table[truth][v] += 1
            if truth == "clean":
                found[0] += bool(r["info"].get("portrait", {}).get("found"))
                found[1] += 1
            by_damage.setdefault(label, {x: 0 for x in VERDICTS})[v] += 1
            codes = sorted({x["code"] for x in r["reasons"] if x["severity"] != "info"})
            if (truth == "clean" and v == "reject") or (truth == "damaged" and v == "accept"):
                misses.append(f"card {seed} / {label}: {v} {codes}")
            if metrics:
                s = r["scores"]
                print(f"{seed} {label:22s} {truth:8s} {v:7s} lap={s['blurLaplacian']:.0f} grad={s['blurGradient']:.0f} "
                      f"glare={s['glare']:.3f} p1={s['p1']:.0f} p99={s['p99']:.0f} noise={s['noise']:.1f} q={s.get('jpegQuality')} "
                      f"dpi={s.get('effectiveDpi')} portrait={r['info'].get('portrait')} {codes}")
    return {"table": table, "byDamage": by_damage, "misses": misses, "portraitFound": tuple(found)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cards", type=int, default=6)
    ap.add_argument("--metrics", action="store_true")
    args = ap.parse_args()
    out = run(args.cards, args.metrics)
    t = out["table"]
    print("\ntruth \\ verdict   accept    warn  reject")
    for truth in ("clean", "damaged"):
        print(f"{truth:15s} {t[truth]['accept']:8d} {t[truth]['warn']:7d} {t[truth]['reject']:7d}")
    dmg = sum(t["damaged"].values())
    print(f"damaged caught (warn or reject): {t['damaged']['warn'] + t['damaged']['reject']}/{dmg}; rejected: {t['damaged']['reject']}/{dmg}; "
          f"clean rejected: {t['clean']['reject']}/{sum(t['clean'].values())}; clean warned: {t['clean']['warn']}/{sum(t['clean'].values())}")
    print(f"portrait found on clean pictures: {out['portraitFound'][0]}/{out['portraitFound'][1]}")
    print("\nby damage            accept  warn  reject")
    for label, row in out["byDamage"].items():
        print(f"{label:22s} {row['accept']:5d} {row['warn']:5d} {row['reject']:7d}")
    for m in out["misses"]:
        print("  miss:", m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
