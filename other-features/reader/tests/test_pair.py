"""Front and back pairing. Pure logic is tested on hand-built read results; the full flow runs on invented
ID-like cards drawn in code (with a QR made from a generated payload) through the real engine when present."""
import dataclasses
import io
import json
import zipfile

import numpy as np
import pytest
import zxingcpp
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app import fields
from app.config import load_settings
from app.main import create_app
from app.pair import classify, judge, merge_fields, run_pair, stack_images, two_page_pdf
from tests.conftest import KEY, needs_tesseract, real_config
from tests.imaging import font
from tests.test_helpers import make_td3, verhoeff_append

AADHAAR = verhoeff_append("23456789012")
AADHAAR_SPACED = f"{AADHAAR[:4]} {AADHAAR[4:8]} {AADHAAR[8:]}"
OTHER_AADHAAR = verhoeff_append("98765432101")


def spaced(n):
    return f"{n[:4]} {n[4:8]} {n[8:]}"


def line(text, conf=0.95):
    return {"text": text, "page": 1, "bbox": [0, 0, 10, 10], "confidence": conf, "script": "Latin"}


def result(lines, codes=None, mrz=None, ids=None):
    return {"lines": [line(t) if isinstance(t, str) else t for t in lines], "codes": codes or [], "mrz": mrz,
            "identifiers": ids or [], "needsHumanCheck": False}


def front_result(name="Ramesh Kumar Shah", dob="01/02/1990", number=AADHAAR):
    return result([f"Name: {name}", f"DOB: {dob}", spaced(number)], ids=[{"type": "aadhaar", "text": spaced(number), "valid": True}])


def back_result(name="Ramesh Kumar Shah", dob="01/02/1990", number=AADHAAR):
    payload = f"NAME={name};DOB={dob};ID={number}"
    return result(["Address: 12 Hill Road", "Surat, Gujarat 395007"], codes=[{"type": "QRCode", "text": payload}],
                  ids=[])


# ---- pure logic --------------------------------------------------------------------------------

def test_fields_come_with_confidence_and_side():
    f = fields.extract_fields(front_result(), "front")
    assert f["name"] == {"value": "Ramesh Kumar Shah", "confidence": 0.95, "side": "front", "source": "ocr"}
    assert f["dob"]["value"] == "1990-02-01" and f["documentNumber"]["value"] == AADHAAR
    b = fields.extract_fields(back_result(), "back")
    assert b["address"]["value"].startswith("12 Hill Road") and b["name"]["source"] == "qr"


def test_same_valid_number_on_both_sides_is_a_match():
    verdict = judge(front_result(), back_result())
    assert verdict["verdict"] == "match" and {r["code"] for r in verdict["reasons"]} >= {"documentNumberMatch", "nameAndDobMatch"}


def test_different_valid_numbers_are_a_mismatch():
    verdict = judge(front_result(), back_result(number=OTHER_AADHAAR))
    assert verdict["verdict"] == "mismatch" and any(r["code"] == "documentNumberDiffers" for r in verdict["reasons"])


def test_spelling_variation_with_same_dob_and_no_number_still_matches():
    a = result(["Name: MOHAMMED ALI KHAN", "DOB: 05/06/1985"])
    b = result(["Name: Mohamed Ali Khan", "DOB: 05-06-1985"])
    verdict = judge(a, b)
    assert verdict["verdict"] == "match" and verdict["evidence"]["nameSimilarity"] >= fields.NAME_MATCH_THRESHOLD


def test_diacritics_titles_case_and_order_are_ignored():
    assert fields.name_similarity("Shri JOSÉ  Müller", "jose muller") == 1.0
    assert fields.name_similarity("Shah Ramesh Kumar", "ramesh kumar shah") == 1.0


def test_different_dob_or_name_is_a_mismatch():
    assert judge(result(["Name: Anna Maria", "DOB: 01/02/1990"]), result(["Name: Anna Maria", "DOB: 02/02/1990"]))["verdict"] == "mismatch"
    assert judge(result(["Name: Anna Maria", "DOB: 01/02/1990"]), result(["Name: Peter Zwolle", "DOB: 01/02/1990"]))["verdict"] == "mismatch"


def test_unverified_numbers_and_missing_evidence_are_unknown_not_guesses():
    bad = result(["Name: Ramesh"], ids=[{"type": "aadhaar", "text": "123456789012", "valid": False}])
    good = result(["Address: x"], ids=[{"type": "aadhaar", "text": spaced(AADHAAR), "valid": True}])
    assert judge(bad, good)["verdict"] == "unknown"
    assert judge(result(["hello"]), result(["world"]))["verdict"] == "unknown"
    assert judge(None, front_result())["verdict"] == "unknown"


def test_passport_mrz_number_on_both_sides_is_evidence():
    from app import mrz
    parsed = mrz.parse_mrz(make_td3())
    a, b = result(["x"], mrz=parsed), result(["y"], mrz=parsed)
    assert judge(a, b)["verdict"] == "match"


def test_conflicting_evidence_is_unknown():
    verdict = judge(front_result(dob="01/02/1990"), back_result(dob="09/09/1999"))  # numbers match, dates differ
    assert verdict["verdict"] == "unknown" and any(r["code"] == "conflictingEvidence" for r in verdict["reasons"])


def test_sides_are_recognised_from_content():
    assert classify(front_result())["front"] > classify(front_result())["back"]
    assert classify(back_result())["back"] > classify(back_result())["front"]


def test_merged_record_keeps_best_value_source_and_conflicts():
    merged = merge_fields(front_result(name="Ramesh Shah"), back_result(name="Ramesh K Shah"))
    assert merged["name"]["value"] in ("Ramesh Shah", "Ramesh K Shah") and merged["name"]["conflicts"]
    assert merged["address"]["side"] == "back" and merged["dob"]["side"] in ("front", "back")


# ---- merged outputs --------------------------------------------------------------------------------

def card(front=True, name="Ramesh Kumar Shah", dob="01/02/1990", number=AADHAAR, size=(1000, 630)) -> bytes:
    img = Image.new("RGB", size, (245, 245, 240))
    d = ImageDraw.Draw(img)
    f = font("segoeui.ttf", 40)
    if front:
        d.rectangle((40, 60, 280, 360), outline=(80, 80, 80), width=4)  # the photo box
        d.text((320, 70), f"Name: {name}", font=f, fill=0)
        d.text((320, 160), f"DOB: {dob}", font=f, fill=0)
        d.text((320, 250), spaced(number), font=f, fill=0)
    else:
        d.text((40, 60), "Address: 12 Hill Road", font=f, fill=0)
        d.text((40, 130), "Surat Gujarat 395007", font=f, fill=0)
        qr = np.asarray(zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, f"NAME={name};DOB={dob};ID={number}", width=300, height=300))
        qr = qr if qr.ndim == 2 else qr[..., 0]
        img.paste(Image.fromarray(qr).convert("RGB"), (600, 230))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def test_stack_has_equal_width_and_a_white_gap():
    a, b = card(True, size=(1000, 630)), card(False, size=(800, 500))
    stacked = Image.open(io.BytesIO(stack_images(a, b)))
    assert stacked.width == 1000 and stacked.height == 630 + 40 + round(500 * 1000 / 800)
    assert stacked.getpixel((500, 630 + 20)) == (255, 255, 255)


def test_two_page_pdf_has_two_pages():
    import pikepdf
    pdf = pikepdf.open(io.BytesIO(two_page_pdf(card(True), card(False))))
    assert len(pdf.pages) == 2


# the pair is judged by the QR on the Aadhaar back: the QR stays behind READER_READ_QR (off by default, MJ 5 Nov 2026), on here
CFG = dataclasses.replace(real_config(), read_qr=True)


@needs_tesseract
def test_real_flow_same_person_with_swapped_sides_and_missing_or_bad_sides():
    record, merged, _ = run_pair(card(True), card(False), CFG, [], "fast", False, "none")
    print("\nreal pair, correct order:", record["samePerson"]["verdict"], [r["code"] for r in record["samePerson"]["reasons"]],
          "merged fields", sorted(record["merged"]))
    assert record["samePerson"]["verdict"] == "match" and merged is None and record["detectedSides"] == "asLabelled"
    assert record["merged"]["address"]["side"] == "back"

    swapped, _, _ = run_pair(card(False), card(True), CFG, [], "fast", False, "none")  # caller labels them wrongly
    assert "sideLabelsContradict" in swapped["flags"] and swapped["samePerson"]["verdict"] == "match"

    different, _, _ = run_pair(card(True), card(False, number=OTHER_AADHAAR), CFG, [], "fast", False, "none")
    assert different["samePerson"]["verdict"] == "mismatch" and different["needsHumanCheck"] is True

    variant, _, _ = run_pair(card(True, name="Mohammed Ali Khan", number=AADHAAR), card(False, name="Mohamed Ali Khan", number=AADHAAR),
                             CFG, [], "fast", False, "none")
    assert variant["samePerson"]["verdict"] == "match"

    only_front, _, _ = run_pair(card(True), None, CFG, [], "fast", False, "none")
    assert only_front["samePerson"]["verdict"] == "unknown" and "sideMissingOrUnreadable" in only_front["flags"]

    broken, _, _ = run_pair(card(True), b"not an image at all", CFG, [], "fast", False, "none")
    assert broken["samePerson"]["verdict"] == "unknown" and broken["sides"]["back"]["error"]["code"] == "unsupported_type"
    assert broken["sides"]["front"]["result"]["lines"]


@needs_tesseract
def test_pair_endpoint_returns_json_or_a_zip():
    env = {"READER_KEY": KEY, "READER_EXECUTOR": "thread", "READER_TESSDATA": CFG.tessdata, "READER_READ_QR": "true"}
    with TestClient(create_app(load_settings(env))) as c:
        headers = {"X-Reader-Key": KEY}
        files = {"front": ("f.png", card(True)), "back": ("b.png", card(False))}
        assert c.post("/v1/read-pair", files=files, data={"findDocument": "false"}).status_code == 401
        r = c.post("/v1/read-pair", headers=headers, files=files, data={"findDocument": "false"})
        assert r.status_code == 200 and r.json()["samePerson"]["verdict"] == "match"
        z = c.post("/v1/read-pair", headers=headers, files=files, data={"findDocument": "false", "merge": "stack"})
        archive = zipfile.ZipFile(io.BytesIO(z.content))
        assert sorted(archive.namelist()) == ["merged.png", "record.json"]
        assert json.loads(archive.read("record.json"))["samePerson"]["verdict"] == "match"
        pdf = c.post("/v1/read-pair", headers=headers, files=files, data={"findDocument": "false", "merge": "pdf"})
        assert "merged.pdf" in zipfile.ZipFile(io.BytesIO(pdf.content)).namelist()
        assert c.post("/v1/read-pair", headers=headers, files=files, data={"merge": "zip"}).json()["error"]["code"] == "bad_option"
        assert c.post("/v1/read-pair", headers=headers, data={}).json()["error"]["code"] == "no_file"
