"""INVENTED drawings for foreign guests at an Indian hotel (visas in every form, OCI in every form, the legacy PIO card, residence
permits, the FRRO permit printout), Gujarati-labelled Indian cards, and PDF files built from them. Every name, number, date and
address is made up; MRZ lines carry correct check digits. Nothing here is, or is copied from, a real document.

Gujarati needs real text shaping (vowel signs, conjuncts). Pillow shapes only with libraqm + FriBiDi; the FriBiDi DLL ships with
Tesseract on Windows, so the Gujarati strings are drawn by a short child Python with that folder on its DLL path (the test process
itself keeps Pillow's basic layout, so the other drawings are unchanged). Without it the strings are drawn unshaped (SHAPED False)."""
from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

from tests import idkinds as K
from tests.idkinds import Foreigner, indian
from tests.imaging import FONTS, font

TESSERACT_DIR = Path(r"C:\Program Files\Tesseract-OCR")
STICKER_B = (1050, 740)  # MRV-B, 105 x 74 mm
A4 = (1000, 1414)
PAPER = (250, 250, 247)  # printed A4 pages: off-white, like the e-Aadhaar letter (the stub cutter needs a step from the white sheet)


def _seg(size: int):
    return font("segoeui.ttf", size)


def _bold(size: int):
    return font("segoeuib.ttf", size) or _seg(size)


def _canvas(size, tint):
    img = Image.new("RGB", size, tint)
    return img, ImageDraw.Draw(img)


def _rows(d, rows, x, y, step, lab=22, val=30, dx=0):
    for i, (label, value) in enumerate(rows):
        d.text((x + dx * i, y + i * step), label, font=_seg(lab), fill=(70, 70, 70))
        d.text((x + dx * i, y + i * step + lab + 6), value, font=_seg(val), fill=0)


# ---- people (all invented) ---------------------------------------------------------------------------------------------------

JAMES = Foreigner("CARTER", "JAMES", "880915", "M", "USA")  # passport + e-Visa ETA
MARTA = Foreigner("KOWALSKA", "MARTA", "910304", "F", "POL")  # passport + older visa sticker without an MRZ
AIKO = Foreigner("TANAKA", "AIKO", "950721", "F", "JPN")  # passport + MRV-B sticker
RAVI = Foreigner("NAIR", "RAVI", "760130", "M", "USA")  # passport + OCI booklet + OCI U-visa sticker
MOHAN = Foreigner("DAS", "MOHAN", "700811", "M", "GBR")  # PIO card
CHEN = Foreigner("CHEN", "WEI", "890506", "M", "CHN")  # German residence permit (TD1, code AR)
LUCIA = Foreigner("FERRARI", "LUCIA", "940318", "F", "BRA")  # residence permit TD2 (code IR)
ANNA = Foreigner("SCHMIDT", "ANNA", "930214", "F", "DEU")  # passport + FRRO residential permit printout

JAMES_PASSPORT, JAMES_ETA = "583920174", "IN26TV8F4K2Q9X"
MARTA_PASSPORT, MARTA_VISA = "EK4829173", "VB1840273"
AIKO_PASSPORT, AIKO_VISA = "TK8271935", "VJ5502817"
RAVI_PASSPORT, RAVI_OCI, RAVI_UVISA = "492817365", "A1938274", "VU2093847"
MOHAN_PASSPORT, MOHAN_PIO = "761204839", "P0427913"
CHEN_RP, LUCIA_RP = "RX4829163", "IR7730164"
ANNA_PASSPORT, ANNA_FRRO, ANNA_VISA = "C4X7Z2K91", "AHM2026RP004512", "VE7730164"

HETAL = indian("Hetal Shah", "18/08/1992", "Female", "72910384652", "W/O Mehul Shah, 9 Ambika Society", "Ahmedabad, Gujarat - 380015",
               "Kirit Shah")
JIGNESH = indian("Jignesh Parmar", "05/01/1986", "Male", "81726354091", "12 Nehru Nagar, Kalavad Road", "Rajkot, Gujarat - 360001",
                 "Bhanubhai Parmar")
JIGNESH_DL = "GJ03 20150004567"


# ---- Gujarati with real shaping ----------------------------------------------------------------------------------------------

_CHILD = r"""
import base64, io, json, os, sys
os.add_dll_directory(sys.argv[1])
os.environ["PATH"] = sys.argv[1] + os.pathsep + os.environ["PATH"]
from PIL import Image, ImageDraw, ImageFont, features
out = {"shaped": bool(features.check("raqm")), "images": []}
for text, size, colour in json.loads(sys.stdin.read()):
    f = ImageFont.truetype(sys.argv[2], size)
    box = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), text, font=f)
    img = Image.new("RGBA", (box[2] + 4, box[3] + 8), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((0, 0), text, font=f, fill=tuple(colour) + (255,))
    buf = io.BytesIO(); img.save(buf, "PNG"); out["images"].append(base64.b64encode(buf.getvalue()).decode())
print(json.dumps(out))
"""
SHAPED: bool | None = None


def shaped_texts(items: list[tuple[str, int, tuple[int, int, int]]]) -> list[Image.Image]:
    """RGBA pictures of each (text, size, colour), shaped by libraqm when the FriBiDi DLL can be found."""
    global SHAPED
    nirmala = str(FONTS / "Nirmala.ttc")
    if TESSERACT_DIR.joinpath("libfribidi-0.dll").exists():
        done = subprocess.run([sys.executable, "-I", "-c", _CHILD, str(TESSERACT_DIR), nirmala], input=json.dumps(items).encode("utf-8"),
                              capture_output=True, timeout=60, check=False)
        if done.returncode == 0:
            out = json.loads(done.stdout)
            SHAPED = out["shaped"]
            return [Image.open(io.BytesIO(base64.b64decode(b))).convert("RGBA") for b in out["images"]]
    SHAPED = False
    pics = []
    for text, size, colour in items:
        f = font("Nirmala.ttc", size)
        box = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), text, font=f)
        img = Image.new("RGBA", (box[2] + 4, box[3] + 8), (0, 0, 0, 0))
        ImageDraw.Draw(img).text((0, 0), text, font=f, fill=tuple(colour) + (255,))
        pics.append(img)
    return pics


def _paste_gu(img: Image.Image, placed: list[tuple[tuple[int, int], str, int, tuple[int, int, int]]]) -> None:
    pics = shaped_texts([(t, s, c) for _, t, s, c in placed])
    for (xy, *_), pic in zip(placed, pics):
        img.paste(pic, xy, pic)


def aadhaar_gujarati_front(p) -> Image.Image:
    """A PVC-style Aadhaar front with Gujarati labels (Gujarati name above the English one, as printed in Gujarat)."""
    img, d = _canvas(K.CARD, (248, 246, 238))
    d.rectangle((30, 150, 220, 390), fill=(200, 200, 200), outline=(120, 120, 120), width=3)
    d.text((30, 75), "Government of India", font=_seg(34), fill=0)
    d.text((260, 220), p.name, font=_seg(38), fill=0)
    d.text((540, 280), f"DOB: {p.dob}", font=_seg(36), fill=0)
    d.text((440, 340), p.gender, font=_seg(36), fill=0)
    d.text((260, 460), p.spaced, font=_seg(54), fill=0)
    _paste_gu(img, [((30, 15), "ભારત સરકાર", 40, (0, 0, 0)), ((260, 160), "હેતલ શાહ", 38, (0, 0, 0)),
                    ((260, 278), "જન્મ તારીખ /", 34, (0, 0, 0)), ((260, 338), "સ્ત્રી /", 34, (0, 0, 0)),
                    ((240, 555), "મારો આધાર, મારી ઓળખ", 34, (160, 0, 0))])
    return img


def dl_gujarati_front(p, number: str) -> Image.Image:
    """A Gujarat licence front with Gujarati labels before the English ones."""
    img, d = _canvas(K.CARD, (236, 244, 252))
    d.rectangle((0, 0, K.CARD[0], 60), fill=(40, 90, 170))
    d.text((30, 8), "INDIAN UNION DRIVING LICENCE", font=_seg(34), fill=(255, 255, 255))
    d.text((300, 75), "Government of Gujarat", font=_seg(28), fill=0)
    rows = [("લાઇસન્સ નં. /", f"DL No: {number}", 125), ("નામ /", f"Name: {p.name}", 185), ("જન્મ તારીખ /", f"DOB: {p.dob}", 240),
            ("પિતાનું નામ /", f"S/D/W of: {p.father}", 295), ("સરનામું /", f"Address: {p.street}", 350)]
    gu = [((30, 68), "ગુજરાત સરકાર", 36, (0, 0, 0)), ((30, 560), "વાહન ચલાવવાનો પરવાનો", 34, (0, 0, 0))]
    for label, value, y in rows:
        gu.append(((30, y), label, 28, (60, 60, 60)))
        d.text((240, y), value, font=_seg(30), fill=0)
    d.text((240, 395), p.city, font=_seg(30), fill=0)
    d.text((30, 450), "Date of Issue: 20/02/2015", font=_seg(28), fill=0)
    d.text((30, 495), "Valid Till: 04/01/2036", font=_seg(28), fill=0)
    d.rectangle((800, 120, 970, 350), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    _paste_gu(img, gu)
    return img


# ---- visas -----------------------------------------------------------------------------------------------------------------

def visa_mrv_b(g: Foreigner, number: str, passport: str) -> Image.Image:
    """An invented smaller visa sticker (MRV-B, 2 x 36 MRZ), printed details on the left of the photo."""
    img, d = _canvas(STICKER_B, (240, 236, 248))
    d.text((30, 15), "VISA   INDIA", font=_bold(36), fill=(110, 20, 80))
    d.rectangle((790, 80, 1010, 360), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    _rows(d, [("Surname", g.surname), ("Given Names", g.given), ("Passport No.", passport)], 30, 75, 70, 20, 28)
    _rows(d, [("Type of Visa", "BUSINESS"), ("No. of Entries", "DOUBLE"), ("Valid Until", "14/02/2027")], 420, 75, 70, 20, 28)
    _mrz_lines(d, K.mrv("B", "IND", g.surname, g.given, number, g.nationality, g.dob, g.sex, "270214"), 560, 36)
    return img


def visa_printed_old(g: Foreigner, number: str, passport: str) -> Image.Image:
    """An older visa sticker with no MRZ: everything from the labels (Visa No, Type, Entries, Valid from / until, passport)."""
    img, d = _canvas(K.VISA, (244, 240, 230))
    d.text((40, 20), "GOVERNMENT OF INDIA", font=_bold(34), fill=(110, 20, 80))
    d.text((40, 70), "VISA", font=_bold(40), fill=(110, 20, 80))
    d.rectangle((40, 140, 260, 420), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    lines = [f"Visa No: {number}", f"Name: {g.given} {g.surname}", f"Passport No: {passport}", "Type: TOURIST", "Entries: MULTIPLE",
             "Valid From: 10/01/2026", "Valid Until: 09/07/2026", "Duration of Stay: 90 DAYS", "Issued at: WARSAW"]
    for i, t in enumerate(lines):
        d.text((300, 140 + i * 62), t, font=_seg(32), fill=0)
    return img


def eta_printout(g: Foreigner, application: str, passport: str) -> Image.Image:
    """An invented e-Visa ETA printout (A4): heading, application ID, holder, passport, visa type, validity, entries."""
    img, d = _canvas(A4, PAPER)
    d.rectangle((0, 0, A4[0], 90), fill=(30, 60, 120))
    d.text((40, 22), "Government of India  -  Bureau of Immigration", font=_bold(34), fill=(255, 255, 255))
    d.text((40, 130), "ELECTRONIC TRAVEL AUTHORISATION (ETA)", font=_bold(40), fill=(30, 60, 120))
    d.text((40, 195), "This ETA permits the holder to travel to India on an e-Visa.", font=_seg(26), fill=(70, 70, 70))
    rows = [("Application ID", application), ("Applicant Name", f"{g.given} {g.surname}"), ("Date of Birth", g.printed_dob),
            ("Nationality", "UNITED STATES"), ("Passport Number", passport), ("Visa Type", "e-TOURIST VISA"),
            ("No. of Entries", "MULTIPLE"), ("ETA Issue Date", "01/10/2026"), ("ETA Expiry Date", "30/09/2027"),
            ("Visa Validity", "365 DAYS")]
    for i, (label, value) in enumerate(rows):
        d.text((60, 290 + i * 80), f"{label}: {value}", font=_seg(34), fill=0)
    d.text((40, 1150), "Show this printout with your passport at the immigration counter.", font=_seg(26), fill=(70, 70, 70))
    return img


ETA_TEXT = lambda g, application, passport: [  # noqa: E731  (the PDF text layer of the ETA printout)
    "ELECTRONIC TRAVEL AUTHORISATION (ETA)", f"Application ID: {application}", f"Applicant Name: {g.given} {g.surname}",
    f"Date of Birth: {g.printed_dob}", "Nationality: UNITED STATES", f"Passport Number: {passport}", "Visa Type: e-TOURIST VISA",
    "No. of Entries: MULTIPLE", "ETA Issue Date: 01/10/2026", "ETA Expiry Date: 30/09/2027", "Visa Validity: 365 DAYS"]


def _mrz_lines(d, lines, top, size=34, left=30):
    for i, text in enumerate(lines):
        d.text((left, top + i * int(size * 1.6)), text, font=K._mono(size), fill=0)


# ---- OCI and PIO -----------------------------------------------------------------------------------------------------------

def oci_booklet(g: Foreigner, number: str, passport: str) -> Image.Image:
    """The old OCI booklet's data page ("Certificate of Registration")."""
    img, d = _canvas(K.PAGE, (240, 236, 222))
    d.text((40, 20), "OVERSEAS CITIZEN OF INDIA", font=_bold(40), fill=(20, 60, 110))
    d.text((40, 75), "Certificate of Registration under Section 7A", font=_seg(28), fill=(20, 60, 110))
    d.rectangle((40, 140, 290, 460), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    _rows(d, [("Registration No.", number), ("Surname", g.surname), ("Given Name", g.given), ("Date of Birth", g.printed_dob),
              ("Sex", g.sex)], 330, 130, 75, 22, 32)
    _rows(d, [("Nationality", "AMERICAN"), ("Passport No.", passport), ("Place of Issue", "HOUSTON"), ("Date of Issue", "11/05/2010")],
          780, 130, 75, 22, 32)
    return img


def oci_u_visa(g: Foreigner, visa_number: str, oci: str, passport: str) -> Image.Image:
    """The OCI "U" lifelong visa sticker in the foreign passport (MRV-A MRZ: the sticker's own visa number)."""
    img, d = _canvas(K.VISA, (236, 244, 240))
    d.text((40, 20), "VISA   INDIA", font=_bold(40), fill=(20, 90, 60))
    d.rectangle((40, 100, 260, 380), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    _rows(d, [("Surname", g.surname), ("Given Names", g.given), ("Passport No.", passport), ("OCI No.", oci)], 300, 95, 70, 22, 30)
    _rows(d, [("Type", "U"), ("Entries", "MULTIPLE"), ("Valid Until", "LIFE LONG"), ("Remarks", "MULTIPLE ENTRY LIFELONG")],
          750, 95, 70, 22, 30)
    _mrz_lines(d, K.mrv("A", "IND", g.surname, g.given, visa_number, g.nationality, g.dob, g.sex, "991231"), 650)
    return img


def pio_card(g: Foreigner, number: str, passport: str) -> Image.Image:
    img, d = _canvas(K.PAGE, (246, 238, 226))
    d.text((40, 20), "PERSON OF INDIAN ORIGIN CARD", font=_bold(40), fill=(120, 60, 20))
    d.text((40, 75), "Government of India", font=_seg(30), fill=(120, 60, 20))
    d.rectangle((40, 140, 290, 460), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    _rows(d, [("PIO Card No.", number), ("Surname", g.surname), ("Given Name", g.given), ("Date of Birth", g.printed_dob)],
          330, 130, 80, 22, 32)
    _rows(d, [("Nationality", "BRITISH"), ("Passport No.", passport), ("Valid Until", "10/08/2028")], 780, 130, 80, 22, 32)
    return img


# ---- residence permits -----------------------------------------------------------------------------------------------------

def rp_td1_front(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(K.CARD, (236, 240, 230))
    d.text((30, 15), "AUFENTHALTSTITEL   RESIDENCE PERMIT", font=_bold(32), fill=(40, 60, 40))
    d.rectangle((30, 90, 250, 370), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    _rows(d, [("Surname", g.surname), ("Given names", g.given), ("Date of birth", g.printed_dob.replace("/", ".")),
              ("Nationality", g.nationality)], 290, 80, 85, 22, 32)
    d.text((30, 470), f"Card No: {number}", font=_seg(32), fill=0)
    d.text((30, 530), "Type of permit: EMPLOYMENT", font=_seg(28), fill=0)
    return img


def rp_td1_back(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(K.CARD, (230, 236, 226))
    d.text((30, 20), "Address: Lindenweg 14, 80331 Munchen", font=_seg(30), fill=0)
    d.text((30, 70), "Remarks: Employment permitted", font=_seg(28), fill=0)
    _mrz_lines(d, K.td1("D<<", g.surname, g.given, number, g.nationality, g.dob, g.sex, "290505", code="AR"), 360, 40, 40)
    return img


def rp_td2_front(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(K.CARD, (240, 232, 236))
    d.text((30, 15), "RESIDENCE PERMIT", font=_bold(32), fill=(90, 30, 60))
    d.rectangle((30, 90, 230, 330), fill=(190, 196, 205), outline=(120, 120, 120), width=3)
    d.text((270, 100), f"Surname: {g.surname}", font=_seg(30), fill=0)
    d.text((270, 150), f"Given names: {g.given}", font=_seg(30), fill=0)
    d.text((270, 200), f"Date of birth: {g.printed_dob}", font=_seg(30), fill=0)
    _mrz_lines(d, K.td2("PRT", g.surname, g.given, number, g.nationality, g.dob, g.sex, "300318", code="IR"), 440, 36, 30)
    return img


def rp_td2_back(g: Foreigner, number: str) -> Image.Image:
    img, d = _canvas(K.CARD, (236, 228, 232))
    d.text((30, 20), "RESIDENCE PERMIT", font=_seg(30), fill=(90, 30, 60))
    d.text((30, 70), f"Card No: {number}", font=_seg(32), fill=0)
    d.text((30, 110), "Address: Rua Augusta 40, 1100-053 Lisboa", font=_seg(30), fill=0)
    return img


def frro_permit(g: Foreigner, number: str, passport: str, visa: str) -> Image.Image:
    """An invented FRRO residential permit printout (A4)."""
    img, d = _canvas(A4, PAPER)
    d.rectangle((0, 0, A4[0], 90), fill=(90, 40, 20))
    d.text((40, 22), "Government of India  -  Bureau of Immigration", font=_bold(34), fill=(255, 255, 255))
    d.text((40, 120), "Foreigners Regional Registration Office, Ahmedabad", font=_seg(30), fill=0)
    d.text((40, 180), "RESIDENTIAL PERMIT", font=_bold(44), fill=(90, 40, 20))
    rows = [("RP No", number), ("Name", f"{g.given} {g.surname}"), ("Date of Birth", g.printed_dob), ("Nationality", "GERMAN"),
            ("Passport No", passport), ("Visa No", visa), ("Visa Type", "EMPLOYMENT"), ("Valid Till", "31/12/2027"),
            ("Address in India", "B-204 Shanti Residency, Bodakdev"), ("", "Ahmedabad, Gujarat - 380054")]
    for i, (label, value) in enumerate(rows):
        d.text((60, 290 + i * 78), f"{label}: {value}" if label else value, font=_seg(32), fill=0)
    d.text((40, 1150), "Registration Certificate cum Residential Permit, issued through e-FRRO.", font=_seg(24), fill=(70, 70, 70))
    return img


# ---- PDF files -------------------------------------------------------------------------------------------------------------

def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf_page(picture: Image.Image, text_lines: list[str] | None = None, page=(595, 842), encrypt_with: str | None = None) -> bytes:
    """A one-page A4 PDF: the picture as a JPEG over the whole page, plus (optionally) an INVISIBLE text layer (render mode 3) with
    the given lines, as an e-Aadhaar or ETA PDF carries. Built by hand (no PDF library writes it), so the file is fully known.
    `encrypt_with` protects it with that user password (standard security handler, revision 2, RC4 40-bit), as UIDAI protects
    an e-Aadhaar."""
    buf = io.BytesIO()
    picture.convert("RGB").save(buf, "JPEG", quality=92)
    jpeg = buf.getvalue()
    lock = _Lock(encrypt_with) if encrypt_with else None
    w, h = page
    ops = [f"q {w} 0 0 {h} 0 0 cm /Im0 Do Q"]
    if text_lines:
        ops.append("BT 3 Tr /F1 10 Tf")
        for i, t in enumerate(text_lines):
            ops.append(f"1 0 0 1 40 {h - 60 - i * 16} Tm ({_escape(t)}) Tj")
        ops.append("ET")
    content = zlib.compress("\n".join(ops).encode("latin-1"))
    if lock:
        jpeg, content = lock.seal(4, jpeg), lock.seal(5, content)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /XObject << /Im0 4 0 R >> /Font << /F1 6 0 R >> >> "
        f"/Contents 5 0 R >>".encode(),
        f"<< /Type /XObject /Subtype /Image /Width {picture.width} /Height {picture.height} /ColorSpace /DeviceRGB "
        f"/BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n".encode() + jpeg + b"\nendstream",
        f"<< /Length {len(content)} /Filter /FlateDecode >>\nstream\n".encode() + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    trailer = f"/Size {len(objects) + 1} /Root 1 0 R" + (lock.trailer() if lock else "")
    out.write(f"trailer\n<< {trailer} >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


_PAD = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")


def _rc4(key: bytes, data: bytes) -> bytes:
    s, j = list(range(256)), 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    out, i, j = bytearray(), 0, 0
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


class _Lock:
    """PDF standard security handler, revision 2 (PDF 1.7 section 7.6.3, algorithms 2, 3 and 4)."""

    def __init__(self, user: str, owner: str = "invented-owner") -> None:
        import hashlib
        pad = lambda pw: (pw.encode("latin-1") + _PAD)[:32]  # noqa: E731
        self.id = hashlib.md5(b"invented test pdf").digest()
        self.p = -44  # print and copy allowed, nothing else (bits 3 and 5 set, high bits set)
        self.o = _rc4(hashlib.md5(pad(owner)).digest()[:5], pad(user))
        self.key = hashlib.md5(pad(user) + self.o + self.p.to_bytes(4, "little", signed=True) + self.id).digest()[:5]
        self.u = _rc4(self.key, _PAD)

    def seal(self, number: int, data: bytes) -> bytes:
        import hashlib
        return _rc4(hashlib.md5(self.key + number.to_bytes(3, "little") + b"\x00\x00").digest()[:10], data)

    def trailer(self) -> str:
        return (f" /Encrypt << /Filter /Standard /V 1 /R 2 /Length 40 /O <{self.o.hex()}> /U <{self.u.hex()}> /P {self.p} >>"
                f" /ID [<{self.id.hex()}> <{self.id.hex()}>]")


def e_aadhaar_text(p, vid: str) -> list[str]:
    """The English part of an e-Aadhaar PDF's text layer (INVENTED)."""
    return ["Unique Identification Authority of India", "Enrolment No.: 1234/56789/01234", "To", p.name, p.street, p.city,
            "Your Aadhaar No. :", p.spaced, f"VID : {vid[:4]} {vid[4:8]} {vid[8:12]} {vid[12:]}", "Government of India", p.name,
            f"DOB: {p.dob}", p.gender, p.spaced]

