"""More ID kinds: Aadhaar (old laminated, PVC with secure QR, e-Aadhaar letter), PAN (old, new with QR), driving licence (smart card,
old state format), voter ID, Indian passport (data page + address page), foreign passport, visa (MRV-A/B), ID cards (TD1/TD2),
OCI, employee card, unknown card. INVENTED drawings and numbers only (tests/idkinds.py); the cutter is stubbed (tests/sheets.stub_cut).

Part 1 runs without OCR (validators, MRZ, detection and fields from text, grouping and linking rules, names).
Part 2 runs the real OCR: every kind read alone, then mixed sheets of several kinds and people through Pipeline.analyse."""
from __future__ import annotations

import io
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from PIL import Image

from app import naming, people
from app.pipeline import Deps, Pipeline
from app.readcore import ids, mrz
from tests import idkinds as K
from tests import sheets as S
from tests.conftest import make_pipeline, settings
from tests.imaging import png_bytes

CAP = 512_000


# ---- helpers ----------------------------------------------------------------------------------------------------------------

def fake(lines: list[str], codes: tuple[str, ...] = ()) -> dict:
    """A reader result built from text, the way reader.assemble builds it (no OCR)."""
    return {"lines": [{"text": t, "confidence": 0.95} for t in lines], "codes": [{"text": c, "format": "QRCode"} for c in codes],
            "mrz": mrz.parse_mrz(lines), "identifiers": ids.find_identifiers("\n".join(lines)), "confidence": 0.95, "flags": []}


DOC = Pipeline(Deps(settings(), []))  # .document() needs no engine


def read(lines, codes=()) -> tuple[dict, dict]:
    result = fake(lines, codes)
    return result, DOC.document(result, {})


def mk(index: int, lines: list[str], codes=(), at=(0, 0), picture=0) -> people.Card:
    result, doc = read(lines, codes)
    x, y = at
    quad = np.array([[x, y], [x + 1000, y], [x + 1000, y + 630], [x, y + 630]], np.float32)
    card = people.Card(index, picture, np.zeros((8, 8, 3), np.uint8), quad, 0.9, [], result, doc)
    card.keys = people.keys_of(result, doc)
    card.side = people.side_of(card.keys)
    return card


def summary(persons) -> list[tuple]:
    return [(people.document_type(p)["type"], [c.index for c in p.cards], p.evidence, sorted(p.flags), p.guest, p.linked)
            for p in persons]


A, KV, SU, ME, FA = K.ANIL, K.KAVITA, K.SURESH, K.MEENA, K.FARHAN

# text as it would be read from each kind (the same invented content as the drawings)
T = {
    "aadhaar_front": ["Government of India", A.name, f"DOB: {A.dob}", "Male", A.spaced],
    "aadhaar_back": ["Unique Identification Authority of India", f"Address: {A.street}", A.city, A.spaced],
    "e_aadhaar": ["Unique Identification Authority of India", "Enrolment No.: 1234/56789/01234", "To", ME.name, ME.street, ME.city,
                  "Your Aadhaar No. :", ME.spaced, f"VID : {K.MEENA_VID[:4]} {K.MEENA_VID[4:8]} {K.MEENA_VID[8:12]} {K.MEENA_VID[12:]}",
                  "Government of India", ME.name, f"DOB: {ME.dob}", "Female", ME.spaced, f"Address: {ME.street}", ME.city],
    "pan_old": ["INCOME TAX DEPARTMENT", "GOVT. OF INDIA", A.name.upper(), A.father.upper(), A.dob, "Permanent Account Number", K.ANIL_PAN],
    "pan_new": ["INCOME TAX DEPARTMENT", "Permanent Account Number Card", K.ANIL_PAN, "नाम / Name", "ANILMEHRA",
                "पिता का नाम / Father's Name", A.father.upper(), "जन्म की तारीख / Date of Birth", A.dob],
    "dl_front": ["INDIAN UNION DRIVING LICENCE", "Issued by Government of Gujarat", f"DL No: {K.KAVITA_DL}", f"Name: {KV.name}",
                 f"DOB: {KV.dob}", f"S/D/W of: {KV.father}", f"Address: {KV.street}", KV.city, "Date of Issue: 15/06/2019",
                 "Valid Till: 01/11/2040"],
    "dl_back": ["INDIAN UNION DRIVING LICENCE", f"DL No: {K.KAVITA_DL}", "Class of Vehicle Date of Issue", "MCWG 15/06/2019",
                "LMV 15/06/2019", "Licensing Authority: RTO Ahmedabad"],
    "dl_old_front": ["MAHARASHTRA STATE", "DRIVING LICENCE FORM 7", f"Licence No: {K.MEENA_DL_OLD}", f"Name: {ME.name}",
                     f"S/D/W of: {ME.father}", f"Date of Birth: {ME.dob}", "Valid Till: 08/05/2028"],
    "dl_old_back": ["Transport Department", f"Licence No: {K.MEENA_DL_OLD}", f"Address: {ME.street}", ME.city,
                    "Class of Vehicle: LMV MCWG", "Date of Issue: 10/04/2008"],
    "voter_front": ["ELECTION COMMISSION OF INDIA", "ELECTOR PHOTO IDENTITY CARD", K.KAVITA_EPIC, "Elector's Name: KavitaJoshi",
                    f"Father's Name: {KV.father}"],
    "voter_back": [K.KAVITA_EPIC, f"Sex: {KV.gender}", f"Date of Birth: {KV.dob}", f"Address: {KV.street}", KV.city,
                   "Electoral Registration Officer"],
    "passport_printed": ["REPUBLIC OF INDIA", "Type / Country Code", "P IND", "Passport No. / पासपोर्ट नं.", K.SURESH_PASSPORT,
                         "Surname / उपनाम", "PATEL", "Given Name(s) / दिया गया नाम", "SURESH", "Nationality / राष्ट्रीयता", "INDIAN",
                         "Date of Birth / जन्मतिथि", SU.dob, "Date of Expiry", "11/03/2032"],
    "passport_address": [f"Passport No.: {K.SURESH_PASSPORT}", "Name of Father / Legal Guardian", SU.father.upper(), "Name of Mother",
                         "SAROJ PATEL", "Address", SU.street.upper(), SU.city.upper(), "Old Passport No. with Date and Place of Issue",
                         f"{K.SURESH_OLD}, 05/01/2012, AHMEDABAD", "File No.", K.SURESH_FILE],
    "visa_printed": ["VISA INDIA", "Surname", "LINDQVIST", "Given Names", "EMMA", "Passport No.", K.EMMA_PASSPORT, "Type of Visa",
                     "TOURIST", "No. of Entries", "MULTIPLE", "Valid From", "01/10/2026", "Valid Until", "31/03/2027"],
    "oci": ["OVERSEAS CITIZEN OF INDIA", "OCI Card No.", K.DANIEL_OCI, "Surname", "OKAFOR", "Given Name", "DANIEL", "Date of Birth",
            K.DANIEL.printed_dob, "Nationality", "BRITISH", "Passport No.", K.DANIEL_PASSPORT],
    "id_front": ["IDENTITY CARD PERSONALAUSWEIS", "Surname", "BRENNER", "Given names", "LUKAS", "Date of birth", "23.02.1979",
                 "Nationality", "DEUTSCH", f"Document No: {K.LUKAS_ID}"],
    "id_back": ["Address: Hauptstrasse 5, 10115 Berlin", "Height 182 cm Eyes BLUE"] +
               K.td1("D<<", "BRENNER", "LUKAS", K.LUKAS_ID, "D<<", "790223", "M", "340222", code="ID"),
    "gym": ["CITY FITNESS GYM", "Member: Rahul Verma", "Member No: MG-55821", "Valid at all branches"],
}


# ---- 1. validators and the MRZ -------------------------------------------------------------------------------------------

def test_licence_epic_passport_and_vid_checks():
    assert ids.dl_valid("MH12 20110012345") and ids.dl_valid("GJ01 20190001234") and ids.dl_valid(K.MEENA_DL_OLD)
    assert ids.dl_parts("GJ01 20190001234")["form"] == "new" and ids.dl_parts(K.MEENA_DL_OLD)["form"] == "old"
    assert not ids.dl_valid("ZZ12 20110012345")  # no such state code
    assert not ids.dl_valid("MH00 20110012345") and not ids.dl_valid("MH12 20990012345")  # RTO 00, a year in the future
    assert ids.epic_valid(K.KAVITA_EPIC) and not ids.epic_valid("XK48291631")
    assert ids.indian_passport_valid(K.SURESH_PASSPORT) and not ids.indian_passport_valid("Z0829163")
    found = ids.find_identifiers(f"Your Aadhaar No.: {ME.spaced}\nVID : 9134 5678 9012 3450")
    kinds = [(i["type"], i["valid"]) for i in found]
    assert ("aadhaar", True) in kinds and kinds.count(("aadhaar", True)) == 1  # the 16-digit VID is not read as an Aadhaar number
    assert any(t == "vid" for t, _ in kinds)
    dl = [i for i in ids.find_identifiers(f"DL No: {K.KAVITA_DL}\nLicence No: {K.MEENA_DL_OLD}") if i["type"] == "driving-licence"]
    assert [i["valid"] for i in dl] == [True, True]


def test_mrz_every_format_with_check_digits():
    swe = K.td3("SWE", "LINDQVIST", "EMMA", K.EMMA_PASSPORT, "SWE", "850612", "F", "330611")
    visa_a = K.mrv("A", "IND", "LINDQVIST", "EMMA", K.EMMA_VISA, "SWE", "850612", "F", "270331")
    visa_b = K.mrv("B", "USA", "LINDQVIST", "EMMA", K.EMMA_VISA, "SWE", "850612", "F", "270331")
    card1 = K.td1("D<<", "BRENNER", "LUKAS", K.LUKAS_ID, "D<<", "790223", "M", "340222", code="ID")
    card2 = K.td2("ITA", "ROMANO", "SOFIA", K.SOFIA_ID, "ITA", "920917", "F", "320916")
    for lines, fmt in ((swe, "TD3"), (visa_a, "MRV-A"), (visa_b, "MRV-B"), (card1, "TD1"), (card2, "TD2")):
        found = mrz.parse_mrz(["some text"] + lines)
        assert found and found["format"] == fmt and found["valid"], (fmt, found)
    # a wrong check digit is reported, never repaired
    broken = [swe[0], swe[1][:9] + str((int(swe[1][9]) + 1) % 10) + swe[1][10:]]
    assert mrz.parse_mrz(broken)["fields"]["documentNumber"]["valid"] is False
    # fillers cut by the OCR, a filler run read as a separate box, and lookalike characters
    short = mrz.parse_mrz([swe[0][:36], swe[1]])  # 8 fillers lost at the end of the names line
    assert short["valid"] and short["padded"] and short["namesWhole"]
    cut = K.td3("SWE", "LINDQVIST", "EMMA MARIA KRISTINA SOFIA", K.EMMA_PASSPORT, "SWE", "850612", "F", "330611")
    cut_read = mrz.parse_mrz([cut[0][:40], cut[1]])  # the line ends inside the given names: a name part may be missing
    assert cut_read["padded"] and not cut_read["namesWhole"]
    from app.readcore.doctypes.mrz_documents import mrz_fields
    assert mrz_fields(cut_read)["name"].get("doubtful") and not mrz_fields(short)["name"].get("doubtful")
    split = mrz.parse_mrz([swe[0][:30], swe[0][30:], swe[1]])
    assert split["valid"] and split["format"] == "TD3"
    assert mrz.parse_mrz([card1[0].replace("0", "θ").replace("X", "×"), card1[1], card1[2]])["valid"]
    assert mrz.iso_date("850612") == "1985-06-12" and mrz.iso_date("150612") == "2015-06-12" and mrz.iso_date("330611", "expiry") == "2033-06-11"


# ---- 2. detection and fields from text --------------------------------------------------------------------------------------

def test_every_kind_is_detected_and_its_fields_mapped():
    def doc(key, codes=()):
        return read(T[key], codes)[1]

    d = doc("e_aadhaar", (K.secure_qr_payload(ME.name, ME.dob, ME.aadhaar[-4:]),))
    f = d["fields"]
    assert d["type"] == "aadhaar" and f["form"]["value"] == "letter" and f["name"]["value"] == ME.name
    assert f["documentNumber"]["value"] == ME.aadhaar and f["dob"]["value"] == ME.iso and "Pune" in f["address"]["value"]
    assert f["vid"]["value"] == K.MEENA_VID and f["vid"]["valid"]

    for key in ("pan_old", "pan_new"):
        d = doc(key)
        assert d["type"] == "pan" and d["fields"]["documentNumber"]["value"] == K.ANIL_PAN and d["fields"]["dob"]["value"] == A.iso
        assert d["fields"]["fatherName"]["value"] == A.father.upper()
    assert doc("pan_old")["fields"]["name"]["value"] == "ANIL MEHRA" and doc("pan_old")["fields"]["form"]["value"] == "old"
    assert doc("pan_new")["fields"]["name"]["value"] == "ANILMEHRA" and doc("pan_new")["fields"]["form"]["value"] == "new"

    d = doc("dl_front")["fields"]
    assert doc("dl_front")["type"] == "driving-licence" and d["documentNumber"]["value"] == "GJ0120190001234" and d["documentNumber"]["valid"]
    assert d["name"]["value"] == KV.name and d["dob"]["value"] == KV.iso and d["expiry"]["value"] == "2040-11-01"
    assert d["issueDate"]["value"] == "2019-06-15" and d["relationName"]["value"] == KV.father and "Vadodara" in d["address"]["value"]
    assert d["form"]["value"] == "smart"
    back = doc("dl_back")
    assert back["type"] == "driving-licence" and back["fields"]["vehicleClasses"]["value"] == "LMV MCWG"
    old = doc("dl_old_front")["fields"]
    assert old["documentNumber"]["value"] == "MH1200345672008" and old["documentNumber"]["valid"] and old["form"]["value"] == "old"

    vf, vb = doc("voter_front"), doc("voter_back")
    assert vf["type"] == vb["type"] == "voter-id" and vf["fields"]["documentNumber"]["value"] == vb["fields"]["documentNumber"]["value"] == K.KAVITA_EPIC
    assert vf["fields"]["relationName"]["value"] == KV.father and vb["fields"]["dob"]["value"] == KV.iso
    assert vb["fields"]["gender"]["value"] == "Female" and "Vadodara" in vb["fields"]["address"]["value"]

    p = doc("passport_printed")  # the MRZ was not read: printed labels only
    assert p["type"] == "passport" and p["fields"]["name"]["value"] == "SURESH PATEL" and p["fields"]["dob"]["value"] == SU.iso
    assert p["fields"]["documentNumber"]["value"] == K.SURESH_PASSPORT and p["fields"]["documentNumber"]["valid"]
    assert p["fields"]["page"]["value"] == "data"
    a = doc("passport_address")
    assert a["type"] == "passport" and a["fields"]["page"]["value"] == "address" and a["fields"]["fileNumber"]["value"] == K.SURESH_FILE
    assert a["fields"]["documentNumber"]["value"] == K.SURESH_PASSPORT and a["fields"]["oldPassportNumber"]["value"] == K.SURESH_OLD
    assert "ANAND" in a["fields"]["address"]["value"] and a["fields"]["fatherName"]["value"] == SU.father.upper() and "name" not in a["fields"]

    v = doc("visa_printed")
    assert v["type"] == "visa" and v["fields"]["passportNumber"]["value"] == K.EMMA_PASSPORT and v["fields"]["entries"]["value"] == "MULTIPLE"
    o = doc("oci")
    assert o["type"] == "oci" and o["fields"]["documentNumber"]["value"] == K.DANIEL_OCI and o["fields"]["name"]["value"] == "DANIEL OKAFOR"
    assert o["fields"]["passportNumber"]["value"] == K.DANIEL_PASSPORT and o["fields"]["dob"]["value"] == K.DANIEL.iso
    i = doc("id_front")
    assert i["type"] == "national-id" and i["fields"]["documentNumber"]["value"] == K.LUKAS_ID and i["fields"]["dob"]["value"] == K.LUKAS.iso
    b = doc("id_back")
    assert b["type"] == "national-id" and b["fields"]["documentNumber"]["valid"] and b["fields"]["address"]["value"] == "Hauptstrasse 5, 10115 Berlin"
    g = doc("gym")
    assert g["type"] == "unknown" and g["fields"] == {}  # a name and a number, but no known type: reception types the fields


def test_sides_by_kind():
    sides = {k: mk(0, T[k]).side for k in T}
    assert sides["aadhaar_front"] == "front" and sides["aadhaar_back"] == "back"
    assert sides["e_aadhaar"] == sides["pan_old"] == sides["pan_new"] == sides["visa_printed"] == sides["oci"] == "single"
    assert sides["dl_front"] == sides["dl_old_front"] == sides["voter_front"] == sides["id_front"] == sides["passport_printed"] == "front"
    assert sides["dl_back"] == sides["dl_old_back"] == sides["voter_back"] == sides["id_back"] == sides["passport_address"] == "back"


# ---- 3. pairing, single documents, one guest with several documents --------------------------------------------------------

def test_pairing_evidence_per_kind():
    persons = people.group([mk(0, T["dl_front"]), mk(1, T["voter_back"], at=(5000, 0)), mk(2, T["voter_front"], at=(0, 5000)),
                            mk(3, T["dl_back"], at=(5000, 5000)), mk(4, T["passport_printed"], at=(9000, 0)),
                            mk(5, T["passport_address"], at=(9000, 9000)), mk(6, T["id_back"], at=(0, 9000)),
                            mk(7, T["id_front"], at=(14000, 0))])
    got = {people.document_type(p)["type"]: ([c.index for c in p.cards], p.evidence) for p in persons}
    assert got["driving-licence"] == ([0, 3], "documentNumber")  # DL number on both sides
    assert got["voter-id"] == ([2, 1], "documentNumber")  # EPIC on both sides
    assert got["passport"] == ([4, 5], "documentNumber")  # passport number on the data page and the last page
    assert got["national-id"] == ([7, 6], "documentNumber")  # printed number on the front = MRZ number on the back
    assert all("unpairedSide" not in p.flags for p in persons)
    # MRZ name and date of birth against the printed ones, when no number is on the front: the back carries a checked number,
    # so a name and date of birth alone no longer pair them (MJ's namesake rule, 4 Nov 2026); a person decides
    front = T["id_front"][:-1]
    pair = people.group([mk(0, front), mk(1, T["id_back"], at=(9000, 9000))])
    assert [p.evidence for p in pair] == ["none", "none"] and all("sameNameDobNoNumber" in p.flags for p in pair)


def test_single_documents_stand_alone_and_kinds_never_mix():
    qr = K.secure_qr_payload(A.name, A.dob, A.aadhaar[-4:])
    cards = [mk(0, T["aadhaar_front"]), mk(1, T["pan_new"], (f"NAME=ANIL MEHRA;DOB={A.dob};ID={K.ANIL_PAN}",), at=(1100, 0)),
             mk(2, T["aadhaar_back"], (qr,), at=(0, 700)), mk(3, T["visa_printed"], at=(1100, 700))]
    persons = people.group(cards)
    s = summary(persons)
    assert [(t, c, e) for t, c, e, *_ in s] == [("aadhaar", [0, 2], "aadhaarNumber"), ("pan", [1], "singleDocument"),
                                                  ("visa", [3], "singleDocument")]
    assert all("unpairedSide" not in p.flags for p in persons)
    # Aadhaar + PAN with the same name AND date of birth but no photo match (these drawings carry no face): only a suggestion
    # (MJ's rule, 4 Nov 2026), never a link; each keeps its own picture
    aad, pan, visa = persons
    assert aad.guest != pan.guest != visa.guest and aad.linked == [] and pan.linked == []
    assert aad.possible == [2] and pan.possible == [1] and "possibleSameGuest" in pan.flags and not visa.possible
    fields, *_ = people.person_fields(pan)
    assert fields["name"]["value"] == "ANIL MEHRA" and fields["name"]["spacingFrom"] == "qr"
    assert naming.stem(fields, "pan") == "Anil_Mehra_PAN"
    # A licence front next to an Aadhaar back with nothing else: never paired by layout across kinds
    mixed = people.group([mk(0, T["dl_front"]), mk(1, T["aadhaar_back"], at=(1100, 0))])
    assert [p.evidence for p in mixed] == ["none", "none"]
    # Two PAN copies of the same card are one document (duplicate); a PAN and an e-Aadhaar letter never are
    copies = people.group([mk(0, T["pan_old"]), mk(1, T["pan_new"], at=(1100, 0)), mk(2, T["e_aadhaar"], at=(0, 700))])
    assert [(people.document_type(p)["type"], len(p.duplicates)) for p in copies] == [("pan", 1), ("aadhaar", 0)]


def test_same_guest_needs_name_and_full_dob_and_no_rival():
    other_dob = [t.replace(A.dob, "15/03/1981") for t in T["pan_old"]]
    no = people.group([mk(0, T["aadhaar_front"]), mk(1, other_dob, at=(9000, 0))])
    assert all(p.linked == [] for p in no) and no[0].guest != no[1].guest
    # Two Aadhaar namesakes with the same date of birth: the PAN cannot tell which one, so it is linked to neither
    twin = K.indian(A.name, A.dob, "Male", "39182746501", "1 Other Road", "Surat, Gujarat - 395001", "X Mehra")
    twin_front = ["Government of India", twin.name, f"DOB: {twin.dob}", "Male", twin.spaced]
    rivals = people.group([mk(0, T["aadhaar_front"]), mk(1, twin_front, at=(0, 5000)), mk(2, T["pan_old"], at=(9000, 0))])
    assert all(p.linked == [] for p in rivals)
    # A different gender blocks the link even with the same name and date of birth
    female = people.group([mk(0, T["aadhaar_front"]), mk(1, T["pan_old"] + ["Female"], at=(9000, 0))])
    assert all(p.linked == [] for p in female)
    # A year of birth alone is not a full date of birth
    yob = ["Government of India", A.name, f"Year of Birth: {A.dob[-4:]}", "Male", A.spaced]
    assert all(p.linked == [] for p in people.group([mk(0, yob), mk(1, T["pan_old"], at=(9000, 0))]))


def test_passport_alone_and_address_page_alone():
    alone = people.group([mk(0, T["passport_printed"])])
    assert alone[0].flags == ["addressPageMissing"] and alone[0].evidence == "none"  # complete, but the Indian address page is welcome
    swe = K.td3("SWE", "LINDQVIST", "EMMA", K.EMMA_PASSPORT, "SWE", "850612", "F", "330611")
    foreign = people.group([mk(0, ["PASSPORT"] + swe)])
    assert people.document_type(foreign[0])["type"] == "passport" and foreign[0].flags == []
    page = people.group([mk(0, T["passport_address"])])
    assert page[0].flags == ["unpairedSide"]


def test_naming_for_every_kind():
    f = {"name": {"value": "emma LINDQVIST"}}
    names = {k: naming.stem(f, k) for k in ("aadhaar", "pan", "driving-licence", "voter-id", "passport", "visa", "oci", "national-id",
                                          "residence-permit", "employee-card", "unknown", "club-card")}
    assert names == {"aadhaar": "Emma_Lindqvist_Aadhaar", "pan": "Emma_Lindqvist_PAN", "driving-licence": "Emma_Lindqvist_DrivingLicence",
                     "voter-id": "Emma_Lindqvist_VoterID", "passport": "Emma_Lindqvist_Passport", "visa": "Emma_Lindqvist_Visa",
                     "oci": "Emma_Lindqvist_OCI", "national-id": "Emma_Lindqvist_NationalID",
                     "residence-permit": "Emma_Lindqvist_ResidencePermit", "employee-card": "Emma_Lindqvist_EmployeeCard",
                     "unknown": "Emma_Lindqvist_Document", "club-card": "Emma_Lindqvist_Document"}
    assert naming.stem({}, "unknown") == "Unknown_Document"
    assert people.respace("KavitaJoshi", "Kavita Joshi") == "Kavita Joshi" and people.respace("ANILMEHRA", "Anil Mehra") == "ANIL MEHRA"
    assert people.respace("KavitaJoshi", "Kavita Joshee") is None and people.respace("Kavita Joshi", "KavitaJoshi") is None


# ---- 4. real OCR ---------------------------------------------------------------------------------------------------------------

ALONE = {  # drawing, type, side, fields that must be read exactly
    "aadhaar old laminated front": (lambda: K.aadhaar_old_front(FA), "aadhaar", "front",
                                    {"documentNumber": FA.aadhaar, "dob": FA.iso, "name": FA.name, "gender": "Male"}),
    "aadhaar old laminated back (XML QR)": (lambda: K.aadhaar_old_back(FA), "aadhaar", "back", {"documentNumber": FA.aadhaar, "qrLast4": None}),
    "aadhaar PVC front (secure QR)": (lambda: S.front(S.GUESTS[0], with_qr=True), "aadhaar", "front", {"documentNumber": A.aadhaar, "dob": A.iso}),
    "aadhaar PVC back": (lambda: S.back(S.GUESTS[0]), "aadhaar", "back", {"documentNumber": A.aadhaar}),
    "e-aadhaar letter": (lambda: K.e_aadhaar_letter(ME, K.MEENA_VID), "aadhaar", "single",
                         {"documentNumber": ME.aadhaar, "name": ME.name, "dob": ME.iso, "form": "letter", "vid": K.MEENA_VID}),
    "PAN old": (lambda: K.pan_old(A, K.ANIL_PAN), "pan", "single", {"documentNumber": K.ANIL_PAN, "dob": A.iso, "name": "ANIL MEHRA"}),
    "PAN new with QR": (lambda: K.pan_new(A, K.ANIL_PAN), "pan", "single", {"documentNumber": K.ANIL_PAN, "dob": A.iso, "form": "new"}),
    "DL smart front": (lambda: K.dl_smart_front(KV, K.KAVITA_DL), "driving-licence", "front",
                       {"documentNumber": "GJ0120190001234", "name": KV.name, "dob": KV.iso, "expiry": "2040-11-01"}),
    "DL smart back": (lambda: K.dl_smart_back(KV, K.KAVITA_DL), "driving-licence", "back", {"documentNumber": "GJ0120190001234"}),
    "DL old front": (lambda: K.dl_old_front(ME, K.MEENA_DL_OLD), "driving-licence", "front",
                     {"documentNumber": "MH1200345672008", "name": ME.name, "dob": ME.iso}),
    "DL old back": (lambda: K.dl_old_back(ME, K.MEENA_DL_OLD), "driving-licence", "back", {"documentNumber": "MH1200345672008"}),
    "voter ID front": (lambda: K.voter_front(KV, K.KAVITA_EPIC), "voter-id", "front", {"documentNumber": K.KAVITA_EPIC}),
    "voter ID back": (lambda: K.voter_back(KV, K.KAVITA_EPIC), "voter-id", "back", {"documentNumber": K.KAVITA_EPIC, "dob": KV.iso, "gender": "Female"}),
    "Indian passport data page": (lambda: K.passport_india_data(SU, K.SURESH_PASSPORT), "passport", "front",
                                  {"documentNumber": K.SURESH_PASSPORT, "name": "SURESH PATEL", "dob": SU.iso, "nationality": "IND",
                                   "expiry": "2032-03-11", "mrzValid": "true"}),
    "Indian passport address page": (lambda: K.passport_india_address(SU, K.SURESH_PASSPORT, K.SURESH_FILE, K.SURESH_OLD), "passport", "back",
                                     {"documentNumber": K.SURESH_PASSPORT, "fileNumber": K.SURESH_FILE, "oldPassportNumber": K.SURESH_OLD}),
    "foreign passport (SWE)": (lambda: K.passport_foreign(K.EMMA, K.EMMA_PASSPORT), "passport", "front",
                               {"documentNumber": K.EMMA_PASSPORT, "name": "EMMA LINDQVIST", "dob": K.EMMA.iso, "nationality": "SWE"}),
    "visa sticker (MRV-A)": (lambda: K.visa_sticker(K.EMMA, K.EMMA_VISA, K.EMMA_PASSPORT), "visa", "single",
                             {"documentNumber": K.EMMA_VISA, "name": "EMMA LINDQVIST", "passportNumber": K.EMMA_PASSPORT, "expiry": "2027-03-31"}),
    "OCI card": (lambda: K.oci_card(K.DANIEL, K.DANIEL_OCI, K.DANIEL_PASSPORT), "oci", "single",
                 {"documentNumber": K.DANIEL_OCI, "name": "DANIEL OKAFOR", "passportNumber": K.DANIEL_PASSPORT, "dob": K.DANIEL.iso}),
    "ID card TD1 front": (lambda: K.id_td1_front(K.LUKAS, K.LUKAS_ID), "national-id", "front",
                          {"documentNumber": K.LUKAS_ID, "name": "LUKAS BRENNER", "dob": K.LUKAS.iso}),
    "ID card TD1 back (MRZ)": (lambda: K.id_td1_back(K.LUKAS, K.LUKAS_ID), "national-id", "back",
                               {"documentNumber": K.LUKAS_ID, "dob": K.LUKAS.iso, "mrzValid": "true"}),
    "ID card TD2 front (MRZ)": (lambda: K.id_td2_front(K.SOFIA, K.SOFIA_ID), "national-id", "front",
                                {"documentNumber": K.SOFIA_ID, "name": "SOFIA ROMANO", "dob": K.SOFIA.iso}),
    "ID card TD2 back": (lambda: K.id_td2_back(K.SOFIA, K.SOFIA_ID), "national-id", "back", {"documentNumber": K.SOFIA_ID}),
    "employee card": (lambda: K.employee("Priya Nair", "SL-20931"), "employee-card", "front", {"name": "Priya Nair", "documentNumber": "SL-20931"}),
    "unknown card with a name and a number": (lambda: K.unknown_member("Rahul Verma", "MG-55821"), "unknown", "unknown", {}),
}


@pytest.fixture(scope="module")
def pipe(engines):
    from tests.conftest import Storage
    return make_pipeline(Storage(), engines)


def test_every_kind_read_alone_real_ocr(pipe):
    def go(item):
        label, (build, kind, side, want) = item
        result, doc = pipe.read_card(np.asarray(build()), {})
        keys = people.keys_of(result, doc)
        got = {k: doc["fields"].get(k, {}).get("value") for k in want}
        return label, doc["type"] == kind, people.side_of(keys) == side, got == want, (doc["type"], people.side_of(keys), got)

    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(go, ALONE.items()))
    print()
    for label, t, s, f, seen in rows:
        print(f"  {label:42s} type {'ok' if t else 'WRONG'}  side {'ok' if s else 'WRONG'}  fields {'ok' if f else 'WRONG'}  {seen if not (t and s and f) else ''}")
    print(f"  {sum(r[1] for r in rows)}/{len(rows)} types, {sum(r[2] for r in rows)}/{len(rows)} sides, {sum(r[3] for r in rows)}/{len(rows)} field sets")
    assert all(t and s and f for _, t, s, f, _ in rows), [r for r in rows if not all(r[1:4])]


def test_the_qr_is_read_only_when_switched_on(engines):
    """MJ, 5 Nov 2026: no QR for now. The QR code stays behind INTAKE_READ_QR (off); switched on it still reads the XML QR."""
    from tests.conftest import Storage
    on = make_pipeline(Storage(), engines, read_qr=True)
    result, doc = on.read_card(np.asarray(K.aadhaar_old_back(FA)), {})
    assert result["codes"] and doc["fields"]["qrLast4"]["value"] == FA.aadhaar[-4:]


def _job(**kw) -> dict:
    return {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": CAP, "languages": None, "multi": True, **kw}


@pytest.fixture()
def stubbed(monkeypatch):
    monkeypatch.setattr(people, "cut", S.stub_cut)


def _people(results) -> dict:
    return {v["suggested_name"]: (v, b) for v, b in results}


def _aspect(blob: bytes) -> float:
    img = Image.open(io.BytesIO(blob))
    return img.height / img.width


def test_indian_guests_several_kinds_on_two_sheets(pipe, stubbed):
    g0 = S.GUESTS[0]  # Anil Mehra, the same invented person as idkinds.ANIL
    sheet1 = K.layout_sheet([S.front(g0), S.back(g0), K.pan_new(A, K.ANIL_PAN), K.dl_smart_front(KV, K.KAVITA_DL),
                             K.dl_smart_back(KV, K.KAVITA_DL), K.voter_front(KV, K.KAVITA_EPIC), K.voter_back(KV, K.KAVITA_EPIC),
                             K.aadhaar_old_front(FA), K.aadhaar_old_back(FA)])
    sheet2 = K.layout_sheet([K.passport_india_data(SU, K.SURESH_PASSPORT), K.passport_india_address(SU, K.SURESH_PASSPORT, K.SURESH_FILE, K.SURESH_OLD),
                             K.dl_old_front(ME, K.MEENA_DL_OLD), K.dl_old_back(ME, K.MEENA_DL_OLD), K.e_aadhaar_letter(ME, K.MEENA_VID)])
    results = pipe.analyse([png_bytes(sheet1), png_bytes(sheet2)], _job())
    found = _people(results)
    print("\n", [(v["suggested_name"], v["person"]["cards"], v["person"]["evidence"], v["person"]["guest"], v["person"]["sameGuestAs"],
                  [f for f in v["flags"] if f in ("sameGuestOtherDocument", "unpairedSide", "addressPageMissing", "pairedByLayoutOnly")])
                 for v, _ in results])
    assert sorted(found) == sorted(["Anil_Mehra_Aadhaar", "Anil_Mehra_PAN", "Kavita_Joshi_DrivingLicence", "Kavita_Joshi_VoterID",
                                    "Farhan_Qureshi_Aadhaar", "Suresh_Patel_Passport", "Meena_Desai_DrivingLicence", "Meena_Desai_Aadhaar"])
    p = {n: v["person"] for n, (v, _) in found.items()}
    assert p["Anil_Mehra_Aadhaar"]["cards"] == [1, 2] and p["Anil_Mehra_Aadhaar"]["evidence"] == "aadhaarNumber"
    assert p["Anil_Mehra_PAN"]["cards"] == [3] and p["Anil_Mehra_PAN"]["evidence"] == "singleDocument"
    assert p["Kavita_Joshi_DrivingLicence"]["cards"] == [4, 5] and p["Kavita_Joshi_DrivingLicence"]["evidence"] == "documentNumber"
    assert p["Kavita_Joshi_VoterID"]["cards"] == [6, 7] and p["Kavita_Joshi_VoterID"]["evidence"] == "documentNumber"
    assert p["Farhan_Qureshi_Aadhaar"]["cards"] == [8, 9] and p["Farhan_Qureshi_Aadhaar"]["evidence"] == "aadhaarNumber"
    assert p["Suresh_Patel_Passport"]["cards"] == [10, 11] and p["Suresh_Patel_Passport"]["sides"] == ["front", "back"]
    assert p["Meena_Desai_DrivingLicence"]["cards"] == [12, 13] and p["Meena_Desai_Aadhaar"]["cards"] == [14]
    # Same name and full date of birth on two documents, no photo match (no faces drawn): a suggestion for reception, not a link
    for a, b in (("Anil_Mehra_Aadhaar", "Anil_Mehra_PAN"), ("Kavita_Joshi_DrivingLicence", "Kavita_Joshi_VoterID"),
                 ("Meena_Desai_DrivingLicence", "Meena_Desai_Aadhaar")):
        assert p[a]["guest"] != p[b]["guest"] and p[a]["sameGuestAs"] == [] and p[b]["sameGuestAs"] == []
        assert p[b]["index"] in p[a]["possibleSameGuestAs"] and p[a]["index"] in p[b]["possibleSameGuestAs"]
        assert "possibleSameGuest" in found[a][0]["flags"] and found[a][0]["needs_human_check"]
    assert p["Farhan_Qureshi_Aadhaar"]["sameGuestAs"] == [] and p["Suresh_Patel_Passport"]["sameGuestAs"] == []
    assert p["Farhan_Qureshi_Aadhaar"]["possibleSameGuestAs"] == []
    fields = {n: v["fields"] for n, (v, _) in found.items()}
    assert fields["Kavita_Joshi_VoterID"]["name"]["value"] == "Kavita Joshi"  # the OCR's "KavitaJoshi", spaced from her licence
    assert fields["Suresh_Patel_Passport"]["fileNumber"]["value"] == K.SURESH_FILE and "ANAND" in fields["Suresh_Patel_Passport"]["address"]["value"]
    assert fields["Kavita_Joshi_DrivingLicence"]["documentNumber"]["value"] == "GJ0120190001234"
    assert fields["Kavita_Joshi_VoterID"]["dob"]["value"] == KV.iso and "Vadodara" in fields["Kavita_Joshi_VoterID"]["address"]["value"]
    for v, blob in results:
        assert "unpairedSide" not in v["flags"] and "pairedByLayoutOnly" not in v["flags"] and len(blob) == v["result_bytes"] <= CAP
    # one picture per document: a single document is one card high, a pair is two cards and the gap
    assert abs(_aspect(found["Anil_Mehra_PAN"][1]) - K.CARD[1] / K.CARD[0]) < 0.01
    assert abs(_aspect(found["Anil_Mehra_Aadhaar"][1]) - (2 * K.CARD[1] + 40) / K.CARD[0]) < 0.01
    assert abs(_aspect(found["Suresh_Patel_Passport"][1]) - (2 * K.PAGE[1] + 40) / K.PAGE[0]) < 0.01
    assert abs(_aspect(found["Meena_Desai_Aadhaar"][1]) - K.LETTER[1] / K.LETTER[0]) < 0.01


def test_foreign_guests_and_other_cards_on_one_sheet(pipe, stubbed):
    from tests import faces as F
    # the data page carries an INVENTED drawn face: MJ's photo rule (5 Nov 2026) flags a data page without a clear photo
    emma = Image.fromarray(F.put_photo(np.asarray(K.passport_foreign(K.EMMA, K.EMMA_PASSPORT).convert("RGB")), F.photo(F.identity(2), 0),
                                       (43, 103, 287, 417)))
    sheet = K.layout_sheet([emma, K.visa_sticker(K.EMMA, K.EMMA_VISA, K.EMMA_PASSPORT),
                            K.id_td1_front(K.LUKAS, K.LUKAS_ID), K.id_td1_back(K.LUKAS, K.LUKAS_ID),
                            K.id_td2_front(K.SOFIA, K.SOFIA_ID), K.id_td2_back(K.SOFIA, K.SOFIA_ID),
                            K.oci_card(K.DANIEL, K.DANIEL_OCI, K.DANIEL_PASSPORT), K.unknown_member("Rahul Verma", "MG-55821"),
                            K.employee("Priya Nair", "SL-20931")])
    results = pipe.analyse([png_bytes(sheet)], _job())
    found = _people(results)
    print("\n", [(v["suggested_name"], v["person"]["cards"], v["person"]["evidence"], v["person"]["sameGuestAs"],
                  v["person"]["guestEvidence"], v["needs_human_check"]) for v, _ in results])
    assert sorted(found) == sorted(["Emma_Lindqvist_Passport", "Emma_Lindqvist_Visa", "Lukas_Brenner_NationalID", "Sofia_Romano_NationalID",
                                    "Daniel_Okafor_OCI", "Unknown_Document", "Priya_Nair_EmployeeCard"])
    p = {n: v["person"] for n, (v, _) in found.items()}
    v = {n: val for n, (val, _) in found.items()}
    assert p["Emma_Lindqvist_Passport"]["cards"] == [1] and p["Emma_Lindqvist_Visa"]["cards"] == [2]
    assert p["Emma_Lindqvist_Passport"]["guest"] == p["Emma_Lindqvist_Visa"]["guest"]
    assert not v["Emma_Lindqvist_Passport"]["needs_human_check"]  # a data page alone is complete; the MRZ is valid
    assert p["Emma_Lindqvist_Visa"]["guestEvidence"] == ["passportNumber"]  # name + DOB alone no longer adds evidence (no photo match)
    assert p["Lukas_Brenner_NationalID"]["cards"] == [3, 4] and p["Lukas_Brenner_NationalID"]["evidence"] == "documentNumber"
    assert p["Sofia_Romano_NationalID"]["cards"] == [5, 6] and p["Sofia_Romano_NationalID"]["evidence"] == "documentNumber"
    assert p["Daniel_Okafor_OCI"]["evidence"] == "singleDocument" and p["Priya_Nair_EmployeeCard"]["cards"] == [9]
    assert v["Emma_Lindqvist_Passport"]["fields"]["nationality"]["value"] == "SWE" and v["Emma_Lindqvist_Visa"]["fields"]["expiry"]["value"] == "2027-03-31"
    assert v["Lukas_Brenner_NationalID"]["fields"]["address"]["value"] == "Hauptstrasse 5, 10115 Berlin"
    assert v["Daniel_Okafor_OCI"]["fields"]["passportNumber"]["value"] == K.DANIEL_PASSPORT
    unknown = v["Unknown_Document"]
    assert unknown["needs_human_check"] and "unknownDocumentType" in unknown["flags"] and unknown["fields"] == {}
    for name in ("Emma_Lindqvist_Passport", "Emma_Lindqvist_Visa", "Daniel_Okafor_OCI", "Priya_Nair_EmployeeCard"):
        assert "unpairedSide" not in v[name]["flags"]
    assert all(val["result_bytes"] <= CAP for val in v.values())
