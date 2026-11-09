# copied from intake-worker on 2026-11-04
"""The card cutter on INVENTED scanned sheets (tests/cardsheet.py): counts, corner accuracy against the drawn truth,
sleeve strip left, orientation, the cut-off flag, blank paper, and the path without the model.
Run with -s to see the measured numbers."""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import pytest

from app import cardcut
from tests.cardsheet import Sheet, make_sheet

needs_model = pytest.mark.skipif(not cardcut.model_available(), reason="segmentation model file or torch missing")


@dataclass
class Measured:
    found: int
    matched: int
    corner_mean: float  # percent of the card diagonal
    corner_max: float
    strip_max_px: float  # widest strip outside the true card edge, in output pixels
    cut_into_max_px: float  # deepest cut into the card, in output pixels
    upright: int  # cards whose corner order matches the truth (orientation right)
    cut_flag_ok: int
    seconds: float


def _side_offsets(quad: np.ndarray, truth: np.ndarray) -> list[float]:
    """Signed distance of each found side's middle from the true side line; + is outside the card."""
    centre = truth.mean(axis=0)
    out = []
    for i in range(4):
        a, b = truth[i], truth[(i + 1) % 4]
        u = (b - a) / np.linalg.norm(b - a)
        n = np.array([-u[1], u[0]])
        if np.dot(centre - a, n) > 0:
            n = -n
        mid = (quad[i] + quad[(i + 1) % 4]) / 2
        out.append(float(np.dot(mid - a, n)))
    return out


def measure(sheet: Sheet, cuts: list[cardcut.CardCut], seconds: float) -> Measured:
    h, w = sheet.image.shape[:2]
    errs, strips, cuts_in, upright, cut_ok, matched = [], [], [], 0, 0, 0
    free = list(cuts)
    for truth in sheet.cards:
        c = truth.corners
        best = min(free, key=lambda k: float(np.linalg.norm(k.quad.mean(0) - c.mean(0))), default=None)
        if best is None or np.linalg.norm(best.quad.mean(0) - c.mean(0)) > 0.25 * np.linalg.norm(c[0] - c[2]):
            continue
        free = [k for k in free if k is not best]
        matched += 1
        diag = float(np.linalg.norm(c[0] - c[2]))
        roll = min(range(4), key=lambda k: float(np.linalg.norm(np.roll(best.quad, k, 0) - c, axis=1).mean()))
        upright += roll == 0
        q = np.roll(best.quad, roll, 0)
        cut_ok += truth.cut_off == ("cutOff" in best.flags)
        inside = (c[:, 0] >= 0) & (c[:, 0] < w) & (c[:, 1] >= 0) & (c[:, 1] < h)
        if truth.cut_off:
            continue  # the true card runs off the scan: its corners there cannot be found
        d = np.linalg.norm(q - c, axis=1)[inside] / diag * 100
        errs += d.tolist()
        scale = best.image.shape[1] / float(np.linalg.norm(c[1] - c[0]))
        offs = np.array(_side_offsets(q, c)) * scale
        strips.append(float(max(0.0, offs.max())))
        cuts_in.append(float(max(0.0, -offs.min())))
    return Measured(len(cuts), matched, float(np.mean(errs)) if errs else 0.0, float(np.max(errs)) if errs else 0.0,
                    max(strips, default=0.0), max(cuts_in, default=0.0), upright, cut_ok, seconds)


def run(sheet: Sheet) -> tuple[list[cardcut.CardCut], Measured]:
    t = time.perf_counter()
    cuts = cardcut.cut_cards(sheet.image)
    seconds = time.perf_counter() - t
    m = measure(sheet, cuts, seconds)
    print(f"\n  cards {len(sheet.cards)} found {m.found} matched {m.matched} corner mean {m.corner_mean:.2f}% max {m.corner_max:.2f}% "
          f"strip left {m.strip_max_px:.1f}px cut in {m.cut_into_max_px:.1f}px upright {m.upright}/{m.matched} "
          f"cutOff flag ok {m.cut_flag_ok}/{m.matched} time {seconds:.1f}s flags {[c.flags for c in cuts]}")
    return cuts, m


SHEETS = {  # cards, seed, settings
    1: dict(n_cards=1, seed=11),
    2: dict(n_cards=2, seed=12, turns=(0, 180)),
    4: dict(n_cards=4, seed=14, turns=(0, 180, 90, 270)),
    6: dict(n_cards=6, seed=16, turns=(0, 180, 90), cut_off=1),
    12: dict(n_cards=12, seed=22, dpi=200, size_mm=(297, 420), turns=(0, 180), cut_off=2),
}


@needs_model
@pytest.mark.parametrize("n", list(SHEETS))
def test_sheet(n):
    sheet = make_sheet(**SHEETS[n])
    cuts, m = run(sheet)
    assert m.found == n and m.matched == n
    assert m.corner_mean < 0.5 and m.corner_max < 1.5
    assert m.strip_max_px <= 4.0 and m.cut_into_max_px <= 4.0
    assert m.upright == n
    assert m.cut_flag_ok == n
    for c in cuts:
        if "cutOff" not in c.flags:
            assert abs(c.image.shape[1] / c.image.shape[0] - cardcut.ID1) < 0.01
            assert 1000 <= c.image.shape[1] <= 1200 or c.image.shape[1] <= 1.5 * np.linalg.norm(c.quad[1] - c.quad[0]) + 2


@needs_model
def test_blank_paper_is_never_a_card():
    sheet = make_sheet(0, seed=5)
    assert cardcut.cut_cards(sheet.image) == []


@needs_model
def test_reading_order_rows_then_columns():
    sheet = make_sheet(4, seed=31, sleeves=False)
    cuts = cardcut.cut_cards(sheet.image)
    centres = [c.quad.mean(0) for c in cuts]
    truth = [p.corners.mean(0) for p in sheet.cards]  # the sheet lays cards out row by row
    assert [int(np.argmin([np.linalg.norm(t - c) for t in truth])) for c in centres] == [0, 1, 2, 3]


def test_without_the_model_the_classic_finder_still_cuts(monkeypatch, tmp_path):
    monkeypatch.setenv(cardcut.MODEL_ENV, str(tmp_path / "missing.pth"))
    assert cardcut.model_available() is False
    sheet = make_sheet(**SHEETS[4])
    cuts, m = run(sheet)
    assert m.found == 4 and m.matched == 4 and all("fallbackFinder" in c.flags for c in cuts)
    assert m.corner_mean < 0.5 and m.upright == 4
