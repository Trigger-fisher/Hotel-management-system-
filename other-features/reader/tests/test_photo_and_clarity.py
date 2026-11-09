# copied from intake-worker on 2026-11-04 (tests/test_photo_and_clarity.py, shaped to the reader's regions / people answer)
"""MJ's decisions of 4 Nov 2026 in the reader: the namesake rule (A), the photo check on every ID (B) and the clarity check per card
(C). INVENTED cards and INVENTED drawn faces only (tests/faces.py); no real ID, no real face."""
from __future__ import annotations

import json
import re

import cv2
import numpy as np
import pytest
from PIL import Image

from app import cardcut, clarity, faces, multi, people
from app.jobs import run_job
from app.people import Card
from tests import faces as F
from tests import sheets as S
from tests.conftest import needs_tesseract, real_config

PHOTO = (40, 190, 190, 370)  # the portrait inside the front's photo box (30..230 x 160..400 on the 1000 x 630 invented card)
needs_faces = pytest.mark.skipif(not faces.available(), reason="face models missing: run scripts/get_face_models.py")
# Invented faces (measured in intake-worker): identities 16 and 27 are the most different pair among 40 drawn faces (0.12, under
# the 0.15 mismatch line); identity 2's two takes are the same person (0.78).
OTHER_A, OTHER_B, SAME = 16, 27, 2


def with_face(img: Image.Image, identity: int, take: int = 0, box=PHOTO) -> Image.Image:
    return Image.fromarray(F.put_photo(np.asarray(img.convert("RGB")), F.photo(F.identity(identity), take), box))


def grid_cut(n: int, columns: int):
    """A stand-in cutter for S.sheet: the cards lie in a known grid on white paper (the real cutter is tested in test_multi)."""
    w, h = S.CARD

    def cut(img, limit, engines=None):
        out = []
        for i in range(min(n, limit)):
            r, c = divmod(i, columns)
            x, y = 80 + c * (w + 90), 80 + r * (h + 90)
            quad = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], np.float32)
            out.append(cardcut.CardCut(np.ascontiguousarray(img[y:y + h, x:x + w]), quad, 0.95, []))
        return out
    return cut


def png(img) -> bytes:
    arr = np.asarray(img.convert("RGB")) if isinstance(img, Image.Image) else img
    ok, buf = cv2.imencode(".png", cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
    return buf.tobytes()


def run_sheet(cards: list[Image.Image], monkeypatch, columns: int = 2) -> dict:
    monkeypatch.setattr(multi, "cut", grid_cut(len(cards), columns))
    return run_job(png(S.sheet(cards, columns=columns)), real_config(), ["en"], "fast", False, None, True, True, 12, False, "none")


# ---- rules, with stand-in portraits (no model, no OCR) -----------------------------------------------------------------

class Fake:
    """A stand-in portrait: `tag` is who it shows (None = no usable photo)."""

    def __init__(self, tag):
        self.tag, self.status, self.reasons, self.feature, self.box, self.quality = tag, "found" if tag else "unclear", [], None, None, {}

    def public(self):
        return {"status": self.status, "reasons": []}


def fake_compare(a, b):
    if a is None or b is None or a.tag is None or b.tag is None:
        return {"outcome": "unclear", "score": None, "reason": "photo unclear"}
    return {"outcome": "match", "score": 0.8, "reason": ""} if a.tag == b.tag else {"outcome": "mismatch", "score": 0.05, "reason": ""}


@pytest.fixture()
def fake_faces(monkeypatch):
    monkeypatch.setattr(people.faces, "compare", fake_compare)
    monkeypatch.setattr(people.faces, "compare_sets", lambda xs, ys: max(
        (fake_compare(x, y) for x in xs for y in ys), key=lambda r: {"match": 2, "mismatch": 1}.get(r["outcome"], 0),
        default={"outcome": "unclear", "score": None, "reason": "no photo"}))


def mk(index, side, name=None, dob=None, number=None, face=None, kind="aadhaar", at=(0, 0), qr=(), numbers=None, ref=None) -> Card:
    x, y = at
    quad = np.array([[x, y], [x + 1000, y], [x + 1000, y + 630], [x, y + 630]], np.float32)
    nums = numbers if numbers is not None else ({"aadhaar": {number}} if number else {})
    keys = {"numbers": nums, "printed": set(), "qr": list(qr), "name": name, "dob": dob, "address": None, "gender": None, "text": "",
            "type": kind, "passportRef": ref}
    fields = {k: {"value": v, "confidence": 0.9, "source": "ocr"} for k, v in (("name", name), ("dob", dob)) if v}
    return Card(index, np.zeros((8, 8, 3), np.uint8), quad, 0.9, [], {"confidence": 0.9},
                {"type": kind, "fields": fields, "needsHumanCheck": False}, side, keys, face=Fake(face))


N1 = S.GUESTS[0].number


def test_namesakes_without_numbers_are_never_one_card(fake_faces):
    # MJ's RARE rule (4 Nov 2026): same full name and DOB, no number: two people, marked rare; a photo mismatch only confirms it
    for a, b, flag in (("A", "B", "sameNameDobNoNumber"), (None, None, "sameNameDobNoNumber"), ("A", "A", "sameNameDobNoNumber")):
        persons = people.group([mk(1, "front", "Rohit Shah", "1985-06-05", face=a), mk(2, "front", "Rohit Shah", "1985-06-05", face=b, at=(0, 5000))])
        assert len(persons) == 2 and not any(p.duplicates for p in persons), (a, b)
        assert all(flag in p.flags and p.rare and "photoMismatch" not in p.flags for p in persons), (a, b, [p.flags for p in persons])
        assert not any(people.needs_check(p) for p in persons if set(p.flags) <= {"sameNameDobNoNumber", "rare"})  # no warning
    same = people.group([mk(1, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(2, "front", "Rohit Shah", "1985-06-05", N1, face="A", at=(0, 5000))])
    assert len(same) == 1 and "duplicateCard" in same[0].flags
    clash = people.group([mk(1, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(2, "front", "Rohit Shah", "1985-06-05", N1, face="B", at=(0, 5000))])
    assert len(clash) == 2 and all("photoMismatch" in p.flags for p in clash)


def test_name_and_dob_pair_front_and_back_only_with_matching_photos_and_no_numbers(fake_faces):
    def pair(front_face, back_face, number=None):
        return people.group([mk(1, "front", "Kavita Joshi", "1990-11-02", number, face=front_face, kind="driving-licence"),
                             mk(2, "back", "Kavita Joshi", "1990-11-02", face=back_face, kind="driving-licence", at=(9000, 0))])
    ok = pair("K", "K")
    assert [p.evidence for p in ok] == ["nameAndDob"] and "pairedByNameDobAndPhoto" in ok[0].flags
    for front_face, back_face, number, flag in (("K", None, None, "sameNameDobNoNumber"), ("K", "M", None, "sameNameDobNoNumber"),
                                                ("K", "K", N1, "sameNameDobNoNumber")):
        apart = pair(front_face, back_face, number)
        assert [p.evidence for p in apart] == ["none", "none"], (front_face, back_face, number)
        assert all(flag in p.flags for p in apart), (front_face, back_face, number, [p.flags for p in apart])
    strong = people.group([mk(1, "front", "Anil Mehra", "1981-03-14", N1, face="A"), mk(2, "back", number=N1, at=(9000, 0))])
    assert [p.evidence for p in strong] == ["aadhaarNumber"]


def test_same_guest_link_needs_number_or_name_dob_and_photo(fake_faces):
    def run(aadhaar_face, pan_face):
        return people.group([mk(1, "front", "Anil Mehra", "1981-03-14", N1, face=aadhaar_face), mk(2, "back", number=N1, at=(1100, 0)),
                             mk(3, "single", "ANIL MEHRA", "1981-03-14", kind="pan", numbers={"pan": {"BQRPM4821K"}}, face=pan_face, at=(0, 5000))])
    linked = run("A", "A")
    assert linked[0].linked == [2] and linked[0].link_evidence == ["nameAndDob", "photoMatch"] and "sameGuestOtherDocument" in linked[1].flags
    maybe = run("A", None)
    assert not maybe[0].linked and maybe[0].possible == [2] and maybe[1].possible == [1] and "possibleSameGuest" in maybe[1].flags
    blocked = run("A", "B")
    assert not blocked[0].linked and not blocked[0].possible and "photoMismatch" in blocked[0].flags and "photoMismatch" in blocked[1].flags
    for visa_face, expect in ((None, [2]), ("B", [])):
        persons = people.group([mk(1, "front", "John Carter", "1980-01-02", kind="passport", numbers={"passport": {"Z1234567"}}, face="A"),
                                mk(2, "single", "John Carter", "1980-01-02", kind="visa", ref="Z1234567", face=visa_face, at=(0, 5000))])
        assert persons[0].linked == expect, visa_face


def test_person_photo_outcome_words():
    from app.inspection import photo_outcome
    found = [{"status": "found", "reasons": []}]
    assert photo_outcome(found, [{"outcome": "mismatch"}], []) == "mismatch"
    assert photo_outcome(found, [{"outcome": "match"}], []) == "match"
    assert photo_outcome(found, [], ["photoMismatch"]) == "mismatch"
    assert photo_outcome(found, [], []) == "notCompared"
    assert photo_outcome([{"status": "none", "reasons": []}], [], []) == "noPhoto"
    assert photo_outcome([{"status": "unavailable", "reasons": []}], [], []) == "unavailable"
    assert photo_outcome([{"status": "unclear", "reasons": []}], [], []) == "unclear"


# ---- clarity -------------------------------------------------------------------------------------------------------------

def _glare(img: Image.Image, box) -> Image.Image:
    arr = np.asarray(img.convert("RGB")).astype(np.float32)
    mask = np.zeros(arr.shape[:2], np.float32)
    cv2.ellipse(mask, ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), ((box[2] - box[0]) // 2, (box[3] - box[1]) // 2), 0, 0, 360, 1.0, -1)
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 8) * 1.3, 0, 1)[..., None]
    return Image.fromarray(np.clip(arr * (1 - mask) + 255 * mask, 0, 255).astype(np.uint8))


@needs_tesseract
def test_clarity_grades_degraded_cards_on_a_sheet(monkeypatch):
    g = S.GUESTS
    clean = with_face(S.front(g[0]), SAME)
    blurred = Image.fromarray(cv2.GaussianBlur(np.asarray(with_face(S.front(g[1]), OTHER_A)), (0, 0), 3.0))
    glared = _glare(with_face(S.front(g[2]), OTHER_B), (250, 455, 760, 545))  # a lamp's reflection over the number line
    result = run_sheet([clean, blurred, glared], monkeypatch, columns=3)
    regions = {r["regionId"]: r for r in result["regions"]}
    for n, r in sorted(regions.items()):
        print(f"\nregion {n}: {r['clarity']['grade']} {r['clarity']['reasons']} {r['flags']}")
    assert result["cards"] == 3
    assert regions[1]["clarity"]["grade"] in ("clear", "usable") and "unclearCard" not in regions[1]["flags"]
    for n, reason in ((2, "blurred"), (3, "glare")):
        r = regions[n]
        assert r["clarity"]["grade"] == "unclear" and any(reason in x for x in r["clarity"]["reasons"]), r["clarity"]
        # a whole card blurred blurs its portrait too: MJ's photo rule puts its retake line first
        assert "Retake this card" in r["retake"] and "unclearCard" in r["flags"] and r["needsHumanCheck"]
        person = next(p for p in result["people"] if n in p["regions"])
        assert person["clarity"]["grade"] == "unclear" and "Retake this card" in person["clarity"]["advice"]
        assert "unclearCard" in person["flags"] and person["needsHumanCheck"]
        assert person["clarity"]["cards"][0]["reasons"] and set(person["photo"]) == {"outcome", "portraits", "checks"}
    blurred_person = next(p for p in result["people"] if 2 in p["regions"])
    if {"documentNumber", "name", "dob"} & set(blurred_person["fields"]):
        assert "keyFieldUnclear" in blurred_person["flags"] and blurred_person["clarity"]["unclearFields"]


@needs_tesseract
def test_clarity_on_the_single_card_path():
    blurred = cv2.GaussianBlur(np.asarray(with_face(S.front(S.GUESTS[0]), SAME)), (0, 0), 3.0)
    result = run_job(png(blurred), real_config(), ["en"], "fast", False, None, True)
    assert result["clarity"]["grade"] == "unclear" and result["needsHumanCheck"] and "unclearCard" in result["flags"]
    assert result["clarity"]["reasons"] and "Retake this card" in result["clarity"]["advice"]
    assert set(result["photo"]) == {"outcome", "portraits", "checks"}
    sharp = run_job(png(with_face(S.front(S.GUESTS[0]), SAME)), real_config(), ["en"], "fast", False, None, True)
    print(f"\nsingle card: blurred {result['clarity']['grade']} {result['clarity']['reasons']}; sharp {sharp['clarity']['grade']} "
          f"{sharp['clarity']['reasons']}; photo {sharp['photo']['outcome']}")
    assert sharp["clarity"]["grade"] in ("clear", "usable") and "unclearCard" not in sharp["flags"]


def test_thresholds_follow_the_readers_own_environment_names(monkeypatch):
    from app import thresholds
    monkeypatch.setenv("READER_CLARITY_DPI_UNCLEAR", "140")
    monkeypatch.setenv("READER_FACE_MISMATCH_BELOW", "oops")
    monkeypatch.setenv("CLARITY_DPI_UNCLEAR", "999")  # intake-worker's name: not read here
    assert thresholds.get("CLARITY_DPI_UNCLEAR") == 140 and thresholds.get("FACE_MISMATCH_BELOW") == 0.15
    monkeypatch.setenv("READER_FACE_MODELS_DIR", "Z:/nowhere")
    assert str(faces.models_dir()).replace("\\", "/") == "Z:/nowhere" and not faces.available()
    small = cv2.resize(np.ascontiguousarray(np.asarray(S.front(S.GUESTS[0]))[..., ::-1]), (500, 315))
    assert any("card too small" in r for r in clarity.assess(small, kind="aadhaar", side="front", source_long=430)["reasons"])


def test_without_face_models_every_outcome_is_unavailable_and_nothing_breaks(monkeypatch):
    monkeypatch.setenv("READER_FACE_MODELS_DIR", "Z:/nowhere")
    p = faces.find_portrait(np.asarray(with_face(S.front(S.GUESTS[0]), SAME))[..., ::-1].copy())
    assert p.status == "unavailable" and p.feature is None


# ---- photo check: real face models, invented faces ---------------------------------------------------------------------

def misread(g: S.Guest) -> S.Guest:
    """The same invented guest with the number's last digit misread: printed, but its Verhoeff check fails (no valid number).
    The name carries a "Name:" label: without a valid number the reader does not know the card's type, and on an unknown card it
    reads a name only from a label (intake-worker's own layout reader finds the unlabelled name)."""
    return S.Guest("Name: " + g.name, g.dob, g.gender, g.number[:-1] + str((int(g.number[-1]) + 1) % 10), g.address)


ROHIT_1 = S.guest("Rohit Shah", "05/06/1985", "Male", "72619384051", "S/O Amit Shah, 8 Hill Road", "Surat, Gujarat - 395003")
ROHIT_2 = S.guest("Rohit Shah", "05/06/1985", "Male", "81937462053", "S/O Kiran Shah, 21 River Road", "Navsari, Gujarat - 396445")


@needs_faces
@needs_tesseract
def test_namesakes_with_unreadable_numbers_kept_apart(monkeypatch):
    sheet = [with_face(S.front(misread(ROHIT_1)), OTHER_A), with_face(S.front(misread(ROHIT_2)), OTHER_B),
             with_face(S.front(misread(S.GUESTS[2])), SAME), with_face(S.front(misread(S.GUESTS[2])), SAME)]
    result = run_sheet(sheet, monkeypatch)
    print("\n", [(p["regions"], p["flags"], p["photo"]["outcome"], p["photo"]["checks"]) for p in result["people"]])
    assert len(result["people"]) == 4
    assert all(not p["duplicates"] for p in result["people"])
    assert all({"photoMismatch", "sameNameDobNoNumber"} & set(p["flags"]) for p in result["people"])
    # these misread cards read as an unknown type: MJ's RARE rule (copied from intake-worker) applies to known document types only
    rohit = [p for p in result["people"] if p["regions"][0] in (1, 2)]
    outcomes = {c["outcome"] for p in rohit for c in p["photo"]["checks"]}
    assert outcomes and outcomes <= {"mismatch", "unclear"}  # two different invented faces: never a match
    copies = [p for p in result["people"] if p["regions"][0] in (3, 4)]
    assert all("sameNameDobNoNumber" in p["flags"] for p in copies)
    assert all(c["outcome"] == "match" for p in copies for c in p["photo"]["checks"])  # a match alone never makes a duplicate
    assert all(p["photo"]["outcome"] == "match" for p in copies)
    region = {r["regionId"]: r for r in result["regions"]}
    assert region[3]["photo"]["status"] == "found" and region[3]["photo"]["checks"][0]["withRegion"] == 4


@needs_faces
@needs_tesseract
def test_front_and_back_pair_and_the_answer_holds_outcomes_only(monkeypatch):
    result = run_sheet([with_face(S.front(S.GUESTS[0]), SAME), S.back(S.GUESTS[0])], monkeypatch)
    text = json.dumps(result)
    assert not re.search(r"(?:-?\d+\.\d+, ){32,}", text), "a long list of numbers in the answer"
    assert "feature" not in text and "embedding" not in text
    person = result["people"][0]
    print(f"\npair: {person['regions']} {person['evidence']} photo {person['photo']} clarity {person['clarity']['grade']}")
    assert person["regions"] == [1, 2] and person["evidence"] in ("aadhaarNumber", "qrNameDob")
    portraits = person["photo"]["portraits"]
    assert portraits and all(set(p) <= {"region", "side", "status", "reasons", "quality"} for p in portraits)
    assert person["photo"]["outcome"] in ("notCompared", "match", "unclear")  # the back carries no portrait to compare
    assert all(set(r["photo"]) <= {"status", "reasons", "quality", "checks"} for r in result["regions"])


# ---- MJ's rules copied from intake-worker on 2026-11-05: pairing by position, unclear ID photo rejects, heavy JPEG ----------------

def _plain(tint, lines):
    from PIL import ImageDraw
    from tests.imaging import font
    img = Image.new("RGB", S.CARD, tint)
    d = ImageDraw.Draw(img)
    for i, text in enumerate(lines):
        d.text((40, 60 + 70 * i), text, font=font("segoeui.ttf", 40), fill=0)
    return cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)


def test_side_by_side_cards_pair_by_position_only_when_they_look_alike(fake_faces):
    tint = (236, 242, 250)
    front = mk(1, "front", "Kavita Joshi", "1990-11-02", face="K", at=(0, 0))
    back = mk(2, "back", at=(1100, 0))
    front.image, back.image = _plain(tint, ["Kavita Joshi", "DOB 02/11/1990"]), _plain(tint, ["Address: 44 Garden Street", "Vadodara"])
    paired = people.group([front, back])
    assert [p.evidence for p in paired] == ["position"] and "pairedByPosition" in paired[0].flags and paired[0].look["alike"]
    other = mk(2, "back", at=(1100, 0))
    other.image = _plain((250, 228, 205), ["Address: 44 Garden Street", "Vadodara"])  # another card colour: only a suggestion
    front2 = mk(1, "front", "Kavita Joshi", "1990-11-02", face="K", at=(0, 0))
    front2.image = front.image
    apart = people.group([front2, other])
    assert [p.evidence for p in apart] == ["none", "none"] and all("layoutSuggestsPair" in p.flags for p in apart)


def test_unclear_id_photo_rejects_and_backs_are_not_checked():
    class P:
        def __init__(self, status, reasons=()):
            self.status, self.reasons = status, list(reasons)
    assert clarity.photo_verdict("aadhaar", "front", None, P("unclear", ["photo blurred"]))["retake"] == clarity.PHOTO_RETAKE
    assert clarity.photo_verdict("pan", "single", None, P("none"))["code"] == "photo_unclear"
    assert clarity.photo_verdict("aadhaar", "back", None, P("none")) is None  # a back carries no portrait
    assert clarity.photo_verdict("visa", "single", "eta", P("none")) is None  # the ETA printout carries none
    assert clarity.photo_verdict("aadhaar", "front", None, P("found")) is None
    assert clarity.photo_verdict("aadhaar", "front", None, None) is None  # face models missing: not judged


def test_heavy_jpeg_is_graded_too_compressed():
    card = _plain((236, 242, 250), ["Kavita Joshi", "DOB 02/11/1990", "2847 3619 2051"])
    q = {}
    for quality in (92, 20):
        ok, buf = cv2.imencode(".jpg", card, [cv2.IMWRITE_JPEG_QUALITY, quality])
        q[quality] = clarity.jpeg_quality(buf.tobytes())
    assert q[92] >= 85 and 15 <= q[20] <= 25 and clarity.jpeg_quality(b"\x89PNG....") is None
    graded = clarity.assess(card, None, None, "unknown", "unknown", 1000, None, q[20])
    assert "picture too compressed" in graded["reasons"] and graded["grade"] == "unclear"


def test_a_heavy_jpeg_saved_again_as_png_or_high_quality_jpeg_is_traced():
    card = _plain((236, 242, 250), ["Invented Name", "DOB 02/11/1990", "0000 1111 2222"])
    for quality in (15, 30):
        once = cv2.imdecode(cv2.imencode(".jpg", card, [cv2.IMWRITE_JPEG_QUALITY, quality])[1], cv2.IMREAD_COLOR)
        as_png = cv2.imencode(".png", once)[1].tobytes()
        as_q95 = cv2.imencode(".jpg", once, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
        assert clarity.jpeg_quality(as_png) == quality and clarity.jpeg_quality(as_q95) == quality
    assert clarity.jpeg_quality(cv2.imencode(".png", card)[1].tobytes()) is None
    assert clarity.jpeg_quality(cv2.imencode(".jpg", card, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()) == 95.0
