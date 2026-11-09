"""Several IDs in one photo: the classic finder's counts (still the fallback), grouping into people with the evidence rules,
caps, small regions, and the whole flow on INVENTED sleeved sheets cut by app/cardcut. Run with -s to see the numbers."""
import base64
import dataclasses
import time

import cv2
import numpy as np
import pytest

from app import cardcut, cards, multi
from app.jobs import run_job
from app.people import Card, group, prepare
from tests import cards as C
from tests import sheets as S
from tests.conftest import needs_tesseract, real_config
from tests.imaging import scene, text_page
from tests.test_pair import card as pair_card

needs_model = pytest.mark.skipif(not cardcut.model_available(), reason="segmentation model file or torch missing")


def card_art(seed: int) -> np.ndarray:
    return np.asarray(text_page([f"GUEST CARD {seed}", f"Name Anna {seed}", f"No {1000 + seed} 4567", "DOB 01/02/1990"],
                                size=(850, 540), font_size=40, step=96))


def sheet(arts, cols=4, frame=(2400, 3200), card_scale=0.2, seed=0):
    canvas = np.full((*frame, 3), (90, 120, 150), np.uint8)
    rng = np.random.default_rng(seed)
    rows = -(-len(arts) // cols)
    for i, art in enumerate(arts):
        r, c = divmod(i, cols)
        centre = (frame[1] * (c + 0.5) / cols, frame[0] * (r + 0.5) / max(rows, 3))
        photo, corners = scene(art, frame=frame, scale=card_scale, angle=float(rng.uniform(-8, 8)), seed=i, centre=centre,
                               clutter=False, noise_sigma=0.0)
        mask = cv2.fillConvexPoly(np.zeros(frame, np.uint8), corners.astype(np.int32), 255)
        canvas = np.where(mask[..., None] > 0, photo, canvas)
    return canvas.astype(np.uint8)


def test_card_detection_rate_by_card_count():
    """The classic finder (fallback when the cutter finds nothing) on invented sheets (cards at random tilt on a plain table)."""
    rows = []
    for n in (1, 2, 4, 6, 10, 12):
        found = len(cards.find_cards(sheet([card_art(i) for i in range(n)], seed=n), 12))
        rows.append((n, found))
    print("\ncards drawn -> found: " + ", ".join(f"{n}->{f}" for n, f in rows))
    assert all(f == n for n, f in rows if n <= 6) and all(abs(f - n) <= 1 for n, f in rows)


def test_more_than_the_maximum_is_capped_and_flagged():
    arts = [card_art(i) for i in range(12)]
    big = sheet(arts, seed=3)
    assert len(cards.find_cards(big, 4)) == 5  # one extra so "too many" is told from "exactly the limit"


# ---- grouping (no OCR) ------------------------------------------------------------------------------------------------

def item(rid, side, number=None, name=None, dob=None, center=(0, 0), size=600, kind="unknown", qr=None):
    fields = {}
    if number:
        fields["documentNumber"] = {"value": number, "valid": True, "confidence": 0.9, "source": "ocr"}
    if name:
        fields["name"] = {"value": name, "confidence": 0.9, "source": "ocr"}
    if dob:
        fields["dob"] = {"value": dob, "confidence": 0.9, "source": "ocr"}
    if side == "back":
        fields["address"] = {"value": "12 Hill Road", "confidence": 0.9, "source": "ocr"}
    result = {"lines": [{"text": f"Name: {name}", "confidence": .9}] if name else [], "codes": [{"text": qr}] if qr else [],
              "mrz": None, "identifiers": [], "confidence": 0.9}
    cx, cy = center
    w, h = size, size / 1.586
    quad = np.array([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], np.float32)
    card = prepare(Card(rid, None, quad, 0.9, [], result, {"type": kind, "fields": fields, "needsHumanCheck": False}))
    card.side = side  # the test decides the side; the rules for it are tested below
    return card


def test_grouping_by_content_wins_over_position():
    items = [item(1, "front", "111122223333", "Anna Maria", "1990-02-01", (100, 100)), item(2, "front", "444455556666", "Peter Zwolle", "1985-06-05", (800, 100)),
             item(3, "back", "444455556666", None, None, (140, 100)),   # sits next to person 1 but carries person 2's number
             item(4, "back", "111122223333", None, None, (840, 100))]
    people = group(items)
    pairs = {tuple(c.index for c in p.cards) for p in people}
    assert pairs == {(1, 4), (2, 3)} and all(p.evidence == "documentNumber" and p.confidence > 0.8 for p in people)


def test_layout_only_suggests_a_pair_and_never_pairs():
    """MJ's rule (4 Nov 2026): the clearly nearest card of the other side is a SUGGESTION (layoutSuggestsPair), never a pair."""
    items = [item(1, "front", None, None, None, (100, 100)), item(2, "back", None, None, None, (700, 110)),
             item(3, "front", None, None, None, (100, 3000)), item(4, "back", None, None, None, (5000, 5000))]
    by = {tuple(c.index for c in p.cards): p for p in group(items)}
    assert set(by) == {(1,), (2,), (3,), (4,)}
    assert "layoutSuggestsPair" in by[(1,)].flags and by[(1,)].suggested == [2] and by[(2,)].suggested == [1]
    assert by[(3,)].evidence == "none" and "unpairedSide" in by[(3,)].flags and not by[(3,)].suggested  # never forced
    assert (4,) in by and by[(4,)].evidence == "none"


def test_different_size_neighbours_are_not_paired_by_layout():
    people = group([item(1, "front", None, None, None, (100, 100), size=600), item(2, "back", None, None, None, (500, 100), size=250)])
    assert [p.evidence for p in people] == ["none", "none"]


def test_two_backs_equally_near_are_ambiguous_and_never_paired():
    people = group([item(1, "front", None, None, None, (1000, 1000)), item(2, "back", None, None, None, (1000, 1500)),
                    item(3, "back", None, None, None, (1000, 500))])
    assert all(len(p.cards) == 1 for p in people)


def test_qr_name_and_dob_pair_a_back_without_number_and_a_different_dob_blocks():
    qr = C.secure_qr_payload("Anna Maria", "01/02/1990", "3333")
    # the QR's number tail (3333) found on the front's printed number: a strong match
    front = item(1, "front", "111122223333", "Anna Maria", "1990-02-01", (0, 0), kind="aadhaar")
    back = item(2, "back", None, None, None, (5000, 5000), kind="aadhaar", qr=qr)
    people = group([front, back])
    assert len(people) == 1 and people[0].evidence == "qrNameDob"
    # no number on the front to check the QR's tail against: name + DOB only, kept apart (namesake rule)
    apart = group([item(1, "front", None, "Anna Maria", "1990-02-01", (0, 0), kind="aadhaar"),
                   item(2, "back", None, None, None, (5000, 5000), kind="aadhaar", qr=qr)])
    assert all(len(p.cards) == 1 and "sameNameDobNoNumber" in p.flags for p in apart)
    other = item(3, "front", None, "Anna Maria", "1991-02-01", (0, 0), kind="aadhaar")
    assert all(len(p.cards) == 1 for p in group([other, item(2, "back", None, None, None, (5000, 5000), kind="aadhaar", qr=qr)]))


def test_namesakes_with_different_numbers_stay_apart_and_a_duplicate_is_kept_once():
    a = item(1, "front", "111122223333", "Rohit Shah", "1990-01-01", (0, 0))
    b = item(2, "front", "444455556666", "Rohit Shah", "1990-01-01", (3000, 0))
    a2 = item(3, "front", "111122223333", "Rohit Shah", "1990-01-01", (6000, 0))
    people = group([a, b, a2])
    assert len(people) == 2 and sum(bool(p.duplicates) for p in people) == 1
    assert any("duplicateCard" in p.flags for p in people)


def test_different_document_types_are_never_one_person():
    people = group([item(1, "front", None, "Anna Maria", "1990-02-01", (0, 0), kind="voter-id"),
                    item(2, "back", None, "Anna Maria", "1990-02-01", (700, 0), kind="driving-licence")])
    assert all(len(p.cards) == 1 for p in people)


# ---- the whole flow ---------------------------------------------------------------------------------------------------

# These sheets pair a back that carries only a QR code by the QR's name and date of birth: the QR stays behind READER_READ_QR
# (off by default, MJ 5 Nov 2026: no QR for now) and is switched on here.
QR_ON = dataclasses.replace(real_config(), read_qr=True)

@needs_tesseract
def test_real_sheet_two_people_one_pair_by_content_and_a_lone_front():
    from io import BytesIO
    from PIL import Image
    other = C.pan_card(name="Peter Zwolle", dob="05/06/1985", number="ABCPE1234F")
    arts = [np.asarray(Image.open(BytesIO(pair_card(True))).convert("L")), np.asarray(Image.open(BytesIO(pair_card(False))).convert("L")),
            np.asarray(other.convert("L"))]
    photo = sheet(arts, cols=3, frame=(1800, 3400), card_scale=0.26)
    ok, buf = cv2.imencode(".png", photo)
    result = run_job(buf.tobytes(), QR_ON, [], "fast", False, None, True, True, 12, False, "none")
    print(f"\nsheet of 3 cards: found {result['cards']}, people {[(p['regions'], p['evidence']) for p in result['people']]}")
    assert result["cards"] == 3
    paired = [p for p in result["people"] if len(p["regions"]) == 2]
    assert len(paired) == 1 and paired[0]["evidence"] in ("aadhaarNumber", "documentNumber", "qrNameDob", "nameAndDob")
    assert any(len(p["regions"]) == 1 for p in result["people"])


class _Blind:
    name = "fake"
    def supports(self, s): return True
    def recognize(self, *a, **k): return []
    def osd(self, i): return None


def test_a_card_too_small_to_read_is_flagged_and_returns_no_text():
    small = sheet([card_art(i) for i in range(2)], card_scale=0.1)  # about 320 px per card
    ok, buf = cv2.imencode(".png", small)
    result = run_job(buf.tobytes(), real_config(), [], "fast", False, [_Blind()], True, True, 12, True, "none")
    assert result["cards"] == 2 and all("regionTooSmall" in r["flags"] and r["fields"] == {} for r in result["regions"])
    assert "Photograph the IDs in smaller groups" in result["regions"][0]["advice"] and "crop" in result["regions"][0]


def _corner_errors(cuts, truths) -> list[float]:
    """Mean corner error per whole (not cut-off) card, percent of the card diagonal."""
    out = []
    for truth in truths:
        best = min(cuts, key=lambda c: float(np.linalg.norm(c.quad.mean(0) - truth.mean(0))))
        if "cutOff" in best.flags:
            continue
        roll = min(range(4), key=lambda r: float(np.linalg.norm(np.roll(best.quad, r, 0) - truth, axis=1).mean()))
        diag = float(np.linalg.norm(truth[0] - truth[2]))
        out.append(float(np.linalg.norm(np.roll(best.quad, roll, 0) - truth, axis=1).mean()) / diag * 100)
    return out


@needs_model
def test_pale_tinted_cards_in_sleeves_are_cut_to_their_own_edge():
    """Pale-tinted fronts and backs (the tint is close to the paper) in sleeves: no margin is trimmed as if it were sleeve."""
    guests = S.GUESTS[:3]
    art = [S.front(guests[0]), S.back(guests[0]), S.front(guests[1]), S.back(guests[1]), S.front(guests[2]), S.back(guests[2])]
    img, truths = S.sleeved_sheet(art, seed=4)
    cuts = cardcut.cut_cards(img, 13, engines=[_Blind()])
    errors = _corner_errors(cuts, truths)
    ratios = [cardcut._ratio(c.quad) for c in cuts if "cutOff" not in c.flags]
    print(f"\npale sleeved sheet: {len(cuts)} cut; corner error mean {np.mean(errors):.2f}%, max {max(errors):.2f}%; "
          f"ratio off ID-1 max {max(abs(r - cardcut.ID1) / cardcut.ID1 for r in ratios) * 100:.2f}%")
    assert len(cuts) == 6 and max(errors) < 0.5
    assert all(abs(r - cardcut.ID1) / cardcut.ID1 < 0.012 for r in ratios)
    # phone-photo look: light-blue fronts in milky sleeves on warm paper (before the fix: 1.535, 3.2% short, margin cut off)
    photo = cv2.cvtColor(S.photo_sheet(art, columns=2, seed=4), cv2.COLOR_RGB2BGR)  # fronts in the left column
    whole = [c for c in cardcut.cut_cards(photo, 13, engines=[_Blind()])
             if "cutOff" not in c.flags and c.quad[:, 0].mean() < photo.shape[1] / 2]
    off = [abs(cardcut._ratio(c.quad) - cardcut.ID1) / cardcut.ID1 * 100 for c in whole]
    print(f"photo-like fronts: {len(whole)} whole cards, ratio off ID-1 {[round(o, 2) for o in off]}%")
    assert len(whole) == 3 and max(off) < 1.2


@needs_model
def test_no_card_is_cut_loose_or_shifted_on_sheets_that_misaligned_before():
    """Eight cards per sheet (four guests). Before the reader's changes these sheets each had a front cut about 2.9% of its
    diagonal off: its pale margin trimmed as sleeve on one side and the sleeve left on the other, or a side leaning the wrong way."""
    worst = []
    for seed in (2, 5, 11):
        art = [x for i in range(4) for x in (S.front(S.GUESTS[i]), S.back(S.GUESTS[i], with_number=(i + seed) % 3 != 0))]
        img, truths = S.sleeved_sheet(art, seed=seed, cut_last=seed % 2 == 0)
        cuts = cardcut.cut_cards(img, 13, engines=[_Blind()])
        assert len(cuts) == 8
        worst.append(max(_corner_errors(cuts, truths)))
    print(f"\nworst corner error per sheet: {[round(w, 2) for w in worst]}% of the diagonal")
    assert max(worst) < 0.5


@needs_model
def test_sleeved_sheet_gives_one_person_per_guest_with_a_stacked_picture():
    """Three invented guests (front and back each, one back without a number) in sleeves, turned 1-6 degrees, translucent
    glare, the last card off the edge: cut by the model, read, grouped, stacked front over back, every picture under 500 KB."""
    guests = S.GUESTS[:3]
    art = [S.front(guests[0]), S.back(guests[0]), S.front(guests[1]), S.back(guests[1], with_number=False),
           S.front(guests[2]), S.back(guests[2])]
    img, _ = S.sleeved_sheet(art, seed=7)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    started = time.monotonic()
    result = run_job(buf.tobytes(), QR_ON, ["en"], "fast", False, None, True, True, 12, True, "stack")
    took = time.monotonic() - started
    names = sorted(p["suggestedName"] for p in result["people"])
    sizes = [len(base64.b64decode(p["image"])) for p in result["people"]]
    print(f"\nsleeved sheet: {result['cards']} cards, {len(result['people'])} people in {took:.1f} s; "
          f"evidence {[p['evidence'] for p in result['people']]}; sizes {sizes}; cut flags {[r['flags'][:3] for r in result['regions']]}")
    assert result["cards"] == 6
    assert names == sorted(f"{g.name.split()[0]}_{g.name.split()[-1]}_Aadhaar" for g in guests)
    assert all(len(p["regions"]) == 2 and p["evidence"] in ("aadhaarNumber", "qrNameDob") for p in result["people"])
    assert all(s <= multi.MAX_IMAGE_BYTES for s in sizes)
    for p in result["people"]:
        img = cv2.imdecode(np.frombuffer(base64.b64decode(p["image"]), np.uint8), cv2.IMREAD_COLOR)
        assert img.shape[0] > 1.8 * img.shape[1] * 54 / 85.6  # two cards stacked, one above the other
        assert p["fields"]["documentNumber"]["value"].replace(" ", "") in {g.number for g in guests}


@needs_model
def test_the_cutter_without_the_model_still_cuts_with_the_fallback(monkeypatch):
    from tests.cardsheet import make_sheet
    s = make_sheet(4, seed=2)
    monkeypatch.setattr(cardcut, "model_available", lambda: False)
    cuts = multi.cut(s.image, 13, [_Blind()])
    assert len(cuts) == 4 and all("fallbackFinder" in c.flags for c in cuts)


def test_fit_image_keeps_a_small_png_and_shrinks_a_big_one_to_jpeg():
    rng = np.random.default_rng(0)
    noisy = rng.integers(0, 255, (900, 1200, 3), dtype=np.uint8)
    ok, png = cv2.imencode(".png", noisy)
    data, fmt = multi.fit_image(png.tobytes())
    assert fmt == "jpeg" and len(data) <= multi.MAX_IMAGE_BYTES
    ok, small = cv2.imencode(".png", np.full((100, 100, 3), 255, np.uint8))
    assert multi.fit_image(small.tobytes()) == (small.tobytes(), "png")
