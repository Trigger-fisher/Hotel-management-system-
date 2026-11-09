"""INVENTED ID-like cards drawn in code. Fonts come from C:\\Windows\\Fonts. Numbers are generated with valid check
digits; no real person or document is involved."""
from __future__ import annotations

import gzip
import io

import numpy as np
from PIL import Image, ImageDraw

from tests.imaging import font
from tests.test_helpers import verhoeff_append
from app import mrz

AADHAAR = verhoeff_append("23456789012")
SPACED = f"{AADHAAR[:4]} {AADHAAR[4:8]} {AADHAAR[8:]}"
NAME, DOB = "Ramesh Kumar Shah", "01/02/1990"
SIZE = (1100, 700)


def canvas(colour=(248, 246, 238)):
    img = Image.new("RGB", SIZE, colour)
    return img, ImageDraw.Draw(img)


def secure_qr_payload(name=NAME, dob=DOB, last4=AADHAAR[-4:]) -> str:
    """The 'secure QR' shape: a big decimal number that is a gzip of fields separated by 0xFF. INVENTED content."""
    fields = [b"3", (last4 + "20260101000000").encode(), name.encode(), dob.replace("/", "-").encode(), b"M", b"C/O Invented", b"Surat"]
    return str(int.from_bytes(gzip.compress(b"\xff".join(fields)), "big"))


def qr_image(text: str, side=260) -> Image.Image:
    import zxingcpp
    arr = np.asarray(zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, text, width=side, height=side))
    arr = arr if arr.ndim == 2 else arr[..., 0]
    return Image.fromarray(arr).convert("RGB")


def aadhaar_front(name=NAME, dob=DOB, number=SPACED, with_qr=True, qr_name=None) -> Image.Image:
    img, d = canvas()
    seg, nir = font("segoeui.ttf", 40), font("Nirmala.ttc", 40)
    d.text((40, 30), "Government of India", font=seg, fill=0)
    d.text((40, 85), "भारत सरकार   आधार", font=nir, fill=0)
    d.text((40, 190), name, font=seg, fill=0)
    d.text((40, 250), f"DOB: {dob}", font=seg, fill=0)
    d.text((40, 310), "Male", font=seg, fill=0)
    d.text((40, 520), number, font=font("segoeui.ttf", 56), fill=0)
    d.text((40, 600), "Aadhaar - Aam Aadmi ka Adhikar", font=seg, fill=0)
    if with_qr:
        img.paste(qr_image(secure_qr_payload(qr_name or name, dob)), (780, 120))
    return img


def pan_card(name=NAME, dob=DOB, number="ABCPE1234F") -> Image.Image:
    img, d = canvas((225, 235, 250))
    f = font("segoeui.ttf", 40)
    d.text((40, 30), "INCOME TAX DEPARTMENT", font=f, fill=0)
    d.text((40, 90), "Permanent Account Number Card", font=f, fill=0)
    d.text((40, 190), number, font=font("segoeui.ttf", 58), fill=0)
    d.text((40, 300), f"Name: {name}", font=f, fill=0)
    d.text((40, 360), f"Date of Birth: {dob}", font=f, fill=0)
    return img


def driving_licence(name=NAME, dob=DOB, number="MH12 20110012345") -> Image.Image:
    img, d = canvas()
    f = font("segoeui.ttf", 40)
    d.text((40, 30), "DRIVING LICENCE", font=f, fill=0)
    d.text((40, 90), "Transport Department", font=f, fill=0)
    d.text((40, 200), f"DL No: {number}", font=f, fill=0)
    d.text((40, 270), f"Name: {name}", font=f, fill=0)
    d.text((40, 340), f"DOB: {dob}", font=f, fill=0)
    return img


def voter_id(name=NAME, number="ABC1234567") -> Image.Image:
    img, d = canvas((250, 240, 235))
    f = font("segoeui.ttf", 40)
    d.text((40, 30), "ELECTION COMMISSION OF INDIA", font=f, fill=0)
    d.text((40, 90), "ELECTOR PHOTO IDENTITY CARD", font=f, fill=0)
    d.text((40, 220), f"EPIC No: {number}", font=f, fill=0)
    d.text((40, 290), f"Name: {name}", font=f, fill=0)
    return img


def employee_card(name=NAME, number="E-10492") -> Image.Image:
    img, d = canvas((235, 250, 240))
    f = font("segoeui.ttf", 40)
    d.text((40, 30), "PALLAV HOTELS", font=f, fill=0)
    d.text((40, 90), "EMPLOYEE CARD", font=f, fill=0)
    d.text((40, 220), f"Name: {name}", font=f, fill=0)
    d.text((40, 290), f"Emp ID: {number}", font=f, fill=0)
    return img


def _line(kind: str, **kw) -> list[str]:
    cd = mrz.check_digit
    country, number, dob, exp = "UTO", kw.get("number", "L898902C3"), "740812", "320415"
    if kind == "TD3":
        l1 = ("P<" + country + "ERIKSSON<<ANNA<MARIA").ljust(44, "<")
        n = number.ljust(9, "<")
        p = "<" * 14
        body = n + cd(n) + country + dob + cd(dob) + "F" + exp + cd(exp) + p + cd(p)
        return [l1, body + cd(body[0:10] + body[13:20] + body[21:43])]
    letter = kw.get("letter", "I<")
    if kind == "TD1":
        l1 = (letter + country + number.ljust(9, "<") + cd(number.ljust(9, "<"))).ljust(30, "<")
        l2 = dob + cd(dob) + "F" + exp + cd(exp) + country + "<" * 11
        l2 += cd(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29])
        return [l1, l2, "ERIKSSON<<ANNA<MARIA".ljust(30, "<")]
    l1 = (letter + country + "ERIKSSON<<ANNA<MARIA").ljust(36, "<")
    n = number.ljust(9, "<")
    body = n + cd(n) + country + dob + cd(dob) + "F" + exp + cd(exp) + "<" * 7
    return [l1, body + cd(body[0:10] + body[13:20] + body[21:35])]


def mrz_card(kind: str, title: str, **kw) -> Image.Image:
    img, d = canvas((240, 244, 250))
    f, mono = font("segoeui.ttf", 44), font("consola.ttf", 40 if kind == "TD3" else 44) or font("cour.ttf", 40)
    d.text((40, 30), title, font=f, fill=0)
    d.text((40, 100), "Surname ERIKSSON   Given names ANNA MARIA", font=font("segoeui.ttf", 34), fill=0)
    lines = _line(kind, **kw)
    top = SIZE[1] - 60 - 62 * len(lines)
    for i, text in enumerate(lines):
        d.text((20 if kind == "TD3" else 10, top + i * 62), text, font=mono, fill=0)
    return img


def unknown_card() -> Image.Image:
    img, d = canvas((240, 230, 245))
    f = font("segoeui.ttf", 42)
    d.text((40, 40), "GOLDEN CLUB MEMBERSHIP", font=f, fill=0)
    d.text((40, 140), "Valued guest since 2019", font=f, fill=0)
    d.text((40, 220), "Present this card at the front desk", font=f, fill=0)
    return img


def png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
