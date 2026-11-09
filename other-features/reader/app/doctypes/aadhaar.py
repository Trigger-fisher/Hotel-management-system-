"""Aadhaar: a 12-digit number whose last digit is a Verhoeff check digit, often with a QR code.

QR cross-check: the QR is decoded (old XML form, or the "secure QR" big number = gzip of fields split by 0xFF) and its
name and date of birth are compared with the OCR text. A mismatch makes the OCR field `doubtful`.
The secure QR's digital SIGNATURE IS NOT VERIFIED here (it needs the UIDAI public certificate, which is not bundled)."""
from __future__ import annotations

import re
import zlib

from ..fields import name_similarity, normalise_dob, NAME_MATCH_THRESHOLD
from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("aadhaar", "आधार", "આધાર", "uidai", "unique identification authority", "भारत सरकार", "ભારત સરકાર")


def parse_qr(text: str) -> dict | None:
    """{name, dob, gender, last4} from an Aadhaar QR payload, or None. Best effort; not signature-verified."""
    text = text.strip()
    if text.startswith("<") and "uid=" in text:  # old XML form
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', text))
        return {"name": attrs.get("name"), "dob": attrs.get("dob") or attrs.get("yob"), "gender": attrs.get("gender"),
                "last4": (attrs.get("uid") or "")[-4:], "form": "xml"}
    if text.isdigit() and len(text) > 60:  # secure QR (real ones are thousands of digits)
        try:
            raw = int(text).to_bytes((int(text).bit_length() + 7) // 8, "big")
            body = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
        except (ValueError, zlib.error, OverflowError):
            return None
        parts = body.split(b"\xff")
        if len(parts) < 5:
            return None
        get = lambda i: parts[i].decode("utf-8", "replace").strip()  # noqa: E731
        reference = get(1)
        return {"name": get(2), "dob": get(3), "gender": get(4), "last4": reference[:4], "form": "secure"}
    return None


def _iso(dob: str | None) -> str | None:
    if not dob:
        return None
    m = re.match(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})", dob)
    if m:
        return normalise_dob(*m.groups())
    return dob if re.fullmatch(r"\d{4}", dob) else None


def _name_above_dob(ctx: Context) -> dict | None:
    """An Aadhaar prints the name WITHOUT a label, on the line above the date of birth."""
    for i, line in enumerate(ctx.lines):
        if i and re.search(r"dob|date of birth|\d{2}[/-]\d{2}[/-]\d{4}", line["text"], re.I):
            for prev in reversed(ctx.lines[max(0, i - 2):i]):
                text = prev["text"].strip()
                if re.fullmatch(r"[A-Za-z .'-]{4,60}", text) and len(text.split()) >= 2:
                    return make_field(text, prev["confidence"], "ocr")
    return None


class Aadhaar(DocType):
    name = "aadhaar"

    def score(self, ctx: Context) -> float:
        has_valid = any(i["type"] == "aadhaar" and i["valid"] for i in ctx.identifiers)
        has_any = any(i["type"] == "aadhaar" for i in ctx.identifiers)
        qr = any(parse_qr(c["text"]) for c in ctx.codes)
        return min(1.0, 0.55 * has_valid + 0.2 * (has_any and not has_valid) + keyword_score(ctx, KEYWORDS, 0.35) + 0.25 * qr)

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        if "name" not in out and (guess := _name_above_dob(ctx)):
            out["name"] = guess
        numbers = [i for i in ctx.identifiers if i["type"] == "aadhaar"]
        if numbers:
            best = max(numbers, key=lambda i: i["valid"])
            out["documentNumber"] = make_field(re.sub(r"\s", "", best["text"]), 0.9, "ocr", valid=best["valid"])
        for code in ctx.codes:
            qr = parse_qr(code["text"])
            if not qr:
                continue
            out["qrLast4"] = make_field(qr["last4"], 0.99, "qr")
            number = out.get("documentNumber")
            if number and qr["last4"] and not number["value"].endswith(qr["last4"]):
                number["doubtful"] = True  # the QR says another last four digits
            if qr.get("name"):
                name = out.get("name")
                if name and name_similarity(name["value"], qr["name"]) < NAME_MATCH_THRESHOLD:
                    name["doubtful"] = True
                if not name:
                    out["name"] = make_field(qr["name"], 0.99, "qr")
            dob_qr, dob_ocr = _iso(qr.get("dob")), out.get("dob")
            if dob_qr and dob_ocr and dob_qr != dob_ocr["value"] and not (len(dob_qr) == 4 and dob_ocr["value"].startswith(dob_qr)):
                dob_ocr["doubtful"] = True
            if dob_qr and not dob_ocr:
                out["dob"] = make_field(dob_qr, 0.99, "qr")
            break
        return out


DOC_TYPE = Aadhaar()
