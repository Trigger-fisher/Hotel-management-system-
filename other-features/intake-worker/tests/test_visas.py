"""Foreign guests at an Indian hotel: visas in every form (MRV-A / MRV-B sticker, an older sticker without an MRZ, the e-Visa ETA
printout), OCI in every form (card, old booklet, the U-visa sticker), the legacy PIO card, residence permits (TD1 / TD2 with the
codes AR / IR / RP, and the FRRO permit printout), linking each to the guest's passport; Gujarati-labelled Aadhaar and licence
fronts; an e-Aadhaar and an ETA delivered as PDF files. INVENTED drawings and numbers only (tests/visadocs.py, tests/idkinds.py).

Part 1 runs without OCR (MRZ codes, detection and fields from text, linking rules, names). Part 2 runs the real OCR."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest

from app import naming, people
from app.errors import StepError
from app.readcore import mrz
from app.readcore.doctypes import read_document
from tests import idkinds as K
from tests import sheets as S
from tests import visadocs as V
from tests.conftest import Storage, make_pipeline
from tests.imaging import png_bytes
from tests.test_idkinds import CAP, fake, mk, read

J, MA, AI, RA, MO, CH, LU, AN = V.JAMES, V.MARTA, V.AIKO, V.RAVI, V.MOHAN, V.CHEN, V.LUCIA, V.ANNA


def passport_text(g, number) -> list[str]:
    return ["PASSPORT", "Surname", g.surname, "Given names", g.given] + \
        K.td3(g.nationality, g.surname, g.given, number, g.nationality, g.dob, g.sex, "330611")


T = {
    "visa_mrv_b": ["VISA INDIA", "Surname", AI.surname, "Given Names", AI.given, "Passport No.", V.AIKO_PASSPORT, "Type of Visa", "BUSINESS",
                   "No. of Entries", "DOUBLE"] + K.mrv("B", "IND", AI.surname, AI.given, V.AIKO_VISA, AI.nationality, AI.dob, AI.sex, "270214"),
    "visa_old": ["GOVERNMENT OF INDIA", "VISA", f"Visa No: {V.MARTA_VISA}", f"Name: {MA.given} {MA.surname}", f"Passport No: {V.MARTA_PASSPORT}",
                 "Type: TOURIST", "Entries: MULTIPLE", "Valid From: 10/01/2026", "Valid Until: 09/07/2026"],
    "eta": V.ETA_TEXT(J, V.JAMES_ETA, V.JAMES_PASSPORT),
    "oci_booklet": ["OVERSEAS CITIZEN OF INDIA", "Certificate of Registration under Section 7A", "Registration No.", V.RAVI_OCI, "Surname",
                    RA.surname, "Given Name", RA.given, "Date of Birth", RA.printed_dob, "Passport No.", V.RAVI_PASSPORT],
    "u_visa": ["VISA INDIA", "Surname", RA.surname, "Given Names", RA.given, "Passport No.", V.RAVI_PASSPORT, "OCI No.", V.RAVI_OCI, "Type", "U",
               "Valid Until", "LIFE LONG"] + K.mrv("A", "IND", RA.surname, RA.given, V.RAVI_UVISA, RA.nationality, RA.dob, RA.sex, "991231"),
    "pio": ["PERSON OF INDIAN ORIGIN CARD", "PIO Card No.", V.MOHAN_PIO, "Surname", MO.surname, "Given Name", MO.given, "Date of Birth",
            MO.printed_dob, "Passport No.", V.MOHAN_PASSPORT],
    "rp_front": ["AUFENTHALTSTITEL RESIDENCE PERMIT", "Surname", CH.surname, "Given names", CH.given, "Date of birth", "06.05.1989",
                 f"Card No: {V.CHEN_RP}"],
    "rp_back": ["Address: Lindenweg 14, 80331 Munchen"] + K.td1("D<<", CH.surname, CH.given, V.CHEN_RP, CH.nationality, CH.dob, CH.sex,
                                                                "290505", code="AR"),
    "frro": ["Foreigners Regional Registration Office, Ahmedabad", "RESIDENTIAL PERMIT", f"RP No: {V.ANNA_FRRO}",
             f"Name: {AN.given} {AN.surname}", f"Date of Birth: {AN.printed_dob}", f"Passport No: {V.ANNA_PASSPORT}", f"Visa No: {V.ANNA_VISA}",
             "Visa Type: EMPLOYMENT", "Valid Till: 31/12/2027"],
}


# ---- 1. without OCR ------------------------------------------------------------------------------------------------------------

def test_residence_permit_mrz_codes():
    td1_ar = K.td1("D<<", CH.surname, CH.given, V.CHEN_RP, CH.nationality, CH.dob, CH.sex, "290505", code="AR")
    td2_ir = K.td2("PRT", LU.surname, LU.given, V.LUCIA_RP, LU.nationality, LU.dob, LU.sex, "300318", code="IR")
    td1_rp = K.td1("FRA", CH.surname, CH.given, V.CHEN_RP, CH.nationality, CH.dob, CH.sex, "290505", code="RP")
    td1_id = K.td1("D<<", CH.surname, CH.given, V.CHEN_RP, CH.nationality, CH.dob, CH.sex, "290505", code="ID")
    for lines, fmt, kind in ((td1_ar, "TD1", "residence-permit"), (td2_ir, "TD2", "residence-permit"), (td1_rp, "TD1", "residence-permit"),
                             (td1_id, "TD1", "national-id")):
        assert mrz.parse_mrz(lines)["valid"] and mrz.parse_mrz(lines)["format"] == fmt
        d = read(["card"] + lines)[1]
        assert d["type"] == kind, (lines[0], d["type"])
    d = read(["RESIDENCE PERMIT"] + td2_ir)[1]["fields"]
    assert d["documentNumber"]["value"] == V.LUCIA_RP and d["documentNumber"]["valid"] and d["form"]["value"] == "card"
    assert mk(0, ["card"] + td2_ir).side == "front" and mk(0, T["rp_back"]).side == "back" and mk(0, T["rp_front"]).side == "front"


def test_every_new_form_detected_with_fields():
    def doc(key):
        return read(T[key])[1]

    def values(d):
        return {k: v["value"] for k, v in d["fields"].items()}

    b = doc("visa_mrv_b")
    assert b["type"] == "visa" and values(b)["form"] == "mrv-b" and values(b)["documentNumber"] == V.AIKO_VISA and b["fields"]["documentNumber"]["valid"]
    assert values(b)["passportNumber"] == V.AIKO_PASSPORT and values(b)["dob"] == AI.iso and values(b)["entries"] == "DOUBLE"
    o = values(doc("visa_old"))
    assert doc("visa_old")["type"] == "visa" and o["form"] == "printed" and o["documentNumber"] == V.MARTA_VISA
    assert o["name"] == "MARTA KOWALSKA" and o["passportNumber"] == V.MARTA_PASSPORT and o["visaType"] == "TOURIST"
    assert o["entries"] == "MULTIPLE" and o["issueDate"] == "2026-01-10" and o["expiry"] == "2026-07-09" and "dob" not in o
    e = values(doc("eta"))
    assert doc("eta")["type"] == "visa" and e["form"] == "eta" and e["applicationId"] == e["documentNumber"] == V.JAMES_ETA
    assert e["name"] == "JAMES CARTER" and e["passportNumber"] == V.JAMES_PASSPORT and e["dob"] == J.iso and e["visaType"] == "e-TOURIST VISA"
    assert e["entries"] == "MULTIPLE" and e["issueDate"] == "2026-10-01" and e["expiry"] == "2027-09-30" and e["validity"] == "365 DAYS"
    assert e["nationality"] == "UNITED STATES"
    ob = values(doc("oci_booklet"))
    assert doc("oci_booklet")["type"] == "oci" and ob["form"] == "booklet" and ob["documentNumber"] == V.RAVI_OCI
    assert ob["passportNumber"] == V.RAVI_PASSPORT and ob["dob"] == RA.iso and ob["name"] == "RAVI NAIR"
    u = doc("u_visa")
    candidates = read_document(fake(T["u_visa"]))["candidates"]
    assert u["type"] == "oci" and candidates.get("visa", 0) < 0.5 < candidates["oci"]  # the sticker is a visa, but its type is OCI
    uv = values(u)
    assert uv["form"] == "u-visa" and uv["documentNumber"] == V.RAVI_OCI and uv["visaNumber"] == V.RAVI_UVISA and uv["dob"] == RA.iso
    assert uv["passportNumber"] == V.RAVI_PASSPORT and uv["name"] == "RAVI NAIR"
    p = values(doc("pio"))
    assert doc("pio")["type"] == "pio" and p["documentNumber"] == V.MOHAN_PIO and p["passportNumber"] == V.MOHAN_PASSPORT and p["dob"] == MO.iso
    f = values(doc("frro"))
    assert doc("frro")["type"] == "residence-permit" and f["form"] == "frro" and f["documentNumber"] == V.ANNA_FRRO
    assert f["passportNumber"] == V.ANNA_PASSPORT and f["visaNumber"] == V.ANNA_VISA and f["expiry"] == "2027-12-31" and f["dob"] == AN.iso
    assert f["purpose"] == "EMPLOYMENT"
    sides = {k: mk(0, T[k]).side for k in ("visa_mrv_b", "visa_old", "eta", "oci_booklet", "u_visa", "pio", "frro")}
    assert set(sides.values()) == {"single"}, sides
    names = {k: naming.stem({"name": {"value": "RAVI NAIR"}}, k) for k in ("visa", "oci", "pio", "residence-permit")}
    assert names == {"visa": "Ravi_Nair_Visa", "oci": "Ravi_Nair_OCI", "pio": "Ravi_Nair_PIO", "residence-permit": "Ravi_Nair_ResidencePermit"}


def _links(persons) -> dict:
    return {(people.document_type(p)["type"], (p.cards[0].keys.get("form") or "")): (p.guest, p.linked, p.link_evidence) for p in persons}


def test_visa_linked_to_passport_by_number_or_name_and_dob():
    cards = [mk(0, passport_text(MA, V.MARTA_PASSPORT)), mk(1, T["visa_old"], at=(2000, 0)), mk(2, passport_text(J, V.JAMES_PASSPORT), at=(0, 2000)),
             mk(3, T["eta"], at=(2000, 2000)), mk(4, passport_text(AI, V.AIKO_PASSPORT), at=(0, 4000)), mk(5, T["visa_mrv_b"], at=(2000, 4000))]
    persons = people.group(cards)
    assert [[c.index for c in p.cards] for p in persons] == [[0], [1], [2], [3], [4], [5]]  # one picture per document
    g = [(p.guest, p.linked, p.link_evidence) for p in persons]
    assert g[0] == (1, [2], ["passportNumber"]) and g[1] == (1, [1], ["passportNumber"])  # the old sticker has no date of birth
    # the passport number links them; name + date of birth adds nothing without a photo match (MJ's rule, 4 Nov 2026)
    assert g[2][0] == g[3][0] == 2 and g[3][2] == ["passportNumber"]
    assert g[4][0] == g[5][0] == 3 and g[5][2] == ["passportNumber"]
    assert all("sameGuestOtherDocument" in p.flags for p in persons)
    # the passport named on the visa is not in the job: the visa stands alone
    alone = people.group([mk(0, passport_text(J, V.JAMES_PASSPORT)), mk(1, T["visa_old"], at=(2000, 0))])
    assert [p.linked for p in alone] == [[], []]
    # the number matches but the date of birth disagrees, or the names are clearly someone else's: never linked
    other_dob = [t.replace(J.printed_dob, "16/09/1988") for t in T["eta"]]
    assert all(p.linked == [] for p in people.group([mk(0, passport_text(J, V.JAMES_PASSPORT)), mk(1, other_dob, at=(2000, 0))]))
    stranger = [t.replace("MARTA KOWALSKA", "PIOTR NOWAK") for t in T["visa_old"]]
    assert all(p.linked == [] for p in people.group([mk(0, passport_text(MA, V.MARTA_PASSPORT)), mk(1, stranger, at=(2000, 0))]))


def test_oci_forms_frro_and_permit_cards():
    cards = [mk(0, passport_text(RA, V.RAVI_PASSPORT)), mk(1, T["oci_booklet"], at=(2000, 0)), mk(2, T["u_visa"], at=(4000, 0)),
             mk(3, passport_text(AN, V.ANNA_PASSPORT), at=(0, 2000)), mk(4, T["frro"], at=(2000, 2000)), mk(5, T["pio"], at=(4000, 2000)),
             mk(6, T["rp_front"], at=(0, 4000)), mk(7, T["rp_back"], at=(9000, 9000))]
    persons = people.group(cards)
    got = [(people.document_type(p)["type"], [c.index for c in p.cards], p.evidence, p.duplicates) for p in persons]
    assert got == [("passport", [0], "none", []), ("oci", [1], "singleDocument", []), ("oci", [2], "singleDocument", []),
                   ("passport", [3], "none", []), ("residence-permit", [4], "singleDocument", []), ("pio", [5], "singleDocument", []),
                   ("residence-permit", [6, 7], "documentNumber", [])]  # the OCI booklet and the U-visa are two documents, not copies
    ravi, booklet, u_visa, anna, frro, pio, permit = persons
    assert ravi.guest == booklet.guest == u_visa.guest and sorted(ravi.linked) == [2, 3]
    # the booklet and the U-visa print the passport number and share the OCI number (two forms of one guest's OCI, never copies)
    assert booklet.link_evidence == ["documentNumber", "passportNumber"] and u_visa.link_evidence == ["documentNumber", "passportNumber"]
    assert anna.guest == frro.guest and frro.link_evidence == ["passportNumber"]
    assert pio.linked == [] and permit.linked == [] and len({ravi.guest, anna.guest, pio.guest, permit.guest}) == 4
    fields, *_ = people.person_fields(permit)
    assert fields["name"]["value"] == "WEI CHEN" and fields["address"]["value"] == "Lindenweg 14, 80331 Munchen"
    # two copies of the SAME form are still one document
    copies = people.group([mk(0, T["oci_booklet"]), mk(1, T["oci_booklet"], at=(2000, 0))])
    assert len(copies) == 1 and len(copies[0].duplicates) == 1


def test_padded_mrz_name_loses_to_the_printed_name():
    """The OCR lost letters on a TD1 names line ("CHEN<<WEI" read as "CHE<<E"): the printed front name wins and the clash is shown."""
    back = T["rp_back"][:-1] + ["CHE<<E<<<<<<<<<<<<<<<<<<<<<"]
    persons = people.group([mk(0, T["rp_front"]), mk(1, back, at=(9000, 9000))])
    assert len(persons) == 1 and persons[0].evidence == "documentNumber"
    fields, doubtful, _ = people.person_fields(persons[0])
    assert fields["name"]["value"] == "WEI CHEN" and fields["name"]["conflicts"][0]["value"] == "E CHE" and "name" in doubtful


# ---- 2. real OCR --------------------------------------------------------------------------------------------------------------

ALONE = {
    "visa MRV-B sticker": (lambda: V.visa_mrv_b(AI, V.AIKO_VISA, V.AIKO_PASSPORT), "visa", "single",
                           {"documentNumber": V.AIKO_VISA, "name": "AIKO TANAKA", "passportNumber": V.AIKO_PASSPORT, "dob": AI.iso,
                            "expiry": "2027-02-14", "mrzFormat": "MRV-B", "mrzValid": "true", "form": "mrv-b", "entries": "DOUBLE"}),
    "visa sticker without MRZ": (lambda: V.visa_printed_old(MA, V.MARTA_VISA, V.MARTA_PASSPORT), "visa", "single",
                                 {"documentNumber": V.MARTA_VISA, "name": "MARTA KOWALSKA", "passportNumber": V.MARTA_PASSPORT,
                                  "visaType": "TOURIST", "entries": "MULTIPLE", "issueDate": "2026-01-10", "expiry": "2026-07-09", "form": "printed"}),
    "e-Visa ETA printout": (lambda: V.eta_printout(J, V.JAMES_ETA, V.JAMES_PASSPORT), "visa", "single",
                            {"applicationId": V.JAMES_ETA, "name": "JAMES CARTER", "passportNumber": V.JAMES_PASSPORT, "dob": J.iso,
                             "visaType": "e-TOURIST VISA", "entries": "MULTIPLE", "expiry": "2027-09-30", "validity": "365 DAYS", "form": "eta"}),
    "OCI booklet data page": (lambda: V.oci_booklet(RA, V.RAVI_OCI, V.RAVI_PASSPORT), "oci", "single",
                              {"documentNumber": V.RAVI_OCI, "name": "RAVI NAIR", "passportNumber": V.RAVI_PASSPORT, "dob": RA.iso, "form": "booklet"}),
    "OCI U-visa sticker": (lambda: V.oci_u_visa(RA, V.RAVI_UVISA, V.RAVI_OCI, V.RAVI_PASSPORT), "oci", "single",
                           {"documentNumber": V.RAVI_OCI, "visaNumber": V.RAVI_UVISA, "name": "RAVI NAIR", "passportNumber": V.RAVI_PASSPORT,
                            "dob": RA.iso, "form": "u-visa"}),
    "PIO card": (lambda: V.pio_card(MO, V.MOHAN_PIO, V.MOHAN_PASSPORT), "pio", "single",
                 {"documentNumber": V.MOHAN_PIO, "name": "MOHAN DAS", "passportNumber": V.MOHAN_PASSPORT, "dob": MO.iso}),
    "residence permit TD1 front": (lambda: V.rp_td1_front(CH, V.CHEN_RP), "residence-permit", "front",
                                   {"documentNumber": V.CHEN_RP, "name": "WEI CHEN", "dob": CH.iso}),
    "residence permit TD1 back (AR)": (lambda: V.rp_td1_back(CH, V.CHEN_RP), "residence-permit", "back",
                                       {"documentNumber": V.CHEN_RP, "dob": CH.iso, "mrzValid": "true", "mrzFormat": "TD1"}),
    "residence permit TD2 front (IR)": (lambda: V.rp_td2_front(LU, V.LUCIA_RP), "residence-permit", "front",
                                        {"documentNumber": V.LUCIA_RP, "name": "LUCIA FERRARI", "dob": LU.iso, "mrzValid": "true"}),
    "residence permit TD2 back": (lambda: V.rp_td2_back(LU, V.LUCIA_RP), "residence-permit", "back", {"documentNumber": V.LUCIA_RP}),
    "FRRO residential permit": (lambda: V.frro_permit(AN, V.ANNA_FRRO, V.ANNA_PASSPORT, V.ANNA_VISA), "residence-permit", "single",
                                {"documentNumber": V.ANNA_FRRO, "name": "ANNA SCHMIDT", "passportNumber": V.ANNA_PASSPORT,
                                 "visaNumber": V.ANNA_VISA, "dob": AN.iso, "expiry": "2027-12-31", "form": "frro"}),
    "Aadhaar front, Gujarati labels": (lambda: V.aadhaar_gujarati_front(V.HETAL), "aadhaar", "front",
                                       {"documentNumber": V.HETAL.aadhaar, "name": V.HETAL.name, "dob": V.HETAL.iso, "gender": "Female"}),
    "DL front, Gujarati labels": (lambda: V.dl_gujarati_front(V.JIGNESH, V.JIGNESH_DL), "driving-licence", "front",
                                  {"documentNumber": "GJ0320150004567", "name": V.JIGNESH.name, "dob": V.JIGNESH.iso,
                                   "relationName": V.JIGNESH.father, "expiry": "2036-01-04"}),
}


@pytest.fixture(scope="module")
def pipe(engines):
    return make_pipeline(Storage(), engines)


def test_every_new_form_read_alone_real_ocr(pipe):
    def go(item):
        label, (build, kind, side, want) = item
        result, doc = pipe.read_card(np.asarray(build()), {})
        keys = people.keys_of(result, doc)
        got = {k: doc["fields"].get(k, {}).get("value") for k in want}
        gujarati = [l["text"] for l in result["lines"] if l.get("script") == "Gujarati"]
        return label, doc["type"] == kind, people.side_of(keys) == side, got == want, (doc["type"], people.side_of(keys), got), gujarati

    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(go, ALONE.items()))
    print(f"\n  Gujarati drawn with shaping: {V.SHAPED}")
    for label, t, s, f, seen, gu in rows:
        print(f"  {label:34s} type {'ok' if t else 'WRONG'}  side {'ok' if s else 'WRONG'}  fields {'ok' if f else 'WRONG'}"
              f"  {seen if not (t and s and f) else ''}{'  Gujarati lines: ' + str(gu) if gu else ''}")
    print(f"  {sum(r[1] for r in rows)}/{len(rows)} types, {sum(r[2] for r in rows)}/{len(rows)} sides, {sum(r[3] for r in rows)}/{len(rows)} field sets")
    assert all(t and s and f for _, t, s, f, _, _ in rows), [r for r in rows if not all(r[1:4])]
    gu = {label: lines for label, *_, lines in rows}
    # the Tesseract Gujarati path really read Gujarati script on both cards (the Aadhaar heading and name, the licence title)
    assert "ભારત સરકાર" in gu["Aadhaar front, Gujarati labels"] and any("વાહન" in t for t in gu["DL front, Gujarati labels"])


def _job(**kw) -> dict:
    return {"id": "local", "profile": "id-card", "gate_action": "warn", "size_cap_bytes": CAP, "languages": None, "multi": True, **kw}


@pytest.fixture()
def stubbed(monkeypatch):
    monkeypatch.setattr(people, "cut", S.stub_cut)


def test_foreign_guests_visas_oci_permits_on_two_sheets(pipe, stubbed):
    sheet1 = K.layout_sheet([K.passport_foreign(J, V.JAMES_PASSPORT), V.eta_printout(J, V.JAMES_ETA, V.JAMES_PASSPORT),
                             K.passport_foreign(MA, V.MARTA_PASSPORT), V.visa_printed_old(MA, V.MARTA_VISA, V.MARTA_PASSPORT),
                             K.passport_foreign(AI, V.AIKO_PASSPORT), V.visa_mrv_b(AI, V.AIKO_VISA, V.AIKO_PASSPORT)])
    sheet2 = K.layout_sheet([K.passport_foreign(RA, V.RAVI_PASSPORT), V.oci_booklet(RA, V.RAVI_OCI, V.RAVI_PASSPORT),
                             V.oci_u_visa(RA, V.RAVI_UVISA, V.RAVI_OCI, V.RAVI_PASSPORT), K.passport_foreign(AN, V.ANNA_PASSPORT),
                             V.frro_permit(AN, V.ANNA_FRRO, V.ANNA_PASSPORT, V.ANNA_VISA), V.pio_card(MO, V.MOHAN_PIO, V.MOHAN_PASSPORT),
                             V.rp_td1_front(CH, V.CHEN_RP), V.rp_td1_back(CH, V.CHEN_RP)])
    results = pipe.analyse([png_bytes(sheet1), png_bytes(sheet2)], _job())
    rows = [(v["suggested_name"], v["fields"].get("form", {}).get("value"), v["person"], v) for v, _ in results]
    print("\n", [(n, f, p["cards"], p["evidence"], p["guest"], p["sameGuestAs"], p["guestEvidence"]) for n, f, p, _ in rows])
    assert [(n, f) for n, f, *_ in rows] == [
        ("James_Carter_Passport", None), ("James_Carter_Visa", "eta"), ("Marta_Kowalska_Passport", None), ("Marta_Kowalska_Visa", "printed"),
        ("Aiko_Tanaka_Passport", None), ("Aiko_Tanaka_Visa", "mrv-b"), ("Ravi_Nair_Passport", None), ("Ravi_Nair_OCI", "booklet"),
        ("Ravi_Nair_OCI", "u-visa"), ("Anna_Schmidt_Passport", None), ("Anna_Schmidt_ResidencePermit", "frro"), ("Mohan_Das_PIO", None),
        ("Wei_Chen_ResidencePermit", "card")]
    p = [r[2] for r in rows]
    assert [x["cards"] for x in p] == [[1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13, 14]]  # one picture per document
    guests = [x["guest"] for x in p]
    assert guests[0] == guests[1] and guests[2] == guests[3] and guests[4] == guests[5] and guests[6] == guests[7] == guests[8]
    assert guests[9] == guests[10] and len(set(guests)) == 7  # James, Marta, Aiko, Ravi, Anna, Mohan, Chen
    assert p[3]["guestEvidence"] == ["passportNumber"]  # the old sticker carries no date of birth: the passport number links it
    for i in (1, 5, 7, 8, 10):  # name + date of birth adds nothing without a photo match (MJ's rule, 4 Nov 2026)
        assert "passportNumber" in p[i]["guestEvidence"] and "nameAndDob" not in p[i]["guestEvidence"], rows[i][0]
    assert p[12]["evidence"] == "documentNumber" and p[11]["sameGuestAs"] == [] and p[12]["sameGuestAs"] == []
    v = [r[3] for r in rows]
    assert v[1]["fields"]["applicationId"]["value"] == V.JAMES_ETA and v[5]["fields"]["documentNumber"]["value"] == V.AIKO_VISA
    assert v[8]["fields"]["documentNumber"]["value"] == V.RAVI_OCI and v[8]["fields"]["visaNumber"]["value"] == V.RAVI_UVISA
    assert v[10]["fields"]["passportNumber"]["value"] == V.ANNA_PASSPORT and v[12]["fields"]["name"]["value"] == "WEI CHEN"
    for values, blob in results:
        assert "unpairedSide" not in values["flags"] and len(blob) == values["result_bytes"] <= CAP


# ---- PDF files --------------------------------------------------------------------------------------------------------------

def test_e_aadhaar_and_eta_as_pdf_files(pipe):
    """Both come as PDF files with a text layer. The worker renders every page at 300 dpi (its own PDF path), reads the picture and
    uses the text layer as a hint. A password-protected PDF (as UIDAI sends it) is refused with a plain reason."""
    me = K.MEENA
    aadhaar_pdf = V.pdf_page(K.e_aadhaar_letter(me, K.MEENA_VID), V.e_aadhaar_text(me, K.MEENA_VID))
    eta_pdf = V.pdf_page(V.eta_printout(J, V.JAMES_ETA, V.JAMES_PASSPORT), V.ETA_TEXT(J, V.JAMES_ETA, V.JAMES_PASSPORT))
    scanned_eta = V.pdf_page(V.eta_printout(J, V.JAMES_ETA, V.JAMES_PASSPORT))  # a scan: no text layer at all

    def go(data):
        return pipe.analyse([data], _job(multi=False))

    with ThreadPoolExecutor(max_workers=3) as pool:
        (a, a_blob), (e, e_blob), (s, _) = list(pool.map(go, [aadhaar_pdf, eta_pdf, scanned_eta]))
    f = {k: x["value"] for k, x in a["fields"].items()}
    print("\n", a["document_type"], f, "\n", e["document_type"], {k: x["value"] for k, x in e["fields"].items()})
    assert a["document_type"]["type"] == "aadhaar" and a["pages"] == 1 and f["form"] == "letter"
    assert f["documentNumber"] == me.aadhaar and f["name"] == me.name and f["dob"] == me.iso and f["vid"] == K.MEENA_VID
    assert len(a_blob) <= CAP and naming.stem(a["fields"], "aadhaar") == "Meena_Desai_Aadhaar"
    for values in (e, s):
        g = {k: x["value"] for k, x in values["fields"].items()}
        assert values["document_type"]["type"] == "visa" and g["form"] == "eta" and g["applicationId"] == V.JAMES_ETA
        assert g["passportNumber"] == V.JAMES_PASSPORT and g["dob"] == J.iso and g["expiry"] == "2027-09-30" and g["entries"] == "MULTIPLE"
    assert len(e_blob) <= CAP and naming.stem(e["fields"], "visa") == "James_Carter_Visa"
    locked = V.pdf_page(K.e_aadhaar_letter(me, K.MEENA_VID), V.e_aadhaar_text(me, K.MEENA_VID), encrypt_with="MEEN1988")
    with pytest.raises(StepError) as refused:
        pipe.analyse([locked], _job(multi=False))
    assert refused.value.code == "pdf_encrypted" and refused.value.reject
