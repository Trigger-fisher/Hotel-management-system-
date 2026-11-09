"""MJ's decisions of 4 Nov 2026: the namesake rule (A), the photo check on every ID (B) and the clarity check per card (C).
INVENTED cards and INVENTED drawn faces only (tests/faces.py); no real ID, no real face."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from app import clarity, faces, people
from app.people import Card
from tests import faces as F
from tests import idkinds as K
from tests import sheets as S
from tests.conftest import make_pipeline
from tests.imaging import png_bytes

ROOT = Path(__file__).resolve().parents[1]
CAP = 512_000
PHOTO = (40, 190, 190, 370)  # the portrait printed 150 x 180 px inside the front's photo frame (about 15 x 18 mm at 254-300 dpi)
needs_faces = pytest.mark.skipif(not faces.available(), reason="face models missing: run scripts/get_face_models.py")
# Invented faces measured at this printed size (scripts/measure_faces.py): identities 16 and 27 are the most different pair found
# among 40 drawn faces (0.12, under the 0.15 mismatch line); identity 2's two takes are the same person (0.78).
OTHER_A, OTHER_B, SAME = 16, 27, 2


def _job(**kw) -> dict:
    return {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": CAP, "languages": None, "multi": True, **kw}


@pytest.fixture()
def stubbed(monkeypatch):
    monkeypatch.setattr(people, "cut", S.stub_cut)


def with_face(img: Image.Image, identity: int, take: int = 0, box=PHOTO) -> Image.Image:
    return Image.fromarray(F.put_photo(np.asarray(img.convert("RGB")), F.photo(F.identity(identity), take), box))


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
    return Card(index, 0, np.zeros((8, 8, 3), np.uint8), quad, 0.9, [], {"confidence": 0.9},
                {"type": kind, "fields": fields, "doubtful": [], "unknown": False}, side, keys, face=Fake(face))


N1, N2 = S.GUESTS[0].number, S.GUESTS[1].number


def test_namesakes_without_numbers_are_never_one_card(fake_faces):
    # Same name and date of birth, no readable number: two people, never a duplicate; MJ's RARE rule (4 Nov 2026) marks them rare
    # and a photo mismatch only confirms two people (no photoMismatch warning without a number).
    for a, b, flag in (("A", "B", "sameNameDobNoNumber"), (None, None, "sameNameDobNoNumber"), ("A", "A", "sameNameDobNoNumber")):
        persons = people.group([mk(0, "front", "Rohit Shah", "1985-06-05", face=a), mk(1, "front", "Rohit Shah", "1985-06-05", face=b, at=(0, 5000))])
        assert len(persons) == 2 and not any(p.duplicates for p in persons), (a, b)
        assert all(flag in p.flags and p.rare and "photoMismatch" not in p.flags for p in persons), (a, b, [p.flags for p in persons])
    # The same valid number IS one card shown twice ...
    same = people.group([mk(0, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(1, "front", "Rohit Shah", "1985-06-05", N1, face="A", at=(0, 5000))])
    assert len(same) == 1 and "duplicateCard" in same[0].flags
    # ... unless the two photos clearly differ: then a person must look.
    clash = people.group([mk(0, "front", "Rohit Shah", "1985-06-05", N1, face="A"), mk(1, "front", "Rohit Shah", "1985-06-05", N1, face="B", at=(0, 5000))])
    assert len(clash) == 2 and all("photoMismatch" in p.flags for p in clash)


def test_name_and_dob_pair_front_and_back_only_with_matching_photos_and_no_numbers(fake_faces):
    def pair(front_face, back_face, number=None):
        return people.group([mk(0, "front", "Kavita Joshi", "1990-11-02", number, face=front_face, kind="driving-licence"),
                             mk(1, "back", "Kavita Joshi", "1990-11-02", face=back_face, kind="driving-licence", at=(9000, 0))])
    ok = pair("K", "K")
    assert [p.evidence for p in ok] == ["nameAndDob"] and "pairedByNameDobAndPhoto" in ok[0].flags
    for front_face, back_face, number, flag in (("K", None, None, "sameNameDobNoNumber"), ("K", "M", None, "sameNameDobNoNumber"),
                                                ("K", "K", N1, "sameNameDobNoNumber")):
        apart = pair(front_face, back_face, number)
        assert [p.evidence for p in apart] == ["none", "none"], (front_face, back_face, number)
        assert all(flag in p.flags for p in apart), (front_face, back_face, number, [p.flags for p in apart])
    # a number match still pairs a back without a photo
    strong = people.group([mk(0, "front", "Anil Mehra", "1981-03-14", N1, face="A"), mk(1, "back", number=N1, at=(9000, 0))])
    assert [p.evidence for p in strong] == ["aadhaarNumber"]


def test_same_guest_link_needs_number_or_name_dob_and_photo(fake_faces):
    def run(aadhaar_face, pan_face):
        return people.group([mk(0, "front", "Anil Mehra", "1981-03-14", N1, face=aadhaar_face), mk(1, "back", number=N1, at=(1100, 0)),
                             mk(2, "single", "ANIL MEHRA", "1981-03-14", kind="pan", numbers={"pan": {"BQRPM4821K"}}, face=pan_face, at=(0, 5000))])
    linked = run("A", "A")
    assert linked[0].linked == [2] and linked[0].link_evidence == ["nameAndDob", "photoMatch"] and "sameGuestOtherDocument" in linked[1].flags
    maybe = run("A", None)
    assert not maybe[0].linked and maybe[0].possible == [2] and maybe[1].possible == [1] and "possibleSameGuest" in maybe[1].flags
    blocked = run("A", "B")
    assert not blocked[0].linked and not blocked[0].possible and "photoMismatch" in blocked[0].flags and "photoMismatch" in blocked[1].flags
    # A visa printing the passport's number is linked by that number alone, photos unclear; a clear photo mismatch blocks it.
    for visa_face, expect in ((None, [2]), ("B", [])):
        persons = people.group([mk(0, "front", "John Carter", "1980-01-02", kind="passport", numbers={"passport": {"Z1234567"}}, face="A"),
                                mk(1, "single", "John Carter", "1980-01-02", kind="visa", ref="Z1234567", face=visa_face, at=(0, 5000))])
        assert persons[0].linked == expect, visa_face


# ---- full runs: real OCR, real face models, invented faces ----------------------------------------------------------------

def misread(g: S.Guest) -> S.Guest:
    """The same invented guest with the number's last digit misread: printed, but its Verhoeff check fails (no valid number)."""
    return S.Guest(g.name, g.dob, g.gender, g.number[:-1] + str((int(g.number[-1]) + 1) % 10), g.address)


ROHIT_1 = S.guest("Rohit Shah", "05/06/1985", "Male", "72619384051", "S/O Amit Shah, 8 Hill Road", "Surat, Gujarat - 395003")
ROHIT_2 = S.guest("Rohit Shah", "05/06/1985", "Male", "81937462053", "S/O Kiran Shah, 21 River Road", "Navsari, Gujarat - 396445")


@needs_faces
def test_namesakes_with_unreadable_numbers_kept_apart(storage, engines, stubbed):
    # Two different invented guests, same name and date of birth, both numbers misread, different faces.
    sheet = S.sheet([with_face(S.front(misread(ROHIT_1)), OTHER_A), with_face(S.front(misread(ROHIT_2)), OTHER_B),
                     # and one guest's card shown twice with the number misread, same photo: no number, so also kept apart
                     with_face(S.front(misread(S.GUESTS[2])), SAME), with_face(S.front(misread(S.GUESTS[2])), SAME)])
    results = make_pipeline(storage, engines).analyse([png_bytes(sheet)], _job())
    print("\n", [(v["suggested_name"], v["flags"], v["photo"]["checks"]) for v, _ in results])
    assert len(results) == 4 and all(v["needs_human_check"] for v, _ in results)
    assert all(not v["person"]["duplicates"] for v, _ in results)
    assert all({"photoMismatch", "sameNameDobNoNumber"} & set(v["flags"]) for v, _ in results)
    rohit = [v for v, _ in results if v["suggested_name"] == "Rohit_Shah_Aadhaar_Rare"]  # MJ's RARE rule
    assert len(rohit) == 2 and all(v["rare"] for v in rohit)
    outcomes = {c["outcome"] for v in rohit for c in v["photo"]["checks"]}
    assert outcomes and outcomes <= {"mismatch", "unclear"}  # two different invented faces: never a match
    copies = [v for v, _ in results if v["suggested_name"] == "Suresh_Patel_Aadhaar_Rare"]
    assert len(copies) == 2 and all("sameNameDobNoNumber" in v["flags"] for v in copies)
    assert all(c["outcome"] == "match" for v in copies for c in v["photo"]["checks"])  # a match alone never makes a duplicate


@needs_faces
def test_same_person_two_documents_linked_by_name_dob_and_photo(storage, engines, stubbed):
    g = S.GUESTS[0]  # Anil Mehra, 14/03/1981 (the same invented person as idkinds.ANIL)
    pan = with_face(K.pan_old(K.ANIL, K.ANIL_PAN), SAME, take=1, box=(770, 190, 950, 410))
    sheet = S.sheet([with_face(S.front(g), SAME, take=0), S.back(g), pan])
    results = make_pipeline(storage, engines).analyse([png_bytes(sheet)], _job())
    print("\n", [(v["suggested_name"], v["person"], v["photo"]) for v, _ in results])
    by_type = {v["document_type"]["type"]: v for v, _ in results}
    assert set(by_type) == {"aadhaar", "pan"}
    aadhaar, pan_v = by_type["aadhaar"], by_type["pan"]
    assert aadhaar["person"]["evidence"] == "aadhaarNumber" and aadhaar["person"]["sides"] == ["front", "back"]
    assert aadhaar["person"]["sameGuestAs"] == [pan_v["person"]["index"]]
    assert aadhaar["person"]["guestEvidence"] == ["nameAndDob", "photoMatch"]
    assert any(c["use"] == "guest" and c["outcome"] == "match" and c["score"] >= 0.363 for c in aadhaar["photo"]["checks"])

    # The same documents with SOMEONE ELSE's photo on the PAN: never linked; a suggestion or a mismatch for a person to check.
    other = with_face(K.pan_old(K.ANIL, K.ANIL_PAN), OTHER_A, box=(770, 190, 950, 410))
    sheet = S.sheet([with_face(S.front(g), OTHER_B), S.back(g), other])
    results = make_pipeline(storage, engines).analyse([png_bytes(sheet)], _job())
    print("\n", [(v["suggested_name"], v["person"], v["flags"], v["photo"]["checks"]) for v, _ in results])
    assert all(not v["person"]["sameGuestAs"] for v, _ in results)
    assert all({"possibleSameGuest", "photoMismatch"} & set(v["flags"]) and v["needs_human_check"] for v, _ in results)


# ---- clarity -------------------------------------------------------------------------------------------------------------

def _glare(img: Image.Image, box) -> Image.Image:
    arr = np.asarray(img.convert("RGB")).astype(np.float32)
    mask = np.zeros(arr.shape[:2], np.float32)
    cv2.ellipse(mask, ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), ((box[2] - box[0]) // 2, (box[3] - box[1]) // 2), 0, 0, 360, 1.0, -1)
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 8) * 1.3, 0, 1)[..., None]
    return Image.fromarray(np.clip(arr * (1 - mask) + 255 * mask, 0, 255).astype(np.uint8))


def test_clarity_grades_degraded_cards_in_a_job(storage, engines, stubbed):
    g = S.GUESTS
    clean = with_face(S.front(g[0]), SAME)
    blurred = Image.fromarray(cv2.GaussianBlur(np.asarray(with_face(S.front(g[1]), OTHER_A)), (0, 0), 3.0))
    glared = _glare(with_face(S.front(g[2]), OTHER_B), (250, 455, 760, 545))  # a lamp's reflection over the number line
    results = make_pipeline(storage, engines).analyse([png_bytes(S.sheet([clean, blurred, glared], columns=3))], _job())
    by_card = {v["person"]["cards"][0]: v for v, _ in results}
    for n, v in sorted(by_card.items()):
        print(f"\ncard {n}: {v['clarity']} {v['flags']}")
    assert by_card[1]["clarity"]["grade"] in ("clear", "usable") and "unclearCard" not in by_card[1]["flags"]
    for n, reason in ((2, "blurred"), (3, "glare")):
        c = by_card[n]["clarity"]
        assert c["grade"] == "unclear" and any(reason in r for r in c["cards"][0]["reasons"]), c
        # the whole card blurred blurs its portrait too: MJ's photo rule puts its retake line first (gate warn: kept for a person)
        assert "Retake this card" in c["advice"] and "unclearCard" in by_card[n]["flags"] and by_card[n]["needs_human_check"]
    # a key field read from the blurred card is flagged
    if "documentNumber" in by_card[2]["fields"] or "name" in by_card[2]["fields"]:
        assert "keyFieldUnclear" in by_card[2]["flags"] and by_card[2]["clarity"]["unclearFields"]


def test_clarity_on_the_single_card_path(storage, engines):
    blurred = cv2.GaussianBlur(np.asarray(with_face(S.front(S.GUESTS[0]), SAME)), (0, 0), 3.0)
    values, _ = make_pipeline(storage, engines).analyse([png_bytes(Image.fromarray(blurred))], _job(multi=False))
    assert values["clarity"]["grade"] == "unclear" and values["needs_human_check"] and "unclearCard" in values["flags"]
    assert values["clarity"]["cards"][0]["reasons"] and "photo" in values


def test_calibration_confusion_table():
    """The degraded invented cards are caught and no clean one is called unclear (a share of the full calibration set)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import calibrate_clarity
    out = calibrate_clarity.run(limit=10)
    t = out["table"]
    print("\n", t, out["misses"])
    assert t["clear"]["unclear"] == 0
    assert t["degraded"]["unclear"] >= 0.95 * sum(t["degraded"].values())


def test_thresholds_follow_the_environment(monkeypatch):
    from app import thresholds
    monkeypatch.setenv("CLARITY_DPI_UNCLEAR", "140")
    monkeypatch.setenv("FACE_MISMATCH_BELOW", "oops")
    assert thresholds.get("CLARITY_DPI_UNCLEAR") == 140 and thresholds.get("FACE_MISMATCH_BELOW") == 0.15
    small = cv2.resize(np.asarray(S.front(S.GUESTS[0])), (500, 315))
    assert any("card too small" in r for r in clarity.assess(small, kind="aadhaar", side="front", source_long=430)["reasons"])


# ---- privacy: no face embedding written anywhere ----------------------------------------------------------------------------

@needs_faces
def test_no_embedding_is_written_anywhere(tmp_path, monkeypatch, capsys, log_lines):
    """Run the folder runner on an invented sheet, then scan every file it wrote (pictures, report.csv, report.html), the console
    and the logs for the face embeddings of the cards (as raw float32 / float64 bytes and as printed numbers)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import run_folder
    monkeypatch.setattr(people, "cut", S.stub_cut)
    g = S.GUESTS
    sheet = S.sheet([with_face(S.front(g[0]), SAME), S.back(g[0]), with_face(S.front(g[1], with_number=False), OTHER_A),
                     with_face(S.front(g[1], with_number=False), OTHER_B)])
    src, out = tmp_path / "in", tmp_path / "out"
    src.mkdir()
    (src / "sheet.png").write_bytes(png_bytes(sheet))
    # the embeddings this sheet produces (to search for them)
    vectors = []
    for c in S.stub_cut(np.asarray(sheet)):
        p = faces.find_portrait(cv2.cvtColor(c.image, cv2.COLOR_BGR2RGB))
        if p.feature is not None:
            vectors.append(p.feature.ravel())
    assert len(vectors) >= 2
    monkeypatch.setattr(sys, "argv", ["run_folder.py", "--in", str(src), "--out", str(out), "--multi", "on", "--gate", "warn"])
    assert run_folder.main() == 0
    console = capsys.readouterr().out + log_lines.getvalue()
    written = sorted(p for p in out.rglob("*") if p.is_file())
    assert {p.suffix for p in written} <= {".jpg", ".png", ".webp", ".csv", ".html"}
    blobs = [p.read_bytes() for p in written] + [console.encode()]
    found = []
    for v in vectors:
        for dtype in ("<f4", "<f8"):  # every run of 8 consecutive values, as raw bytes
            raw, step = v.astype(dtype).tobytes(), np.dtype(dtype).itemsize * 8
            if any(raw[i:i + step] in b for i in range(0, len(raw) - step + 1, step) for b in blobs):
                found.append(dtype)
        texts = [f"{x:.3f}" for x in v[:8]]
        if any(all(t in b.decode("latin-1") for t in texts) for b in blobs):
            found.append("text")
    report = (out / "report.csv").read_text(encoding="utf-8").replace(str(src), "<in>")  # the test's own folder name says "embedding"
    long_runs = re.findall(r"(?:-?\d+\.\d+[ ,;]+){16,}", report + console)
    print(f"\n{len(written)} files scanned ({', '.join(p.name.split('.')[-1] for p in written)}), console and logs: "
          f"{len(vectors)} embeddings searched, hits {found}, number runs {len(long_runs)}")
    assert not found and not long_runs
    assert "embedding" not in report.lower() and "feature" not in report.lower()
    assert "card 1" in report and ("clear" in report or "usable" in report)  # the clarity columns are there


@needs_faces
def test_job_result_holds_outcomes_only(storage, engines, stubbed):
    sheet = S.sheet([with_face(S.front(S.GUESTS[0]), SAME), S.back(S.GUESTS[0])])
    results = make_pipeline(storage, engines).analyse([png_bytes(sheet)], _job())
    text = json.dumps([v for v, _ in results], default=str)
    numbers = re.findall(r"-?\d+\.\d+", text)
    assert not re.search(r"(?:-?\d+\.\d+, ){32,}", text), "a long list of numbers in the job result"
    assert "feature" not in text and "embedding" not in text and len(numbers) < 400
    portraits = results[0][0]["photo"]["portraits"]
    assert portraits and all(set(p) <= {"card", "side", "status", "reasons", "quality"} for p in portraits)
