"""Many cards in one job -> one picture per person (front over back, under 500 KB, named FirstName_LastName_IdName).
Invented people on invented sheets only; the cutter is stubbed (tests/sheets.stub_cut)."""
import io
import time

import numpy as np
import pytest
from PIL import Image

from app import naming, people
from app.people import Card
from tests import sheets as S
from tests.conftest import make_pipeline
from tests.imaging import png_bytes

CAP = 512_000


def _job(**kw) -> dict:
    return {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": CAP, "languages": None, "multi": True, **kw}


@pytest.fixture()
def stubbed(monkeypatch):
    monkeypatch.setattr(people, "cut", S.stub_cut)


def _by_name(results) -> dict:
    return {v["suggested_name"]: (v, b) for v, b in results}


# ---- full runs (real OCR) ----------------------------------------------------------------------------------------------

def test_two_sheets_five_people_five_pictures(storage, engines, stubbed):
    g = S.GUESTS
    sheet1 = S.sheet([S.front(g[0]), S.front(g[1]), S.front(g[2]), S.back(g[3], with_qr=False), S.back(g[4], with_number=False), S.back(g[0])])
    sheet2 = S.sheet([S.front(g[3]), S.front(g[4]), S.back(g[1]), S.back(g[2])])
    pipe = make_pipeline(storage, engines, read_qr=True)  # Farhan's back carries only a QR: the QR code behind INTAKE_READ_QR
    started = time.perf_counter()
    results = pipe.analyse([png_bytes(sheet1), png_bytes(sheet2)], _job())
    seconds = time.perf_counter() - started
    found = _by_name(results)
    print(f"\n{len(results)} people from 10 cards in {seconds:.1f} s:",
          [(v["suggested_name"], v["person"]["evidence"], v["result_bytes"], v["scores"]["format"]) for v, _ in results])
    assert len(results) == 5
    assert set(found) == {"Anil_Mehra_Aadhaar", "Kavita_Joshi_Aadhaar", "Suresh_Patel_Aadhaar", "Meena_Desai_Aadhaar", "Farhan_Qureshi_Aadhaar"}
    for (values, blob), guest in zip((found[n] for n in ("Anil_Mehra_Aadhaar", "Kavita_Joshi_Aadhaar", "Suresh_Patel_Aadhaar",
                                                          "Meena_Desai_Aadhaar", "Farhan_Qureshi_Aadhaar")), g):
        p = values["person"]
        assert p["sides"] == ["front", "back"] and len(p["cards"]) == 2
        assert values["result_bytes"] == len(blob) <= CAP
        assert values["fields"]["documentNumber"]["value"] == guest.number
        assert "Address" not in values["fields"]["address"]["value"] and guest.address[1].split(",")[0] in values["fields"]["address"]["value"]
        assert values["fields"]["gender"]["value"] == guest.gender
        assert "unpairedSide" not in values["flags"] and "pairedByLayoutOnly" not in values["flags"]
        img = np.asarray(Image.open(io.BytesIO(blob)).convert("RGB")).astype(int)
        h, w = img.shape[:2]
        assert w == S.CARD[0] and abs(h - (2 * S.CARD[1] + 40)) <= 2  # same width, front over back, the white gap
        assert img[5:60, :, 2].mean() < 140 and img[5:60, :, 0].mean() > 200  # the front's orange band on top
        assert img[S.CARD[1] + 10:S.CARD[1] + 30].mean() > 250  # white gap, no border
        assert img[S.CARD[1] + 45:S.CARD[1] + 95, :, 1].mean() < 120  # the back's red band below
    assert found["Meena_Desai_Aadhaar"][0]["person"]["evidence"] == "aadhaarNumber"  # back without QR: the number
    assert found["Farhan_Qureshi_Aadhaar"][0]["person"]["evidence"] == "qrNameDob"  # back without number: its QR
    assert all(v["person"]["evidence"] == "aadhaarNumber" for n, (v, _) in found.items() if n not in ("Farhan_Qureshi_Aadhaar",))


def test_lonely_front_duplicate_and_namesakes(storage, engines, stubbed):
    a, b = S.GUESTS[0], S.GUESTS[1]
    x1 = S.guest("Rohit Shah", "05/06/1985", "Male", "72619384051", "S/O Amit Shah, 8 Hill Road", "Surat, Gujarat - 395003")
    x2 = S.guest("Rohit Shah", "05/06/1985", "Male", "81937462053", "S/O Kiran Shah, 21 River Road", "Navsari, Gujarat - 396445")
    cards = [S.front(a), S.front(a), S.back(a), S.front(b), S.front(x1), S.back(x1), S.front(x2), S.back(x2)]
    pipe = make_pipeline(storage, engines)
    results = pipe.analyse([png_bytes(S.sheet(cards))], _job())
    print("\n", [(v["suggested_name"], v["person"], v["flags"]) for v, _ in results])
    assert len(results) == 4
    one, lonely, r1, r2 = (v for v, _ in results)
    assert one["suggested_name"] == "Anil_Mehra_Aadhaar" and "duplicateCard" in one["flags"] and len(one["person"]["duplicates"]) == 1
    assert one["person"]["sides"] == ["front", "back"]
    assert lonely["suggested_name"] == "Kavita_Joshi_Aadhaar" and lonely["person"]["cards"] == [4]
    assert "unpairedSide" in lonely["flags"] and lonely["needs_human_check"]
    # Same name and date of birth, different valid numbers: two people, each front with its own back.
    assert r1["suggested_name"] == r2["suggested_name"] == "Rohit_Shah_Aadhaar_Rare"  # MJ's RARE rule: same full name and DOB
    assert r1["rare"] and r2["rare"] and not one["rare"]
    assert r1["person"]["cards"] == [5, 6] and r2["person"]["cards"] == [7, 8]
    assert r1["fields"]["documentNumber"]["value"] == x1.number and r2["fields"]["documentNumber"]["value"] == x2.number
    assert all(v["result_bytes"] <= CAP for v, _ in results)


def test_auto_switch_and_single_card_path_unchanged(storage, engines):
    """MJ, 5 Nov 2026: every ID photo takes the card path (one card or many); `multi: false` and other profiles read the page."""
    pipe = make_pipeline(storage, engines)
    from app.resave import resave
    sheet = resave(png_bytes(S.sheet([S.front(S.GUESTS[0]), S.back(S.GUESTS[0])])))
    single = resave(png_bytes(S.front(S.GUESTS[0])))
    assert pipe.is_multi(sheet, {"profile": "id-card"}) and pipe.is_multi(single, {"profile": "id-card"})
    assert not pipe.is_multi(sheet, {"profile": "id-card", "multi": False}) and not pipe.is_multi(single, {"profile": "document"})


# ---- grouping rules on cards with known contents (no OCR) ---------------------------------------------------------------

def card(index: int, side: str, name=None, dob=None, aadhaar=None, qr=(), address=None, picture=0, at=(0, 0), conf=0.9) -> Card:
    x, y = at
    quad = np.array([[x, y], [x + 1000, y], [x + 1000, y + 630], [x, y + 630]], np.float32)
    keys = {"numbers": {"aadhaar": {aadhaar}} if aadhaar else {}, "qr": list(qr), "name": name, "dob": dob, "address": address,
            "gender": None, "text": ""}
    fields = {k: {"value": v, "confidence": 0.9, "source": "ocr"} for k, v in (("name", name), ("dob", dob), ("address", address)) if v}
    return Card(index, picture, np.zeros((8, 8, 3), np.uint8), quad, 0.9, [], {"confidence": conf},
                {"type": "aadhaar", "fields": fields, "doubtful": [], "unknown": False}, side, keys)


N1, N2 = S.GUESTS[0].number, S.GUESTS[1].number


def test_pairs_need_content_and_are_never_forced():
    persons = people.group([card(0, "front", "Anil Mehra", "1981-03-14", N1), card(1, "back", aadhaar=N2, address="x", at=(5000, 0)),
                            card(2, "front", "Kavita Joshi", "1990-11-02", at=(0, 5000)), card(3, "back", aadhaar=N1, address="y", at=(5000, 5000))])
    assert [(p.evidence, [c.index for c in p.cards]) for p in persons] == [("aadhaarNumber", [0, 3]), ("none", [1]), ("none", [2])]
    assert all("unpairedSide" in p.flags for p in persons[1:])


def test_layout_only_suggests_a_pair():
    # MJ's rule (4 Nov 2026): the nearest card of the other side is a suggestion for reception, never a pair on its own.
    alone = people.group([card(0, "front", "Anil Mehra", "1981-03-14"), card(1, "back", address="12 Lake View Road", at=(1100, 0))])
    assert [p.evidence for p in alone] == ["none", "none"]
    assert all("layoutSuggestsPair" in p.flags and "unpairedSide" in p.flags for p in alone)
    assert [p.suggested for p in alone] == [[2], [1]]
    # Two backs equally near the front: no suggestion.
    crowd = people.group([card(0, "front", "Anil Mehra", "1981-03-14", at=(1100, 0)), card(1, "back", address="a", at=(0, 0)),
                          card(2, "back", address="b", at=(2200, 0))])
    assert [p.evidence for p in crowd] == ["none", "none", "none"] and not any(p.suggested for p in crowd)
    # Different pictures: layout means nothing.
    apart = people.group([card(0, "front", "Anil Mehra", "1981-03-14"), card(1, "back", address="a", picture=1, at=(1100, 0))])
    assert [p.evidence for p in apart] == ["none", "none"] and not any(p.suggested for p in apart)


def test_qr_name_dob_and_name_dob_evidence_and_conflicts():
    qr = {"name": "Anil Mehra", "dob": "1981-03-14", "last4": N1[-4:]}
    # The QR's number tail is found on the front: a strong QR match.
    persons = people.group([card(0, "front", "Anil Mehra", "1981-03-14", N1), card(1, "back", qr=[qr], address="a", at=(9000, 9000))])
    assert persons[0].evidence == "qrNameDob"
    # The front's number cannot be read: the QR's name and date of birth alone no longer pair (MJ's namesake rule).
    unread = people.group([card(0, "front", "Anil Mehra", "1981-03-14"), card(1, "back", qr=[qr], address="a", at=(9000, 9000))])
    assert [p.evidence for p in unread] == ["none", "none"] and all("sameNameDobNoNumber" in p.flags for p in unread)
    other_dob = people.group([card(0, "front", "Anil Mehra", "1981-03-14"),
                              card(1, "back", qr=[{**qr, "dob": "1982-03-14"}], address="a", at=(9000, 9000))])
    assert [p.evidence for p in other_dob] == ["none", "none"]
    # Same name, two different valid numbers: never the same person, even with a matching QR name and date of birth.
    clash = people.group([card(0, "front", "Anil Mehra", "1981-03-14", N1), card(1, "back", aadhaar=N2, qr=[qr], at=(1100, 0))])
    assert [p.evidence for p in clash] == ["none", "none"]
    # The QR's last four digits tell two namesakes apart.
    told = people.group([card(0, "front", "Anil Mehra", "1981-03-14", N1), card(1, "front", "Anil Mehra", "1981-03-14", N2, at=(0, 5000)),
                         card(2, "back", qr=[qr], at=(9000, 0))])
    assert [(p.evidence, [c.index for c in p.cards]) for p in told] == [("qrNameDob", [0, 2]), ("none", [1])]
    # Without the last four digits the QR is only a name and date of birth: nothing paired, every card flagged for a person.
    tie = people.group([card(0, "front", "Anil Mehra", "1981-03-14", N1), card(1, "front", "Anil Mehra", "1981-03-14", N2, at=(0, 5000)),
                        card(2, "back", qr=[{**qr, "last4": None}], at=(9000, 0))])
    assert [p.evidence for p in tie] == ["none"] * 3 and all("sameNameDobNoNumber" in p.flags for p in tie)


def test_duplicates_are_kept_once():
    persons = people.group([card(0, "front", "Anil Mehra", "1981-03-14", N1, conf=0.7), card(1, "front", "Anil Mehra", "1981-03-14", N1, conf=0.95),
                            card(2, "back", aadhaar=N1, address="a", at=(5000, 0))])
    assert len(persons) == 1 and "duplicateCard" in persons[0].flags
    assert [c.index for c in persons[0].cards] == [1, 2] and [d.index for d in persons[0].duplicates] == [0]


def test_naming():
    taken: set[str] = set()
    stem = naming.stem({"name": {"value": "rajiv  kumar SHETH"}}, "aadhaar")
    assert stem == "Rajiv_Sheth_Aadhaar"
    assert naming.unique(stem, "jpg", taken) == "Rajiv_Sheth_Aadhaar.jpg" and naming.unique(stem, "jpg", taken) == "Rajiv_Sheth_Aadhaar_2.jpg"
    assert naming.stem({}, "driving-licence") == "Unknown_DrivingLicence"
    assert naming.stem({"name": {"value": 'A:B* "C"? <D>|'}}, "pan") == "AB_D_PAN"
    assert naming.stem({"name": {"value": "Con"}}, "unknown") == "Con_Document"
