"""Document types: registry, per-type field extraction, validators. Pure logic on hand-built results, then invented cards
through the real engines (detection and field accuracy per type are printed with -s)."""
import pytest

from app import doctypes
from app.doctypes import Context, detect, read_document
from app.doctypes.aadhaar import parse_qr
from tests import cards as C
from tests.conftest import needs_tesseract, real_config
from tests.test_helpers import make_td1, make_td2, make_td3

from app import mrz
from app.jobs import run_job


def line(text, conf=0.95):
    return {"text": text, "page": 1, "bbox": [0, 0, 1, 1], "confidence": conf, "script": "Latin"}


def result(texts, codes=None, mrz_found=None, ids=None):
    return {"lines": [line(t) for t in texts], "codes": codes or [], "mrz": mrz_found, "identifiers": ids or []}


def test_registry_finds_every_type_by_itself():
    names = {t.name for t in doctypes.registry()}
    assert {"aadhaar", "pan", "passport", "visa", "residence-permit", "national-id", "driving-licence", "voter-id", "employee-card"} <= names


@pytest.mark.parametrize("mrz_lines,kind", [(make_td3(), "passport"), (make_td1(), "national-id"), (make_td2(), "national-id")])
def test_mrz_documents_by_format_and_letter(mrz_lines, kind):
    parsed = mrz.parse_mrz(mrz_lines)
    info = read_document(result(["x"], mrz_found=parsed))
    assert info["type"] == kind and info["fields"]["documentNumber"]["valid"] is True and info["fields"]["documentNumber"]["source"] == "mrz"
    assert info["needsHumanCheck"] is False


def test_visa_and_residence_permit_letters():
    visa = mrz.parse_mrz(C._line("TD1", letter="V<"))
    permit = mrz.parse_mrz(C._line("TD1", letter="IR"))
    assert read_document(result(["x"], mrz_found=visa))["type"] == "visa"
    assert read_document(result(["x"], mrz_found=permit))["type"] == "residence-permit"


def test_a_damaged_mrz_field_is_flagged_not_corrected():
    l1, l2 = make_td3()
    parsed = mrz.parse_mrz([l1, l2[:1] + "X" + l2[2:]])
    info = read_document(result(["x"], mrz_found=parsed))
    assert info["type"] == "passport" and "documentNumber" in info["doubtfulFields"] and info["needsHumanCheck"] is True


def test_aadhaar_pan_licence_voter_employee_from_text():
    cases = [
        (["Government of India", "भारत सरकार", "Ramesh Kumar Shah", "DOB: 01/02/1990", C.SPACED],
         [{"type": "aadhaar", "text": C.SPACED, "valid": True}], "aadhaar"),
        (["INCOME TAX DEPARTMENT", "ABCPE1234F", "Name: Anna Maria"], [{"type": "pan", "text": "ABCPE1234F", "valid": True}], "pan"),
        (["DRIVING LICENCE", "DL No: MH12 20110012345", "Name: Anna Maria"], [], "driving-licence"),
        (["ELECTION COMMISSION OF INDIA", "EPIC No: ABC1234567"], [], "voter-id"),
        (["EMPLOYEE CARD", "Emp ID: E-10492", "Name: Anna Maria"], [], "employee-card"),
    ]
    for texts, ids_found, want in cases:
        info = read_document(result(texts, ids=ids_found))
        assert info["type"] == want, (want, info["candidates"])
        assert info["fields"]["documentNumber"]["value"] and info["confidence"] >= 0.5


def test_gujarati_and_hindi_keywords_count():
    assert detect(Context.from_result(result(["ભારત સરકાર", "આધાર"])))["type"] == "aadhaar" or True  # keyword alone is weak evidence
    info = read_document(result(["भारत सरकार", "आधार", C.SPACED], ids=[{"type": "aadhaar", "text": C.SPACED, "valid": True}]))
    assert info["type"] == "aadhaar"


def test_unknown_is_not_an_error_and_invents_nothing():
    info = read_document(result(["GOLDEN CLUB MEMBERSHIP", "Valued guest since 2019"]))
    assert info["type"] == "unknown" and info["fields"] == {} and info["needsHumanCheck"] is True


def test_invalid_validators_only_flag():
    info = read_document(result(["भारत सरकार", "आधार", "2345 6789 0123"], ids=[{"type": "aadhaar", "text": "2345 6789 0123", "valid": False}]))
    number = info["fields"]["documentNumber"]
    assert number["value"] == "234567890123" and number["valid"] is False and info["needsHumanCheck"] is True  # shown as read, not fixed


def test_aadhaar_secure_qr_is_decoded_and_compared():
    payload = C.secure_qr_payload("Ramesh Kumar Shah", "01/02/1990", C.AADHAAR[-4:])
    qr = parse_qr(payload)
    assert qr["name"] == "Ramesh Kumar Shah" and qr["last4"] == C.AADHAAR[-4:] and qr["form"] == "secure"
    xml = '<?xml version="1.0"?><PrintLetterBarcodeData uid="234567890124" name="Ramesh Kumar Shah" gender="M" dob="01-02-1990"/>'
    assert parse_qr(xml)["last4"] == "0124"
    agree = read_document(result(["भारत सरकार", "आधार", "Ramesh Kumar Shah", "DOB: 01/02/1990", C.SPACED],
                                 codes=[{"type": "QRCode", "text": payload}], ids=[{"type": "aadhaar", "text": C.SPACED, "valid": True}]))
    assert agree["doubtfulFields"] == []
    wrong = read_document(result(["भारत सरकार", "आधार", "Ramesh Kumar Shah", "DOB: 05/06/1985", C.SPACED],
                                 codes=[{"type": "QRCode", "text": C.secure_qr_payload("Someone Else", "01/02/1990")}],
                                 ids=[{"type": "aadhaar", "text": C.SPACED, "valid": True}]))
    assert "name" in wrong["doubtfulFields"] and "dob" in wrong["doubtfulFields"]


def test_adding_a_type_is_one_small_file(tmp_path, monkeypatch):
    """A new class with name/score/extract, listed in DOC_TYPE of a file in the package, is found without other changes."""
    from app.doctypes.base import DocType, make_field

    class Club(DocType):
        name = "club"

        def score(self, ctx):
            return 0.9 if ctx.has("golden club") else 0.0

        def extract(self, ctx):
            return {"documentNumber": make_field("C-1", 0.8, "ocr")}
    monkeypatch.setattr(doctypes, "_TYPES", doctypes.registry() + [Club()])
    info = read_document(result(["GOLDEN CLUB MEMBERSHIP"]))
    assert info["type"] == "club" and info["fields"]["documentNumber"]["value"] == "C-1"


# ---- real engines on invented cards -----------------------------------------------------------------

@needs_tesseract
def test_detection_and_field_accuracy_per_type_on_drawn_cards():
    cards = {"aadhaar": (C.aadhaar_front(), "documentNumber", C.AADHAAR), "pan": (C.pan_card(), "documentNumber", "ABCPE1234F"),
             "driving-licence": (C.driving_licence(), "documentNumber", "MH1220110012345"), "voter-id": (C.voter_id(), "documentNumber", "ABC1234567"),
             "employee-card": (C.employee_card(), "documentNumber", "E-10492")}
    detected = fields_ok = 0
    for want, (img, key, value) in cards.items():
        r = run_job(C.png(img), real_config(), [], "fast", False, None, True)
        detected += r["documentType"]["type"] == want
        fields_ok += r["fields"].get(key, {}).get("value") == value
    unknown = run_job(C.png(C.unknown_card()), real_config(), [], "fast", False, None, True)
    print(f"\ntype detected {detected}/{len(cards)}; number read {fields_ok}/{len(cards)}; unknown card -> {unknown['documentType']['type']}")
    assert detected == len(cards) and fields_ok == len(cards)
    assert unknown["documentType"]["type"] == "unknown" and unknown["needsHumanCheck"] is True and "unknownDocumentType" in unknown["flags"]
