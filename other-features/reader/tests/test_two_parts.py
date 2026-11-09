"""The reader in two parts (5 Nov 2026, the intake worker's split copied): picture=later answers the form at once, without the
model and without a picture; GET /v1/picture/{token} gives the picture and what the background read differently, which never
changes a value. QR codes are off unless READER_READ_QR=true. Invented cards only."""
import dataclasses
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import twoparts
from app.config import load_settings
from app.engines.base import Osd
from app.main import create_app
from app.multi import read_sheet
from app.reader import ReadOptions, Reader
from tests import cards as C
from tests import sheets as S
from tests.conftest import KEY, needs_tesseract, real_config, real_engines
from tests.fake_engine import FakeEngine, line

ENV = {"READER_KEY": KEY, "READER_EXECUTOR": "thread"}
AUTH = {"X-Reader-Key": KEY}


def png(img) -> bytes:
    buf = io.BytesIO()
    (img if isinstance(img, Image.Image) else Image.fromarray(img)).save(buf, "PNG")
    return buf.getvalue()


def test_qr_codes_are_off_by_default_and_read_when_switched_on():
    page = Image.new("RGB", (700, 500), "white")
    page.paste(C.qr_image("INVENTED QR 12345", 300), (200, 100))
    engine = FakeEngine({"Latin": [line("Invented page", 20)]}, osd=Osd(0, "Latin", 1))
    assert load_settings(ENV).worker.read_qr is False
    assert load_settings({**ENV, "READER_READ_QR": "true"}).worker.read_qr is True
    opts = ReadOptions(find_document=False)
    off = Reader([engine], load_settings(ENV).worker).read_image(png(page), opts)
    on = Reader([engine], dataclasses.replace(load_settings(ENV).worker, read_qr=True)).read_image(png(page), opts)
    assert off["codes"] == [] and on["codes"] and on["codes"][0]["text"] == "INVENTED QR 12345"


def test_pillow_bomb_guard_stays_on():
    assert Image.MAX_IMAGE_PIXELS is not None and Image.MAX_IMAGE_PIXELS <= real_config().max_pixels


def test_picture_later_answers_first_then_gives_the_picture_once():
    engine = FakeEngine({"Latin": [line("Invented Card", 20)]}, osd=Osd(0, "Latin", 1))
    sheet = png(np.ascontiguousarray(S.sleeved_sheet([S.front(S.GUESTS[0]), S.front(S.GUESTS[1])], seed=5, cut_last=False)[0][..., ::-1]))
    with TestClient(create_app(load_settings(ENV), engines=[engine])) as c:
        bad = c.post("/v1/read", headers=AUTH, files={"file": ("s.png", sheet)}, data={"picture": "later", "multi": "true"})
        assert bad.status_code == 400 and bad.json()["error"]["code"] == "bad_option"  # kind=id is needed
        r = c.post("/v1/read", headers=AUTH, files={"file": ("s.png", sheet)},
                   data={"kind": "id", "multi": "true", "picture": "later", "merge": "stack"})
        fast = r.json()
        assert r.status_code == 200 and fast["picture"]["status"] == "saving" and fast["cards"] == 2
        assert all("image" not in p for p in fast["people"])  # the fast answer carries no picture
        assert all("quickFinder" in reg["flags"] for reg in fast["regions"])  # cut without the model
        token = fast["picture"]["token"]
        assert c.get(f"/v1/picture/{token}").status_code == 401  # the key is needed
        done = c.get(f"/v1/picture/{token}", headers=AUTH, params={"wait": 120}).json()
        assert done["status"] == "done" and len(done["people"]) >= len(fast["people"])
        assert all(p["image"] for p in done["people"] if p.get("status") == "done")
        assert c.get(f"/v1/picture/{token}", headers=AUTH).status_code == 404  # given once, then dropped


def test_without_picture_later_the_api_is_unchanged():
    engine = FakeEngine({"Latin": [line("Invented Card", 20)]}, osd=Osd(0, "Latin", 1))
    with TestClient(create_app(load_settings(ENV), engines=[engine])) as c:
        r = c.post("/v1/read", headers=AUTH, files={"file": ("s.png", png(S.sheet([S.front(S.GUESTS[0])])))},
                   data={"kind": "id", "multi": "true", "merge": "stack"}).json()
        assert "picture" not in r and r["people"] and r["people"][0]["image"]


def _person(pid, regions, **fields):
    return {"personId": pid, "regions": regions, "status": "accepted", "documentType": {"type": "aadhaar"},
            "fields": {k: {"value": v} for k, v in fields.items()}, "needsHumanCheck": False}


def _region(rid, x):
    return {"regionId": rid, "quad": [[x, 0], [x + 856, 0], [x + 856, 540], [x, 540]], "rotationApplied": 0}


def test_the_background_flags_a_difference_and_never_changes_a_value():
    img = np.full((600, 3000, 3), 250, np.uint8)
    fast = {"cards": 2, "regions": [_region(1, 0), _region(2, 1000)],
            "people": [_person(1, [1], name="Anil Mehra", dob="1981-03-14"), _person(2, [2], name="Kavita Joshi")]}
    shifted = _region(1, 30)  # the model cut the first card a little differently: the same card, linked by overlap
    full = {"cards": 3, "regions": [shifted, _region(2, 1000), _region(3, 2000)],
            "people": [{**_person(1, [1], name="Anil Mehra", dob="1981-03-15"), "image": "QQ==", "imageFormat": "png"},
                       {**_person(2, [2], name="Kavita Joshi"), "image": "Qg==", "imageFormat": "png"},
                       {**_person(3, [3], name="Farhan Qureshi"), "image": "Qw==", "imageFormat": "png"}]}
    out = twoparts.compare_sheet(fast, full, img)
    first, second, extra = out["people"]
    assert first["personId"] == 1 and first["image"] == "QQ==" and {"code": "field", "field": "dob"} in first["disagreements"]
    assert "value" not in str(first["disagreements"]) and "1981-03-15" not in str(first)  # names of fields only, no values
    assert first["needsHumanCheck"] and "backgroundDisagrees" in first["flags"]
    assert {d["code"] for d in second["disagreements"]} == {"cards", "people"}
    assert extra["backgroundOnly"] and extra["personId"] is None and extra["fields"]["name"]["value"] == "Farhan Qureshi"
    assert fast["people"][0]["fields"]["dob"]["value"] == "1981-03-14"  # the fast answer is never changed


def test_a_person_the_model_cut_differently_keeps_its_own_picture():
    img = np.full((600, 1000, 3), 200, np.uint8)
    fast = {"cards": 1, "regions": [_region(1, 0)], "people": [_person(1, [1], name="Anil Mehra")]}
    out = twoparts.compare_sheet(fast, {"cards": 0, "regions": [], "people": []}, img)
    person = out["people"][0]
    assert {"code": "unmatched"} in person["disagreements"] and person["image"]  # stored from the fast part's own cut


@needs_tesseract
def test_a_sheet_of_ten_cards_gives_every_guest_in_the_fast_part():
    art = [x for i in range(5) for x in (S.front(S.GUESTS[i]), S.back(S.GUESTS[i]))]
    img, _ = S.sleeved_sheet(art, seed=5, cut_last=False)
    reader = Reader(real_engines(), real_config())
    fast = read_sheet(reader, png(img[..., ::-1]), ReadOptions(languages=["en", "hi", "gu"]), 12, quick=True)
    names = sorted((p["fields"].get("name") or {}).get("value", "") for p in fast["people"])
    assert names == sorted(g.name for g in S.GUESTS) and fast["cards"] >= 9
    assert all("image" not in p for p in fast["people"])


@pytest.mark.parametrize("found", [True, False])
def test_a_single_id_is_matched_by_number_then_name(found):
    fast = {"fields": {"documentNumber": {"value": "ABCPE1234F"}, "name": {"value": "Ramesh Shah"}}, "needsHumanCheck": False}
    theirs = {"documentNumber": {"value": "ABCPE1234F" if found else "XYZ"}, "name": {"value": "Ramesh Shah" if found else "Other"}}
    out = twoparts.compare_single(fast, {"cards": 1, "people": [{"status": "accepted", "fields": theirs, "image": "QQ=="}]})
    person = out["people"][0]
    assert (person["image"] == "QQ==" and not person["disagreements"]) if found else (person["image"] is None and
                                                                                     person["disagreements"] == [{"code": "unmatched"}])
