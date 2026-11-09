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


def test_the_quick_finder_finds_every_card_of_a_crowded_sheet():
    """The fast part's finder (no model, MJ 5 Nov 2026: a sheet of many IDs fills the form fast): ten invented cards in sleeves on
    one A4 page, so close that the sleeves touch and two columns of five form two islands; _split cuts them apart. Sheets of
    2, 4 and 8 cards keep their accuracy."""
    from tests import sheets as S
    art = [x for i in range(5) for x in (S.front(S.GUESTS[i]), S.back(S.GUESTS[i]))]
    for n, seeds in ((2, (5, 6)), (4, (5, 7)), (8, (5, 8))):
        for seed in seeds:
            img, truths = S.sleeved_sheet(art[:n], seed=seed, cut_last=False)
            cuts = cardcut.cut_cards(img, 12, engines=[_Blind()], use_model=False)
            assert len(cuts) == n and all("quickFinder" in c.flags for c in cuts)
            for truth in truths:
                best = min(cuts, key=lambda c: float(np.linalg.norm(c.quad.mean(0) - truth.mean(0))))
                err = min(float(np.linalg.norm(np.roll(best.quad, r, 0) - truth, axis=1).max()) for r in range(4))
                assert err / float(np.linalg.norm(truth[0] - truth[2])) * 100 < 0.5
    found = []
    for seed in (5, 6, 7, 8, 9, 10):
        img, truths = S.sleeved_sheet(art, seed=seed, cut_last=False)
        t = time.perf_counter()
        cuts = cardcut.cut_cards(img, 12, engines=[_Blind()], use_model=False)
        seconds = time.perf_counter() - t
        hits = sum(any(np.linalg.norm(c.quad.mean(0) - truth.mean(0)) < 0.1 * np.linalg.norm(truth[0] - truth[2]) for c in cuts)
                   for truth in truths)
        found.append(hits)
        print(f"\n  ten cards, seed {seed}: {len(cuts)} cut, {hits} on a true card, {seconds:.1f} s")
        assert len(cuts) <= 10 and hits == len(cuts)
    assert sum(found) >= 54  # of 60; a piece with a weak edge is left to the background part's model


def test_one_card_island_is_never_split():
    """A single card, a card filling the photo or a two-page passport spread is card shaped: _split never runs on it. A card's
    photo box can be cut in two, but such pieces show no card edge and are never kept."""
    from tests import cards as Cards
    from tests import sheets as S
    img, _ = S.sleeved_sheet([S.front(S.GUESTS[0])], seed=3, cut_last=False)
    assert len(cardcut.cut_cards(img, 12, engines=[_Blind()], use_model=False)) == 1
    full = np.ascontiguousarray(np.asarray(Cards.aadhaar_front().convert("RGB"))[..., ::-1])
    assert cardcut.cut_cards(full, 12, engines=[_Blind()], use_model=False) == []
    island = np.zeros((400, 640), np.uint8)
    island[50:350, 50:526] = 1  # ID-1 shaped
    assert cardcut._split(island, island) == []


class _Blind:
    """An OCR engine that reads nothing: orientation comes from the colour bands only."""
    name = "fake"

    def recognize(self, *a, **k):
        return []


@needs_model
def test_pale_tinted_cards_are_cut_to_their_own_edge_not_their_margin():
    """Pale-tinted invented Aadhaar-like fronts and backs in sleeves (tests/sheets.sleeved_sheet). Before the fix copied from the
    reader, one card per sheet came out about 1.1-1.4% of its diagonal off: its pale margin trimmed as if it were sleeve."""
    from tests import sheets as S
    worst = []
    for seed in (2, 5, 11):
        art = [x for i in range(4) for x in (S.front(S.GUESTS[i]), S.back(S.GUESTS[i], with_number=(i + seed) % 3 != 0))]
        img, truths = S.sleeved_sheet(art, seed=seed, cut_last=seed % 2 == 0)
        cuts = cardcut.cut_cards(img, 13, engines=[_Blind()])
        assert len(cuts) == 8
        for truth in truths:
            best = min(cuts, key=lambda c: float(np.linalg.norm(c.quad.mean(0) - truth.mean(0))))
            if "cutOff" in best.flags:
                continue
            roll = min(range(4), key=lambda r: float(np.linalg.norm(np.roll(best.quad, r, 0) - truth, axis=1).mean()))
            worst.append(float(np.linalg.norm(np.roll(best.quad, roll, 0) - truth, axis=1).mean())
                         / float(np.linalg.norm(truth[0] - truth[2])) * 100)
    print(f"\npale sleeved sheets: worst corner error {max(worst):.2f}% of the diagonal over {len(worst)} whole cards")
    assert max(worst) < 0.5