"""Geometry ensemble: each method alone vs the ensemble on warped, curved, low-contrast and cluttered photos (invented)."""
import difflib
import re
import time

import cv2
import numpy as np
import pytest

from app import ensemble, geometry
from app.jobs import run_job
from tests.conftest import needs_tesseract, real_config, real_engines
from tests.imaging import corner_error, random_lines, scene, text_page
from app.reader import Reader

LINES = random_lines(7, count=8)
EXPECTED = "\n".join(LINES)


def page():
    return np.asarray(text_page(LINES, size=(1000, 800)))


def curl(art: np.ndarray, amplitude=16.0) -> np.ndarray:
    h, w = art.shape
    xs, ys = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(art, xs, ys + (amplitude * np.sin(xs / w * np.pi * 1.5)).astype(np.float32), cv2.INTER_CUBIC, borderValue=255)


CASES = {
    "tilted and keystoned": dict(art=page, angle=14, tilt=0.18, bg=(70, 110, 160), clutter=False),
    "tilted, cluttered": dict(art=page, angle=-18, tilt=0.1, bg=(60, 90, 130), clutter=True),
    "curled page": dict(art=lambda: curl(page()), angle=8, tilt=0.08, bg=(70, 110, 160), clutter=False),
    "low contrast background": dict(art=page, angle=10, tilt=0.1, bg=(200, 205, 210), clutter=False),
    "dark table": dict(art=page, angle=-12, tilt=0.12, bg=(25, 30, 35), clutter=True),
    "document fills the frame": dict(art=page, angle=0, tilt=0.0, bg=(70, 110, 160), clutter=False, scale=1.0),
}


def accuracy(got: str) -> float:
    norm = lambda s: re.sub(r"\s+", " ", s).strip().lower()  # noqa: E731
    return difflib.SequenceMatcher(None, norm(EXPECTED), norm(got)).ratio()


def photo(case, seed):
    p = case["art"]()
    return scene(p, frame=(1100, 1500), scale=case.get("scale", 0.72), angle=case["angle"], tilt=case["tilt"], seed=seed,
                 bg_colour=case["bg"], clutter=case["clutter"])


def test_each_method_alone_on_the_hard_cases():
    """Geometric success of every method's best quad (corners within 3% of the diagonal)."""
    methods = {}
    total = 0
    for seed, (name, case) in enumerate(CASES.items(), 1):
        if case.get("scale") == 1.0:
            continue
        img, truth = photo(case, seed)
        diag = float(np.hypot(*img.shape[:2]))
        total += 1
        best = {}
        for q in geometry.find_quads(img, keep_all=True):
            if q.method not in best or q.score > best[q.method].score:
                best[q.method] = q
        for method, q in best.items():
            methods.setdefault(method, 0)
            methods[method] += corner_error(q.corners, truth) / diag < 0.03
    print(f"\nmethod alone, success on {total} hard photos: " + ", ".join(f"{m}={n}/{total}" for m, n in sorted(methods.items())))
    assert max(methods.values()) >= total - 2  # at least one method gets nearly all of them


@needs_tesseract
def test_ensemble_vs_whole_picture_and_audit_json():
    rows, gains, audits = [], [], []
    for seed, (name, case) in enumerate(CASES.items(), 1):
        img, _ = photo(case, seed)
        ok, buf = cv2.imencode(".png", img)
        t0 = time.perf_counter()
        fixed = run_job(buf.tobytes(), real_config(), [], "fast", True)
        t_fixed = time.perf_counter() - t0
        whole = run_job(buf.tobytes(), real_config(), [], "fast", False)
        a_fixed, a_whole = accuracy(fixed["text"]), accuracy(whole["text"])
        audit = fixed["document"].get("geometry")
        audits.append(audit)
        rows.append((name, a_whole, a_fixed, audit["winner"] if audit else "-", t_fixed))
        gains.append(a_fixed - a_whole)
    print("\ncase                        whole  ensemble  winner   seconds")
    for n, w, f, win, t in rows:
        print(f"{n:27s} {w:5.2f}  {f:7.2f}  {win:8s} {t:5.1f}")
    print(f"mean accuracy gain over 'no geometry fix': {np.mean(gains):+.3f}")
    assert all(a and a["candidates"] and "winner" in a for a in audits)
    assert any(c["chosen"] for c in audits[0]["candidates"])
    assert np.mean(gains) >= -0.02  # the ensemble never reads worse on average than not fixing anything
    assert all(f >= w - 0.1 for _, w, f, _, _ in rows)


@needs_tesseract
def test_when_scores_are_close_the_larger_crop_wins():
    reader = Reader(real_engines(), real_config())
    img = cv2.cvtColor(page(), cv2.COLOR_GRAY2BGR)  # a page that already fills the frame
    regions, audit = ensemble.localise(reader, img, "thorough")
    assert regions[0].quad is None and audit["winner"] == "whole"
