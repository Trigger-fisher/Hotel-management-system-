"""INVENTED drawings of every ID kind a hotel in India is handed, for the type / field / pairing / naming tests. Every name, number,
address and date is made up. Numbers pass their own checks where a check exists (Aadhaar and VID Verhoeff, PAN pattern, licence
state code and year, EPIC pattern, MRZ check digits). Nothing here is, or is copied from, a real document.

Sizes follow the real formats loosely: ID-1 cards 1000 x 630, passport pages and OCI 1250 x 880 (ID-3), visa sticker 1200 x 800,
e-Aadhaar letter about A4 (1000 x 1414). Use `layout_sheet` to lay mixed sizes on white paper for the stub cutter (tests/sheets.py)."""
from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw

from app.readcore.mrz import check_digit as cd
from tests.cards import qr_image, secure_qr_payload
from tests.helpers import verhoeff_append
from tests.imaging import font

CARD = (1000, 630)
PAGE = (1250, 880)
VISA = (1200, 800)
LETTER = (1000, 1414)


def _seg(size: int):
    return font("segoeui.ttf", size)


def _nir(size: int):
    return font("Nirmala.ttc", size)


def _mono(size: int):
    return font("consola.ttf", size) or font("cour.ttf", size)


def _canvas(size, tint):
    img = Image.new("RGB", size, tint)
    return img, ImageDraw.Draw(img)


@dataclass
class Indian:
    name: str
    dob: str  # dd/mm/yyyy
    gender: str
    aadhaar: str  # 12 digits, valid Verhoeff
    street: str
    city: str  # with the pin code
    father: str

    @property
    def spaced(self) -> str:
        return f"{self.aadhaar[:4]} {self.aadhaar[4:8]} {self.aadhaar[8:]}"

    @property
    def iso(self) -> str:
        d, m, y = self.dob.split("/")
        return f"{y}-{m}-{d}"


def indian(name, dob, gender, digits11, street, city, father) -> Indian:
    return Indian(name, dob, gender, verhoeff_append(digits11), street, city, father)


ANIL = indian("Anil Mehra", "14/03/1981", "Male", "28473619205", "C/O Ravi Mehra, 12 Lake View Road", "Surat, Gujarat - 395007", "Ravi Mehra")
KAVITA = indian("Kavita Joshi", "02/11/1990", "Female", "35720946183", "W/O Nikhil Joshi, 44 Garden Street", "Vadodara, Gujarat - 390001",
                "Harish Pandya")
SURESH = indian("Suresh Patel", "21/07/1975", "Male", "46281937502", "7 Station Lane, Near Clock Tower", "Anand, Gujarat - 388001",
                "Mohan Patel")
MEENA = indian("Meena Desai", "09/05/1988", "Female", "59302746811", "D/O Harish Desai, 3 Temple Road", "Pune, Maharashtra - 411001",
               "Harish Desai")
FARHAN = indian("Farhan Qureshi", "30/12/1993", "Male", "67143829056", "S/O Imran Qureshi, 19 Market Road", "Bharuch, Gujarat - 392001",
                "Imran Qureshi")

ANIL_PAN = "BQRPM4821K"
KAVITA_DL = "GJ01 20190001234"
KAVITA_EPIC = "XKT4829163"
SURESH_PASSPORT, SURESH_FILE, SURESH_OLD = "Z4829163", "AH1069876543210", "J7654321"
MEENA_DL_OLD = "MH-12/0034567/2008"
MEENA_VID = verhoeff_append("913456789012345")


# ---- Aadhaar -------------------------------------------------------------------------------------------------------------

def aadhaar_old_front(p: Indian) -> Image.Image:
    """Old laminated card (the cut-out strip of a paper letter): paper white, no QR on the front, Hindi heading."""
    img, d = _canvas(CARD, (250, 248, 240))
    d.text((30, 20), "भारत सरकार", font=_nir(40), fill=0)
    d.text((30, 75), "Government of India", font=_seg(36), fill=0)
    d.rectangle((30, 150, 220, 390), fill=(200, 200, 200), outline=(120, 120, 120), width=3)
    d.text((260, 170), p.name, font=_seg(38), fill=0)
    d.text((260, 230), f"DOB: {p.dob}", font=_seg(36), fill=0)
    d.text((260, 290), p.gender, font=_seg(36), fill=0)
    d.text((260, 460), p.spaced, font=_seg(54), fill=0)
    d.text((240, 560), "मेरा आधार, मेरी पहचान", font=_nir(34), fill=(160, 0, 0))
    return img


def xml_qr(p: Indian) -> str:
    """The OLD Aadhaar QR shape (plain XML, full number). INVENTED content."""
    return (f'<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="{p.aadhaar}" name="{p.name}" '
            f'gender="{p.gender[0]}" yob="{p.dob[-4:]}" dob="{p.dob}" vtc="{p.city.split(",")[0]}"/>')


def aadhaar_old_back(p: Indian) -> Image.Image:
    img, d = _canvas(CARD, (250, 248, 240))
    d.text((30, 20), "Unique Identification Authority of India", font=_seg(32), fill=0)
    d.text((30, 110), f"Address: {p.street}", font=_seg(32), fill=0)
    d.text((30, 160), p.city, font=_seg(32), fill=0)
    d.text((260, 470), p.spaced, font=_seg(54), fill=0)
    img.paste(qr_image(xml_qr(p), 240), (730, 200))
    return img


def e_aadhaar_letter(p: Indian, vid: str) -> Image.Image:
    """e-Aadhaar letter (A4 print): Enrolment No., "To", name, address, "Your Aadhaar No.", the VID, and the cut-out strip with the
    front and the back side by side at the bottom."""
    img, d = _canvas(LETTER, (251, 251, 247))
    d.rectangle((0, 0, LETTER[0], 70), fill=(255, 153, 51))
    d.text((30, 12), "Unique Identification Authority of India", font=_seg(36), fill=0)
    d.text((40, 110), "Enrolment No.: 1234/56789/01234", font=_seg(32), fill=0)
    d.text((40, 190), "To", font=_seg(32), fill=0)
    d.text((40, 240), p.name, font=_seg(34), fill=0)
    d.text((40, 290), p.street, font=_seg(32), fill=0)
    d.text((40, 340), p.city, font=_seg(32), fill=0)
    d.text((40, 450), "आपका आधार क्रमांक / Your Aadhaar No. :", font=_nir(34), fill=0)
    d.text((300, 510), p.spaced, font=_seg(60), fill=0)
    d.text((300, 600), f"VID : {vid[:4]} {vid[4:8]} {vid[8:12]} {vid[12:]}", font=_seg(32), fill=0)
    d.text((300, 660), "मेरा आधार, मेरी पहचान", font=_nir(36), fill=(160, 0, 0))
    # the strip: front (left) and back (right), dashed cut line above
    for x in range(20, LETTER[0] - 20, 30):
        d.line((x, 780, x + 15, 780), fill=(90, 90, 90), width=2)
    d.rectangle((20, 820, 490, 1360), outline=(90, 90, 90), width=2)
    d.rectangle((510, 820, 980, 1360), outline=(90, 90, 90), width=2)
    d.text((40, 840), "Government of India", font=_seg(28), fill=0)
    d.text((40, 960), p.name, font=_seg(28), fill=0)
    d.text((40, 1010), f"DOB: {p.dob}", font=_seg(28), fill=0)
    d.text((40, 1060), p.gender, font=_seg(28), fill=0)
    d.text((60, 1250), p.spaced, font=_seg(40), fill=0)
    d.text((530, 840), f"Address: {p.street}", font=_seg(24), fill=0)
    d.text((530, 880), p.city, font=_seg(24), fill=0)
    img.paste(qr_image(secure_qr_payload(p.name, p.dob, p.aadhaar[-4:]), 220), (640, 1000))
    return img


# ---- PAN -----------------------------------------------------------------------------------------------------------------

def pan_old(p: Indian, number: str) -> Image.Image:
    """Old PAN: no labels; name, father's name, date of birth under the header."""
    img, d = _canvas(CARD, (214, 230, 246))
    d.text((30, 20), "आयकर विभाग", font=_nir(34), fill=0)
    d.text((30, 70), "INCOME TAX DEPARTMENT", font=_seg(34), fill=0)
    d.text((620, 70), "GOVT. OF INDIA", font=_seg(34), fill=0)
    d.text((30, 170), p.name.upper(), font=_seg(38), fill=0)
    d.text((30, 230), p.father.upper(), font=_seg(38), fill=0)
    d.text((30, 290), p.dob, font=_seg(38), fill=0)
    d.text((30, 380), "Permanent Account Number", font=_seg(32), fill=0)
    d.text((30, 430), number, font=_seg(52), fill=0)
    d.rectangle((760, 180, 960, 420), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    return img


def pan_new(p: Indian, number: str) -> Image.Image:
    """New PAN (with QR): bilingual label lines, the value on the line below. The QR holds INVENTED KEY=value text."""
    img, d = _canvas(CARD, (222, 236, 250))
    d.text((30, 15), "आयकर विभाग  INCOME TAX DEPARTMENT", font=_nir(32), fill=0)
    d.text((30, 70), "Permanent Account Number Card", font=_seg(30), fill=0)
    d.text((30, 120), number, font=_seg(46), fill=0)
    d.text((30, 200), "नाम / Name", font=_nir(26), fill=(60, 60, 60))
    d.text((30, 235), p.name.upper(), font=_seg(36), fill=0)
    d.text((30, 300), "पिता का नाम / Father's Name", font=_nir(26), fill=(60, 60, 60))
    d.text((30, 335), p.father.upper(), font=_seg(36), fill=0)
    d.text((30, 400), "जन्म की तारीख / Date of Birth", font=_nir(26), fill=(60, 60, 60))
    d.text((30, 435), p.dob, font=_seg(36), fill=0)
    img.paste(qr_image(f"NAME={p.name.upper()};DOB={p.dob};ID={number}", 210), (760, 330))
    return img


# ---- driving licence -----------------------------------------------------------------------------------------------------

def dl_smart_front(p: Indian, number: str) -> Image.Image:
    img, d = _canvas(CARD, (236, 244, 252))
    d.rectangle((0, 0, CARD[0], 60), fill=(40, 90, 170))
    d.text((30, 8), "INDIAN UNION DRIVING LICENCE", font=_seg(34), fill=(255, 255, 255))
    d.text((30, 75), "Issued by Government of Gujarat", font=_seg(28), fill=0)
    d.text((30, 125), f"DL No: {number}", font=_seg(36), fill=0)
    d.text((30, 185), f"Name: {p.name}", font=_seg(32), fill=0)
    d.text((30, 235), f"DOB: {p.dob}", font=_seg(32), fill=0)
    d.text((30, 285), f"S/D/W of: {p.father}", font=_seg(32), fill=0)
    d.text((30, 335), f"Address: {p.street}", font=_seg(30), fill=0)
    d.text((30, 380), p.city, font=_seg(30), fill=0)
    d.text((30, 450), "Date of Issue: 15/06/2019", font=_seg(30), fill=0)
    d.text((30, 500), "Valid Till: 01/11/2040", font=_seg(30), fill=0)
    d.rectangle((790, 120, 970, 360), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    return img


def dl_smart_back(p: Indian, number: str) -> Image.Image:
    img, d = _canvas(CARD, (244, 240, 252))
    d.text((30, 20), "INDIAN UNION DRIVING LICENCE", font=_seg(32), fill=0)
    d.text((30, 80), f"DL No: {number}", font=_seg(34), fill=0)
    d.text((30, 150), "Class of Vehicle    Date of Issue", font=_seg(30), fill=0)
    d.text((30, 200), "MCWG                15/06/2019", font=_seg(30), fill=0)
    d.text((30, 250), "LMV                 15/06/2019", font=_seg(30), fill=0)
    d.text((30, 330), "Licensing Authority: RTO Ahmedabad", font=_seg(30), fill=0)
    d.text((30, 380), "Emergency Contact No: 0000000000", font=_seg(28), fill=0)
    img.paste(qr_image(f"DL={number.replace(' ', '')}", 170), (790, 380))
    return img


def dl_old_front(p: Indian, number: str) -> Image.Image:
    """An older state format (paper-like card, number with slashes)."""
    img, d = _canvas(CARD, (250, 246, 226))
    d.text((30, 20), "MAHARASHTRA STATE", font=_seg(34), fill=0)
    d.text((30, 70), "DRIVING LICENCE   FORM 7", font=_seg(34), fill=0)
    d.text((30, 140), f"Licence No: {number}", font=_seg(34), fill=0)
    d.text((30, 200), f"Name: {p.name}", font=_seg(32), fill=0)
    d.text((30, 250), f"S/D/W of: {p.father}", font=_seg(32), fill=0)
    d.text((30, 300), f"Date of Birth: {p.dob}", font=_seg(32), fill=0)
    d.text((30, 360), "Valid Till: 08/05/2028", font=_seg(30), fill=0)
    d.rectangle((790, 140, 970, 380), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    return img


def dl_old_back(p: Indian, number: str) -> Image.Image:
    img, d = _canvas(CARD, (246, 242, 222))
    d.text((30, 20), "Transport Department", font=_seg(32), fill=0)
    d.text((30, 80), f"Licence No: {number}", font=_seg(32), fill=0)
    d.text((30, 140), f"Address: {p.street}", font=_seg(30), fill=0)
    d.text((30, 185), p.city, font=_seg(30), fill=0)
    d.text((30, 260), "Class of Vehicle: LMV  MCWG", font=_seg(30), fill=0)
    d.text((30, 320), "Date of Issue: 10/04/2008", font=_seg(30), fill=0)
    return img


# ---- voter ID (EPIC) -------------------------------------------------------------------------------------------------------

def voter_front(p: Indian, epic: str) -> Image.Image:
    img, d = _canvas(CARD, (250, 238, 232))
    d.text((30, 15), "भारत निर्वाचन आयोग", font=_nir(32), fill=0)
    d.text((30, 65), "ELECTION COMMISSION OF INDIA", font=_seg(32), fill=0)
    d.text((30, 110), "ELECTOR PHOTO IDENTITY CARD", font=_seg(28), fill=0)
    d.text((30, 170), epic, font=_seg(44), fill=0)
    d.text((30, 260), f"Elector's Name: {p.name}", font=_seg(30), fill=0)
    d.text((30, 310), f"Father's Name: {p.father}", font=_seg(30), fill=0)
    d.rectangle((790, 170, 970, 410), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    return img


def voter_back(p: Indian, epic: str) -> Image.Image:
    img, d = _canvas(CARD, (246, 236, 236))
    d.text((30, 20), epic, font=_seg(40), fill=0)
    d.text((30, 100), f"Sex: {p.gender}", font=_seg(30), fill=0)
    d.text((30, 150), f"Date of Birth: {p.dob}", font=_seg(30), fill=0)
    d.text((30, 210), f"Address: {p.street}", font=_seg(30), fill=0)
    d.text((30, 255), p.city, font=_seg(30), fill=0)
    d.text((30, 380), "Electoral Registration Officer", font=_seg(28), fill=0)
    d.text((30, 425), "Assembly Constituency: 141 Vadodara City", font=_seg(26), fill=0)
    return img


# ---- MRZ lines (ICAO 9303), check digits computed ----------------------------------------------------------------------------

def _names(surname: str, given: str, width: int) -> str:
    return (surname.upper().replace(" ", "<") + "<<" + given.upper().replace(" ", "<")).ljust(width, "<")[:width]


def td3(country, surname, given, number, nationality, dob, sex, expiry, personal="", code="P<") -> list[str]:
    l1 = code + country + _names(surname, given, 39)
    n, p = number.ljust(9, "<"), personal.ljust(14, "<")
    body = n + cd(n) + nationality + dob + cd(dob) + sex + expiry + cd(expiry) + p + (cd(p) if personal else "<")
    return [l1, body + cd(body[0:10] + body[13:20] + body[21:43])]


def mrv(kind, country, surname, given, number, nationality, dob, sex, expiry, optional="", code="V<") -> list[str]:
    """Visa MRZ: MRV-A (2 x 44) or MRV-B (2 x 36); no composite check digit."""
    width = 44 if kind == "A" else 36
    l1 = code + country + _names(surname, given, width - 5)
    n = number.ljust(9, "<")
    l2 = n + cd(n) + nationality + dob + cd(dob) + sex + expiry + cd(expiry)
    return [l1, (l2 + optional).ljust(width, "<")]


def td1(country, surname, given, number, nationality, dob, sex, expiry, code="I<") -> list[str]:
    n = number.ljust(9, "<")
    l1 = (code + country + n + cd(n)).ljust(30, "<")
    l2 = dob + cd(dob) + sex + expiry + cd(expiry) + nationality + "<" * 11
    l2 += cd(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29])
    return [l1, l2, _names(surname, given, 30)]


def td2(country, surname, given, number, nationality, dob, sex, expiry, code="I<") -> list[str]:
    l1 = code + country + _names(surname, given, 31)
    n = number.ljust(9, "<")
    body = n + cd(n) + nationality + dob + cd(dob) + sex + expiry + cd(expiry) + "<" * 7
    return [l1, body + cd(body[0:10] + body[13:20] + body[21:35])]


def _mrz(d: ImageDraw.ImageDraw, lines: list[str], top: int, size: int = 34, left: int = 30) -> None:
    for i, text in enumerate(lines):
        d.text((left, top + i * int(size * 1.6)), text, font=_mono(size), fill=0)


# ---- passports -------------------------------------------------------------------------------------------------------------

def passport_india_data(p: Indian, number: str) -> Image.Image:
    """Indian passport data page: bilingual labels with values below, the photo, and the TD3 MRZ."""
    sur, given = p.name.split()[-1], " ".join(p.name.split()[:-1])
    img, d = _canvas(PAGE, (236, 242, 232))
    d.text((40, 20), "भारत गणराज्य   REPUBLIC OF INDIA", font=_nir(38), fill=(20, 40, 110))
    d.rectangle((40, 100, 290, 420), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    lab, val = _seg(22), _seg(32)
    rows = [("Type / Country Code", f"P   IND"), ("Passport No. / पासपोर्ट नं.", number), ("Surname / उपनाम", sur.upper()),
            ("Given Name(s) / दिया गया नाम", given.upper()), ("Nationality / राष्ट्रीयता", "INDIAN"),
            ("Sex / लिंग", p.gender[0]), ("Date of Birth / जन्मतिथि", p.dob), ("Place of Birth", "SURAT, GUJARAT"),
            ("Place of Issue", "AHMEDABAD"), ("Date of Issue", "12/03/2022"), ("Date of Expiry", "11/03/2032")]
    for i, (label, value) in enumerate(rows):
        x, y = (330, 100 + i * 75) if i < 7 else (760, 100 + (i - 5) * 75)
        d.text((x, y), label, font=_nir(22) if any(ord(c) > 0x900 for c in label) else lab, fill=(70, 70, 70))
        d.text((x, y + 28), value, font=val, fill=0)
    d, yy = d, p.dob.split("/")
    _mrz(d, td3("IND", sur, given, number, "IND", yy[2][2:] + yy[1] + yy[0], p.gender[0], "320311"), 730)
    return img


def passport_india_address(p: Indian, number: str, file_no: str, old: str) -> Image.Image:
    """The Indian passport's last page: parents, address, the old passport and the file number; the passport number on top."""
    img, d = _canvas(PAGE, (240, 240, 228))
    f, small = _seg(30), _seg(24)
    d.text((40, 25), f"Passport No.: {number}", font=f, fill=0)
    d.text((40, 90), "Name of Father / Legal Guardian", font=small, fill=(70, 70, 70))
    d.text((40, 120), p.father.upper(), font=f, fill=0)
    d.text((40, 180), "Name of Mother", font=small, fill=(70, 70, 70))
    d.text((40, 210), "SAROJ PATEL", font=f, fill=0)
    d.text((40, 270), "Name of Spouse", font=small, fill=(70, 70, 70))
    d.text((40, 300), "LATA PATEL", font=f, fill=0)
    d.text((40, 370), "Address", font=small, fill=(70, 70, 70))
    d.text((40, 400), p.street.upper(), font=f, fill=0)
    d.text((40, 445), p.city.upper(), font=f, fill=0)
    d.text((40, 530), "Old Passport No. with Date and Place of Issue", font=small, fill=(70, 70, 70))
    d.text((40, 560), f"{old}, 05/01/2012, AHMEDABAD", font=f, fill=0)
    d.text((40, 640), "File No.", font=small, fill=(70, 70, 70))
    d.text((40, 670), file_no, font=f, fill=0)
    return img


@dataclass
class Foreigner:
    surname: str
    given: str
    dob: str  # YYMMDD
    sex: str
    nationality: str  # ICAO code

    @property
    def name(self) -> str:
        return f"{self.given} {self.surname}".title()

    @property
    def iso(self) -> str:
        return f"19{self.dob[:2]}-{self.dob[2:4]}-{self.dob[4:]}"

    @property
    def printed_dob(self) -> str:
        return f"{self.dob[4:]}/{self.dob[2:4]}/19{self.dob[:2]}"


EMMA = Foreigner("LINDQVIST", "EMMA", "850612", "F", "SWE")
LUKAS = Foreigner("BRENNER", "LUKAS", "790223", "M", "DEU")
SOFIA = Foreigner("ROMANO", "SOFIA", "920917", "F", "ITA")
DANIEL = Foreigner("OKAFOR", "DANIEL", "870402", "M", "GBR")
EMMA_PASSPORT, EMMA_VISA = "XA7429163", "VX4829163"
LUKAS_ID, SOFIA_ID = "L01X00T47", "CA48291K6"
DANIEL_OCI, DANIEL_PASSPORT = "A4829163", "GB5512847"


def passport_foreign(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(PAGE, (232, 238, 246))
    d.text((40, 20), "PASSPORT   PASS   PASSEPORT", font=_seg(38), fill=(20, 40, 110))
    d.rectangle((40, 100, 290, 420), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    rows = [("Type / Code", f"P   {g.nationality}"), ("Passport No.", number), ("Surname", g.surname), ("Given names", g.given),
            ("Nationality", g.nationality), ("Date of birth", g.printed_dob), ("Sex", g.sex), ("Date of expiry", "11/06/2033")]
    for i, (label, value) in enumerate(rows):
        x, y = (330, 100 + i * 75) if i < 6 else (760, 100 + (i - 4) * 75)
        d.text((x, y), label, font=_seg(22), fill=(70, 70, 70))
        d.text((x, y + 28), value, font=_seg(32), fill=0)
    _mrz(d, td3(g.nationality, g.surname, g.given, number, g.nationality, g.dob, g.sex, "330611"), 730)
    return img


def visa_sticker(g: Foreigner, number: str, passport: str) -> Image.Image:
    """An invented Indian visa sticker (MRV-A): printed details and the 2 x 44 MRZ."""
    img, d = _canvas(VISA, (246, 236, 246))
    d.text((40, 20), "VISA   भारत   INDIA", font=_nir(40), fill=(110, 20, 80))
    d.rectangle((40, 100, 260, 380), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    rows = [("Surname", g.surname), ("Given Names", g.given), ("Passport No.", passport), ("Nationality", g.nationality),
            ("Type of Visa", "TOURIST"), ("No. of Entries", "MULTIPLE"), ("Valid From", "01/10/2026"), ("Valid Until", "31/03/2027")]
    for i, (label, value) in enumerate(rows):
        x, y = (300, 100 + i * 70) if i < 4 else (750, 100 + (i - 4) * 70)
        d.text((x, y), label, font=_seg(22), fill=(70, 70, 70))
        d.text((x, y + 26), value, font=_seg(30), fill=0)
    _mrz(d, mrv("A", "IND", g.surname, g.given, number, g.nationality, g.dob, g.sex, "270331"), 650)
    return img


def oci_card(g: Foreigner, number: str, passport: str) -> Image.Image:
    img, d = _canvas(PAGE, (236, 246, 240))
    d.text((40, 20), "OVERSEAS CITIZEN OF INDIA", font=_seg(40), fill=(20, 90, 60))
    d.text((40, 75), "भारत का प्रवासी नागरिक कार्ड", font=_nir(32), fill=(20, 90, 60))
    d.rectangle((40, 140, 290, 460), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    rows = [("OCI Card No.", number), ("Surname", g.surname), ("Given Name", g.given), ("Date of Birth", g.printed_dob),
            ("Nationality", "BRITISH"), ("Passport No.", passport), ("Place of Birth", "LONDON"), ("Date of Issue", "04/08/2021")]
    for i, (label, value) in enumerate(rows):
        x, y = (330, 140 + i * 75) if i < 5 else (780, 140 + (i - 5) * 75)
        d.text((x, y), label, font=_seg(22), fill=(70, 70, 70))
        d.text((x, y + 28), value, font=_seg(32), fill=0)
    return img


def id_td1_front(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(CARD, (232, 242, 236))
    d.text((30, 15), "IDENTITY CARD   PERSONALAUSWEIS", font=_seg(32), fill=(20, 60, 40))
    d.rectangle((30, 90, 250, 370), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    rows = [("Surname", g.surname), ("Given names", g.given), ("Date of birth", g.printed_dob.replace("/", ".")),
            ("Nationality", "DEUTSCH")]
    for i, (label, value) in enumerate(rows):
        d.text((290, 85 + i * 85), label, font=_seg(22), fill=(70, 70, 70))
        d.text((290, 112 + i * 85), value, font=_seg(32), fill=0)
    d.text((30, 470), f"Document No: {number}", font=_seg(32), fill=0)
    return img


def id_td1_back(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(CARD, (226, 238, 232))
    d.text((30, 20), "Address: Hauptstrasse 5, 10115 Berlin", font=_seg(30), fill=0)
    d.text((30, 70), "Height 182 cm   Eyes BLUE", font=_seg(28), fill=0)
    _mrz(d, td1("D<<", g.surname, g.given, number, "D<<", g.dob, g.sex, "340222", code="ID"), 360, size=40, left=40)
    return img


def id_td2_front(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(CARD, (240, 236, 228))
    d.text((30, 15), "CARTA D'IDENTITÀ   IDENTITY CARD", font=_seg(32), fill=(80, 40, 20))
    d.rectangle((30, 90, 230, 330), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    d.text((270, 100), f"Surname: {g.surname}", font=_seg(30), fill=0)
    d.text((270, 150), f"Given names: {g.given}", font=_seg(30), fill=0)
    d.text((270, 200), f"Date of birth: {g.printed_dob}", font=_seg(30), fill=0)
    _mrz(d, td2(g.nationality, g.surname, g.given, number, g.nationality, g.dob, g.sex, "320916"), 440, size=36, left=30)
    return img


def id_td2_back(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(CARD, (236, 232, 226))
    d.text((30, 20), "IDENTITY CARD", font=_seg(30), fill=(80, 40, 20))
    d.text((30, 70), f"Card No: {number}", font=_seg(32), fill=0)
    d.text((30, 110), "Address: Via Roma 21, 00184 Roma", font=_seg(30), fill=0)
    d.text((30, 170), "Place of birth: NAPOLI", font=_seg(30), fill=0)
    return img


# ---- other cards ---------------------------------------------------------------------------------------------------------

def employee(name: str, number: str) -> Image.Image:
    img, d = _canvas(CARD, (235, 250, 240))
    d.text((30, 30), "SILVER LEAF LOGISTICS", font=_seg(38), fill=0)
    d.text((30, 90), "EMPLOYEE CARD", font=_seg(36), fill=0)
    d.text((30, 220), f"Name: {name}", font=_seg(36), fill=0)
    d.text((30, 290), f"Emp ID: {number}", font=_seg(36), fill=0)
    return img


def unknown_member(name: str, number: str) -> Image.Image:
    """Not an ID type the reader knows, but it carries a name and a number: kept as unknown, reception types the fields."""
    img, d = _canvas(CARD, (240, 230, 245))
    d.text((30, 40), "CITY FITNESS GYM", font=_seg(42), fill=0)
    d.text((30, 160), f"Member: {name}", font=_seg(38), fill=0)
    d.text((30, 230), f"Member No: {number}", font=_seg(38), fill=0)
    d.text((30, 330), "Valid at all branches", font=_seg(34), fill=0)
    return img


# ---- sheets ----------------------------------------------------------------------------------------------------------------

def layout_sheet(items: list[Image.Image], columns: int = 2, gap: int = 90, margin: int = 80) -> Image.Image:
    """White paper with pictures of mixed sizes in rows (top-aligned), reading order = list order."""
    rows = [items[i:i + columns] for i in range(0, len(items), columns)]
    width = 2 * margin + max(sum(im.width for im in row) + gap * (len(row) - 1) for row in rows)
    height = 2 * margin + sum(max(im.height for im in row) for row in rows) + gap * (len(rows) - 1)
    paper = Image.new("RGB", (width, height), (255, 255, 255))
    y = margin
    for row in rows:
        x = margin
        for im in row:
            paper.paste(im, (x, y))
            x += im.width + gap
        y += max(im.height for im in row) + gap
    return paper
