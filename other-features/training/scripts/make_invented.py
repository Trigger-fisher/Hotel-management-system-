"""INVENTED ID-like cards for testing the training pipeline. No real person, number or photo is involved.

  .venv\\Scripts\\python.exe scripts\\make_invented.py --out D:\\hmsd\\fake --guests 30 [--seed 7]

Draws Aadhaar-, PAN-, driving-licence-, voter-ID- and passport-like cards with invented names and numbers (valid check digits
so the pseudo-label rules can be exercised), in Latin, Devanagari and Gujarati, then applies blur / glare / tilt / noise variants.
Writes:  photos/*.jpg,  truth.jsonl (every drawn line with its box and text, the fields, the guest id),
         labels.jsonl (the same fields in the accuracy review form's format, as if a person had reviewed them).
Fonts come from C:\\Windows\\Fonts (Segoe UI, Nirmala UI for Devanagari and Gujarati, Consolas for the MRZ)."""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import mrz_check_digit, secure_qr_payload, verhoeff_append  # noqa: E402

FONT_DIR = Path(r"C:\Windows\Fonts")
FIRST = [("Aarav", "आरव", "આરવ"), ("Kiran", "किरण", "કિરણ"), ("Meera", "मीरा", "મીરા"), ("Rohan", "रोहन", "રોહન"),
         ("Nisha", "निशा", "નિશા"), ("Vikram", "विक्रम", "વિક્રમ"), ("Pooja", "पूजा", "પૂજા"), ("Arjun", "अर्जुन", "અર્જુન"),
         ("Sneha", "स्नेहा", "સ્નેહા"), ("Dev", "देव", "દેવ"), ("Tara", "तारा", "તારા"), ("Kabir", "कबीर", "કબીર")]
LAST = [("Patel", "पटेल", "પટેલ"), ("Mehta", "मेहता", "મહેતા"), ("Desai", "देसाई", "દેસાઈ"), ("Joshi", "जोशी", "જોશી"),
        ("Shah", "शाह", "શાહ"), ("Verma", "वर्मा", "વર્મા"), ("Rao", "राव", "રાવ"), ("Nair", "नायर", "નાયર")]
TYPES = ["aadhaar", "pan", "driving-licence", "voter-id", "passport"]
VARIANTS = ["clean", "blur", "glare", "tilt", "noise"]
_FONTS: dict = {}


def font(name: str, size: int):
    key = (name, size)
    if key not in _FONTS:
        try:
            _FONTS[key] = ImageFont.truetype(str(FONT_DIR / name), size)
        except OSError:
            _FONTS[key] = ImageFont.load_default()
    return _FONTS[key]


def invent_guest(rng: random.Random, gid: int) -> dict:
    f, l = rng.choice(FIRST), rng.choice(LAST)
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    day, month, year = rng.randint(1, 28), rng.randint(1, 12), rng.randint(1955, 2005)
    aadhaar = verhoeff_append(str(rng.randint(2, 9)) + "".join(str(rng.randint(0, 9)) for _ in range(10)))
    pan = "".join(rng.choice(letters) for _ in range(3)) + "P" + l[0][0].upper() + f"{rng.randint(0, 9999):04d}" + rng.choice(letters)
    return {"guest": f"G{gid:05d}", "name": f"{f[0]} {l[0]}", "dev": f"{f[1]} {l[1]}", "guj": f"{f[2]} {l[2]}",
            "dob": f"{day:02d}/{month:02d}/{year}", "iso": f"{year}-{month:02d}-{day:02d}", "gender": rng.choice("MF"),
            "aadhaar": aadhaar, "pan": pan, "father": f"{rng.choice(FIRST)[0]} {l[0]}",
            "dl": f"GJ{rng.randint(1, 38):02d} {rng.randint(2000, 2024)}{rng.randint(0, 9999999):07d}",
            "epic": "".join(rng.choice(letters) for _ in range(3)) + f"{rng.randint(0, 9999999):07d}",
            "passport": rng.choice(letters) + f"{rng.randint(0, 9999999):07d}",
            "yymmdd": f"{year % 100:02d}{month:02d}{day:02d}"}


class Card:
    def __init__(self, size=(1100, 700), colour=(248, 246, 238)) -> None:
        self.img = Image.new("RGB", size, colour)
        self.d = ImageDraw.Draw(self.img)
        self.lines: list[dict] = []

    def text(self, xy, text, fnt, field=None, value=None):
        self.d.text(xy, text, font=fnt, fill=(20, 20, 20))
        x0, y0, x1, y1 = self.d.textbbox(xy, text, font=fnt)
        x0, y0, x1, y1 = x0 - 4, y0 - 4, x1 + 4, y1 + 4
        rec = {"quad": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], "text": text}
        if field:
            rec["field"], rec["value"] = field, value if value is not None else text
        self.lines.append(rec)


def qr_image(text: str, side=240) -> Image.Image | None:
    try:
        import zxingcpp
    except ImportError:
        return None
    if hasattr(zxingcpp, "create_barcode"):
        arr = np.asarray(zxingcpp.write_barcode_to_image(zxingcpp.create_barcode(text, zxingcpp.BarcodeFormat.QRCode), scale=4))
    else:
        arr = np.asarray(zxingcpp.write_barcode(zxingcpp.BarcodeFormat.QRCode, text, width=side, height=side))
    arr = arr if arr.ndim == 2 else arr[..., 0]
    return Image.fromarray(arr).convert("RGB").resize((side, side), Image.NEAREST)


def draw(kind: str, g: dict, rng: random.Random) -> tuple[Card, dict]:
    seg, big, nir, mono = font("segoeui.ttf", 40), font("segoeuib.ttf", 54), font("Nirmala.ttc", 40), font("consola.ttf", 36)
    spaced = f"{g['aadhaar'][:4]} {g['aadhaar'][4:8]} {g['aadhaar'][8:]}"
    fields: dict[str, str] = {}
    if kind == "aadhaar":
        c = Card()
        c.text((40, 30), "Government of India", seg)
        c.text((40, 85), "भारत सरकार", nir)
        local = g["dev"] if rng.random() < 0.5 else g["guj"]
        c.text((40, 165), local, nir, "nameLocal")
        c.text((40, 225), g["name"], seg, "name")
        c.text((40, 285), f"DOB: {g['dob']}", seg, "dob", g["dob"])
        c.text((40, 345), "Male / पुरुष" if g["gender"] == "M" else "Female / महिला", nir)
        c.text((40, 520), spaced, big, "documentNumber", g["aadhaar"])
        qr = qr_image(secure_qr_payload(g["name"], g["dob"].replace("/", "-"), g["aadhaar"][-4:], g["gender"]))
        if qr:
            c.img.paste(qr, (800, 130))
        fields = {"name": g["name"], "dob": g["iso"], "documentNumber": g["aadhaar"], "nameLocal": local}
    elif kind == "pan":
        c = Card(colour=(225, 235, 250))
        c.text((40, 30), "INCOME TAX DEPARTMENT", seg)
        c.text((40, 85), "आयकर विभाग", nir)
        c.text((40, 160), "Permanent Account Number Card", seg)
        c.text((40, 230), g["pan"], big, "documentNumber")
        c.text((40, 330), g["name"].upper(), seg, "name", g["name"].upper())
        c.text((40, 400), g["father"].upper(), seg, "fatherName", g["father"].upper())
        c.text((40, 470), g["dob"], seg, "dob")
        fields = {"name": g["name"].upper(), "dob": g["iso"], "documentNumber": g["pan"]}
    elif kind == "driving-licence":
        c = Card(colour=(245, 240, 225))
        c.text((40, 30), "DRIVING LICENCE", big)
        c.text((40, 105), "ડ્રાઇવિંગ લાઇસન્સ", nir)
        c.text((40, 190), f"DL No: {g['dl']}", seg, "documentNumber", g["dl"])
        c.text((40, 260), f"Name: {g['name']}", seg, "name", g["name"])
        c.text((40, 330), f"DOB: {g['dob']}", seg, "dob", g["dob"])
        c.text((40, 400), "Transport Department Gujarat", seg)
        fields = {"name": g["name"], "dob": g["iso"], "documentNumber": g["dl"].replace(" ", "")}
    elif kind == "voter-id":
        c = Card(colour=(250, 240, 235))
        c.text((40, 30), "ELECTION COMMISSION OF INDIA", seg)
        c.text((40, 90), "ભારતનું ચૂંટણી પંચ", nir)
        c.text((40, 180), g["epic"], big, "documentNumber")
        c.text((40, 270), f"Name: {g['name']}", seg, "name", g["name"])
        c.text((40, 340), f"નામ: {g['guj']}", nir, "nameLocal", g["guj"])
        fields = {"name": g["name"], "documentNumber": g["epic"], "nameLocal": g["guj"]}
    else:  # passport-like data page with a TD3 machine readable zone (invented country code UTO, as in ICAO examples)
        c = Card(size=(1250, 700), colour=(240, 244, 250))
        sur, given = g["name"].split()[1].upper(), g["name"].split()[0].upper()
        c.text((40, 30), "PASSPORT  UTOPIA", seg)
        c.text((40, 100), f"Surname: {sur}", seg, "surname", sur)
        c.text((40, 160), f"Given names: {given}", seg, "givenNames", given)
        c.text((40, 220), f"Date of birth: {g['dob']}", seg, "dob", g["dob"])
        c.text((40, 280), f"Passport No: {g['passport']}", seg, "documentNumber", g["passport"])
        l1 = f"P<UTO{sur}<<{given}".ljust(44, "<")
        n = g["passport"].ljust(9, "<")
        exp, p = "321231", "<" * 14
        body = n + mrz_check_digit(n) + "UTO" + g["yymmdd"] + mrz_check_digit(g["yymmdd"]) + g["gender"] + exp + mrz_check_digit(exp) + p + mrz_check_digit(p)
        l2 = body + mrz_check_digit(body[0:10] + body[13:20] + body[21:43])
        c.text((25, 540), l1, mono, "mrz1")
        c.text((25, 600), l2, mono, "mrz2")
        fields = {"name": f"{given} {sur}", "dob": g["iso"], "documentNumber": g["passport"]}
    return c, fields


def apply_variant(img: Image.Image, lines: list[dict], variant: str, rng: random.Random) -> tuple[Image.Image, list[dict]]:
    """Places the card on a background with a margin, then degrades it. Line quads are moved with the card."""
    m = 60
    bg = Image.new("RGB", (img.width + 2 * m, img.height + 2 * m), tuple(rng.randint(60, 140) for _ in range(3)))
    bg.paste(img, (m, m))
    quads = [[[x + m, y + m] for x, y in ln["quad"]] for ln in lines]
    if variant == "tilt":
        angle = rng.uniform(-6, 6)
        cx, cy = bg.width / 2, bg.height / 2
        bg = bg.rotate(angle, resample=Image.BICUBIC, center=(cx, cy), fillcolor=(90, 90, 90))
        a = np.deg2rad(angle)
        cos, sin = np.cos(a), np.sin(a)
        quads = [[[cx + (x - cx) * cos + (y - cy) * sin, cy - (x - cx) * sin + (y - cy) * cos] for x, y in q] for q in quads]
    elif variant == "blur":
        bg = bg.filter(ImageFilter.GaussianBlur(rng.uniform(1.0, 2.0)))
    elif variant == "glare":
        overlay = Image.new("L", bg.size, 0)
        od = ImageDraw.Draw(overlay)
        x, y = rng.randint(200, bg.width - 200), rng.randint(150, bg.height - 150)
        od.ellipse((x - 180, y - 90, x + 180, y + 90), fill=150)
        overlay = overlay.filter(ImageFilter.GaussianBlur(40))
        bg = Image.composite(Image.new("RGB", bg.size, (255, 255, 255)), bg, overlay)
    elif variant == "noise":
        arr = np.asarray(bg).astype(np.float32) + np.random.default_rng(rng.randint(0, 10**6)).normal(0, 14, (bg.height, bg.width, 3))
        bg = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    out = []
    for ln, q in zip(lines, quads):
        out.append({**ln, "quad": [[round(float(x), 1), round(float(y), 1)] for x, y in q]})
    return bg, out


def generate(out: Path, guests: int, seed: int = 7, cards_per_guest: tuple[int, int] = (1, 3)) -> dict:
    rng = random.Random(seed)
    photos = out / "photos"
    photos.mkdir(parents=True, exist_ok=True)
    truth, labels = [], []
    for gid in range(guests):
        g = invent_guest(rng, gid)
        kinds = rng.sample(TYPES, rng.randint(*cards_per_guest))
        for kind in kinds:
            card, fields = draw(kind, g, rng)
            variant = rng.choice(VARIANTS)
            img, lines = apply_variant(card.img, card.lines, variant, rng)
            name = f"{g['guest']}_{kind}_{variant}.jpg"
            img.save(photos / name, quality=92)
            truth.append({"photo": name, "guest": g["guest"], "docType": kind, "variant": variant, "fields": fields, "lines": lines})
            labels.append({"photo": name, "expectedType": kind, "detectedType": kind,
                           "fields": [{"field": k, "extracted": v, "final": v, "notOnCard": False, "confidence": 0.9, "flag": "", "extra": False}
                                      for k, v in fields.items()]})
    with open(out / "truth.jsonl", "w", encoding="utf-8") as fh:
        for t in truth:
            fh.write(json.dumps(t, ensure_ascii=False) + "\n")
    with open(out / "labels.jsonl", "w", encoding="utf-8") as fh:
        for rec in labels:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return {"guests": guests, "photos": len(truth)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--guests", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    print(json.dumps(generate(Path(a.out), a.guests, a.seed)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
