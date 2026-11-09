# copied from reader on 2026-11-04 (extended in intake-worker on 2026-11-04: new PAN labels and QR, old PAN layout, father's name)
"""PAN card (India): the 10-character pattern AAAPA9999A and income-tax keywords. Front only (one side holds everything).

Two layouts:
  new (2018+)  label lines "नाम / Name", "पिता का नाम / Father's Name", "जन्म की तारीख / Date of Birth" with the value on the
               line BELOW; a QR code (its content is signed by the issuer; read here only as KEY=value text when it is that)
  old          no labels: the holder's name, then the father's name, then the date of birth, under "INCOME TAX DEPARTMENT"."""
from __future__ import annotations

import re

from ..fields import DATE, normalise_dob, parse_qr_payload
from .base import Context, DocType, keyword_score, make_field

KEYWORDS = ("income tax department", "permanent account number", "आयकर विभाग", "आयकर", "આવકવેરા", "આવકવેરા વિભાગ",
            "स्थायी लेखा संख्या")
NAME_LABEL = r"(?:^[^A-Za-z]*|/\s*)(?:name|holder['’]?s? name)\b"  # "नाम / Name": the Hindi part may be read as junk
FATHER_LABEL = r"\bfather['’]?s?\s*name\b"
DOB_LABEL = r"\b(?:date of birth|dob)\b"
PERSON_NAME = re.compile(r"[A-Z][A-Za-z .'-]{2,60}")
SKIP = re.compile(r"income tax|govt|government|india|permanent account|signature|card|department|account number", re.I)


def _old_layout(ctx: Context) -> tuple[dict | None, dict | None]:
    """Old PAN: the first two plain name lines after the header are the holder and the father."""
    names = []
    for line in ctx.lines:
        text = line["text"].strip()
        if DATE.search(text):
            break
        if PERSON_NAME.fullmatch(text) and not SKIP.search(text) and len(text.split()) >= 2:
            names.append(make_field(text, line["confidence"], "ocr"))
    return (names[0] if names else None), (names[1] if len(names) > 1 else None)


class Pan(DocType):
    name = "pan"

    def score(self, ctx: Context) -> float:
        pans = [i for i in ctx.identifiers if i["type"] == "pan"]
        return min(1.0, 0.55 * any(i["valid"] for i in pans) + 0.15 * bool(pans) + keyword_score(ctx, KEYWORDS, 0.45))

    def extract(self, ctx: Context) -> dict:
        out = ctx.generic_fields()
        out.pop("documentNumber", None)
        pans = [i for i in ctx.identifiers if i["type"] == "pan"]
        if pans:
            best = max(pans, key=lambda i: i["valid"])
            out["documentNumber"] = make_field(best["text"], 0.9, "ocr", valid=best["valid"])
        labelled = ctx.label_value(NAME_LABEL, PERSON_NAME)
        father = ctx.label_value(FATHER_LABEL, PERSON_NAME)
        if labelled:
            out["name"] = labelled
            out["form"] = make_field("new", 0.9, "layout")
        elif "name" not in out or out["name"]["source"] != "ocr":
            holder, father_old = _old_layout(ctx)
            if holder:
                out["name"] = holder
                father = father or father_old
            out["form"] = make_field("old", 0.8, "layout")
        if father:
            out["fatherName"] = father
        if dob := ctx.label_date(DOB_LABEL):
            out["dob"] = dob
        elif "dob" not in out and (m := DATE.search(ctx.text)):  # a PAN prints one date only: the date of birth
            out["dob"] = make_field(normalise_dob(*m.groups()), 0.8, "ocr")
        for code in ctx.codes:  # new PAN QR, when it is plain KEY=value text
            payload = parse_qr_payload(code.get("text", ""))
            if payload.get("ID") or payload.get("PAN"):
                out["qr"] = make_field("present", 0.99, "qr")
                number = (payload.get("ID") or payload.get("PAN") or "").replace(" ", "").upper()
                if out.get("documentNumber") and number and number != out["documentNumber"]["value"]:
                    out["documentNumber"]["doubtful"] = True
                out.setdefault("form", make_field("new", 0.9, "layout"))
                out["form"]["value"] = "new"
        return out


DOC_TYPE = Pan()
