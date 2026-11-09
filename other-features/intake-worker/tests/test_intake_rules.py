"""MJ's intake decisions of 4 Nov 2026: (1) RARE namesakes, (2) an unclear ID photo rejects the card, (3) a front and back paired by
position, (4) a very heavily compressed JPEG is graded unclear. INVENTED cards, INVENTED drawn faces and invented sheets only."""
from __future__ import annotations

import csv
import io
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from app import clarity, faces, naming, people
from app.errors import StepError
from app.people import Card
from tests import faces as F
from tests import idkinds as K
from tests import sheets as S
from tests import visadocs as V
from tests.conftest import make_pipeline
from tests.imaging import png_bytes

ROOT = Path(__file__).resolve().parents[1]
CAP = 512_000
PHOTO = (40, 190, 190, 370)  # the portrait inside the sheets.front photo frame (as in test_photo_and_clarity)
PAN_PHOTO = (770, 190, 950, 410)
needs_faces = pytest.mark.skipif(not faces.available(), reason="face models missing: run scripts/get_face_models.py")
OTHER_A, OTHER_B, SAME = 16, 27, 2  # the invented identities test_photo_and_clarity measured (16 vs 27 the most different)


def _job(**kw) -> dict:
    return {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": CAP, "languages": None, "multi": True, **kw}


@pytest.fixture()
def stubbed(monkeypatch):
    monkeypatch.setattr(people, "cut", S.stub_cut)


def with_face(img: Image.Image, identity: int, take: int = 0, box=PHOTO) -> Image.Image:
    return Image.fromarray(F.put_photo(np.asarray(img.convert("RGB")), F.photo(F.identity(identity), take), box))


def jpeg_bytes(img, quality: int) -> bytes:
    buf = io.BytesIO()
    (img if isinstance(img, Image.Image) else Image.fromarray(img)).convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()


# ---- stand-ins (no OCR, no face model) ---------------------------------------------------------------------------------------

class Fake:
    """A stand-in portrait: `tag` is who it shows; None = no usable photo."""

    def __init__(self, tag, status=None, reasons=()):
        self.tag, self.status, self.reasons = tag, status or ("found" if tag else "none"), list(reasons)
        self.feature, self.box, self.quality = None, None, {}

    def public(self):
        return {"status": self.status, "reasons": self.reasons}


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


def tinted(colour, print_lines: int = 6) -> np.ndarray:
    """A plain invented card (RGB) of one colour with a few dark print lines."""
    img = np.full((630, 1000, 3), colour, np.uint8)
    for i in range(print_lines):
        cv2.putText(img, "INVENTED LINE %d" % i, (280, 120 + 70 * i), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (20, 20, 20), 3)
    return img


def mk(index, side, name=None, dob=None, number=None, face=None, kind="aadhaar", at=(0, 0), numbers=None, printed=(), qr=(),
       gender=None, image=None, picture=0, status=None) -> Card:
    x, y = at
    quad = np.array([[x, y], [x + 1000, y], [x + 1000, y + 630], [x, y + 630]], np.float32)
    nums = numbers if numbers is not None else ({"aadhaar": {number}} if number else {})
    keys = {"numbers": nums, "printed": set(printed), "qr": list(qr), "name": name, "dob": dob, "address": None, "gender": gender,
            "text": "", "type": kind, "passportRef": None}
    fields = {k: {"value": v, "confidence": 0.9, "source": "ocr"} for k, v in (("name", name), ("dob", dob)) if v}
    img = image if image is not None else tinted((236, 242, 250))
    return Card(index, picture, img, quad, 0.9, [], {"confidence": 0.9}, {"type": kind, "fields": fields, "doubtful": [], "unknown": False},
                side, keys, face=Fake(face, status))


N1, N2 = S.GUESTS[0].number, S.GUESTS[1].number


# ==== 1. RARE ==================================================================================================================

def test_rare_namesakes_are_kept_apart_and_marked(fake_faces):
    # Same full name and full date of birth, no number: two people, rare, never a duplicate (photo match or mismatch alike).
    for a, b in ((None, None), ("A", "A"), ("A", "B")):
        persons = people.group([mk(0, "single", "Rohit Shah", "1985-06-05", face=a, kind="pan"),
                                mk(1, "single", "Rohit Shah", "1985-06-05", face=b, kind="pan", at=(0, 5000))])
        assert len(persons) == 2 and not any(p.duplicates for p in persons), (a, b)
        assert all(p.rare and "rare" in p.flags and "photoMismatch" not in p.flags for p in persons), (a, b, [p.flags for p in persons])
    # Two different valid numbers, same name and date of birth: two people, rare.
    two = people.group([mk(0, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(1, "front", "Rohit Shah", "1985-06-05", N2, face="B", at=(0, 5000))])
    assert len(two) == 2 and all(p.rare for p in two)
    # A year of birth alone is not the rare case; nor are two different documents of one guest; nor a different date of birth.
    yob = people.group([mk(0, "single", "Rohit Shah", "1985", kind="pan"), mk(1, "single", "Rohit Shah", "1985", kind="pan", at=(0, 5000))])
    assert not any(p.rare for p in yob) and all("sameNameDobNoNumber" in p.flags for p in yob)
    docs = people.group([mk(0, "single", "Rohit Shah", "1985-06-05", kind="pan"),
                         mk(1, "front", "Rohit Shah", "1985-06-05", kind="driving-licence", at=(0, 5000))])
    assert not any(p.rare for p in docs)
    other = people.group([mk(0, "single", "Rohit Shah", "1985-06-05", kind="pan"), mk(1, "single", "Rohit Shah", "1986-06-05", kind="pan", at=(0, 5000))])
    assert not any(p.rare for p in other)
    # The same valid number is still one card shown twice; with a clearly different face a person must look (not rare).
    same = people.group([mk(0, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(1, "front", "Rohit Shah", "1985-06-05", N1, face="A", at=(0, 5000))])
    assert len(same) == 1 and "duplicateCard" in same[0].flags and not same[0].rare
    clash = people.group([mk(0, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(1, "front", "Rohit Shah", "1985-06-05", N1, face="B", at=(0, 5000))])
    assert len(clash) == 2 and all("photoMismatch" in p.flags for p in clash)


def test_rare_file_names():
    stem = naming.stem({"name": {"value": "Rajiv Kumar Sheth"}}, "aadhaar", rare=True)
    assert stem == "Rajiv_Sheth_Aadhaar_Rare"
    taken: set[str] = set()
    assert naming.unique(stem, "jpg", taken) == "Rajiv_Sheth_Aadhaar_Rare.jpg"
    assert naming.unique(stem, "jpg", taken) == "Rajiv_Sheth_Aadhaar_Rare_2.jpg"
    assert naming.stem({}, "pan", rare=True) == "Unknown_PAN_Rare" and naming.stem({"name": {"value": "Rajiv Sheth"}}, "pan") == "Rajiv_Sheth_PAN"


@needs_faces
def test_rare_pan_namesakes_full_run_no_warning(tmp_path, monkeypatch, stubbed, capsys):
    """Two invented PAN cards, same name and date of birth, different numbers and faces: two pictures named ..._PAN_Rare, report
    rare=yes, and the rare case alone does not ask reception to check."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import run_folder
    sheet = S.sheet([with_face(K.pan_old(K.ANIL, K.ANIL_PAN), OTHER_A, box=PAN_PHOTO),
                     with_face(K.pan_old(K.ANIL, "CDTPM5932L"), OTHER_B, box=PAN_PHOTO)])
    src, out = tmp_path / "in", tmp_path / "out"
    src.mkdir()
    (src / "sheet.png").write_bytes(png_bytes(sheet))
    # gate warn: the quality gate calls this flat invented sheet glared (a whole-sheet measure, not the rule tested here)
    monkeypatch.setattr(sys, "argv", ["run_folder.py", "--in", str(src), "--out", str(out), "--multi", "on", "--gate", "warn"])
    assert run_folder.main() == 0
    console = capsys.readouterr().out
    assert "Anil" not in console and "Mehra" not in console and "sheet.png" not in console  # counts only
    rows = list(csv.DictReader(open(out / "report.csv", encoding="utf-8")))
    print("\n", [(r["status"], r["rare"], r["flags"], r["output"]) for r in rows])
    assert len(rows) == 2 and all(r["rare"] == "yes" for r in rows)
    assert sorted(Path(r["output"]).stem for r in rows) == ["Anil_Mehra_PAN_Rare", "Anil_Mehra_PAN_Rare_2"]
    assert sorted(p.stem for p in out.iterdir() if p.suffix in (".jpg", ".png", ".webp")) == ["Anil_Mehra_PAN_Rare", "Anil_Mehra_PAN_Rare_2"]
    assert all("rare" in r["flags"].split() and "photoUnclear" not in r["flags"].split() for r in rows)
    # no warning BECAUSE of the namesake rule: whatever else is flagged, it is never sameNameDobNoNumber alone
    for r in rows:
        others = set(r["flags"].split()) - {"rare", "sameNameDobNoNumber"}
        if r["status"] == "done (check)":
            assert others, r["flags"]


# ==== 2. UNCLEAR ID PHOTO = REJECT ================================================================================================

def test_photo_verdict_by_side():
    none, blurred = Fake(None, "none"), Fake(None, "unclear", ["photo blurred"])
    found, missing_models = Fake("A"), Fake(None, "unavailable", ["face models not installed"])
    for kind, side, form in (("aadhaar", "front", None), ("pan", "single", None), ("driving-licence", "front", None),
                             ("voter-id", "front", None), ("passport", "front", None), ("oci", "single", None),
                             ("visa", "single", "sticker"), ("residence-permit", "front", None), ("aadhaar", "single", "letter")):
        v = clarity.photo_verdict(kind, side, form, none)
        assert v == {"code": "photo_unclear", "reason": "no photo found on the ID", "retake": "Photo on the ID is not clear, please retake."}, kind
        assert clarity.photo_verdict(kind, side, form, blurred)["reason"] == "photo on the ID blurred"
        assert clarity.photo_verdict(kind, side, form, found) is None and clarity.photo_verdict(kind, side, form, missing_models) is None
    # sides without a portrait are never checked
    for kind, side, form in (("aadhaar", "back", None), ("passport", "back", None), ("driving-licence", "back", None),
                             ("visa", "single", "eta"), ("residence-permit", "single", "frro"), ("unknown", "front", None)):
        assert clarity.photo_verdict(kind, side, form, none) is None, (kind, side, form)
    # the clarity result carries the reject and the retake line
    card = np.asarray(S.front(S.GUESTS[0]))
    got = clarity.assess(card, kind="aadhaar", side="front", source_long=1000, portrait=Fake(None, "unclear", ["glare over photo"]))
    assert got["grade"] == "unclear" and got["photoReject"]["reason"] == "glare over the photo on the ID"
    assert got["advice"].startswith("Photo on the ID is not clear, please retake.")
    back = clarity.assess(np.asarray(S.back(S.GUESTS[0])), kind="aadhaar", side="back", source_long=1000, portrait=none)
    assert "photoReject" not in back


def _blur_box(img: Image.Image, box, sigma=6.0) -> Image.Image:
    arr = np.asarray(img.convert("RGB")).copy()
    x0, y0, x1, y1 = box
    arr[y0:y1, x0:x1] = cv2.GaussianBlur(arr[y0:y1, x0:x1], (0, 0), sigma)
    return Image.fromarray(arr)


@needs_faces
def test_unclear_id_photo_rejects_the_card(storage, engines, stubbed):
    g = S.GUESTS
    sheet = S.sheet([with_face(S.front(g[0]), SAME), S.back(g[0]),  # clear photo: kept
                     S.front(g[1]), S.back(g[1]),  # no photo in the frame: rejected
                     _blur_box(with_face(S.front(g[2]), OTHER_A), PHOTO), S.back(g[2])])  # blurred photo: rejected
    results = make_pipeline(storage, engines).analyse([png_bytes(sheet)], _job(gate_action="reject"))
    print("\n", [(v["status"], v["person"]["cards"], v.get("reject"), v["flags"]) for v, _ in results])
    by_first = {v["person"]["cards"][0]: (v, b) for v, b in results}
    assert set(by_first) == {1, 3, 5}
    ok, _ = by_first[1]
    assert ok["status"] == "done" and ok["person"]["sides"] == ["front", "back"]
    for n, why in ((3, "no photo found"), (5, "blurred")):
        v, blob = by_first[n]
        assert v["status"] == "rejected" and blob == b"" and v["result_bytes"] == 0, v
        assert v["reject"]["code"] == "photo_unclear" and v["reject"]["message"] == "Photo on the ID is not clear, please retake."
        assert [c["card"] for c in v["reject"]["cards"]] == [n] and why in v["reject"]["cards"][0]["reason"]
        assert "fields" not in v and "photoUnclear" in v["flags"]
        assert all(set(p) <= {"card", "side", "status", "reasons", "quality"} for p in v["photo"]["portraits"])  # nothing about the face
    # gate_action warn: the same card is kept, graded unclear and flagged for a person instead
    warned = make_pipeline(storage, engines).analyse([png_bytes(S.sheet([S.front(g[1]), S.back(g[1])]))], _job())
    assert len(warned) == 1 and warned[0][0]["status"] == "done" and warned[0][1]
    assert {"photoUnclear", "unclearCard"} <= set(warned[0][0]["flags"]) and warned[0][0]["needs_human_check"]


def test_folder_report_row_for_a_rejected_card():
    """The folder runner's row for a person refused by the photo rule: no picture, the retake line, fixed phrases only."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import run_folder
    values = {"status": "rejected", "needs_human_check": False, "rare": False, "flags": ["photoUnclear"], "steps": ["type", "group"],
              "document_type": {"type": "aadhaar"}, "person": {"index": 2, "cards": [3, 4], "sides": ["front", "back"],
                                                              "evidence": "aadhaarNumber", "duplicates": []},
              "reject": {"code": "photo_unclear", "message": clarity.PHOTO_RETAKE,
                         "cards": [{"card": 3, "side": "front", "reason": "photo on the ID blurred"}]},
              "clarity": {"grade": "unclear", "cards": [{"card": 3, "side": "front", "grade": "unclear", "reasons": ["photo on the ID blurred"]}]},
              "photo": {"portraits": [{"card": 3, "status": "unclear", "reasons": ["photo blurred"]}], "checks": []}}
    row = run_folder._person_row(values, b"", [])
    assert row["status"] == "rejected: photo_unclear" and row["blob"] is None and row["bytes_after"] == 0
    assert row["retake"] == "Photo on the ID is not clear, please retake." and "card 3: photo on the ID blurred" in row["clarity_cards"]
    assert row["rare"] == "" and row["paired_by_position"] == "" and row["fields"] == {}


@needs_faces
def test_unclear_id_photo_rejects_the_single_card_and_backs_are_not_checked(storage, engines):
    with pytest.raises(StepError) as err:
        make_pipeline(storage, engines).analyse([png_bytes(S.front(S.GUESTS[0]))], _job(multi=False, gate_action="reject"))
    assert err.value.code == "photo_unclear" and err.value.reject and err.value.message == "Photo on the ID is not clear, please retake."
    # an Aadhaar back alone and an e-Visa ETA printout carry no portrait: never rejected for it
    for picture in (S.back(S.GUESTS[0]), V.eta_printout(V.JAMES, V.JAMES_ETA, V.JAMES_PASSPORT)):
        try:
            values, _ = make_pipeline(storage, engines).analyse([png_bytes(picture)], _job(multi=False, gate_action="reject"))
            assert "photoUnclear" not in values["flags"], values["flags"]
        except StepError as e:  # another quality reason may refuse an invented page; never the photo rule
            assert e.code != "photo_unclear", e.code
    values, _ = make_pipeline(storage, engines).analyse([png_bytes(with_face(S.front(S.GUESTS[0]), SAME))], _job(multi=False, gate_action="reject"))
    assert values["status"] == "done" and "photoUnclear" not in values["flags"]


# ==== 3. SIDE-BY-SIDE PAIRING ======================================================================================================

def test_position_pairing_rules(fake_faces):
    front = lambda **kw: mk(0, "front", "Anil Mehra", "1981-03-14", face="A", **kw)  # noqa: E731
    back = lambda **kw: mk(1, "back", at=(1100, 0), **kw)  # noqa: E731
    paired = people.group([front(), back()])
    assert [(p.evidence, [c.index for c in p.cards]) for p in paired] == [("position", [0, 1])]
    assert "pairedByPosition" in paired[0].flags and paired[0].look["alike"] and "layoutSuggestsPair" not in paired[0].flags
    # One side's number unreadable, the other's read: still paired by position (nothing could decide by number)
    assert [p.evidence for p in people.group([front(number=N1), back()])] == ["position"]

    def stays_suggestion(cards, why):
        persons = people.group(cards)
        assert [p.evidence for p in persons] == ["none", "none"], why
        return persons
    # the front's portrait is not clear
    for status in ("none", "unclear"):
        assert all("layoutSuggestsPair" in p.flags for p in stays_suggestion(
            [mk(0, "front", "Anil Mehra", "1981-03-14", status=status), back()], status))
    # conflicts: gender, date of birth, number tails
    stays_suggestion([front(gender="Male"), back(gender="Female")], "gender")
    stays_suggestion([front(), mk(1, "back", "Anil Mehra", "1982-03-14", at=(1100, 0))], "dob")
    stays_suggestion([front(printed={"123456781234"}), back(printed={"123456785678"})], "number tails")
    # they do not look alike: another card colour, another size
    pink = tinted((250, 205, 215))
    assert all("layoutSuggestsPair" in p.flags for p in stays_suggestion([front(), back(image=pink)], "colour"))
    small = mk(1, "back", at=(1100, 0))
    small.quad = np.array([[1100, 0], [1900, 0], [1900, 504], [1100, 504]], np.float32)  # 80% of the size
    stays_suggestion([front(), small], "size")
    # not the single nearest: two backs about as near
    crowd = people.group([mk(0, "front", "Anil Mehra", "1981-03-14", face="A", at=(1100, 0)), mk(1, "back", at=(0, 0)), mk(2, "back", at=(2200, 0))])
    assert all(p.evidence == "none" for p in crowd)
    # on different pictures: no pair, no suggestion
    apart = people.group([front(), mk(1, "back", at=(1100, 0), picture=1)])
    assert [p.evidence for p in apart] == ["none", "none"] and not any(p.suggested for p in apart)
    # a number on both sides that does not match is a conflict, never a position pair
    stays_suggestion([front(number=N1), back(number=N2)], "both numbered")


def _same_tint_back(g, monkeypatch) -> Image.Image:
    monkeypatch.setattr(S, "BACK_TINT", S.FRONT_TINT)
    img = S.back(g, with_number=False, with_qr=False)
    monkeypatch.undo()
    return img


@needs_faces
def test_side_by_side_pair_full_run(storage, engines, monkeypatch):
    g = S.GUESTS[3]
    front = with_face(S.front(g, with_number=False), SAME)
    alike_back = _same_tint_back(g, monkeypatch)
    monkeypatch.setattr(people, "cut", S.stub_cut)
    results = make_pipeline(storage, engines).analyse([png_bytes(S.sheet([front, alike_back]))], _job(gate_action="reject"))
    print("\n", [(v["person"], v["flags"]) for v, _ in results])
    assert len(results) == 1
    v = results[0][0]
    assert v["status"] == "done" and v["person"]["evidence"] == "position" and v["person"]["pairedByPosition"]
    assert v["person"]["sides"] == ["front", "back"] and "pairedByPosition" in v["flags"] and v["person"]["lookAlike"]["alike"]
    # the usual back (another card colour) next to the same front: only a suggestion
    other = make_pipeline(storage, engines).analyse([png_bytes(S.sheet([front, S.back(g, with_number=False, with_qr=False)]))], _job())
    print("\n", [(v["person"], v["flags"]) for v, _ in other])
    assert [v["person"]["evidence"] for v, _ in other] == ["none", "none"]
    assert all("layoutSuggestsPair" in v["flags"] and not v["person"]["pairedByPosition"] for v, _ in other)
    # the front without a clear portrait: only a suggestion (and, with gate warn, kept for a person)
    bare = make_pipeline(storage, engines).analyse([png_bytes(S.sheet([S.front(g, with_number=False), alike_back]))], _job())
    assert [v["person"]["evidence"] for v, _ in bare] == ["none", "none"]


# ==== 4. HEAVY JPEG ================================================================================================================

def test_jpeg_quality_is_read_from_the_original_file():
    card = with_face(S.front(S.GUESTS[0]), SAME)
    for q in (95, 80, 60, 30, 20):
        assert abs(clarity.jpeg_quality(jpeg_bytes(card, q)) - q) <= 1, q
    assert clarity.jpeg_quality(jpeg_bytes(card, 8)) < 20
    assert clarity.jpeg_quality(png_bytes(card)) is None and clarity.jpeg_quality(b"\xff\xd8\xffnot a jpeg") is None
    assert clarity.jpeg_quality(b"") is None
    rgb = np.asarray(card)
    heavy = clarity.assess(rgb, kind="aadhaar", side="back", source_long=1000, jpeg_q=12.0)
    assert heavy["grade"] == "unclear" and "picture too compressed" in heavy["reasons"] and heavy["scores"]["jpegQuality"] == 12.0
    assert "compressed copy" in heavy["advice"]
    assert "picture too compressed" not in clarity.assess(rgb, kind="aadhaar", side="back", source_long=1000, jpeg_q=90.0)["reasons"]
    assert "jpegQuality" not in clarity.assess(rgb, kind="aadhaar", side="back", source_long=1000)["scores"]


def _resaved(img, quality: int, as_png: bool) -> bytes:
    once = Image.open(io.BytesIO(jpeg_bytes(img, quality)))
    return png_bytes(once) if as_png else jpeg_bytes(once, 95)


def test_a_hard_compressed_copy_saved_again_is_traced_in_its_pixels():
    """MJ's known limit (5 Nov 2026): a q10-q35 copy re-saved as PNG or as a q95 JPEG reads its earlier quality back."""
    card = with_face(S.front(S.GUESTS[1]), SAME)
    for q in (10, 20, 35):
        assert clarity.jpeg_quality(_resaved(card, q, True)) == q and clarity.jpeg_quality(_resaved(card, q, False)) == q, q
        assert clarity.table_quality(_resaved(card, q, False)) == 95.0
    assert clarity.traced_quality(png_bytes(card)) is None and clarity.traced_quality(jpeg_bytes(card, 92)) is None
    assert clarity.jpeg_quality(jpeg_bytes(card, 90)) == 90.0  # a clean JPEG keeps its own table's quality
    small = Image.open(io.BytesIO(jpeg_bytes(card, 20))).resize((700, 441), Image.LANCZOS)
    assert clarity.jpeg_quality(png_bytes(small)) is None  # resized after the compression: the 8 px grid is gone (a known limit)


@needs_faces
def test_a_heavy_jpeg_saved_again_as_png_is_graded_too_compressed_in_a_job(storage, engines, stubbed):
    g = S.GUESTS[0]
    sheet = S.sheet([with_face(S.front(g), SAME), S.back(g)])
    pipe = make_pipeline(storage, engines)
    resaved = pipe.analyse([_resaved(sheet, 15, True)], _job())
    cards = [c for v, _ in resaved for c in v["clarity"]["cards"]]
    assert cards and all(c["grade"] == "unclear" and "picture too compressed" in c["reasons"] for c in cards)
    assert all("unclearCard" in v["flags"] and v["needs_human_check"] for v, _ in resaved)
    clean = pipe.analyse([png_bytes(sheet)], _job())
    assert all("picture too compressed" not in c["reasons"] for v, _ in clean for c in v["clarity"]["cards"])


@needs_faces
def test_heavy_jpeg_graded_unclear_in_a_job(storage, engines, stubbed):
    g = S.GUESTS[0]
    sheet = S.sheet([with_face(S.front(g), SAME), S.back(g)])
    pipe = make_pipeline(storage, engines)
    heavy = pipe.analyse([jpeg_bytes(sheet, 15)], _job())
    print("\n", [(v["clarity"], v["flags"]) for v, _ in heavy])
    cards = [c for v, _ in heavy for c in v["clarity"]["cards"]]
    assert cards and all(c["grade"] == "unclear" and "picture too compressed" in c["reasons"] for c in cards)
    assert all("unclearCard" in v["flags"] and v["needs_human_check"] for v, _ in heavy)
    fine = pipe.analyse([jpeg_bytes(sheet, 92)], _job())
    assert all("picture too compressed" not in c["reasons"] for v, _ in fine for c in v["clarity"]["cards"])
    # the single-card path reads it from the original file too
    single, _ = pipe.analyse([jpeg_bytes(with_face(S.front(g), SAME), 15)], _job(multi=False))
    assert single["clarity"]["grade"] == "unclear" and "picture too compressed" in single["clarity"]["cards"][0]["reasons"]


# ==== a sheet of fronts and a sheet of backs laid out the same way (MJ's real scans, 5 Nov 2026) ==============================

def _two_sheets(confirm: bool, mirror: bool = False):
    """Picture 0: four fronts on a 2x2 grid; picture 1: their backs at the same places (or mirrored left-right). The first guest's
    front and back carry the same valid number when `confirm`; the others carry none (as on many real Aadhaar backs)."""
    spots = [(0, 0), (1200, 0), (0, 800), (1200, 800)]
    tints = [(236, 242, 250), (250, 236, 200), (220, 245, 225), (245, 225, 235)]
    fronts = [mk(i, "front", f"Guest {i}", f"19{80 + i}-01-0{i + 1}", N1 if (confirm and i == 0) else None, face=f"P{i}",
                 at=spots[i], picture=0, image=tinted(tints[i])) for i in range(4)]
    back_spots = [(1200 - x, y) for x, y in spots] if mirror else spots
    backs = [mk(4 + i, "back", number=N1 if (confirm and i == 0) else None, at=back_spots[i], picture=1, image=tinted(tints[i]))
             for i in range(4)]
    return fronts + backs


def test_back_sheet_pairs_by_place_only_when_a_number_confirms_the_layout(fake_faces):
    persons = people.group(_two_sheets(confirm=True))
    pairs = {tuple(c.index for c in p.cards): p for p in persons if len(p.cards) == 2}
    assert set(pairs) == {(0, 4), (1, 5), (2, 6), (3, 7)}
    assert pairs[(0, 4)].evidence == "aadhaarNumber"
    assert all(pairs[k].evidence == "position" and "pairedBySheetPosition" in pairs[k].flags for k in ((1, 5), (2, 6), (3, 7)))
    mirrored = people.group(_two_sheets(confirm=True, mirror=True))  # backs laid left-right swapped: found by the confirmed pair
    assert {tuple(c.index for c in p.cards) for p in mirrored if len(p.cards) == 2} == {(0, 4), (1, 5), (2, 6), (3, 7)}
    unconfirmed = people.group(_two_sheets(confirm=False))  # no number anywhere: the layout is not trusted, nothing pairs by place
    assert not any("pairedBySheetPosition" in p.flags for p in unconfirmed)


def test_back_sheet_place_pairing_refuses_cards_that_do_not_look_alike(fake_faces):
    cards = _two_sheets(confirm=True)
    cards[5].image = tinted((40, 40, 40))  # the back in guest 1's place is another kind of card
    persons = people.group(cards)
    assert not any({c.index for c in p.cards} == {1, 5} for p in persons)
