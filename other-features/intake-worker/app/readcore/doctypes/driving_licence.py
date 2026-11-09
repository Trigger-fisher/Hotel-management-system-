# copied from reader on 2026-11-04 (extended in intake-worker on 2026-11-04: smart card and old state formats, both sides)
"""Driving licence (India first, other countries by keyword).

Number: SS RR YYYY NNNNNNN (MH12 20110012345, GJ01 20190001234) or an old state form SS-RR/NNNNN/YYYY; checked by
ids.dl_valid (known state code, RTO above 00, believable year). Both sides of the smart card carry the number.
Front: name, date of birth, S/D/W of, often the address (smart card), issue date and validity.
Back: classes of vehicle (MCWG, LMV, TRANS ...), issuing authority, sometimes the address."""
from __future__ import annotations

import re

from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("driving licence", "driving license", "driver license", "driver's licence", "permis de conduire", "führerschein",
            "licencia de conducir", "ड्राइविंग", "वाहन चालन", "चालन अनुज्ञप्ति", "ડ્રાઇવિંગ", "ડ્રાઈવિંગ", "transport department",
            "form 7", "indian union driving licence", "union of india", "licensing authority", "dl no", "licence no")
VEHICLE_CLASSES = re.compile(r"\b(MCWG|MCWOG|LMV|LMV-NT|LMV-TR|HMV|HGMV|HPMV|TRANS|MGV|INVCRG|ADPVEH|COV|e-?RIKSHAW)\b")
BACK_WORDS = re.compile(r"class of vehicle|cov\b|vehicle class|authori[sz]ation to drive|hazardous|badge|emergency contact", re.I)
NAME_LABEL = r"^[^A-Za-z]*(?:name|holder['’]?s? name|name of holder)\b"
RELATION = r"^[^A-Za-z]*(?:s\s*/\s*d\s*/\s*w\s*of|son\s*/\s*daughter\s*/\s*wife\s*of|s/o|d/o|w/o|father['’]?s? name)\b"
STOP = re.compile(r"^\W*(?:dob|date of|valid|blood|issue|doi|sign|s\s*/\s*d\s*/\s*w|name|class)\b", re.I)


class DrivingLicence(DocType):
    name = "driving-licence"

    def score(self, ctx: Context) -> float:
        numbers = [i for i in ctx.identifiers if i["type"] == "driving-licence"]
        classes = bool(VEHICLE_CLASSES.search(ctx.text.upper()))
        return min(1.0, keyword_score(ctx, KEYWORDS, 0.6) + 0.4 * any(i["valid"] for i in numbers) + 0.1 * bool(numbers)
                   + 0.15 * classes)

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        numbers = [i for i in ctx.identifiers if i["type"] == "driving-licence"]
        if numbers:
            best = max(numbers, key=lambda i: i["valid"])
            out["documentNumber"] = make_field(re.sub(r"[\s\-/]", "", best["text"]), 0.85, "ocr", valid=best["valid"])
        if "name" not in out and (name := ctx.label_value(NAME_LABEL, r"([A-Z][A-Za-z .'-]{2,60})")):
            out["name"] = name
        if relation := ctx.label_value(RELATION, r"([A-Z][A-Za-z .'-]{2,60})"):
            out["relationName"] = relation
        if "dob" not in out and (dob := ctx.label_date(r"^\W*(?:dob|d\.o\.b|date of birth)\b")):
            out["dob"] = dob
        if issue := ctx.label_date(r"(?:date of [il1]ssue|[il1]ssue date|doi|issued on)\b"):
            out["issueDate"] = issue
        if expiry := ctx.label_date(r"(?:valid till|valid upto|valid up to|validity(?:\s*\(nt\))?|expiry|valid until)\b"):
            out["expiry"] = expiry
        if "address" not in out and (address := ctx.block_after(r"^\W*address\b", STOP)):
            out["address"] = address
        classes = sorted(set(VEHICLE_CLASSES.findall(ctx.text.upper())))
        if classes:
            out["vehicleClasses"] = make_field(" ".join(classes), 0.8, "ocr")
        if gender := ctx.gender():
            out["gender"] = gender
        smart = ctx.has("indian union driving licence", "union of india")
        old = bool(numbers) and re.search(r"/", numbers[0]["text"]) is not None
        out["form"] = make_field("smart" if smart else "old" if old else "card", 0.8, "layout")
        return out


DOC_TYPE = DrivingLicence()
